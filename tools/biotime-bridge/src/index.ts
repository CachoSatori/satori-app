// El .env primero: `loadConfig` lee `process.env` ya cargado.
import 'dotenv/config'

import { loadConfig } from './config.js'
import { createDb } from './db.js'
import { fetchPunches, describeLote } from './fetchPunches.js'
import { pushIngest } from './pushIngest.js'
import { readState, writeState, getLastId, setLastId, advanceLastId } from './state.js'

// ── Agente local BioTime → Supabase (F1c) ───────────────────────────────────────
// Un proceso por local, en la PC del reloj. Lee `iclock_transaction` (solo lectura) y
// empuja las marcas nuevas al edge `ingest-punches`. No deriva horas ni empareja in/out:
// eso es F1d.
//
// Reglas del loop:
//   · Un ciclo a la vez (nunca solapa): se drena de a lotes hasta que un fetch traiga 0.
//   · El `last_id` avanza SOLO después de que el edge confirmó el lote.
//   · Si algo falla, no se avanza nada: el próximo ciclo relee y el (local, biotime_id)
//     de la base garantiza que reenviar no duplique.

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
    `[${ts()}] bridge arriba · local=${cfg.local} · biotime=${cfg.biotimeHost}:${cfg.biotimePort}/${cfg.biotimeDb} ` +
    `· cada ${Math.round(cfg.pollIntervalMs / 1000)}s · lote ${cfg.batchSize}`,
  )
  await db.checkPunchTimeType()

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
      // Drenar de a lotes: si el reloj acumuló 3.000 marcas, se van en tandas de BATCH_SIZE
      // dentro del MISMO ciclo, sin esperar un poll por lote.
      for (;;) {
        const punches = await fetchPunches(db, lastId, cfg.batchSize)
        if (punches.length === 0) break

        const res = await pushIngest(cfg, punches)
        // Recién ahora: el edge confirmó, así que este id ya está a salvo.
        lastId = advanceLastId(lastId, punches)
        state = setLastId(state, cfg.local, lastId)
        writeState(cfg.stateFile, state)

        fetched += punches.length
        inserted += res.inserted
        duplicates += res.duplicates
        if (res.unmapped > 0) {
          console.warn(
            `[${ts()}] ${describeLote(cfg.local, punches)} · ${res.unmapped} sin empleado mapeado ` +
            '(falta el código de BioTime en Salarios → Empleados/Tarifas)',
          )
        }
        if (res.unknown_state > 0 || res.invalid > 0) {
          console.warn(
            `[${ts()}] descartes del edge · unknown_state=${res.unknown_state} invalid=${res.invalid}`,
          )
        }
        if (parando) break
      }

      console.log(
        `[${ts()}] local=${cfg.local} fetched=${fetched} inserted=${inserted} duplicates=${duplicates} last_id=${lastId}`,
      )
    } catch (e) {
      // No se avanza el `last_id`: el lote se vuelve a intentar en el próximo ciclo.
      console.error(`[${ts()}] ciclo con error (se reintenta en el próximo poll):`, e instanceof Error ? e.message : e)
    }

    if (parando) break
    await dormir(cfg.pollIntervalMs)
  }

  await db.close()
  console.log(`[${ts()}] bridge detenido.`)
}

main().catch(e => {
  // Error de arranque (config incompleta, BioTime inalcanzable): salir con código != 0 para
  // que el Programador de tareas de Windows lo marque como fallido y lo reintente.
  console.error(`[${ts()}] no se pudo arrancar:`, e instanceof Error ? e.message : e)
  process.exitCode = 1
})
