// (mig 096) La clave del servidor (`public.proveedor_clave_alias`) tiene que ser la MISMA que `claveProveedor` del cliente:
// si difieren, la RPC deja pasar duplicados que el cliente ve iguales (o rechaza alias que el cliente ve nuevos).
// Esta prueba lee el SQL de la 096, exige los pasos que emula y compara la emulación con claveProveedor en un corpus.
// La batería en Postgres (scripts/sql/096_pruebas.sql, caso 12) cubre lo mismo contra la base real.
// Mutaciones anotadas (verificadas el 13-nov): sacar `NFD` del SQL → cae «el SQL de la 096…»; cambiar `< 4` por `< 3`
// en la 096 → cae «el mínimo…»; en la emulación, no descomponer (sin NFD) → cae «emulación = claveProveedor».
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { claveProveedor, ALIAS_MIN } from './proveedorAlias'

const SQL = readFileSync(join(__dirname, '../../../supabase/migrations/096_proveedor_agregar_alias.sql'), 'utf8')

/** Lo que hace proveedor_clave_alias en Postgres: NFD → quitar marcas U+0300–U+036F → lower → solo a-z0-9.
 *  `lower` de Postgres con collation C solo baja ASCII: se emula así (lo demás lo saca el último paso igual). */
const claveSql = (s: string | null) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[A-Z]/g, c => c.toLowerCase()).replace(/[^a-z0-9]/g, '')

describe('clave de proveedor: servidor (096) = cliente', () => {
  it('el SQL de la 096 hace exactamente los pasos que se emulan', () => {
    const cuerpo = SQL.slice(SQL.indexOf('create or replace function public.proveedor_clave_alias'), SQL.indexOf('comment on function public.proveedor_clave_alias'))
    expect(cuerpo).toContain("normalize(coalesce(p, ''), NFD)")
    expect(cuerpo).toContain("'[\\u0300-\\u036f]', '', 'g'")
    expect(cuerpo).toMatch(/lower\(regexp_replace\(normalize/)
    expect(cuerpo).toContain("'[^a-z0-9]', '', 'g'")
  })

  it('el mínimo de la RPC es ALIAS_MIN del cliente', () => {
    expect(SQL).toContain(`if length(v_clave) < ${ALIAS_MIN} then`)
  })

  it('emulación = claveProveedor en un corpus con tildes, ñ, puntuación y mayúsculas', () => {
    const corpus = [
      'Exportadora X, S.A.', 'X S. A.', 'Café Ñandú Ltda.', 'ÁÉÍÓÚ Ñ ü ç', 'Pescadería  Del-Mar #2', 'MARISCOS FICTICIOS',
      'Lácteos «La Vaca» S.R.L.', 'Distribuidora 3-101-000000', '  ', '', 'São Paulo Importações', 'Œuvre & Cía',
      'Straße', 'ﬁ ligadura', 'Ø Nórdica', 'Ⅻ romano', '½ media',
    ]
    for (const s of corpus) expect(claveSql(s), s).toBe(claveProveedor(s))
    expect(claveSql(null)).toBe(claveProveedor(null))
  })
})
