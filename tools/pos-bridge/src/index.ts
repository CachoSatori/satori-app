// El .env primero: `loadConfig` lee `process.env` ya cargado.
import 'dotenv/config'

import { loadConfig } from './config.js'
import { createDb } from './db.js'
import { fetchVentas, describeLote } from './fetchVentas.js'
import { pushVentas } from './pushVentas.js'
import { readState, writeState, getLastId, setLastId, advanceLastId } from './state.js'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ ESQUELETO · Agente local PoS → Supabase (Analítica PoS, Fase A)                        ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// Un proceso por local, en una PC del local. Cada 2 minutos lee las ventas nuevas del PoS
// (SQL Server, base `ndf`, SOLO LECTURA) y las empuja a la Edge Function `ingest-ventas`.
// No calcula nada: ni mix, ni ticket promedio, ni venta por pax. Eso se deriva después.
//
// ⚠ FASE A · NO SE CONECTA A NADA. Falta el permiso de lectura sobre `ndf` y falta la Edge
//   Function. El loop arranca, avisa en qué fase está y se va a dormir. Es a propósito: que
//   exista y corra vacío hace que cablearlo sea llenar tres huecos (ver README), no escribir
//   un agente.
//
// Las reglas del loop, copiadas del biotime-bridge porque ya se probaron en producción:
//   · Un ciclo a la vez (nunca solapa): se drena de a lotes hasta que un fetch traiga 0.
//   · El `last_id` avanza SOLO después de que el edge confirmó el lote.
//   · Si algo falla, no se avanza nada: el próximo ciclo relee, y la clave (local, pos_id)
//     de la base garantiza que reenviar no duplique.

/** Mientras el agente sea un esqueleto, el ciclo no intenta leer ni empujar. */
const FASE_A = true

const ts = () => new Date().toISOString()

let parando = false
let despertar: (() => void) | null = null

/** Sleep que se puede cortar con Ctrl+C sin esperar los 2 minutos. */
function dormir(ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    const t = setTimeout(() => { despertar = null; resolve() }, ms)
    despertar = () => { clearTimeout(t); despertar = null; resolve() }
  })
}

async function main(): Promise<void> {
  const cfg = loadConfig(process.env)
  const db = createDb(cfg)

  console.log(
    `[${ts()}] pos-bridge arriba · local=${cfg.local} · pos=${cfg.posHost}:${cfg.posPort}/${cfg.posDb} ` +
    `· cada ${Math.round(cfg.pollIntervalMs / 1000)}s · lote ${cfg.batchSize}`,
  )
  await db.checkEsquema()

  const cerrar = () => {
    if (parando) return
    parando = true
    console.log(`[${ts()}] parando… (termina el ciclo en curso)`)
    despertar?.()
  }
  process.on('SIGINT', cerrar)
  process.on('SIGTERM', cerrar)

  while (!parando) {
    let state = readState(cfg.stateFile)
    let lastId = getLastId(state, cfg.local)
    let fetched = 0, inserted = 0, duplicates = 0

    try {
      if (FASE_A) {
        console.log(
          `[${ts()}] local=${cfg.local} FASE A · sin conexión al PoS · last_id=${lastId} ` +
          '(cablear: query real + mapeo + Edge Function — ver README)',
        )
      } else {
        // Drenar de a lotes: si el PoS acumuló 3.000 cuentas, se van en tandas de BATCH_SIZE
        // dentro del MISMO ciclo, sin esperar un poll por lote.
        for (;;) {
          const ventas = await fetchVentas(db, lastId, cfg.batchSize)
          if (ventas.length === 0) break

          const res = await pushVentas(cfg, ventas)
          // Recién ahora: el edge confirmó, así que este id ya está a salvo.
          lastId = advanceLastId(lastId, ventas)
          state = setLastId(state, cfg.local, lastId)
          writeState(cfg.stateFile, state)

          fetched += ventas.length
          inserted += res.inserted
          duplicates += res.duplicates
          if (res.unmapped > 0) {
            console.warn(
              `[${ts()}] ${describeLote(cfg.local, ventas)} · ${res.unmapped} sin mesero mapeado ` +
              '(falta el puente mesero del PoS ↔ employees)',
            )
          }
          if (res.invalid > 0) {
            console.warn(`[${ts()}] descartes del edge · invalid=${res.invalid}`)
          }
          if (parando) break
        }

        console.log(
          `[${ts()}] local=${cfg.local} fetched=${fetched} inserted=${inserted} duplicates=${duplicates} last_id=${lastId}`,
        )
      }
    } catch (e) {
      // No se avanza el `last_id`: el lote se vuelve a intentar en el próximo ciclo.
      console.error(`[${ts()}] ciclo con error (se reintenta en el próximo poll):`, e instanceof Error ? e.message : e)
    }

    if (parando) break
    await dormir(cfg.pollIntervalMs)
  }

  await db.close()
  console.log(`[${ts()}] pos-bridge detenido.`)
}

main().catch(e => {
  // Error de arranque (config incompleta, PoS inalcanzable): salir con código != 0 para que el
  // Programador de tareas de Windows lo marque como fallido y lo reintente.
  console.error(`[${ts()}] no se pudo arrancar:`, e instanceof Error ? e.message : e)
  process.exitCode = 1
})
