#!/usr/bin/env node
// ── pos-bridge · el agente (A3) ────────────────────────────────────────────────
//
//   npm run pos:agente            (desde la raíz del repo)
//   npm run agente                (desde pos-bridge/)
//
// CORRE EN LA PC DEL PoS (`DESKTOP-25PRDR1`): es la única máquina con red al PoS y a
// Supabase a la vez. Cada ciclo lee las ventas nuevas y las mesas abiertas, y se las
// manda al Edge `ingest-ndf`. READ-ONLY contra el PoS: solo SELECT, con el candado de
// `sqlGuard.ts` antes de cada sentencia.
//
// Reglas del loop (las mismas del agente BioTime):
//   · Un ciclo a la vez: nunca se solapan.
//   · El cursor avanza SOLO con lo que el Edge confirmó.
//   · Si algo falla no se avanza nada: el próximo ciclo relee y el
//     `(local, numero_factura)` de la base garantiza que reenviar no duplique.
//   · No crashea: el PoS apagado o Supabase caído son un ciclo con error, no una caída.

import { describirAgente, loadAgenteConfig } from './configAgente.ts'
import { loadEnv, describirConfig } from './config.ts'
import { leerAbiertas, leerCerradas, puedeLeerAbiertas } from './consultaAgente.ts'
import { abrirConexion, type ConexionPos } from './db.ts'
import { leerEsquema } from './extraerDia.ts'
import { pushIngest } from './pushIngest.ts'
import { describirCiclo, ejecutarCiclo, ESTADO_INICIAL, type EstadoAgente, type PuertosCiclo } from './ciclo.ts'
import { intervaloMs } from './ventana.ts'
import type { Esquema } from './esquema.ts'

const ts = () => new Date().toISOString()

let parando = false
let despertar: (() => void) | null = null

/** Sleep que se puede cortar con Ctrl+C sin esperar el ciclo entero. */
function dormir(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(() => { despertar = null; resolve() }, ms)
    despertar = () => { clearTimeout(t); despertar = null; resolve() }
  })
}

async function main(): Promise<void> {
  const cfg = loadAgenteConfig(loadEnv())

  console.log(`[${ts()}] agente pos-ndf arriba · ${describirAgente(cfg)}`)
  console.log(`[${ts()}] PoS (solo lectura): ${describirConfig(cfg.pos)}`)

  // La conexión al PoS se abre por ciclo y se cierra al terminar: si el SQL Server se
  // reinicia de madrugada, el agente no queda pegado a un pool muerto.
  let cache: Esquema | null = null

  const conectar = async (): Promise<{ conn: ConexionPos; esquema: Esquema }> => {
    const conn = await abrirConexion(cfg.pos)
    // El esquema se resuelve una vez y se reusa: es catálogo, no cambia entre ciclos.
    if (cache === null) cache = await leerEsquema(conn, cfg.pos.columnas)
    return { conn, esquema: cache }
  }

  const puertos: PuertosCiclo = {
    async leerCerradas(p) {
      const { conn, esquema } = await conectar()
      try {
        return await leerCerradas(conn, esquema, p)
      } finally {
        await conn.close()
      }
    },
    async leerAbiertas(r) {
      const { conn, esquema } = await conectar()
      try {
        // Sin `NumeroPedido` no hay clave estable para la mesa: se manda `open` ausente y
        // el Edge no toca el snapshot (mejor no saber que borrar mesas vivas).
        return puedeLeerAbiertas(esquema) ? await leerAbiertas(conn, esquema, r) : null
      } finally {
        await conn.close()
      }
    },
    enviar: (payload) => pushIngest(cfg, payload),
  }

  const cerrar = () => {
    if (parando) return
    parando = true
    console.log(`[${ts()}] parando… (termina el ciclo en curso)`)
    despertar?.()
  }
  process.on('SIGINT', cerrar)
  process.on('SIGTERM', cerrar)

  let estado: EstadoAgente = { ...ESTADO_INICIAL }

  while (!parando) {
    const ahora = new Date()
    const { estado: siguiente, resumen } = await ejecutarCiclo(
      puertos, cfg.local, cfg.ventanaHoras, estado, ahora,
    )
    estado = siguiente

    const linea = `[${ts()}] ${describirCiclo(resumen)}`
    if (resumen.error !== null) console.error(linea)
    else console.log(linea)
    for (const a of resumen.avisos) console.warn(`[${ts()}]   ⚠ ${a}`)

    if (parando) break
    // Después del saludo se entra al primer ciclo real sin esperar.
    await dormir(resumen.fase === 'saludo' ? 0 : intervaloMs(ahora, cfg.ritmo))
  }

  console.log(`[${ts()}] agente detenido.`)
}

main().catch((e: unknown) => {
  // Error de ARRANQUE (config incompleta, entorno no habilitado): salir con código != 0
  // para que el Programador de tareas de Windows lo marque como fallido y lo reintente.
  // Los errores de ciclo NO llegan acá: se manejan adentro y el agente sigue vivo.
  console.error(`[${ts()}] no se pudo arrancar:`, e instanceof Error ? e.message : e)
  process.exitCode = 1
})
