// (12-nov) El Edge lee del entorno TODAS las variables que espera la lógica (EnvPase). Si falta una, la lógica la ve
// vacía: con WALLET_ENTORNO, el Edge respondería 503 a todo aunque el secreto esté cargado en el panel.
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), 'utf8')

test('club-pase: cada variable de EnvPase se lee con Deno.env.get en index.ts', () => {
  const logica = leer('../../../src/shared/wallet/edgePase.ts')
  const ini = logica.indexOf('export interface EnvPase')
  const bloque = logica.slice(ini, logica.indexOf('\n}\n', ini))   // hasta la llave que cierra la interfaz (columna 0)
  const esperadas = [...bloque.matchAll(/^\s+([A-Z][A-Z0-9_]+)\?:/gm)].map(m => m[1])
  expect(esperadas).toEqual(expect.arrayContaining(['CLUB_WEB_KEY', 'GOOGLE_WALLET_ISSUER_ID', 'GOOGLE_WALLET_SA_KEY', 'CLUB_WEB_ORIGIN', 'WALLET_ENTORNO']))
  const indice = leer('./index.ts')
  for (const v of esperadas) expect(indice, v).toContain(`${v}: Deno.env.get('${v}')`)
})

test('club-pase: la red hacia Google solo va a la API de Wallet y al token OAuth', () => {
  const indice = leer('./index.ts')
  expect(indice).toMatch(/startsWith\('https:\/\/walletobjects\.googleapis\.com\/'\)/)
  expect(indice).toContain("url !== 'https://oauth2.googleapis.com/token'")
  expect(indice).toMatch(/manejarPase\(req, ruta, env, rpc, fetchGoogle\)/)
  // (12-nov, opción c) /vencer llega a manejarSync, como /sync y /actualizar
  expect(indice).toContain("if (ruta === 'sync' || ruta === 'vencer' || ruta === 'actualizar') return await manejarSync(req, ruta, env, rpc, fetchGoogle)")
})
