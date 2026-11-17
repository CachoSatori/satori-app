// El clonado prod → staging NO copia credenciales ni correos reales (docs/seguridad/PLAN-usuarios-prueba-staging.md).
// Importa el script de Python de verdad (sin correr main) y revisa el SELECT que arma contra prod.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const RUTA = new URL('./clone_prod_to_staging.py', import.meta.url).pathname
const COLS_USERS = ['instance_id', 'id', 'aud', 'role', 'email', 'encrypted_password', 'email_confirmed_at', 'confirmation_token',
  'recovery_token', 'email_change_token_new', 'email_change', 'raw_app_meta_data', 'raw_user_meta_data', 'phone', 'phone_change',
  'phone_change_token', 'email_change_token_current', 'banned_until', 'reauthentication_token', 'created_at']
const COLS_IDENT = ['provider_id', 'user_id', 'identity_data', 'provider', 'last_sign_in_at', 'created_at', 'id']

function py(codigo: string): string {
  const prog = `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("clon", ${JSON.stringify(RUTA)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
${codigo}`
  return execFileSync('python3', ['-I', '-c', prog], { env: { PATH: process.env.PATH ?? '', SUPABASE_ACCESS_TOKEN: 'falso' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
const selectDe = (tab: string, cols: string[]) =>
  py(`print(m.auth_select(${JSON.stringify(tab)}, json.loads(${JSON.stringify(JSON.stringify(cols))})))`).trim()
const expr = (sel: string, col: string) =>
  sel.split(/,\s(?![^()]*\))/).find(e => e.trim().endsWith(` as ${col}`) || e.trim() === col)?.trim() ?? ''

describe('clonado prod → staging sin claves', () => {
  const sel = selectDe('users', COLS_USERS)

  it('no copia el hash de la contraseña ni ningún token', () => {
    for (const c of ['encrypted_password', 'confirmation_token', 'recovery_token', 'email_change_token_new',
      'email_change_token_current', 'phone_change_token', 'reauthentication_token']) {
      expect(expr(sel, c)).toBe(`'' as ${c}`)
    }
  })

  it('reemplaza el correo real por uno de prueba y banea la copia', () => {
    expect(expr(sel, 'email')).toMatch(/@staging-satori\.test' as email$/)
    expect(expr(sel, 'email')).not.toMatch(/^email$/)
    expect(expr(sel, 'raw_user_meta_data')).toBe(`'{}'::jsonb as raw_user_meta_data`)
    expect(expr(sel, 'phone')).toBe('null as phone')
    expect(expr(sel, 'banned_until')).toMatch(/100 years/)
  })

  it('las columnas no sensibles pasan tal cual', () => {
    expect(expr(sel, 'id')).toBe('id')
    expect(expr(sel, 'created_at')).toBe('created_at')
  })

  it('identities: el correo de identity_data también se reemplaza', () => {
    const si = selectDe('identities', COLS_IDENT)
    expect(expr(si, 'identity_data')).toMatch(/staging-satori\.test/)
    expect(expr(si, 'identity_data')).not.toMatch(/^identity_data$/)
    expect(expr(si, 'provider_id')).not.toBe('provider_id')
  })

  it('sesiones, refresh tokens y demás tablas de auth no se copian', () => {
    expect(py('print(json.dumps(list(m.AUTH_TABLAS_COPIADAS)))').trim()).toBe('["users", "identities"]')
    expect(() => selectDe('sessions', ['id'])).toThrow()
    expect(() => selectDe('refresh_tokens', ['id'])).toThrow()
  })

  it('el SELECT a prod usa auth_select y el script no tiene correos reales', () => {
    const fuente = readFileSync(RUTA, 'utf8')
    expect(fuente).toMatch(/select \{auth_select\(authtab, colnames\)\} from auth\.\{authtab\}/)
    expect(fuente).not.toMatch(/select \{cols\} from auth\./)
    expect(fuente).not.toMatch(/@(?!staging-satori\.test)[a-z0-9-]+\.[a-z]{2,}/i)
  })
})
