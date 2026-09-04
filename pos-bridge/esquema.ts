// ── pos-bridge · resolución del esquema de `ndf` ───────────────────────────────
//
// POR QUÉ EXISTE ESTE ARCHIVO: el repo no tiene red a `SQLNUBE`, así que nadie pudo
// correr el SELECT antes de escribirlo. En vez de clavar nombres de columna a
// ciegas y que el primer intento de Ismael muera con un "Invalid column name", el
// extractor le pregunta al servidor qué columnas hay (`INFORMATION_SCHEMA`) y
// resuelve cada campo lógico contra una lista de candidatos. Si algo no aparece, el
// error dice QUÉ falta, QUÉ columnas sí existen y cómo forzarlo desde el `.env`.
//
// Nada de esto toca datos: `INFORMATION_SCHEMA` es catálogo.

export type TablaKey =
  | 'facturas' | 'facturasdet' | 'pedidos' | 'productos' | 'clasificaciones' | 'empleados'

export interface DefColumna {
  /** En orden de preferencia. El primero que exista, gana. */
  candidatos: string[]
  requerida:  boolean
  /** Para qué se usa (sale en el mensaje de error). */
  para:       string
}

export interface DefTabla {
  tabla:    string
  /** Si no está, el extractor sigue sin ella (se degrada, no aborta). */
  opcional?: boolean
  columnas: Record<string, DefColumna>
}

const req = (para: string, ...candidatos: string[]): DefColumna => ({ candidatos, requerida: true, para })
const opt = (para: string, ...candidatos: string[]): DefColumna => ({ candidatos, requerida: false, para })

/**
 * El contrato con la base. Los nombres que la spec da por seguros van primero; los
 * demás candidatos son variantes vistas en instalaciones de "Nube de Fuego".
 */
export const CATALOGO: Record<TablaKey, DefTabla> = {
  facturas: {
    tabla: 'FAC_Facturas',
    columnas: {
      numero:           req('id de la factura', 'NumeroFactura'),
      fecha:            req('fecha/hora de la venta (naive = hora CR)', 'FechaRegistra'),
      estado:           req('C cerrada / X anulada / R rara', 'Estado'),
      efectivo:         req('medio de pago', 'Efectivo'),
      tarjeta:          req('medio de pago', 'Tarjeta'),
      montoelectronico: req('medio de pago', 'MontoElectronico'),
      deposito:         req('medio de pago', 'Deposito'),
      cheque:           req('medio de pago', 'Cheque'),
      cuentacobrar:     req('medio de pago', 'CuentaCobrar'),
      dolaresefectivo:  opt('informativo (NO suma)', 'DolaresEfectivo'),
      dolarestarjeta:   opt('informativo (NO suma)', 'DolaresTarjeta'),
      vuelto:           req('vuelto — se RESTA del total (Efectivo lo trae adentro)', 'Vuelto'),
      login:            opt('cajero que cobró (informativo)', 'Login'),
      tipo:             opt('canal, si el pedido no lo trae', 'Tipo', 'TipoFactura'),
      area:             opt('área cruda', 'Area'),
    },
  },
  pedidos: {
    tabla: 'FAC_Pedidos',
    columnas: {
      // El join es por NumeroFactura. `Facturas.NumeroPedido` viene vacío en mesa.
      numerofactura:   req('join con la factura', 'NumeroFactura'),
      usuarioregistra: req('LOGIN del que registró (salonero o cajero 111/222)', 'UsuarioRegistra'),
      personas:        req('pax nativo', 'Personas'),
      tipo:            opt('canal B/D/M/L', 'Tipo', 'TipoPedido'),
      area:            opt('área cruda', 'Area'),
    },
  },
  facturasdet: {
    tabla: 'FAC_FacturasDet',
    columnas: {
      numerofactura: req('join con la factura', 'NumeroFactura'),
      producto:      req('código del producto', 'CodigoProducto', 'Codigo', 'Producto', 'CodProducto'),
      cantidad:      req('unidades vendidas', 'Cantidad', 'Cant'),
      monto:         req('monto de la línea', 'Monto', 'MontoTotal', 'Total', 'SubTotal'),
      imps:          req('impuesto de servicio 10% (parte el día con/sin 10%)', 'ImpS'),
      impv:          opt('impuesto de venta (informativo)', 'ImpV', 'Imp', 'IVA', 'Impuesto'),
      esextra:       opt('línea que NO cuenta como unidad', 'EsExtra'),
      compuesto:     opt('línea que NO cuenta como unidad', 'Compuesto', 'EsCompuesto'),
    },
  },
  productos: {
    tabla: 'FAC_Productos',
    columnas: {
      codigo:        req('join con el detalle', 'Codigo', 'CodigoProducto', 'Producto'),
      nombre:        req('nombre del producto', 'Nombre', 'Descripcion', 'NombreProducto'),
      clasificacion: req('familia (mix)', 'Clasificacion', 'CodigoClasificacion', 'IdClasificacion', 'Familia'),
    },
  },
  clasificaciones: {
    tabla: 'FAC_Clasificaciones',
    opcional: true,
    columnas: {
      codigo: req('join con el producto', 'Codigo', 'CodigoClasificacion', 'Id', 'Clasificacion'),
      nombre: req('nombre de la familia', 'Nombre', 'Descripcion'),
    },
  },
  empleados: {
    tabla: 'FAC_Empleados',
    opcional: true,
    columnas: {
      login:  req('join con UsuarioRegistra', 'Login', 'Usuario', 'Codigo', 'CodigoEmpleado'),
      nombre: req('nombre del salonero', 'Nombre', 'NombreEmpleado', 'Descripcion'),
    },
  },
}

export interface TablaResuelta {
  tabla:    string
  presente: boolean
  /** campo lógico → nombre real de la columna (o `null` si es opcional y no está). */
  columnas: Record<string, string | null>
}

export type Esquema = Record<TablaKey, TablaResuelta>

/** Identificadores permitidos. Lo que venga del `.env` pasa por acá antes del SQL. */
const IDENT_OK = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/

export function assertIdentificador(nombre: string, contexto: string): string {
  if (!IDENT_OK.test(nombre)) {
    throw new Error(`Nombre de columna/tabla inválido en ${contexto}: ${JSON.stringify(nombre)}`)
  }
  return nombre
}

/** `[Nombre]` — el quoting de SQL Server, después de validar. */
export function q(nombre: string): string {
  return `[${assertIdentificador(nombre, 'SQL')}]`
}

export class EsquemaError extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'EsquemaError'
  }
}

/**
 * PURA: recibe lo que hay en la base y devuelve el esquema resuelto. Se prueba sin
 * SQL Server (que es todo lo que CC puede validar solo).
 *
 * @param existentes  tabla (minúsculas) → columnas reales
 * @param overrides   `facturas.monto` → `Total` (del `.env`)
 */
export function resolverEsquema(
  existentes: Map<string, string[]>,
  overrides: Record<string, string> = {},
): Esquema {
  const salida = {} as Esquema
  const faltantes: string[] = []

  for (const [key, def] of Object.entries(CATALOGO) as [TablaKey, DefTabla][]) {
    const reales = existentes.get(def.tabla.toLowerCase()) ?? []
    const porMinuscula = new Map(reales.map(c => [c.toLowerCase(), c]))
    const presente = reales.length > 0

    if (!presente) {
      if (!def.opcional) {
        faltantes.push(`· tabla ${def.tabla}: no existe (o el usuario no la puede leer)`)
      }
      salida[key] = {
        tabla: def.tabla,
        presente: false,
        columnas: Object.fromEntries(Object.keys(def.columnas).map(c => [c, null])),
      }
      continue
    }

    const columnas: Record<string, string | null> = {}
    for (const [campo, dc] of Object.entries(def.columnas)) {
      const forzada = overrides[`${key}.${campo}`]
      if (forzada) {
        const real = porMinuscula.get(forzada.toLowerCase())
        if (!real) {
          faltantes.push(
            `· ${def.tabla}.${campo}: el .env fuerza "${forzada}" y esa columna no existe. ` +
            `Columnas reales: ${reales.join(', ')}`,
          )
          columnas[campo] = null
          continue
        }
        columnas[campo] = real
        continue
      }

      const real = dc.candidatos.map(c => porMinuscula.get(c.toLowerCase())).find(Boolean) ?? null
      columnas[campo] = real ?? null
      if (!real && dc.requerida) {
        faltantes.push(
          `· ${def.tabla}.${campo} (${dc.para}): ninguno de ${dc.candidatos.join(' / ')} existe.\n` +
          `    columnas reales: ${reales.join(', ')}\n` +
          `    forzalo con  POS_COL_${key.toUpperCase()}_${campo.toUpperCase()}=<nombre real>  en el .env`,
        )
      }
    }
    salida[key] = { tabla: def.tabla, presente: true, columnas }
  }

  if (faltantes.length) {
    throw new EsquemaError(
      'El esquema de `ndf` no coincide con lo que espera el extractor:\n' + faltantes.join('\n'),
    )
  }
  return salida
}

/** Columna real de un campo lógico. Explota si es requerida y no está. */
export function col(esq: Esquema, tabla: TablaKey, campo: string): string {
  const real = esq[tabla]?.columnas[campo] ?? null
  if (!real) throw new Error(`Columna no resuelta: ${tabla}.${campo}`)
  return real
}

/** Columna real, o `null` si es opcional y no existe en esta instalación. */
export function colOpt(esq: Esquema, tabla: TablaKey, campo: string): string | null {
  return esq[tabla]?.columnas[campo] ?? null
}

/** Catálogo, no datos: qué columnas tiene cada tabla que nos interesa. */
export const SQL_ESQUEMA = `SELECT c.TABLE_NAME AS tabla, c.COLUMN_NAME AS columna
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_NAME IN (${Object.values(CATALOGO).map(d => `'${d.tabla}'`).join(', ')})
ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`

export interface FilaEsquema { tabla: string; columna: string }

/** Filas de `INFORMATION_SCHEMA` → mapa tabla(minúsculas) → columnas. */
export function agruparColumnas(filas: FilaEsquema[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const f of filas) {
    const t = String(f.tabla).toLowerCase()
    const lista = out.get(t)
    if (lista) lista.push(String(f.columna))
    else out.set(t, [String(f.columna)])
  }
  return out
}
