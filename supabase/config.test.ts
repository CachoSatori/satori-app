// supabase/config.toml (ítem 11). Branching despliega a prod, en cada push a main, las funciones declaradas acá con su
// verify_jwt: un valor equivocado es una función abierta o un 401 en cada llamada (el agente del PoS deja de cargar ventas).
// Los valores esperados son los de PROD (list_edge_functions, solo lectura, 20-nov-2026). Cambiar uno es una decisión del
// dueño: se cambia acá y en config.toml en el mismo PR, con firma.
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error módulo .mjs sin tipos
import { carpetasDeFunciones, leerConfig, problemasConfig } from '../scripts/ci/edgeConfig.mjs'

const RAIZ = __dirname
const texto = readFileSync(join(RAIZ, 'config.toml'), 'utf8')
const config = leerConfig(texto) as { verify: Record<string, boolean | undefined>; secciones: string[] }
const carpetas = carpetasDeFunciones(join(RAIZ, 'functions')) as string[]

const PROD: Record<string, boolean> = {
  'monthly-report': true,
  'extract-document': true,
  'cierre-email': true,
  'pago-notificar': true,
  'ventas-dia-contador': true,
  'alta-empleado': true,
  'ingest-ndf': false,
  'club-pase': false,
}

describe('supabase/config.toml', () => {
  it('verify_jwt de cada función = el de prod', () => {
    expect(config.verify).toEqual(PROD)
  })
  it('cada carpeta de supabase/functions/ tiene su bloque y no hay bloques sin carpeta', () => {
    expect(problemasConfig(config, carpetas)).toEqual([])
    expect(carpetas).toEqual(Object.keys(PROD).sort())
  })
  it('solo [functions.*]: sin [auth], [api], [db] ni [remotes] (la config de Auth/API de prod no se maneja desde acá)', () => {
    expect(config.secciones.filter(s => !s.startsWith('functions.'))).toEqual([])
  })
  it('mutaciones: la regla cae con verify_jwt cambiado, bloque faltante o [remotes]', () => {
    const mal = (t: string) => problemasConfig(leerConfig(t), carpetas) as string[]
    expect(mal(texto.replace(/(\[functions\.ingest-ndf\]\nverify_jwt = )false/, '$1true')).join()).toMatch(/ingest-ndf/)
    expect(mal(texto.replace(/(\[functions\.club-pase\]\nverify_jwt = )false/, '$1true')).join()).toMatch(/club-pase/)
    expect(mal(texto.replace(/\[functions\.alta-empleado\]\nverify_jwt = true\n/, '')).join()).toMatch(/alta-empleado/)
    expect(mal(texto + '\n[remotes.x]\nproject_id = "ficticio"\n').join()).toMatch(/remotes/)
  })
})
