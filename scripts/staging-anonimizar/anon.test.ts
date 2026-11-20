// Anonimización de staging: reglas puras (anon.ts), sincronía con el SQL y forma de la clasificación.
// La corrida de verdad del SQL (en una base Postgres local, con datos inventados y 13 mutaciones) está en
// scripts/sql/anonimizar_staging_pruebas.sql + anonimizar_staging_mutaciones.py; esto corre en el gate sin base.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CEDULA_FICTICIA, IMAGEN_FICTICIA, NOTA, aliasNumerado, asignarAlias, claveAlias, descripcionAnonima, esAlias,
  esCorreoFicticio, esTelefonoFicticio, reemplazarCedulaClave, telefonoFicticio,
} from './anon'

const leer = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')
const COMUN = leer('comun.sql')
const ANON = leer('anonimizar.sql')
const CLASIF = leer('clasificacion.sql')

// Clave FE inventada: 506 · 011126 · cédula (12) · consecutivo (20) · situación (1) · seguridad (8)
const clave = (cedula: string, consecutivo = '00100001040000000123', seg = '12345678') =>
  `506011126${cedula}${consecutivo}1${seg}`

describe('alias numerados (D2)', () => {
  it('«Prefijo NN» con dos dígitos como mínimo y sin truncar de 100 en adelante', () => {
    expect(aliasNumerado('empleado', 7)).toBe('Empleado 07')
    expect(aliasNumerado('socio', 123)).toBe('Socio 123')
    expect(esAlias(aliasNumerado('cliente', 1))).toBe(true)
    expect(() => aliasNumerado('proveedor', 0)).toThrow()
  })

  it('el mismo nombre con otra mayúscula o espacios queda con el mismo alias en todas las columnas', () => {
    const m = asignarAlias('empleado', [['Ana Ficticia Mora'], ['ana ficticia mora  '], ['ANA FICTICIA MORA'], ['Otro Nombre']])
    expect(m.get(claveAlias('Ana Ficticia Mora'))).toBe('Empleado 01')
    expect(m.get(claveAlias(' ANA FICTICIA MORA'))).toBe('Empleado 01')
    expect(m.get(claveAlias('Otro Nombre'))).toBe('Empleado 02')
  })

  it('un grupo (nombre, nombre del PoS y perfil) recibe un solo alias; los uuid y vacíos no entran', () => {
    const m = asignarAlias('empleado', [['Ana Ficticia Mora', 'ANA F', null, ''], ['00000000-0000-4000-8000-000000000001']])
    expect(m.get(claveAlias('ANA F'))).toBe(m.get(claveAlias('Ana Ficticia Mora')))
    expect(m.size).toBe(2)
  })

  it('los alias y los nombres de prueba se mapean a sí mismos; el contador sigue después del más alto (idempotencia)', () => {
    const m = asignarAlias('proveedor', [['Proveedor 05'], ['Prueba Cajero'], ['Nuevo Proveedor Ficticio']], ['Proveedor 05', 'Proveedor 09'])
    expect(m.get(claveAlias('Proveedor 05'))).toBe('Proveedor 05')
    expect(m.get(claveAlias('Prueba Cajero'))).toBe('Prueba Cajero')
    expect(m.get(claveAlias('Nuevo Proveedor Ficticio'))).toBe('Proveedor 10')
    // segunda pasada sobre lo ya anonimizado: nada cambia
    const segunda = asignarAlias('proveedor', [['Proveedor 05'], ['Proveedor 10']], ['Proveedor 05', 'Proveedor 10'])
    expect([...segunda.values()]).toEqual(['Proveedor 05', 'Proveedor 10'])
  })

  it('un grupo con un valor ya anonimizado arrastra a los demás a ese alias', () => {
    const m = asignarAlias('empleado', [['Empleado 03', 'Nombre Nuevo Ficticio']], ['Empleado 03'])
    expect(m.get(claveAlias('Nombre Nuevo Ficticio'))).toBe('Empleado 03')
  })
})

describe('clave FE: cédula del emisor reemplazada (D7)', () => {
  it('cambia solo las posiciones 10–21 y deja 50 dígitos válidos, con el mismo consecutivo y código de seguridad', () => {
    const original = clave('003101999992')
    const nueva = reemplazarCedulaClave(original)
    expect(nueva).toMatch(/^[0-9]{50}$/)
    expect(nueva.slice(9, 21)).toBe(CEDULA_FICTICIA)
    expect(nueva.slice(0, 9)).toBe(original.slice(0, 9))          // 506 + fecha
    expect(nueva.slice(21, 41)).toBe('00100001040000000123')         // consecutivo = el de la fila
    expect(nueva.slice(21)).toBe(original.slice(21))                // situación + código de seguridad
    expect(reemplazarCedulaClave(nueva)).toBe(nueva)                // idempotente
  })

  it('con otra forma (corta, con espacios, con letras) la deja igual', () => {
    for (const v of ['50601112600', ` ${clave('003101999992')}`, clave('003101999992').replace('1', 'A'), '']) {
      expect(reemplazarCedulaClave(v)).toBe(v)
    }
  })

  it('propiedad: para 500 claves al azar el largo, el consecutivo y la cantidad de distintas no cambian', () => {
    let semilla = 20261120
    const azar = (n: number) => Array.from({ length: n }, () => { semilla = (semilla * 1103515245 + 12345) % 2 ** 31; return semilla % 10 }).join('')
    const claves = Array.from({ length: 500 }, () => clave(azar(12), azar(20), azar(8)))
    const nuevas = claves.map(reemplazarCedulaClave)
    expect(nuevas.every(c => c.length === 50 && c.slice(9, 21) === CEDULA_FICTICIA)).toBe(true)
    expect(nuevas.every((c, i) => c.slice(21, 41) === claves[i].slice(21, 41))).toBe(true)
    expect(new Set(nuevas).size).toBe(new Set(claves).size)
  })
})

describe('descripción de caja (regla 11 y patrones del sistema)', () => {
  it.each([
    ['Ventas efectivo Noche 2026-11-01', 'Ventas efectivo Noche 2026-11-01'],
    ['Retiro dueños a banco 2026-11-01', 'Retiro dueños a banco 2026-11-01'],
    ['Apertura pozo 2026-07-22', 'Apertura pozo 2026-07-22'],
    ['Propinas turno 2026-11-01 Mediodía', 'Propinas turno 2026-11-01 Mediodía'],
    ['Ajuste de cierre 2026-11-01 · Sobrante · lo contó alguien', `Ajuste de cierre 2026-11-01 · Sobrante · ${NOTA}`],
    ['Pago a alguien · fact 2026-10-30 · fact 2026-11-02', `${NOTA} · fact 2026-11-02`],
    ['Propinas turno 2026-11-01 Alguien', NOTA],
    ['Ventas efectivo Noche 2026-11-01 de alguien', NOTA],
    [`${NOTA} · fact 2026-11-02`, `${NOTA} · fact 2026-11-02`],
    ['', ''],
  ])('%s', (entrada, salida) => {
    expect(descripcionAnonima(entrada)).toBe(salida)
  })
})

describe('teléfonos y correos ficticios', () => {
  it('los 100 teléfonos son del bloque de la lista blanca (8000 00NN) y el formato pasa el check del Club', () => {
    const todos = Array.from({ length: 100 }, (_, n) => telefonoFicticio(n))
    expect(new Set(todos).size).toBe(100)
    expect(todos.every(t => esTelefonoFicticio(t) && /^\+[1-9][0-9]{6,14}$/.test(t))).toBe(true)
    expect(() => telefonoFicticio(100)).toThrow()
    expect(esTelefonoFicticio(['+506 ', '6000', '0042'].join(''))).toBe(false)
  })
  it('solo staging-satori.test y example.com son correos ficticios', () => {
    expect(esCorreoFicticio('anon-0123456789ab@staging-satori.test')).toBe(true)
    expect(esCorreoFicticio('alguien' + '@' + 'dominio-real.cr')).toBe(false)
  })
})

describe('sincronía con el SQL', () => {
  it('las constantes y formas de anon.ts son las mismas de comun.sql / anonimizar.sql', () => {
    expect(COMUN).toContain(`substr(v, 1, 9) || '${CEDULA_FICTICIA}' || substr(v, 22)`)
    expect(ANON).toContain(`'${IMAGEN_FICTICIA}'`)
    expect(COMUN).toContain(`'${NOTA}'`)
    expect(COMUN).toContain(`'^(Empleado|Proveedor|Socio|Cliente) [0-9]{2,}$'`)
    expect(COMUN).toContain(`'^(506)?800000[0-9]{2}$'`)
    expect(COMUN).toContain(`'@(staging-satori\\.test|example\\.com)$'`)
    expect(ANON).toContain(`'+506800000' || lpad(`)
    expect(ANON).toContain(`lpad(v_n::text, greatest(2, length(v_n::text)), '0')`)   // sin truncar, como aliasNumerado
    expect(COMUN).toContain(`(Mediodía|Noche|Mañana|Tarde|AM|PM)`)
  })

  it('la guarda pide el ref de staging, club_entorno y los usuarios de prueba; prod no aparece como destino', () => {
    expect(COMUN).toMatch(/current_setting\('anon\.ref', true\) is distinct from 'hwiatgicyyqyezqwldia'/)
    expect(COMUN).toMatch(/club_entorno where nombre = 'staging'/)
    expect(COMUN).toMatch(/if v_n < 5 then/)
    const py = leer('correr.py')
    expect(py).toMatch(/^REF = 'hwiatgicyyqyezqwldia'/m)
    // el ref de prod no se escribe en una prueba (src/refProdEnPruebas.test.ts): se lee de la herramienta que lo usa de candado
    const prod = /PROD_REF = '([a-z]{20})'/.exec(readFileSync(new URL('../club/migrar_firestore.py', import.meta.url), 'utf8'))?.[1]
    expect(prod).toMatch(/^[a-z]{20}$/)
    expect(py).not.toContain(`projects/${prod}`)
    expect(ANON.indexOf('select pg_temp.anon_guarda();')).toBeLessThan(ANON.indexOf('update '))
  })

  it('corre sin triggers y aborta si cambia un control del §2', () => {
    expect(ANON).toContain('set local session_replication_role = replica;')
    expect(ANON).not.toMatch(/disable\s+trigger/i)
    expect(ANON).toContain("raise exception 'ANON-ABORTA: cambió un control del §2")
  })
})

describe('clasificación (clasificacion.sql)', () => {
  const CLASES = new Set(['mantener', 'alias_empleado', 'alias_proveedor', 'alias_socio', 'alias_cliente', 'correo', 'correo_auth',
    'telefono', 'nota', 'descripcion_fact', 'nulo', 'seudonimo', 'token', 'clave_fe', 'json', 'json_mantener', 'adjuntos',
    'ruta_storage', 'vaciar_tabla', 'especial'])
  const bloque = CLASIF.slice(CLASIF.indexOf('insert into _anon_clases'), CLASIF.indexOf('drop table if exists _anon_json_extra'))
  const filas = [...bloque.matchAll(/\('([a-z0-9_]+)', '([a-z0-9_,]+)', '([a-z_]+)'\)/g)]
    .flatMap(m => m[2].split(',').map(c => ({ tabla: m[1], columna: c, clase: m[3] })))

  it('tiene todas las columnas del inventario de staging (470 al 20-nov) y ninguna repetida', () => {
    expect(filas.length).toBeGreaterThanOrEqual(470)
    const claves = filas.map(f => `${f.tabla}.${f.columna}`)
    expect(claves.length - new Set(claves).size).toBe(0)
  })

  it('cada clase existe y cada clase con paso propio está en anonimizar.sql', () => {
    expect(filas.filter(f => !CLASES.has(f.clase))).toEqual([])
    const conPasoGenerico = [...CLASES].filter(c => !['mantener', 'json_mantener', 'correo_auth', 'especial'].includes(c) && !c.startsWith('alias_'))
    for (const c of conPasoGenerico) expect(ANON).toContain(`'${c}'`)
    expect(ANON).toContain("where a.clase like 'alias\\_%'")                                 // un solo paso para los 4 alias
    expect(ANON).toContain('update public.profiles p set email = u.email from auth.users u')   // correo_auth
    // las columnas «especial» tienen su paso con nombre
    for (const f of filas.filter(f => f.clase === 'especial')) expect(ANON).toContain(f.columna)
  })

  it('lo que la spec manda tratar está clasificado así', () => {
    const clase = (t: string, c: string) => filas.find(f => f.tabla === t && f.columna === c)?.clase
    expect(clase('cash_movements', 'description')).toBe('descripcion_fact')
    expect(clase('ventas_dias', 'data')).toBe('vaciar_tabla')                       // D4
    expect(clase('employee_bank_info', 'banco')).toBe('vaciar_tabla')               // banco: borrar
    expect(clase('club_pases', 'object_id')).toBe('vaciar_tabla')
    expect(clase('fe_documentos', 'receptor_id')).toBe('nulo')                       // cédula del receptor
    expect(clase('pos_ndf_tickets', 'clave_fe')).toBe('clave_fe')                    // D7
    expect(clase('employees', 'pos_login')).toBe('mantener')                         // logins del PoS: no se tocan
    expect(clase('sops', 'content')).toBe('mantener')                                // D6
    expect(clase('bitacora_permisos', 'antes')).toBe('mantener')
    for (const c of ['token_portal', 'token_pase', 'codigo', 'codigo_socio']) expect(clase('club_miembros', c)).toBe('token')
    expect(clase('club_cupones_contactos', 'baja_token')).toBe('token')
    expect(clase('club_web_clave', 'sha256')).toBe('token')
    expect(clase('club_codigos_canje', 'codigo_hash')).toBe('token')
    expect(filas.filter(f => f.tabla.endsWith('_pre_migracion_2026_07')).every(f => f.clase === 'vaciar_tabla')).toBe(true)
  })
})
