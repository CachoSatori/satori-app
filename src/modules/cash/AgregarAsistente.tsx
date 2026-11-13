import { useState, useMemo, useEffect, useRef } from 'react'
import { createCashMovement, upsertSupplier } from '../../shared/api/cash'
import { getFinanceAccounts, type FinanceAccount } from '../../shared/api/finance'
import {
  uploadImage, extractImageDetalle, createDocumentRow, cuadra, sha256File, findDuplicate, findDuplicateClave, findFacturaParecida,
  type DocExtract,
} from '../../shared/api/documents'
import {
  fechaCortaCR, revisarDocumentos, mensajeBloqueo, mensajePostPago, MSG_PARECIDA, MSG_VARIAS_FACTURAS, MSG_QUEDAN_SIN_CARGAR,
  resumenVarias, type DocRevisado,
} from '../../shared/utils/facturaDuplicada'
import { normalizeInvoiceImage } from '../../shared/utils/imageNormalize'
import { classifyMovement } from '../../shared/utils/classifyMovement'
import { PAGO_META, formasPago, type Pago } from '../../shared/utils/pagoMatrix'
import { norm } from '../../shared/api/inventoryIngest'
import { tipShiftToCaja } from '../../shared/utils'
import { fi, fd } from './cashUtils'
import { useManagerOverride } from '../../shared/ManagerOverride'
import type { CashSession, CashMovement, Supplier, UserRole } from '../../shared/types/database'

// F4.3a — el "➕ Agregar" único de Caja Diaria (SPEC §5). Asistente de UNA pantalla con secciones
// progresivas: Captura MANUAL → Clasificación advisory (classifyMovement, RN-2) → Pago (matriz RN-3
// reusada) → Confirmar. Crea el cash_movement vía createCashMovement (idempotente por client_op_id):
//   · Mercadería → classification='mercaderia' → el trigger crea la tarea de Revisión (INV-1).
//   · Operativa(aprobado, con cuenta) → el trigger postea el asiento operativo.
//   · Ingreso → movimiento de ingreso (dirección de flujo elegida explícitamente, NO se infiere).
// FOTO/IA (aditivo, Opción A): opcionalmente el cajero saca una foto → el MISMO pipeline de la Bandeja
// (normalizeInvoiceImage → uploadImage → extractImage) PRECARGA los campos (todo editable, RN-2) y, al
// confirmar, el documento se enlaza al movimiento recién creado (linked_movement_id) con sus ítems → si es
// mercadería la tarea nace con ítems (completable sin rectificación). El camino manual sigue igual.
// Los 3 botones viejos siguen vivos (F4.3c los retira).

type Clase = 'mercaderia' | 'operativa' | 'ingreso'

interface Props {
  openSession: CashSession            // requerido: el asistente vive en la vista de turno (caja abierta)
  suppliers:   Supplier[]
  role:        UserRole
  createdBy:   string                 // profile.id
  tc:          number                 // tipo de cambio vigente
  onCreated:   (m: CashMovement) => void
  onClose:     () => void
  /** (13-nov, prueba física caso B) Ya NO se usa: el aviso del módulo se pintaba DETRÁS del modal (overlay fijo).
   *  Todos los avisos del asistente se muestran ahora DENTRO del modal (estado `aviso`). Se deja opcional por compat. */
  onError?:    (msg: string) => void
}

// Match de proveedor por nombre (trim + acentos/case vía norm) contra los activos — para enlazar
// supplier_id en mercadería. Solo lee; no da de alta (eso queda para el flujo con foto / F4.3b).
function matchSupplier(name: string, suppliers: Supplier[]): Supplier | null {
  const key = norm(name)
  if (!key) return null
  return suppliers.find(s => s.is_active && (norm(s.name) === key || (s.aliases ?? []).some(a => norm(a) === key))) ?? null
}

const claseLabel: Record<Clase, string> = { mercaderia: 'Mercadería', operativa: 'Operativa', ingreso: 'Ingreso' }

// ── Ingreso adicional (Caja Diaria) — endurecimiento ──────────────────────────────────────
// La categoría (dropdown) y el motivo son obligatorios; ambos se guardan en `description`
// (`${categoría} · ${motivo}`). subcategory se mantiene 'Ingreso adicional' (compat pozo/reportes)
// → SIN cambio de esquema. Un ingreso que supera el umbral (equivalente CRC = crc + usd·tc) exige
// autorización de gerencia antes de crear. SOLO aplica a esta clase del asistente.
const INGRESO_CATEGORIAS = ['Aceite/reciclaje', 'Reintegro', 'Devolución de proveedor', 'Otro'] as const
const INGRESO_UMBRAL_CRC = 100_000

export default function AgregarAsistente({ openSession, suppliers, role, createdBy, tc, onCreated, onClose }: Props) {
  // (13-nov, prueba física caso B) Aviso DENTRO del modal, arriba (bajo el título): bloqueo por foto/clave FE repetida,
  // «no se pudo verificar», lectura caída, error al registrar y el aviso post-pago. Antes iba a onError → el banner de
  // CashModule, que queda DETRÁS del overlay fijo del modal (index.css .cd-modal-overlay z-index 1000): la cajera no
  // veía nada. Se borra al cargar otra foto o al cerrar (el modal se desmonta).
  const [aviso, setAviso] = useState<string | null>(null)
  const avisoRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (aviso) avisoRef.current?.scrollIntoView?.({ block: 'nearest' })   // si el form estaba scrolleado, que se vea
  }, [aviso])
  // ── 1. Captura manual ──────────────────────────────────────
  const [descripcion, setDescripcion] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [montoCRC, setMontoCRC] = useState<number | ''>('')
  const [montoUSD, setMontoUSD] = useState<number | ''>('')
  const [fechaFactura, setFechaFactura] = useState('')   // opcional; la fecha de REGISTRO es hoy (RN-1)
  // Resolución de proveedor: pickedSupplierId = uno elegido/creado a mano (pisa el auto-match por nombre);
  // createdSuppliers = altas al vuelo en este flujo (aún no en el prop suppliers).
  const [pickedSupplierId, setPickedSupplierId] = useState<string | null>(null)
  const [createdSuppliers, setCreatedSuppliers] = useState<Supplier[]>([])
  const [creatingSup, setCreatingSup] = useState(false)

  // ── 2. Clasificación advisory (RN-2: sugiere, el humano confirma) ──
  const sugerencia = useMemo(
    () => classifyMovement({ text: descripcion, supplierName, amount: Number(montoCRC) || 0 }, suppliers),
    [descripcion, supplierName, montoCRC, suppliers],
  )
  // La clase efectiva sigue la sugerencia hasta que el humano elige otra (null = "seguir la sugerencia").
  const [clasePicked, setClasePicked] = useState<Clase | null>(null)
  const clase: Clase = clasePicked ?? sugerencia.suggestion

  // ── 3. Pago (matriz RN-3 reusada) ──────────────────────────
  const formas = useMemo(() => formasPago(role), [role])
  const [pago, setPago] = useState<Pago>(formas[0])   // local → 'efectivo'; oficina → 'pendiente'
  const [accountId, setAccountId] = useState<string>('')
  const [accounts, setAccounts] = useState<FinanceAccount[]>([])
  const [accountsError, setAccountsError] = useState(false)   // falló la carga (≠ "no hay cuentas")
  useEffect(() => {
    let on = true
    getFinanceAccounts()
      .then(a => { if (on) { setAccounts(a); setAccountsError(false) } })
      .catch(() => { if (on) setAccountsError(true) })   // no bloquea: el gasto se registra igual (P&L cae al catch-all)
    return () => { on = false }
  }, [])
  const cuentasGasto = useMemo(() => accounts.filter(a => a.section === 'expenses' && a.is_leaf), [accounts])

  const [saving, setSaving] = useState(false)

  // ── Ingreso adicional (Caja Diaria): categoría + motivo obligatorios; umbral con autorización ──
  const requireManager = useManagerOverride()
  const [ingresoCategoria, setIngresoCategoria] = useState<string>('')   // '' = sin elegir (bloquea)
  const [ingresoMotivo, setIngresoMotivo] = useState('')

  // ── Flujo guiado (decisión del dueño): el modal abre con DOS opciones — foto (protagonista)
  // o carga manual — y el formulario completo recién se revela después. 'form' se alcanza por:
  // (a) foto sacada y leída (onPhoto lo setea al terminar) o (b) tap en "Carga manual".
  // Cancelar la cámara NO dispara el change del input → la vista queda en 'opciones' sola.
  // 'listo' (13-nov, caso B): el pago YA se registró pero hubo un aviso post-pago → queda a la vista hasta «Cerrar».
  const [vista, setVista] = useState<'opciones' | 'form' | 'listo'>('opciones')

  // Borra los campos del formulario (no la foto). Lo usan «← Volver» y el paso a la próxima factura de la misma foto.
  const limpiarCampos = () => {
    setDescripcion(''); setSupplierName(''); setMontoCRC(''); setMontoUSD(''); setFechaFactura('')
    setPickedSupplierId(null); setClasePicked(null)
    setIngresoCategoria(''); setIngresoMotivo('')
    setPago(formas[0]); setAccountId('')
  }
  // ← Volver desde el form: limpia el borrador SIN crear nada y regresa a las dos opciones.
  // (createdSuppliers no se limpia: los proveedores creados ya existen en la base.)
  const volverAOpciones = () => {
    limpiarCampos()
    setPhoto(null); setParecida(null); setEsOtra(false); setAviso(null); setPendiente(null)
    setVista('opciones')
  }

  // ── Foto/IA (aditivo) ──────────────────────────────────────
  // photo = la factura ya subida + lo extraído por la IA, para enlazarla al movimiento al confirmar.
  // (13-nov, el dueño — #149) `docs`: TODOS los documentos de la foto; `idx`: el que se está cargando ahora
  // (`extracted` = docs[idx]). Con 2 o más, el asistente los carga UNO POR UNO sin cerrarse: cada uno es su propio
  // movimiento y su propio documento «procesado» (mismo path/sha). Nada va a la Bandeja como «nuevo» desde acá.
  // `fallo`: la lectura falló (≠ la IA no vio documentos). `parecida`: ya hay una factura del mismo proveedor, número y
  // total → aviso no bloqueante: hay que tocar «Es otra» para confirmar.
  type Foto = { path: string; sha: string; fallo: boolean; docs: DocExtract[] }
  const [photo, setPhoto] = useState<(Foto & { idx: number; extracted: DocExtract | null }) | null>(null)
  const [parecida, setParecida] = useState<{ cuando: string; numero: string } | null>(null)
  const [esOtra, setEsOtra] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // ── Varias facturas en una foto (#149) ──
  const totalFacturas = photo?.docs.length ?? 0
  const varias = totalFacturas >= 2
  // La factura actual no se puede registrar: 'repetida' (clave FE ya cargada) o 'error' (no se pudo verificar).
  // El formulario se oculta y solo se ofrece «Saltear esta factura» (y «Reintentar» si fue error).
  const [pendiente, setPendiente] = useState<'repetida' | 'error' | null>(null)
  const [verificando, setVerificando] = useState(false)          // revisando la próxima factura de la foto
  const [confirmarSalida, setConfirmarSalida] = useState<number | null>(null)   // K facturas sin cargar
  const [resumenListo, setResumenListo] = useState('✓ El movimiento quedó registrado.')
  const [hechas, setHechas] = useState(0)                        // espejo para el render (← Volver / Cambiar foto)
  // Plata: refs (no estado) para que un doble toque en el MISMO render no pase dos veces. `registradas` = índices de
  // la foto que ya tienen movimiento: confirmar nunca registra dos veces el mismo índice (doble toque, reintento).
  const guardandoRef = useRef(false)
  const registradasRef = useRef<Set<number>>(new Set())
  const hechasRef = useRef(0)
  const salteadasRef = useRef(0)
  const postAvisosRef = useRef<string[]>([])
  const depsRevision = { porClave: findDuplicateClave, parecida: findFacturaParecida }

  const precargar = (ex: DocExtract) => {
    if (ex.proveedor) { setSupplierName(ex.proveedor); setPickedSupplierId(null) }   // re-resolver por el nombre leído
    if (ex.concepto || ex.proveedor) setDescripcion(ex.concepto || ex.proveedor || '')
    if (ex.total != null) {
      if (ex.moneda === 'USD') setMontoUSD(ex.total)
      else setMontoCRC(ex.total)
    }
    if (ex.fecha) setFechaFactura(ex.fecha)
    setClasePicked(null)   // que la sugerencia se recalcule sobre lo recién precargado
  }

  // Deja a la vista la factura `idx` de la foto, ya revisada (clave FE y parecida). Si su clave FE ya está cargada
  // (de otra foto o de una factura anterior de ESTA foto), no se precarga para registrar: solo «Saltear esta factura».
  const mostrarFactura = (base: Foto, idx: number, rev: DocRevisado<DocExtract> | null) => {
    const ex = base.docs[idx] ?? null
    limpiarCampos()
    if (ex) precargar(ex)
    setPhoto({ ...base, idx, extracted: ex })
    setEsOtra(false)
    setConfirmarSalida(null)
    if (rev?.claveRepetida) {
      setParecida(null)
      setPendiente('repetida')
      setAviso(`Factura ${idx + 1} de ${base.docs.length}: ${mensajeBloqueo('clave', rev.claveRepetida, 'caja')} Tocá «Saltear esta factura».`)
    } else {
      setPendiente(null)
      setAviso(null)
      setParecida(rev?.parecida ? { cuando: fechaCortaCR(rev.parecida.created_at), numero: String(ex?.numero_documento ?? '') } : null)
    }
  }

  // Pasa a la factura `idx` de la misma foto: la revisa recién ahora (así ve la que se acaba de registrar).
  // Si no se puede verificar → no se precarga para registrar: «Reintentar» o «Saltear esta factura».
  const irAFactura = async (base: Foto, idx: number) => {
    setVerificando(true)
    try {
      const [rev] = await revisarDocumentos([base.docs[idx]], depsRevision)
      mostrarFactura(base, idx, rev ?? null)
    } catch (e) {
      mostrarFactura(base, idx, null)
      setParecida(null)
      setPendiente('error')
      setAviso(`Factura ${idx + 1} de ${base.docs.length}: ${e instanceof Error ? e.message : 'No se pudo verificar la factura.'}`)
    } finally {
      setVerificando(false)
    }
  }

  // Fin del recorrido (o salida a medias). Sin nada que avisar → se cierra como siempre; si no → «listo» con el resumen.
  const terminar = (salida: boolean) => {
    const total = photo?.docs.length ?? 0
    const post = postAvisosRef.current
    if (total < 2) {
      if (post.length) { setAviso(post.join(' ')); setResumenListo('✓ El movimiento quedó registrado.'); setVista('listo') }
      else onClose()
      return
    }
    const r = resumenVarias(total, hechasRef.current, salteadasRef.current, post)
    if (!r || (salida && hechasRef.current === 0)) { onClose(); return }   // nada registrado al salir → nada que avisar
    setAviso(r.aviso); setResumenListo(r.titulo); setPendiente(null); setConfirmarSalida(null); setVista('listo')
  }

  const saltear = () => {
    if (!photo || guardandoRef.current) return
    salteadasRef.current += 1
    if (photo.idx + 1 >= photo.docs.length) terminar(false)
    else void irAFactura(photo, photo.idx + 1)
  }

  // Cancelar / tocar afuera: con varias facturas a medias, primero se pregunta (dentro del modal).
  const intentarCerrar = () => {
    if (guardandoRef.current) return   // registrando: no se corta a la mitad
    if (vista === 'form' && varias && photo) {
      const quedan = photo.docs.length - hechasRef.current - salteadasRef.current
      if (quedan > 0) { setConfirmarSalida(quedan); return }
    }
    onClose()
  }

  // Reusa EXACTO el pipeline de la Bandeja: normalizar → (13-nov) ¿foto repetida? → subir → leer → (13-nov) ¿clave FE
  // repetida? ¿factura parecida? La extracción PRECARGA los campos (todo editable; RN-2: la IA no confirma). El doc se
  // enlaza recién al confirmar (con el id del movimiento); los demás documentos de la foto van a la Bandeja al confirmar.
  // Misma foto o misma clave FE → BLOQUEA (decisión del dueño, sin excepción de rol): no se precarga ni se enlaza nada.
  const onPhoto = async (file: File) => {
    setPhotoBusy(true)
    setAviso(null)   // otra foto → el aviso anterior se va
    try {
      const { blob, filename } = await normalizeInvoiceImage(file)
      const shaFoto = await sha256File(blob)
      // Foto repetida (sha): se revisa UNA vez, acá. Las facturas de esta misma foto comparten sha y no se bloquean entre sí.
      const dupFoto = await findDuplicate(shaFoto, null)
      if (dupFoto) { setAviso(mensajeBloqueo('foto', dupFoto, 'caja')); return }
      const { path, sha } = await uploadImage(blob, filename)
      const { documentos, fallo } = await extractImageDetalle(path)
      const base: Foto = { path, sha, fallo, docs: documentos }
      // Recorrido nuevo: nada registrado todavía de esta foto.
      registradasRef.current = new Set(); hechasRef.current = 0; salteadasRef.current = 0; postAvisosRef.current = []
      setHechas(0)
      // Revisión de la PRIMERA factura (clave FE y parecida); las siguientes se revisan al llegar a cada una.
      const [rev] = await revisarDocumentos(documentos.slice(0, 1), depsRevision)
      // Una sola factura con clave FE repetida → BLOQUEA como siempre (no abre el formulario).
      if (documentos.length < 2 && rev?.claveRepetida) { setAviso(mensajeBloqueo('clave', rev.claveRepetida, 'caja')); return }
      mostrarFactura(base, 0, rev ?? null)
      // Flujo guiado: con la foto lista (leída o no), recién ahora se revela el formulario
      // completo (precarga + confirmación). Si falla (catch), la vista no cambia → el usuario
      // sigue en las dos opciones y puede sacar otra foto o ir a manual.
      setVista('form')
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo leer la factura — probá otra foto o cargá a mano.')
    } finally {
      setPhotoBusy(false)
    }
  }
  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) onPhoto(f)
    e.target.value = ''   // permite re-sacar la misma foto
  }

  const amountCRC = Number(montoCRC) || 0
  const amountUSD = Number(montoUSD) || 0
  const montoOk = amountCRC > 0 || amountUSD > 0
  const montoNegativo = amountCRC < 0 || amountUSD < 0   // Ítem 2: entrada manual no admite montos < 0

  // Ingreso adicional: categoría + motivo completos (sino no se puede crear) y si el equivalente en
  // colones (crc + usd·tc) supera el umbral → hay que pedir autorización de gerencia antes de crear.
  const ingresoCompleto = ingresoCategoria !== '' && ingresoMotivo.trim() !== ''
  const ingresoSuperaUmbral = clase === 'ingreso' && amountCRC + amountUSD * tc > INGRESO_UMBRAL_CRC

  // Preview del destino, para que el cajero vea qué va a pasar antes de confirmar.
  const preview = clase === 'ingreso'
    ? 'Ingreso → entra a la Registradora'
    : `${PAGO_META[pago].caja} · ${PAGO_META[pago].status === 'pendiente' ? 'Pendiente (cuenta por pagar)' : 'Pagado'}`
      + (clase === 'mercaderia' ? ' · crea tarea de Revisión de inventario' : '')

  // ── Resolución de proveedor ────────────────────────────────
  // Lista total = proveedores del padre + los recién creados acá. El RESUELTO = el elegido/creado a mano
  // (pickedSupplierId) o, si no, el match EXACTO por nombre (matchSupplier/norm reusado, sin reimplementar).
  const allSuppliers = useMemo(() => [...suppliers, ...createdSuppliers], [suppliers, createdSuppliers])
  const nameTrimmed = supplierName.trim()
  const autoMatch = useMemo(() => matchSupplier(supplierName, allSuppliers), [supplierName, allSuppliers])
  const pickedSupplier = pickedSupplierId ? (allSuppliers.find(s => s.id === pickedSupplierId) ?? null) : null
  const resolvedSupplier: Supplier | null = pickedSupplier ?? autoMatch   // elegido/creado pisa el auto-match
  const resolvedSupplierId = resolvedSupplier?.id ?? null
  const supplierUnknown = nameTrimmed.length > 0 && !resolvedSupplier
  // Parecidos (anti-duplicado): comparten substring o un token significativo (≥4) con lo tipeado/leído.
  const similares = useMemo(() => {
    if (!supplierUnknown) return []
    const q = norm(nameTrimmed)
    const qtok = new Set(q.split(/\s+/).filter(t => t.length >= 4))
    return allSuppliers.filter(s => s.is_active && (
      norm(s.name).includes(q) || q.includes(norm(s.name)) ||
      [...new Set(norm(s.name).split(/\s+/))].some(t => t.length >= 4 && qtok.has(t))
    )).slice(0, 6)
  }, [supplierUnknown, nameTrimmed, allSuppliers])

  const pickSupplier = (s: Supplier) => { setPickedSupplierId(s.id); setSupplierName(s.name) }
  const crearProveedor = async () => {
    if (!nameTrimmed || creatingSup) return
    setCreatingSup(true)
    try {
      const s = await upsertSupplier({ name: nameTrimmed })   // reusa el alta existente (defaults: CRC/Efectivo/activo)
      setCreatedSuppliers(prev => [...prev, s])
      setPickedSupplierId(s.id)
      setSupplierName(s.name)
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo crear el proveedor — reintentá.')
    } finally { setCreatingSup(false) }
  }

  const confirmar = async () => {
    if (!montoOk || saving || guardandoRef.current || verificando || pendiente) return
    // (#149) Índice de la factura de la foto que se registra. Si ya tiene movimiento, nunca se registra otra vez.
    const idx = photo?.idx ?? 0
    if (photo && registradasRef.current.has(idx)) return
    setAviso(null)
    if (parecida && !esOtra) return   // (13-nov) aviso de factura parecida: hay que confirmar «Es otra»
    if (montoNegativo) { setAviso('El monto no puede ser negativo.'); return }   // Ítem 2
    // Ingreso adicional: sin categoría o sin motivo NO se crea (se elimina el default mudo).
    if (clase === 'ingreso' && !ingresoCompleto) return
    guardandoRef.current = true
    setSaving(true)

    // Umbral (Caja Diaria): un ingreso cuyo equivalente en colones supera ₡100.000 exige autorización
    // de gerencia ANTES de crear. owner/manager pasan solos; otros → modal de contraseña. Si cancela o
    // la contraseña no valida (!auth.ok) → no se crea nada. Patrón canónico de ManagerOverride.
    if (ingresoSuperaUmbral) {
      const auth = await requireManager()
      if (!auth.ok) { guardandoRef.current = false; setSaving(false); return }
    }

    // Paso 1 — crear el movimiento (plata). Si falla, NO se intenta el doc (no se duplica el movimiento).
    let mov: CashMovement
    try {
      if (clase === 'ingreso') {
        // Dirección de flujo = entrada. No lleva clasificación mercadería/operativa. La categoría
        // elegida + el motivo se persisten en description; subcategory se mantiene 'Ingreso adicional'.
        const description = `${ingresoCategoria} · ${ingresoMotivo.trim()}`
        mov = await createCashMovement({
          session_id:    openSession.id,
          created_by:    createdBy,
          movement_type: 'ingreso',
          amount_crc:    amountCRC,
          amount_usd:    amountUSD,
          currency:      'CRC',
          exchange_rate: tc,
          description,
          subcategory:   'Ingreso adicional',
          method:        'Efectivo',
          caja_origen:   'Registradora',
          shift:         tipShiftToCaja(openSession.shift_type),
        })
      } else {
        const baseDesc = descripcion.trim() || supplierName.trim() || claseLabel[clase]
        const description = fechaFactura ? `${baseDesc} · fact ${fechaFactura}` : baseDesc
        const { method, status, caja } = PAGO_META[pago]
        const esMercaderia = clase === 'mercaderia'
        mov = await createCashMovement({
          session_id:    openSession.id,
          created_by:    createdBy,
          movement_type: esMercaderia ? 'egreso_mercaderia' : 'egreso_operativo',
          amount_crc:    amountCRC,
          amount_usd:    amountUSD,
          currency:      'CRC',
          exchange_rate: tc,
          description,
          subcategory:   esMercaderia ? 'Proveedor mercadería' : 'Operativo',
          // Proveedor RESUELTO (matcheado / elegido / recién creado) → va en mercadería Y operativa para
          // que los movimientos agrupen/filtren por proveedor. No es campo de plata.
          supplier_id:   resolvedSupplierId,
          supplier_name: (resolvedSupplier?.name ?? supplierName.trim()) || undefined,
          method,
          caja_origen:   caja,
          status,
          // Operativa: la cuenta de gasto dispara el asiento operativo del trigger (aprobado + account_id).
          account_id:    esMercaderia ? null : (accountId || null),
          // Efectivo descuenta la caja física → necesita el turno; lo electrónico sale del Banco.
          shift:         pago === 'efectivo' ? tipShiftToCaja(openSession.shift_type) : undefined,
          // Clase EFECTIVA = la confirmada por el humano. suggested_* = snapshot de lo que propuso el
          // sistema (auditoría: qué sugirió vs qué eligió el humano).
          classification:           clase,
          suggested_classification: sugerencia.suggestion,
          suggested_confidence:     sugerencia.confidence,
        })
      }
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo registrar el movimiento — reintentá.')
      guardandoRef.current = false
      setSaving(false)
      return
    }
    // El movimiento YA está: este índice no se vuelve a registrar.
    registradasRef.current.add(idx)
    hechasRef.current += 1
    setHechas(hechasRef.current)

    // Paso 2 — si hubo foto, enlazar la factura al movimiento recién creado (estado='procesado' → no entra
    // a la cola de la Bandeja). Best-effort: el movimiento ya está; si el enlace falla, la factura se puede
    // adjuntar después en Revisión (vía F4.3b) → NO se reintenta el movimiento (evita duplicar plata).
    // (#149) Cada factura de la foto: su PROPIO documento «procesado» enlazado a SU movimiento (mismo path/sha).
    if (photo) {
      let enlaceFallo = false
      try {
        await createDocumentRow(photo.path, photo.sha, photo.extracted, createdBy, mov.id, 'procesado')
      } catch {
        enlaceFallo = true
      }
      // (13-nov, verificación) Si el enlace falló, nunca «subí la foto a la Bandeja»: entraría como «nuevo» y el pago
      // ya hecho se podría pagar dos veces. El aviso se junta y se muestra al final (en «listo»).
      const avisoPost = mensajePostPago(enlaceFallo, 0)
      if (avisoPost) postAvisosRef.current.push(varias ? `Factura ${idx + 1}: ${avisoPost}` : avisoPost)
    }
    onCreated(mov)
    setSaving(false)
    // (#149) Quedan facturas de esta foto → NO se cierra: pasa a la siguiente. El candado se suelta recién cuando la
    // siguiente quedó a la vista (y el índice registrado ya está en `registradas`).
    if (photo && varias && idx + 1 < photo.docs.length) {
      await irAFactura(photo, idx + 1)
      guardandoRef.current = false
      return
    }
    guardandoRef.current = false
    // (13-nov, caso B) Con aviso post-pago el modal queda en «listo» hasta «Cerrar» (sin formulario → no se paga dos veces).
    terminar(false)
  }

  const confPct = Math.round(sugerencia.confidence * 100)
  const confNivel = sugerencia.confidence >= 0.8 ? 'alta' : sugerencia.confidence >= 0.6 ? 'media' : 'baja'

  // Calidad de la LECTURA de la IA (≠ confianza de la clasificación). Informativo (RN-2): no bloquea.
  // Reusa cuadra() para el cruce ítems↔total (no se reimplementa el chequeo).
  const lectura = photo?.extracted ?? null
  const lecturaPct = lectura ? Math.round((lectura.confianza ?? 0) * 100) : 0
  const lecturaCuadra = lectura ? cuadra(lectura) : true
  const lecturaAlerta = !!lectura && (lectura.requiere_revision === true || (lectura.confianza ?? 0) < 0.5)
  // Ítems leídos (read-only) para revisar antes de confirmar. El emparejamiento va en Revisión, no acá.
  const lineItems = lectura?.items ?? []
  const fmtMoney = (n: number) => (lectura?.moneda === 'USD' ? fd : fi)(n)

  return (
    <div className="cd-modal-overlay" onClick={intentarCerrar}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="cd-modal-title">➕ Agregar factura / movimiento</div>

        {/* (13-nov, caso B) Aviso dentro del modal, arriba: se ve sin scroll en el celular. */}
        {aviso && (
          <div ref={avisoRef} className="tips-error" role="alert" data-testid="aviso-asistente" style={{ margin: '0.6rem 0 0.4rem' }}>
            <span>⚠ {aviso}</span>
          </div>
        )}

        {/* Input de cámara SIEMPRE montado: lo disparan la opción grande de la pantalla inicial
            Y el botón "Cambiar foto" del form. Cancelar la cámara no emite change → no pasa nada. */}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPickPhoto} aria-label="Foto de la factura" />

        {vista === 'listo' ? (
          /* ── Pago registrado con aviso post-pago: solo el aviso (arriba) y «Cerrar». ── */
          <>
            <div className="cd-method-info ok" style={{ marginTop: '0.4rem' }}>{resumenListo}</div>
            <div className="cd-modal-actions" style={{ marginTop: '1rem' }}>
              <button className="cd-btn-green" onClick={onClose}>Cerrar</button>
            </div>
          </>
        ) : vista === 'opciones' ? (
          /* ── Pantalla inicial (flujo guiado): foto protagonista, manual secundario ── */
          <>
            <p style={{ fontSize: '0.78rem', color: 'var(--c-gris)', margin: '0.4rem 0 1rem' }}>
              ¿Cómo querés cargar el movimiento?
            </p>
            <button className="cd-btn-green" style={{ width: '100%', padding: '1.1rem 1rem', fontSize: '1rem', lineHeight: 1.35 }}
              disabled={photoBusy} onClick={() => fileRef.current?.click()}>
              {photoBusy ? '📷 Leyendo factura…' : (
                <>
                  📷 Sacar foto de la factura
                  <div style={{ fontSize: '0.68rem', fontWeight: 400, opacity: 0.85, marginTop: 4 }}>
                    La IA lee la factura y precarga los campos — recomendado
                  </div>
                </>
              )}
            </button>
            <button className="tips-btn-ghost" style={{ width: '100%', marginTop: '0.6rem', padding: '0.7rem 1rem' }}
              disabled={photoBusy} onClick={() => setVista('form')}>
              ✏️ Carga manual (sin foto)
            </button>
            <div className="cd-modal-actions" style={{ marginTop: '1rem' }}>
              <button className="tips-btn-ghost" onClick={onClose} disabled={photoBusy}>Cancelar</button>
            </div>
          </>
        ) : confirmarSalida !== null ? (
          /* ── (#149) Salir a medias de una foto con varias facturas: se confirma dentro del modal. ── */
          <>
            <div className="cd-method-info pend" role="alert" data-testid="confirmar-salida" style={{ marginTop: '0.6rem' }}>
              ⚠ {MSG_QUEDAN_SIN_CARGAR(confirmarSalida)}
            </div>
            <div className="cd-modal-actions" style={{ marginTop: '1rem' }}>
              <button className="tips-btn-ghost" onClick={() => setConfirmarSalida(null)}>Seguir cargando</button>
              <button className="cd-btn-green" onClick={() => { setConfirmarSalida(null); terminar(true) }}>Salir</button>
            </div>
          </>
        ) : varias && (pendiente || verificando) ? (
          /* ── (#149) Factura de la foto que no se puede registrar (repetida / sin verificar) o en revisión. ── */
          <>
            {photo && (
              <div className="cd-method-info" role="status" data-testid="varias-progreso" style={{ marginTop: '0.4rem' }}>
                {MSG_VARIAS_FACTURAS(photo.docs.length, photo.idx + 1)}
              </div>
            )}
            {verificando ? (
              <p style={{ fontSize: '0.78rem', color: 'var(--c-gris)', margin: '0.6rem 0' }}>Revisando la próxima factura…</p>
            ) : (
              <div className="cd-modal-actions" style={{ marginTop: '1rem' }}>
                <button className="tips-btn-ghost" onClick={intentarCerrar}>Cancelar</button>
                {pendiente === 'error' && photo && (
                  <button className="tips-btn-ghost" onClick={() => void irAFactura(photo, photo.idx)}>Reintentar</button>
                )}
                <button className="cd-btn-green" onClick={saltear}>Saltear esta factura</button>
              </div>
            )}
          </>
        ) : (
        <>
        {/* (#149) Varias facturas en la foto: en cuál va la cajera. */}
        {varias && photo && (
          <div className="cd-method-info" role="status" data-testid="varias-progreso" style={{ marginTop: '0.4rem' }}>
            {MSG_VARIAS_FACTURAS(photo.docs.length, photo.idx + 1)}
          </div>
        )}
        {/* ← Volver: descarta el borrador (no se creó nada) y regresa a las dos opciones. Con facturas de la foto ya
            registradas no se puede (se perderían las que faltan sin aviso): se sale con «Cancelar», que pregunta. */}
        <button type="button" className="tips-btn-ghost" onClick={volverAOpciones} disabled={saving || photoBusy || hechas > 0}
          style={{ padding: '2px 10px', fontSize: '0.72rem', marginTop: '0.3rem' }}>
          ← Volver
        </button>

        {/* ── 1. Captura — foto (opcional) + manual ── */}
        <div className="tips-field" style={{ marginTop: '0.5rem' }}>
          <button className="tips-btn-ghost" style={{ width: '100%' }} disabled={photoBusy || hechas > 0}
            onClick={() => fileRef.current?.click()}>
            {photoBusy ? '📷 Leyendo factura…' : photo ? '📷 Cambiar foto' : '📷 Sacar foto de la factura (la IA precarga)'}
          </button>
          {photo && photo.extracted && (
            <div style={{ fontSize: '0.66rem', marginTop: 3 }}>
              <div style={{ color: 'var(--c-musgo)' }}>
                ✓ Factura leída{photo.extracted.items?.length ? ` · ${photo.extracted.items.length} ítem(s)` : ''} · confianza {lecturaPct}% — revisá y corregí los campos antes de confirmar.
              </div>
              <div style={{ color: lecturaCuadra ? 'var(--c-musgo)' : 'var(--c-oro-texto)', marginTop: 2 }}>
                {lecturaCuadra ? '✓ los ítems cuadran con el total leído' : '⚠ los ítems no suman el total — puede faltar alguna línea, revisá'}
              </div>
              {lecturaAlerta && (
                <div className="cd-method-info pend" role="alert" style={{ marginTop: 4 }}>
                  ⚠ Confianza baja — revisá bien los campos y los ítems antes de confirmar.
                </div>
              )}
            </div>
          )}
          {photo && !photo.extracted && (
            <div className="cd-method-info pend" role="alert" style={{ fontSize: '0.66rem', marginTop: 3 }}>
              {photo.fallo
                ? '⚠ No se pudo leer la factura (falló la lectura) — completá los campos a mano. La foto igual se enlaza al pago.'
                : '⚠ La IA no encontró una factura en la foto — completá los campos a mano. La foto igual se enlaza al pago.'}
            </div>
          )}
          {parecida && (
            <div className="cd-method-info pend" role="alert" style={{ fontSize: '0.66rem', marginTop: 4 }}>
              ⚠ {MSG_PARECIDA(parecida.cuando, parecida.numero)}{' '}
              {esOtra ? <strong>✓ Marcada como otra factura.</strong> : (
                <button type="button" className="tips-btn-ghost" style={{ padding: '1px 8px', fontSize: '0.66rem' }} onClick={() => setEsOtra(true)}>
                  Es otra
                </button>
              )}
              {/* (#149) Con varias facturas en la foto, la parecida también se puede saltear (p. ej. la misma leída dos veces). */}
              {varias && !esOtra && (
                <>{' '}<button type="button" className="tips-btn-ghost" style={{ padding: '1px 8px', fontSize: '0.66rem' }} onClick={saltear} disabled={saving}>
                  Saltear esta factura
                </button></>
              )}
            </div>
          )}
        </div>

        {/* ── 2. Clasificación advisory ── (orden T3-B decidido por el dueño: Foto → Clasificación →
            Proveedor → Montos → Descripción → Fecha. La sugerencia es un useMemo puro sobre
            descripción/proveedor/monto → se recalcula sola aunque esos campos estén más abajo.) */}
        <div className="tips-field" style={{ marginTop: '1rem' }}>
          <div className="tips-field-label">
            Clasificación — sugerido: <strong>{claseLabel[sugerencia.suggestion]}</strong> (confianza {confNivel} · {confPct}%)
          </div>
          <div className="cd-metodo-tabs" role="group" aria-label="Clasificación">
            {(['mercaderia', 'operativa', 'ingreso'] as Clase[]).map(c => (
              <div key={c}
                className={`cd-metodo-tab ${clase === c ? 'active' : ''}`}
                role="button" tabIndex={0} aria-pressed={clase === c}
                onClick={() => setClasePicked(c)}>
                {claseLabel[c]}{c === sugerencia.suggestion ? ' ✦' : ''}
              </div>
            ))}
          </div>
          <div style={{ fontSize: '0.66rem', color: 'var(--c-gris)', marginTop: 4 }}>
            Es una sugerencia: confirmala o cambiala. Ingreso se elige a mano (no se deduce del texto).
          </div>
        </div>

        <div className="tips-field" style={{ marginTop: '0.5rem' }}>
          <div className="tips-field-label">Proveedor (opcional)</div>
          {/* En carga manual (sin foto) el foco arranca acá — primer input del orden T3-B.
              Llegando por foto, photo ya está seteado → sin autofocus (no roba scroll). */}
          <input type="text" className="tips-input-dark" style={{ width: '100%' }} aria-label="Proveedor"
            placeholder="Nombre del proveedor, si aplica" autoFocus={!photo}
            value={supplierName} onChange={e => { setSupplierName(e.target.value); setPickedSupplierId(null) }} />
          {resolvedSupplier && (
            <div style={{ fontSize: '0.66rem', color: 'var(--c-musgo)', marginTop: 3 }}>✓ Proveedor reconocido: {resolvedSupplier.name}</div>
          )}
          {supplierUnknown && (
            <div style={{ marginTop: 4 }}>
              <div className="cd-method-info pend" role="alert">
                ⚠ «{nameTrimmed}» no existe en el sistema — puede ser un error de lectura. Elegí uno existente o crealo.
              </div>
              {similares.length > 0 && (
                <div style={{ fontSize: '0.66rem', color: 'var(--c-gris)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                  ¿Quisiste decir?
                  {similares.map(s => (
                    <button key={s.id} type="button" className="tips-btn-ghost" style={{ padding: '2px 8px', fontSize: '0.7rem' }}
                      onClick={() => pickSupplier(s)}>{s.name}</button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <select className="tips-input-dark" style={{ flex: 1, minWidth: 160 }} aria-label="Elegir proveedor existente"
                  value="" onChange={e => { const s = allSuppliers.find(x => x.id === e.target.value); if (s) pickSupplier(s) }}>
                  <option value="">— elegir proveedor existente —</option>
                  {allSuppliers.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button type="button" className="cd-btn-green" onClick={crearProveedor} disabled={creatingSup}>
                  {creatingSup ? 'Creando…' : `+ Crear «${nameTrimmed}»`}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="cd-grid2" style={{ marginTop: '0.75rem' }}>
          <div className="tips-field">
            <div className="tips-field-label">Monto ₡ colones</div>
            <div className="cd-monto-wrap">
              <span className="cd-prefix">₡</span>
              <input type="number" className="cd-monto-input" aria-label="Monto colones" placeholder="0" min={0}
                value={montoCRC} onChange={e => setMontoCRC(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
          </div>
          <div className="tips-field">
            <div className="tips-field-label">Monto $ dólares</div>
            <div className="cd-monto-wrap usd">
              <span className="cd-prefix">$</span>
              <input type="number" className="cd-monto-input" aria-label="Monto dólares" placeholder="0" min={0}
                value={montoUSD} onChange={e => setMontoUSD(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
          </div>
        </div>
        {montoNegativo && (
          <div className="cd-method-info pend" role="alert" style={{ marginTop: 4 }}>
            ⚠ El monto no puede ser negativo.
          </div>
        )}

        {clase === 'ingreso' ? (
          /* Ingreso adicional: categoría (obligatoria) + motivo (obligatorio) reemplazan la descripción
             libre. Ambos se guardan juntos en `description` al confirmar (subcategory queda 'Ingreso adicional'). */
          <>
            <div className="tips-field" style={{ marginTop: '0.75rem' }}>
              <div className="tips-field-label">Categoría del ingreso</div>
              <select className="tips-input-dark" style={{ width: '100%' }} aria-label="Categoría del ingreso"
                value={ingresoCategoria} onChange={e => setIngresoCategoria(e.target.value)}>
                <option value="">— elegí una categoría —</option>
                {INGRESO_CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="tips-field" style={{ marginTop: '0.75rem' }}>
              <div className="tips-field-label">Motivo / nota</div>
              <input type="text" className="tips-input-dark" style={{ width: '100%' }} aria-label="Motivo del ingreso"
                placeholder="Por qué entra esta plata (obligatorio)"
                value={ingresoMotivo} onChange={e => setIngresoMotivo(e.target.value)} />
            </div>
          </>
        ) : (
          <div className="tips-field" style={{ marginTop: '0.75rem' }}>
            <div className="tips-field-label">Descripción / concepto</div>
            <input type="text" className="tips-input-dark" style={{ width: '100%' }} aria-label="Descripción"
              placeholder="Ej: pescado fresco, alquiler del local, ingreso por…"
              value={descripcion} onChange={e => setDescripcion(e.target.value)} />
          </div>
        )}

        <div className="tips-field" style={{ marginTop: '0.75rem' }}>
          <div className="tips-field-label">Fecha de la factura (opcional)</div>
          <input type="date" className="tips-input-dark" style={{ width: '100%' }} aria-label="Fecha de factura"
            value={fechaFactura} onChange={e => setFechaFactura(e.target.value)} />
          <div style={{ fontSize: '0.66rem', color: 'var(--c-gris)', marginTop: 3 }}>
            La fecha de registro es HOY (entra hoy a la caja). La de la factura, si difiere, va a la descripción.
          </div>
        </div>

        {/* Preview READ-ONLY de los ítems leídos — revisión previa; el emparejamiento es en Revisión. */}
        {lineItems.length > 0 && (
          <div className="tips-field" style={{ marginTop: '0.75rem' }}>
            <div className="tips-field-label">Ítems leídos por la IA ({lineItems.length}) — revisá antes de confirmar</div>
            <div style={{ border: '1px solid var(--c-linea)', borderRadius: 4, overflow: 'hidden', fontSize: '0.7rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 44px 78px 82px', gap: 4, padding: '4px 8px', fontWeight: 700, color: 'var(--c-gris)', borderBottom: '1px solid var(--c-linea)' }}>
                <span>Descripción</span><span style={{ textAlign: 'right' }}>Cant.</span><span style={{ textAlign: 'right' }}>P. unit.</span><span style={{ textAlign: 'right' }}>Total</span>
              </div>
              {lineItems.map((it, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 44px 78px 82px', gap: 4, padding: '4px 8px', borderBottom: i < lineItems.length - 1 ? '1px solid var(--c-linea)' : 'none' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.descripcion}>{it.descripcion}</span>
                  <span style={{ textAlign: 'right' }}>{it.cantidad ?? '—'}</span>
                  <span style={{ textAlign: 'right' }}>{it.precio_unitario != null ? fmtMoney(it.precio_unitario) : '—'}</span>
                  <span style={{ textAlign: 'right' }}>{it.total != null ? fmtMoney(it.total) : '—'}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '0.64rem', color: 'var(--c-gris)', marginTop: 3 }}>
              Solo lectura. El emparejamiento ítem↔ingrediente se hace en Revisión de inventario.
            </div>
          </div>
        )}

        {/* ── 3. Pago (matriz RN-3) ── */}
        {clase !== 'ingreso' ? (
          <>
            <div className="tips-field" style={{ marginTop: '1rem' }}>
              <div className="tips-field-label">Forma de pago</div>
              <select className="tips-input-dark" style={{ width: '100%' }} aria-label="Forma de pago"
                value={pago} onChange={e => setPago(e.target.value as Pago)}>
                {formas.map(f => (
                  <option key={f} value={f}>
                    {f === 'efectivo' ? 'Efectivo (caja del local)' : f === 'pendiente' ? 'Transferencia — Pendiente' : 'Transferencia — Pagado desde Banco'}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: '0.66rem', color: 'var(--c-gris)', marginTop: 3 }}>{PAGO_META[pago].label}</div>
            </div>

            {clase === 'operativa' && (
              <div className="tips-field" style={{ marginTop: '0.75rem' }}>
                <div className="tips-field-label">Cuenta de gasto (P&L)</div>
                <select className="tips-input-dark" style={{ width: '100%' }} aria-label="Cuenta de gasto"
                  value={accountId} onChange={e => setAccountId(e.target.value)}>
                  <option value="">— sin cuenta (no postea asiento) —</option>
                  {cuentasGasto.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {accountsError && (
                  <div className="cd-method-info pend" role="alert" style={{ marginTop: 4 }}>
                    ⚠ No se pudieron cargar las cuentas (red/sesión). El gasto se registra igual; reabrí el asistente con conexión para asignar la cuenta y postear el asiento.
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="cd-method-info" style={{ marginTop: '1rem' }}>
            Ingreso en efectivo → entra a la Registradora.
            {ingresoSuperaUmbral && <> Supera ₡100.000 → requiere <strong>autorización de gerencia</strong> al confirmar.</>}
          </div>
        )}

        <div className="tips-field" style={{ marginTop: '0.75rem' }}>
          <div className="tips-field-label">Resultado</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--c-tinta)' }}>{preview}{montoOk ? ` · ${fi(amountCRC)}` : ''}</div>
        </div>

        <div className="cd-modal-actions" style={{ marginTop: '1rem' }}>
          <button className="tips-btn-ghost" onClick={intentarCerrar} disabled={saving}>Cancelar</button>
          <button className="cd-btn-green" onClick={confirmar} disabled={!montoOk || montoNegativo || (clase === 'ingreso' && !ingresoCompleto) || (!!parecida && !esOtra) || saving}>
            {saving ? 'Registrando…' : '✓ Confirmar y registrar'}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  )
}
