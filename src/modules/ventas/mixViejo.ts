// ── El «Mix» viejo, sus cuentas (PURO) — sacadas tal cual de `VentasMix.tsx` en la 3.2 ─────────────────────────
//
// Sin cambiar una coma de la cuenta: se movieron acá para que la prueba de paridad de la 3.2
// (`__paridad__/productos32.paridad.test.ts`) compare la «Productos» definitiva contra lo que el Mix viejo pinta.
// El Mix viejo se retira en la 3.6 (SPEC-ventas-v2 §9) y con él este archivo.
import type { DiasMap, ProductMap } from '../../shared/types/ventas'
// Caja de turno con la regla central: sin mayúsculas ni tildes, y reconoce los nombres del
// .xls («Cajero Turno Mañana», «cajero turno tarde»), que la clave exacta dejaba afuera.
import { esCajaDeTurno } from './baldesNoMesero'

export interface PMItem {
  nombre: string; tipo: string; clas: string; subcl: string
  monto: number; unidades: number; salon: number; delivery: number
}
export interface CMSubcl { monto: number; unidades: number; salon: number; delivery: number; prods: PMItem[] }
export interface CMClas  { monto: number; unidades: number; salon: number; delivery: number; subcls: Record<string, CMSubcl> }
export type ClassMap = Record<string, CMClas>
export interface Tots { totG: number; totBeb: number; totCom: number; totMerch: number; totLC: number; totUn: number }

export const TIPOS_BASE = ['bebida','comida','comensales','local club','invitados','cortesia','personal']

export function getMonto(p: PMItem | { monto: number; salon: number; delivery: number }, canal: 'todos'|'salon'|'delivery'): number {
  if (canal === 'salon')    return (p as PMItem).salon
  if (canal === 'delivery') return (p as PMItem).delivery
  return p.monto
}

export function buildPMRaw(dates: string[], dias: DiasMap, pm: ProductMap, canal: 'todos'|'salon'|'delivery'): Record<string, PMItem> {
  const result: Record<string, PMItem> = {}
  for (const date of dates) {
    const dia = dias[date]
    if (!dia) continue
    for (const [salName, s] of Object.entries(dia.saloneros)) {
      const isCaj = esCajaDeTurno(salName)
      if (canal === 'salon'    && isCaj)  continue
      if (canal === 'delivery' && !isCaj) continue
      const prods = (s as { prods?: [string, number, number][] }).prods ?? []
      for (const [name, qty, monto] of prods) {
        if (!name) continue
        const info = pm[name]
        if (!result[name]) {
          result[name] = {
            nombre: name,
            tipo:  info?.tipo ?? 'desconocido',
            clas:  info?.clasificacion ?? 'SIN CLASIFICAR',
            subcl: info?.subclasificacion ?? '',
            monto: 0, unidades: 0, salon: 0, delivery: 0,
          }
        }
        const mult = info?.multiplicador ?? 1
        result[name].monto    += monto
        result[name].unidades += qty * mult
        if (isCaj) result[name].delivery += monto
        else       result[name].salon    += monto
      }
    }
  }
  return result
}

export function calcTotals(PM: Record<string, PMItem>, canal: 'todos'|'salon'|'delivery'): Tots {
  let totG=0, totBeb=0, totCom=0, totMerch=0, totLC=0, totUn=0
  for (const p of Object.values(PM)) {
    const m = getMonto(p, canal)
    if (!['cortesia','comensales'].includes(p.tipo)) { totG += m; totUn += p.unidades }
    if (p.tipo === 'bebida') totBeb += m
    else if (p.tipo === 'comida') totCom += m
    else if (['merchandising','nofood','desconocido'].includes(p.tipo) || !TIPOS_BASE.includes(p.tipo)) totMerch += m
    else if (p.tipo === 'local club' || p.tipo === 'invitados') totLC += m
  }
  return { totG, totBeb, totCom, totMerch, totLC, totUn }
}
