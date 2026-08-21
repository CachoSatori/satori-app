import * as XLSX from 'xlsx'

// ── Archivo de transferencias del homebanking ("planilla") ─────────────────────
// Formato REAL confirmado contra el archivo que Ismael sube al banco. NO se inventa
// nada acá: si esto cambia, cambia porque el banco cambió el formato.
//
//   · Hoja: `planilla` (nombre exacto, en minúscula).
//   · SIN fila de encabezado — la primera fila YA es un beneficiario.
//   · 5 columnas por fila:
//       A  nombre del beneficiario tal como figura en el homebanking (el banco lo
//          identifica POR EL NOMBRE, no por cuenta → el archivo no lleva IBAN)
//       B  monto en colones, número ENTERO (sin decimales ni separadores)
//       C  'COL'  (moneda, literal)
//       D  concepto (texto)
//       E  concepto (texto, el MISMO que D)
//
// El módulo es deliberadamente genérico (`nombre` + `monto`, sin nada de salarios):
// el pago masivo a proveedores usa el mismo archivo con otro origen de datos y otro
// concepto, y debe poder reusar esto sin tocar una línea.

export interface PlanillaBeneficiario {
  nombre: string   // col A — como figura en el homebanking
  monto:  number   // col B — colones; se redondea a entero al exportar
}

export const CONCEPTO_SALARIOS_DEFAULT = 'PAGO DE SALARIOS'

export const PLANILLA_SHEET = 'planilla'

export type PlanillaRow = [string, number, string, string, string]

// Filas del archivo, sin encabezado. Solo entran los montos > 0 (redondeados): una
// transferencia de ₡0 no existe y el banco rechaza el archivo entero por una fila así.
// Un nombre vacío TIRA: es preferible fallar acá que subir al banco una fila que no se
// puede pagar (o, peor, que el banco asocie al beneficiario equivocado).
export function buildPlanillaRows(
  beneficiarios: PlanillaBeneficiario[],
  concepto: string,
): PlanillaRow[] {
  const c = concepto.trim()
  if (!c) throw new Error('El concepto no puede ir vacío: el banco lo exige en las columnas D y E.')

  return beneficiarios.reduce<PlanillaRow[]>((acc, b) => {
    const monto = Math.round(Number(b.monto) || 0)
    if (monto <= 0) return acc
    const nombre = (b.nombre ?? '').trim()
    if (!nombre) {
      throw new Error(
        'Hay un beneficiario sin nombre para el homebanking. El banco identifica la cuenta por ese nombre: cargalo antes de exportar.',
      )
    }
    acc.push([nombre, monto, 'COL', c, c])
    return acc
  }, [])
}

// Bytes del .xlsx. Separado de la descarga a propósito: esto es puro (se testea sin DOM)
// y la descarga es la única parte que toca el navegador.
export function buildPlanillaXlsx(
  beneficiarios: PlanillaBeneficiario[],
  concepto: string,
): Uint8Array<ArrayBuffer> {
  const rows = buildPlanillaRows(beneficiarios, concepto)
  if (rows.length === 0) {
    throw new Error('No hay ningún monto mayor a ₡0 para exportar.')
  }
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, PLANILLA_SHEET)
  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer)
}

// Nombre de archivo sin espacios ni acentos: los homebankings viejos se atragantan con ambos.
export function planillaFileName(prefix: string, sufijo: string): string {
  const clean = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '')
  return `${clean(prefix)}-${clean(sufijo)}.xlsx`
}

export function downloadPlanillaXlsx(
  beneficiarios: PlanillaBeneficiario[],
  concepto: string,
  fileName: string,
): void {
  const bytes = buildPlanillaXlsx(beneficiarios, concepto)
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
