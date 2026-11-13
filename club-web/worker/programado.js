// (12-nov, opción c del dueño) Cron del Worker: cada 10 minutos le pide al Edge `club-pase` que venza en Google Wallet
// los pases de las personas dadas de baja (POST /functions/v1/club-pase/vencer, header x-club-pase-sync).
// · Sin CLUB_PASE_SYNC_KEY (Secret del panel del Worker, ≥ 32 caracteres; la MISMA que el secreto del Edge) no hace nada:
//   así el cron puede estar en el wrangler.toml antes de que el Edge esté en prod.
// · No manda datos de nadie: el Edge lee la base. Al log va solo un resumen con conteos.

const RE_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/

export async function vencerBajasProgramado(env, fetchFn = fetch) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '')
  const clave = String(env.CLUB_PASE_SYNC_KEY || '')
  if (!RE_SUPABASE.test(url) || !env.SUPABASE_ANON_KEY || clave.length < 32) return { hecho: false, motivo: 'sin_configurar' }
  let r
  try {
    r = await fetchFn(`${url}/functions/v1/club-pase/vencer`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, 'x-club-pase-sync': clave },
    })
  } catch {
    console.log(JSON.stringify({ evento: 'club-pase-vencer', ok: false, motivo: 'red' }))
    return { hecho: false, motivo: 'red' }
  }
  let j = null
  try { j = await r.json() } catch { /* sin cuerpo */ }
  const resumen = { evento: 'club-pase-vencer', ok: r.status === 200, status: r.status }
  if (j && typeof j === 'object') {
    for (const k of ['eventos', 'con_pase', 'vencidos', 'ya_vencidos', 'sin_pase', 'permanentes', 'cursor_antes', 'cursor_despues']) {
      if (typeof j[k] === 'number') resumen[k] = j[k]
    }
    if (Array.isArray(j.errores)) resumen.errores = j.errores.length
    // (13-nov) el Edge corta a los ~90 s y guarda el cursor: la pasada siguiente sigue desde ahí
    if (typeof j.cortado_por_tiempo === 'boolean') resumen.cortado_por_tiempo = j.cortado_por_tiempo
  }
  console.log(JSON.stringify(resumen))
  return { hecho: r.status === 200, status: r.status }
}
