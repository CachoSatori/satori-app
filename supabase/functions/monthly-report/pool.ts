// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Pool de una sesión — REIMPLEMENTACIÓN del pool de propinas para el reporte mensual por correo.
//
//  FUENTE DE VERDAD (sagrado, NO importable desde Deno): src/shared/utils/tipCalculations.ts →
//  calcTurno().totals.totalPool (y calcHistory, que lo alimenta desde las entries). Esta función
//  DEBE reproducir su composición AL PESO:
//
//      totalPool = efectivo + propinaSala + barra
//        efectivo    = pool_efectivo_crc + pool_efectivo_usd · tc
//        propinaSala = Σ (tip_amount_crc + tip_amount_usd · tc) de las entries de SALA (rol NO barra)
//        barra       = pool_barra_crc + pool_barra_electronico_crc
//
//  El correo viejo sumaba SOLO las columnas de la sesión (efectivo + barra) y perdía `propinaSala`
//  (las propinas individuales de sala/datáfono) → Julio 2026 daba ₡471.311 en vez de ₡2.160.860.
//
//  Clasificación sala↔barra por BAR_ROLES (barman/barback), igual que calcTurno. El `role` que llega
//  acá ya viene resuelto por el caller (rol base, = lo que computa TipStats/Estadísticas; ver nota en
//  index.ts sobre base vs covered_role).
//
//  ⚠️ Deno no puede importar el sagrado, así que esta réplica queda ATADA por el ORACLE TEST
//  (pool.test.ts): exige poolTotalSesion(...) === calcTurno.totalPool al peso. NO tocar la fórmula
//  sin correr ese test.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const BAR_ROLES = new Set<string>(['barman', 'barback'])

export interface PoolSesion {
  pool_efectivo_crc: number | null
  pool_efectivo_usd: number | null
  pool_barra_crc: number | null
  pool_barra_electronico_crc: number | null
  exchange_rate: number | null
}

export interface PoolEntry {
  role: string                    // rol ya resuelto (sala vs barra) — ver index.ts
  tip_amount_crc: number | null   // propina individual (solo PROPINA_ROLES; barra/cocina = 0)
  tip_amount_usd: number | null
}

/** Pool total de UNA sesión = efectivo + propinaSala(sala) + barra(ef+electrónica). Réplica de calcTurno.totalPool. */
export function poolTotalSesion(s: PoolSesion, entries: PoolEntry[]): number {
  const tc = s.exchange_rate ?? 640
  const efectivo = (s.pool_efectivo_crc ?? 0) + (s.pool_efectivo_usd ?? 0) * tc
  const barra    = (s.pool_barra_crc ?? 0) + (s.pool_barra_electronico_crc ?? 0)
  const propinaSala = entries.reduce(
    (acc, e) => BAR_ROLES.has(e.role) ? acc : acc + (e.tip_amount_crc ?? 0) + (e.tip_amount_usd ?? 0) * tc,
    0,
  )
  return efectivo + propinaSala + barra
}
