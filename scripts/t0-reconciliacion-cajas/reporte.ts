// T0 · Render del reporte en Markdown.
//
// Determinista a propósito: NO se estampa la hora de ejecución, sino el watermark
// de los datos (conteos + último created_at de cada tabla). Con los mismos datos el
// archivo sale byte-idéntico, así que re-correr el harness no ensucia el diff.

import type {
  Cierre,
  CierreClasificado,
  ComparativoPozo,
  Inventarios,
  Watermark,
} from './analisis.ts'
import {
  FECHAS_NO_CONFIABLES,
  TOLERANCIA_CRC,
  VENTANA_PROPINA_DIAS,
} from './analisis.ts'
import type { Backend } from './db.ts'

/** ₡ con separador de miles y 2 decimales, sin depender del ICU de la máquina. */
export function fi(v: number): string {
  const neg = v < 0 || Object.is(v, -0)
  const [ent, dec] = Math.abs(v).toFixed(2).split('.')
  return `${neg ? '−' : ''}₡ ${ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
}

export function fu(v: number): string {
  const neg = v < 0 || Object.is(v, -0)
  const [ent, dec] = Math.abs(v).toFixed(2).split('.')
  return `${neg ? '−' : ''}$ ${ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
}

/** Tope de filas en los listados largos — la truncación se declara en el propio reporte. */
export const TOPE_LISTADO = 25

/** El texto libre (motivos de ajuste, descripciones) puede traer pipes. */
const esc = (v: unknown): string => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim() || '—'

const EMOJI: Record<string, string> = {
  'CUADRÓ': '✅',
  'EXPLICADO-HUECO-2': '🟡',
  'CANDIDATO-HUECO-1': '🟠',
  'NO-EXPLICADO': '🔴',
}

function tabla(headers: string[], filas: string[][]): string {
  if (!filas.length) return '_(sin filas)_'
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...filas.map((f) => `| ${f.join(' | ')} |`),
  ].join('\n')
}

export type DatosReporte = {
  ref: string
  backend: Backend
  watermark: Watermark
  cierres: Cierre[]
  clasificados: CierreClasificado[]
  pozo: ComparativoPozo
  inv: Inventarios
}

export function renderReporte(d: DatosReporte): string {
  const { clasificados, pozo, inv, watermark: wm } = d
  const L: string[] = []
  const p = (...xs: string[]) => L.push(...xs)

  const conteo = (c: string) => clasificados.filter((x) => x.clase === c).length
  const noExplicados = clasificados.filter((x) => x.clase === 'NO-EXPLICADO')
  const parciales = d.cierres.filter((c) => c.tipo !== 'completo')

  // ── Encabezado ────────────────────────────────────────────────────────────
  p(
    '# REPORTE T0 — Reconciliación de cajas',
    '',
    '> **Harness READ-ONLY sobre STAGING.** Cero INSERT/UPDATE/DELETE, cero migraciones, cero cambios de esquema.',
    '> Insumo para el rediseño hacia el **pozo único de efectivo**: cuantifica el histórico y corre el modelo nuevo',
    '> en paralelo al actual, sin tocar la app. Generado por `scripts/t0-reconciliacion-cajas` (ver README).',
    '',
    tabla(
      ['Campo', 'Valor'],
      [
        ['Proyecto Supabase', `\`${d.ref}\` (STAGING)`],
        ['Transporte de lectura', `\`${d.backend}\``],
        ['`cash_movements`', String(wm.movimientos)],
        ['`cash_sessions`', String(wm.sesiones)],
        ['`cash_cierres_dia`', `${wm.cierres} (${clasificados.length} completos · ${parciales.length} parciales)`],
        ['Último movimiento', `\`${wm.ultimoMovimiento}\``],
        ['Último cierre', `\`${wm.ultimoCierre}\``],
      ],
    ),
    '',
    `> ⚠️ **Datos no confiables:** en staging el/los día(s) **${FECHAS_NO_CONFIABLES.join(', ')}** incluyen turnos FICTICIOS de prueba.`,
    '> Cualquier número que caiga en esas fechas es de laboratorio, no de piso — no sirve para conclusiones de plata.',
    '',
    '---',
    '',
  )

  // ── 0 · Resumen ───────────────────────────────────────────────────────────
  p(
    '## 0 · Resumen ejecutivo',
    '',
    '**Clasificación de los cierres completos**',
    '',
    tabla(
      ['Clase', 'Cierres', 'Qué significa'],
      [
        ['✅ CUADRÓ', String(conteo('CUADRÓ')), `la diferencia es menor a ${fi(TOLERANCIA_CRC)} en valor absoluto`],
        ['🟡 EXPLICADO-HUECO-2', String(conteo('EXPLICADO-HUECO-2')), 'la diferencia ≈ −(egresos de Caja Proveedores en efectivo de ese día)'],
        ['🟠 CANDIDATO-HUECO-1', String(conteo('CANDIDATO-HUECO-1')), `la diferencia ≈ −(un pago de 'Propinas por turno' de ±${VENTANA_PROPINA_DIAS} días)`],
        ['🔴 NO-EXPLICADO', String(noExplicados.length), 'ninguna de las dos hipótesis la cubre'],
        ['**Total**', `**${clasificados.length}**`, '_todos los cierres `tipo=completo` están clasificados_'],
      ],
    ),
    '',
    '**Pozo único vs modelo actual**',
    '',
    tabla(
      ['Medida', 'CRC', 'USD'],
      [
        ['`saldoPozoEfectivo` (modelo nuevo, harness)', fi(pozo.pozo.crc), fu(pozo.pozo.usd)],
        ['`saldoCajaFuerte` (modelo actual, `src/modules/cash/cashUtils.ts`)', fi(pozo.cfReal.crc), fu(pozo.cfReal.usd)],
        ['**Diferencia (pozo − CF)**', `**${fi(pozo.deltaCrc)}**`, `**${fu(pozo.deltaUsd)}**`],
      ],
    ),
    '',
    '**Hallazgos de un vistazo**',
    '',
  )

  const hallazgos: string[] = []
  if (noExplicados.length) {
    hallazgos.push(
      `**${noExplicados.length} cierre(s) NO-EXPLICADO(S)** por las hipótesis de hueco: ` +
        noExplicados.map((x) => `\`${x.cierre.session_date}\` (${fi(x.cierre.diferencia_crc)})`).join(' · ') +
        ' → detalle en §1.2.',
    )
  }
  const conAjuste = noExplicados.filter((x) => x.ajusteLedger)
  if (conAjuste.length) {
    hallazgos.push(
      `Los ${conAjuste.length} NO-EXPLICADOS **sí tienen un egreso \`Ajuste de cierre\` en Caja Fuerte por el monto exacto** ` +
        '(Opción B — la diferencia se selló contra el ledger). O sea: están *contabilizados*, no *explicados*: ' +
        'nadie sabe todavía qué movimiento real los causó.',
    )
  }
  hallazgos.push(
    `El pozo y la Caja Fuerte difieren en **${fi(pozo.deltaCrc)}**; el desglose de §2.2 suma exactamente esa cifra ` +
      `(${pozo.cuadra ? '✅ verificado' : '❌ NO cuadra'}).`,
  )
  if (pozo.pozo.crc < 0) {
    const enRojo = pozo.porCaja.filter((c) => c.neto < 0)
    const cf = pozo.porCaja.find((c) => c.caja === 'Caja Fuerte')
    hallazgos.push(
      `🚩 **El pozo da NEGATIVO (${fi(pozo.pozo.crc)})** — imposible en efectivo físico. No es un error del modelo: ` +
        'es la confirmación de que **el histórico no tiene ancla**. Ninguna caja tiene un asiento de apertura, así que ' +
        'cada una arranca contra cero, y las que gastaron más de lo que el ledger les registró como entrado quedan en rojo: ' +
        enRojo.map((c) => `\`${c.caja}\` (entra ${fi(c.entra)} · sale ${fi(c.sale)} → **${fi(c.neto)}**)`).join(' · ') +
        '. **El pozo necesita un asiento de apertura antes de poder usarse como saldo** (ver §2.4).',
    )
    if (cf && Math.abs(cf.neto - pozo.cfReal.crc) < 1e-6) {
      hallazgos.push(
        `Y acá está el nudo: \`Caja Fuerte\` sola cierra en **${fi(cf.neto)}**, que es *exactamente* lo que devuelve ` +
          '`saldoCajaFuerte`. El modelo actual **no está mal calculado — está mirando una sola caja de tres**. Toda la ' +
          `diferencia de ${fi(pozo.deltaCrc)} es el rojo de \`Caja Proveedores\` y \`Registradora\`, que hoy nadie ve.`,
      )
    }
  }
  if (inv.sesionesAbiertas.length === 0) {
    hallazgos.push('**Cero cajas huérfanas**: no hay ninguna `cash_sessions` con `status=\'open\'`.')
  } else {
    hallazgos.push(`**${inv.sesionesAbiertas.length} caja(s) huérfana(s)** con \`status='open'\` — §3.a.`)
  }
  if (inv.filasFueraDeConvencion) {
    hallazgos.push(
      `**${inv.filasFueraDeConvencion} movimiento(s) fuera de convención** (caja/método/tipo fuera del catálogo de \`cashUtils\`) — §3.b.`,
    )
  }
  const nInternos = inv.traspasosEntreFisicas.reduce((a, t) => a + t.n, 0)
  const nIndet = inv.traspasosIndeterminados.reduce((a, t) => a + t.n, 0)
  hallazgos.push(
    `Traspasos que el pozo vuelve **neutros**: ${nInternos} con dirección explícita + ${nIndet} sin dirección legible ` +
      `(${fi(inv.traspasosIndeterminados.reduce((a, t) => a + t.crc, 0))} movidos hoy sin poder decir de dónde a dónde) — §3.c.`,
  )
  if (inv.movsSinSesionTotal.n) {
    hallazgos.push(
      `**${inv.movsSinSesionTotal.n} movimiento(s) sin turno** (\`session_id\` NULL, ${fi(inv.movsSinSesionTotal.crc)}): ` +
        'no entran a ninguna reconciliación por `session_date` — §3.e.',
    )
  }
  if (inv.fechasAnomalas.length) {
    hallazgos.push(`**${inv.fechasAnomalas.length} movimiento(s) con fecha imposible** (año fuera de 2025–2027) — §3.f.`)
  }
  p(...hallazgos.map((h) => `- ${h}`), '', '---', '')

  // ── 1 · Reconciliación por cierre ─────────────────────────────────────────
  p(
    '## 1 · Reconciliación por cierre',
    '',
    'Un renglón por fila de `cash_cierres_dia` con `tipo=\'completo\'`. La columna **Egresos prov. efectivo** es la suma de',
    '`cash_movements` con `caja_origen=\'Caja Proveedores\'` · `method=\'Efectivo\'` · `movement_type like \'egreso%\'` ·',
    '`status <> \'rechazado\'`, unidos al cierre por `cash_sessions.session_date`.',
    '',
    '### 1.1 · Tabla completa',
    '',
    tabla(
      ['#', 'Fecha', 'Diferencia sellada', 'ajuste_tipo', 'ajuste_motivo', 'Egresos prov. efectivo', 'dif + egresos', 'Clase'],
      clasificados.map((x, i) => [
        String(i + 1),
        `\`${x.cierre.session_date}\`${x.fechaNoConfiable ? ' ⚠️' : ''}`,
        fi(x.cierre.diferencia_crc),
        esc(x.cierre.ajuste_tipo),
        esc(x.cierre.ajuste_motivo),
        x.egresosProv.n ? `${fi(x.egresosProv.total)} _(${x.egresosProv.n} mov.)_` : '—',
        fi(x.residuoHueco2),
        `${EMOJI[x.clase]} ${x.clase}`,
      ]),
    ),
    '',
  )

  const conMatch = clasificados.filter((x) => x.matchPropina)
  if (conMatch.length) {
    p(
      '**Candidatos de hueco 1 encontrados** (pago de `Propinas por turno` cuyo monto ≈ −diferencia):',
      '',
      tabla(
        ['Cierre', 'Diferencia', 'Movimiento propina', 'Fecha propina', 'Monto', 'Δ días', 'Residuo'],
        conMatch.map((x) => [
          `\`${x.cierre.session_date}\``,
          fi(x.cierre.diferencia_crc),
          `\`${x.matchPropina!.id.slice(0, 8)}\``,
          `\`${x.matchPropina!.fecha}\``,
          fi(x.matchPropina!.monto),
          String(x.matchPropina!.deltaDias),
          fi(x.matchPropina!.residuo),
        ]),
      ),
      '',
    )
  } else {
    p(
      `_Ningún cierre tiene un pago de \`Propinas por turno\` con monto ≈ −diferencia dentro de ±${VENTANA_PROPINA_DIAS} días ` +
        `(tolerancia ${fi(TOLERANCIA_CRC)}) → **cero CANDIDATO-HUECO-1** en este histórico._`,
      '',
    )
  }

  // ── 1.2 · No explicados ───────────────────────────────────────────────────
  p('### 1.2 · Cierres NO-EXPLICADOS — números exactos', '')
  if (!noExplicados.length) {
    p('_Ninguno._ Todos los cierres completos caen en CUADRÓ, HUECO-2 o HUECO-1.', '')
  } else {
    p(
      `Se listan **los ${noExplicados.length}**, sin omitir ninguno. Para cada uno: la diferencia sellada, los egresos`,
      'de proveedor en efectivo de ese día (el candidato del hueco 2), y si el cierre emitió un `Ajuste de cierre`',
      'contra el ledger de Caja Fuerte (Opción B).',
      '',
    )
    for (const x of noExplicados) {
      const c = x.cierre
      p(
        `#### \`${c.session_date}\` — diferencia ${fi(c.diferencia_crc)}`,
        '',
        tabla(
          ['Dato', 'Valor'],
          [
            ['`session_date`', `\`${c.session_date}\``],
            ['`diferencia_crc` (sellada)', `**${fi(c.diferencia_crc)}**`],
            ['`ajuste_tipo` / `ajuste_motivo`', `${esc(c.ajuste_tipo)} / ${esc(c.ajuste_motivo)}`],
            ['`manager`', esc(c.manager)],
            ['Cierre creado', `\`${c.created_at ?? '—'}\``],
            ['Egresos Caja Proveedores efectivo del día', `${fi(x.egresosProv.total)} (${x.egresosProv.n} mov.)`],
            ['Residuo si fuera hueco 2 (`dif + egresos`)', fi(x.residuoHueco2)],
            [
              'Mejor candidato de propina (±' + VENTANA_PROPINA_DIAS + 'd)',
              x.matchPropina
                ? `${fi(x.matchPropina.monto)} el \`${x.matchPropina.fecha}\` (residuo ${fi(x.matchPropina.residuo)})`
                : `ninguno dentro de ${fi(TOLERANCIA_CRC)}`,
            ],
            [
              'Egreso `Ajuste de cierre` emitido',
              x.ajusteLedger
                ? `**sí** — ${fi(x.ajusteLedger.amount_crc)} en \`${x.ajusteLedger.caja_origen}\` (\`${x.ajusteLedger.id.slice(0, 8)}\`, ${x.ajusteLedger.created_at})`
                : 'no',
            ],
          ],
        ),
        '',
      )
      if (x.ajusteLedger) {
        const desc = esc(x.ajusteLedger.description)
        const casa = Math.abs(Math.abs(x.ajusteLedger.amount_crc) - Math.abs(c.diferencia_crc)) < 0.005
        p(
          `> El movimiento dice: _"${desc}"_. Su monto ${casa ? '**coincide exactamente**' : 'NO coincide'} con la magnitud`,
          '> de la diferencia. La plata quedó **cuadrada en el ledger**, pero la causa física sigue sin identificar:',
          '> ni egresos de proveedor en efectivo ni un pago de propinas de esos días la explican.',
          '',
        )
      }
      if (x.egresosProv.n) {
        p(
          '<details><summary>Egresos de proveedor en efectivo de ese día</summary>',
          '',
          tabla(
            ['id', 'tipo', 'subcategory', 'monto', 'status'],
            x.egresosProv.movs.map((m) => [
              `\`${m.id.slice(0, 8)}\``,
              m.movement_type,
              esc(m.subcategory),
              fi(m.amount_crc),
              esc(m.status),
            ]),
          ),
          '',
          '</details>',
          '',
        )
      }
      if (x.huerfanosDelDia.length) {
        p(
          '<details><summary>Movimientos de ese día SIN turno (no entran al join)</summary>',
          '',
          tabla(
            ['id', 'tipo', 'caja', 'método', 'subcategory', 'monto', 'status'],
            x.huerfanosDelDia.map((m) => [
              `\`${m.id.slice(0, 8)}\``,
              m.movement_type,
              esc(m.caja_origen),
              esc(m.method),
              esc(m.subcategory),
              fi(m.amount_crc),
              esc(m.status),
            ]),
          ),
          '',
          '</details>',
          '',
        )
      }
    }
  }
  p('---', '')

  // ── 2 · Pozo vs Caja Fuerte ───────────────────────────────────────────────
  p(
    '## 2 · Saldo del pozo vs saldo de Caja Fuerte',
    '',
    '### 2.1 · Los dos números',
    '',
    '`saldoPozoEfectivo` vive **solo en el harness** (`scripts/t0-reconciliacion-cajas/pozo.ts`); `saldoCajaFuerte` se',
    '**importa tal cual** de `src/modules/cash/cashUtils.ts` sin modificarlo. Reglas del pozo:',
    '',
    "- Cajas físicas: `Caja Fuerte` · `Caja Proveedores` · `Registradora`. **`Banco` queda fuera.**",
    "- Ingresos/egresos: cuentan si son de caja física, en `Efectivo` (o sin método), y `status` ≠ `pendiente`/`rechazado`.",
    '- Traspasos **entre cajas físicas: neutros** (mover plata de bolsillo no cambia cuánto efectivo hay).',
    "- Traspasos **contra Banco: sí mueven** — `Caja Fuerte → Banco` resta, `Banco → Caja Fuerte` suma. La dirección sale de",
    '  `subcategory`, **no** del `method` (los depósitos históricos están cargados como `Transferencia`).',
    '',
    tabla(
      ['Medida', 'CRC', 'USD'],
      [
        ['`saldoPozoEfectivo(movs)`', `**${fi(pozo.pozo.crc)}**`, `**${fu(pozo.pozo.usd)}**`],
        ['`saldoCajaFuerte(movs)` — función real de `src/`', `**${fi(pozo.cfReal.crc)}**`, `**${fu(pozo.cfReal.usd)}**`],
        ['Diferencia (pozo − CF)', `**${fi(pozo.deltaCrc)}**`, `**${fu(pozo.deltaUsd)}**`],
      ],
    ),
    '',
    `> **Verificación del espejo:** para desglosar la diferencia hace falta el aporte *por fila* a \`saldoCajaFuerte\`, que`,
    '> la función real no expone. El harness replica esa lógica en `contribucionCajaFuerte()` y comprueba que la suma del',
    `> espejo sea idéntica a la función importada: **${pozo.espejoOk ? '✅ idénticas' : '❌ DIVERGEN'}** ` +
      `(espejo ${fi(pozo.cfEspejo.crc)} vs real ${fi(pozo.cfReal.crc)}). Si divergieran, el harness aborta.`,
    '',
    '### 2.2 · Desglose de la diferencia por (`caja_origen` × `movement_type`)',
    '',
    'Cada renglón es `Σ(aporte al pozo) − Σ(aporte a Caja Fuerte)` de las filas de ese grupo. **La suma de la columna',
    'Δ es exactamente la diferencia de §2.1** — no es una aproximación.',
    '',
    tabla(
      ['caja_origen', 'movement_type', 'Filas', 'Aporte al pozo', 'Aporte a CF', 'Δ (pozo − CF)'],
      pozo.desglose.map((g) => [
        `\`${g.caja_origen}\``,
        `\`${g.movement_type}\``,
        String(g.n),
        fi(g.pozo),
        fi(g.cf),
        `**${fi(g.delta)}**`,
      ]),
    ),
    '',
    tabla(
      ['Comprobación', 'CRC', 'USD'],
      [
        ['Suma de la columna Δ', `**${fi(pozo.sumaDesglose)}**`, `**${fu(pozo.sumaDesgloseUsd)}**`],
        ['Diferencia pozo − CF (§2.1)', `**${fi(pozo.deltaCrc)}**`, `**${fu(pozo.deltaUsd)}**`],
        [
          '¿Cuadra?',
          pozo.cuadra ? '✅ sí, al céntimo' : '❌ NO — el harness debería haber abortado',
          pozo.cuadra ? '✅ sí, al centavo' : '❌ NO',
        ],
      ],
    ),
    '',
    'La misma descomposición en dólares, solo los grupos que aportan algo (el resto es cero):',
    '',
    tabla(
      ['caja_origen', 'movement_type', 'Aporte al pozo', 'Aporte a CF', 'Δ (pozo − CF)'],
      pozo.desglose
        .filter((g) => Math.abs(g.pozoUsd) > 1e-9 || Math.abs(g.cfUsd) > 1e-9)
        .map((g) => [`\`${g.caja_origen}\``, `\`${g.movement_type}\``, fu(g.pozoUsd), fu(g.cfUsd), `**${fu(g.deltaUsd)}**`]),
    ),
    '',
    '### 2.3 · De dónde sale cada colón del pozo',
    '',
    tabla(
      ['Clase de fila (modelo pozo)', 'Filas', 'Aporte CRC'],
      pozo.porClase.map((c) => [`\`${c.clase}\``, String(c.n), fi(c.crc)]),
    ),
    '',
    '### 2.4 · Aporte neto de cada caja al pozo',
    '',
    'Lo que cada caja física puso y sacó del pozo, según lo que hay cargado como movimiento. Una caja en rojo no',
    'significa que se robaron la plata: significa que **su saldo de apertura nunca se cargó al ledger**, así que sus',
    'egresos se descuentan contra cero.',
    '',
    tabla(
      ['caja_origen', 'Entra', 'Sale', 'Neto'],
      pozo.porCaja.map((c) => [`\`${c.caja}\``, fi(c.entra), `−${fi(c.sale).replace(/^−/, '')}`, `**${fi(c.neto)}**`]),
    ),
    '',
    '---',
    '',
  )

  // ── 3 · Inventarios ───────────────────────────────────────────────────────
  p('## 3 · Inventarios', '', '### 3.a · Cajas huérfanas (`cash_sessions` con `status=\'open\'`)', '')
  if (!inv.sesionesAbiertas.length) {
    p(`_Ninguna._ Las ${wm.sesiones} sesiones están cerradas. **No hay cajas huérfanas que migrar.**`, '')
  } else {
    p(
      tabla(
        ['id', 'session_date', 'shift_type', 'cajero', '`initial_suppliers_crc`'],
        inv.sesionesAbiertas.map((x) => [
          `\`${x.id}\``,
          `\`${x.session_date}\``,
          esc(x.shift_type),
          esc(x.cajero_name),
          fi(x.initial_suppliers_crc),
        ]),
      ),
      '',
    )
  }

  p(
    '### 3.b · Distribución `caja_origen` × `method` × `movement_type`',
    '',
    'Se agrega `status` porque cambia si la fila cuenta o no. La columna **Fuera de convención** marca los valores que',
    'no están en los catálogos de `cashUtils` (`CAJAS_ORIGEN`, `METODOS_PAGO`, `MOVEMENT_TYPES`).',
    '',
    tabla(
      ['caja_origen', 'method', 'movement_type', 'status', 'Filas', 'Σ CRC', 'Σ USD', 'Fuera de convención'],
      inv.distribucion.map((g) => [
        `\`${g.caja_origen}\``,
        `\`${g.method}\``,
        `\`${g.movement_type}\``,
        g.status,
        String(g.n),
        fi(g.crc),
        fu(g.usd),
        g.banderas.length ? `⚠️ ${g.banderas.join('; ')}` : '—',
      ]),
    ),
    '',
    `**Filas fuera de convención: ${inv.filasFueraDeConvencion}** de ${wm.movimientos}.`,
    '',
  )

  p(
    '### 3.c · Traspasos',
    '',
    'Bajo el pozo, un traspaso **entre cajas físicas deja de mover plata**. Este es el censo de los que cambian de',
    'semántica, y el de los que ni siquiera dicen a dónde iban.',
    '',
    '**c.1 · Entre cajas físicas (dirección explícita) → pasan a NEUTROS**',
    '',
    inv.traspasosEntreFisicas.length
      ? tabla(
          ['subcategory', 'caja_origen', 'method', 'Filas', 'Σ CRC'],
          inv.traspasosEntreFisicas.map((t) => [`\`${t.subcategory}\``, `\`${t.caja_origen}\``, t.method, String(t.n), fi(t.crc)]),
        )
      : '_Ninguno con dirección explícita entre dos cajas físicas._',
    '',
    '**c.2 · Sin dirección legible → el harness los ASUME internos (neutros) y los reporta acá**',
    '',
    'Son traspasos cuyo `subcategory` no tiene la forma `A → B` (`null`, `Ajuste`, texto libre). Hoy `saldoCajaFuerte`',
    'los ignora por completo cuando `caja_origen` ≠ `Caja Fuerte`. **Antes de mover el modelo hay que decidir qué son.**',
    '',
    inv.traspasosIndeterminados.length
      ? tabla(
          ['subcategory', 'caja_origen', 'method', 'Filas', 'Σ CRC'],
          inv.traspasosIndeterminados.map((t) => [`\`${t.subcategory}\``, `\`${t.caja_origen}\``, t.method, String(t.n), fi(t.crc)]),
        )
      : '_Ninguno._',
    '',
    '**c.3 · Contra Banco → los únicos traspasos que SÍ mueven el pozo**',
    '',
    inv.traspasosBanco.length
      ? tabla(
          ['dirección', 'caja_origen', 'method', 'Filas', 'Σ CRC', 'Efecto en el pozo'],
          inv.traspasosBanco.map((t) => [
            `\`${t.direccion}\``,
            `\`${t.caja_origen}\``,
            t.method,
            String(t.n),
            fi(t.crc),
            t.clase === 'traspaso-sale-a-banco' ? 'resta' : 'suma',
          ]),
        )
      : '_Ninguno._',
    '',
  )

  p('### 3.d · Movimientos con `subcategory = \'Ajuste de cierre\'`', '')
  if (!inv.ajustesDeCierre.length) {
    p('_Ninguno._', '')
  } else {
    p(
      tabla(
        ['Fecha (created_at)', 'Signo', 'Monto', 'movement_type', 'caja_origen', 'method', 'status', 'description'],
        inv.ajustesDeCierre.map(({ mov: m, signo }) => [
          `\`${m.created_at}\``,
          signo,
          fi(m.amount_crc),
          `\`${m.movement_type}\``,
          `\`${m.caja_origen}\``,
          esc(m.method),
          esc(m.status),
          esc(m.description),
        ]),
      ),
      '',
      `Total: **${inv.ajustesDeCierre.length}** movimiento(s), ` +
        `Σ ${fi(inv.ajustesDeCierre.reduce((a, x) => a + x.mov.amount_crc, 0))}.`,
      '',
    )
  }

  p(
    '### 3.e · Extra — movimientos sin turno (`session_id` NULL)',
    '',
    'No los pide el T0, pero mandan: **ninguna reconciliación por `session_date` los ve**, porque el join sale de',
    '`cash_sessions`. Cualquier modelo nuevo tiene que decidir a qué día pertenecen.',
    '',
    inv.movsSinSesion.length
      ? tabla(
          ['movement_type', 'caja_origen', 'method', 'subcategory', 'status', 'Filas', 'Σ CRC'],
          inv.movsSinSesion.map((g) => [
            `\`${g.movement_type}\``,
            `\`${g.caja_origen}\``,
            g.method,
            esc(g.subcategory),
            g.status,
            String(g.n),
            fi(g.crc),
          ]),
        )
      : '_Ninguno._',
    '',
    `Total: **${inv.movsSinSesionTotal.n}** movimiento(s), Σ ${fi(inv.movsSinSesionTotal.crc)}.`,
    '',
  )

  p('### 3.f · Extra — fechas imposibles y días no confiables', '')
  if (inv.fechasAnomalas.length) {
    const muestra = inv.fechasAnomalas.slice(0, TOPE_LISTADO)
    p(
      'Movimientos cuyo `created_at` no se puede leer o cae fuera del rango operativo del negocio (2025–2027) —',
      'casi seguro un dedazo de año:',
      '',
      tabla(
        ['id', 'created_at', 'Fecha CR', 'caja_origen', 'Monto'],
        muestra.map((x) => [`\`${x.id.slice(0, 8)}\``, `\`${x.created_at}\``, `\`${x.fechaCR || '(ilegible)'}\``, esc(x.caja_origen), fi(x.crc)]),
      ),
      '',
      inv.fechasAnomalas.length > muestra.length
        ? `_Se listan ${muestra.length} de **${inv.fechasAnomalas.length}** (tope del reporte). ` +
          'Para verlos todos, correr el harness y leer `inv.fechasAnomalas`._'
        : `Total: **${inv.fechasAnomalas.length}**.`,
      '',
    )
  } else {
    p('_Sin fechas fuera de rango._', '')
  }
  p(
    'Huella de los días marcados como **no confiables** (turnos ficticios de prueba en staging):',
    '',
    tabla(
      ['Fecha', 'Movimientos', 'Σ CRC'],
      inv.movsEnFechasNoConfiables.map((x) => [`\`${x.fecha}\` ⚠️`, String(x.n), fi(x.crc)]),
    ),
    '',
    '---',
    '',
  )

  // ── Apéndice ──────────────────────────────────────────────────────────────
  p(
    '## Apéndice · Definiciones y supuestos',
    '',
    `- **Tolerancia**: ${fi(TOLERANCIA_CRC)} para las tres comparaciones. \`CUADRÓ\` usa \`< tolerancia\` (estricto);`,
    '  `HUECO-2` y `HUECO-1` usan `≤ tolerancia`.',
    '- **Orden de clasificación**: `CUADRÓ` → `EXPLICADO-HUECO-2` → `CANDIDATO-HUECO-1` → `NO-EXPLICADO`. El primero que',
    '  aplica gana, así que un cierre que cuadra no se "explica" por unos egresos que casualmente sumen poco.',
    `- **HUECO-2** exige egresos > 0: si el día no tuvo egresos de proveedor en efectivo, no puede ser la causa.`,
    `- **HUECO-1** busca un solo pago de \`Propinas por turno\` (no combinaciones) dentro de ±${VENTANA_PROPINA_DIAS} días.`,
    '  La fecha del pago es su `session_date`; si no tiene turno, el día de Costa Rica de su `created_at`.',
    '- **Traspasos sin dirección legible** se asumen internos (neutros para el pozo). Es un supuesto, y por eso está',
    '  inventariado en §3.c.2 con su monto: si se decidiera otra cosa, ahí está la plata en juego.',
    '- **Fechas**: todo lo que convierte `created_at` a día usa `America/Costa_Rica`, igual que `dateCR` de la app.',
    '- **`saldoCajaFuerte` no excluye `rechazado`** (solo `pendiente`); el pozo sí excluye ambos. Parte de la diferencia',
    '  de §2.1 sale de ahí.',
    '',
    '### Qué NO hace este reporte',
    '',
    '- No escribe una sola fila: el transporte `mgmt` manda las consultas con `read_only: true`, que Postgres impone a',
    '  nivel de transacción (un `CREATE` en ese canal falla con `25006`).',
    '- No toca `src/`. El único símbolo importado desde la app es `saldoCajaFuerte`, en modo lectura.',
    '- No propone la migración. Mide el terreno para que la decisión del pozo se tome con números, no con memoria.',
    '',
  )

  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
