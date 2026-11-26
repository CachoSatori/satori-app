import { describe, it, expect, vi } from 'vitest'
// Carteles del Cierre del día (SPEC-caja-estandar §3.2 y §4). Datos ficticios.
vi.mock('../../shared/api/cash', () => ({}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 640) }))
vi.mock('../../shared/api/tips', () => ({ getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: null }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn() }))
import { estadoFases, textoDiferencia, lineaDolares, montoSinSigno, resumenDiferencia, montoConSigno, lineasAjuste, CLASE_TONO, tituloAjuste } from './textoDiferencia'
import { fd } from './cashUtils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cierreNecesitaAjuste } from './CashCierre'

describe('estadoFases — la barra sale de parcial Y completo', () => {
  it('día cerrado sin fila parcial (cierres nuevos): las dos fases cerradas', () => {
    expect(estadoFases(false, true)).toEqual({ mediodia: 'sellado', noche: 'cerrado' })
  })
  it('día cerrado con fila parcial (cierres viejos): igual', () => {
    expect(estadoFases(true, true)).toEqual({ mediodia: 'sellado', noche: 'cerrado' })
  })
  it('mediodía sellado, noche en curso', () => {
    expect(estadoFases(true, false)).toEqual({ mediodia: 'sellado', noche: 'en-curso' })
  })
  it('nada todavía', () => {
    expect(estadoFases(false, false)).toEqual({ mediodia: 'pendiente', noche: 'en-espera' })
  })
})

describe('textoDiferencia ₡ — palabras, tolerancia y color', () => {
  it('0 → Cuadra · Sin diferencia · musgo', () => {
    expect(textoDiferencia(0, 'crc', false)).toMatchObject({ titular: 'Cuadra', nota: 'Sin diferencia.', tono: 'musgo', estado: 'cuadra' })
  })
  it('faltan ₡300 → Cuadra, dentro de la tolerancia', () => {
    expect(textoDiferencia(-300, 'crc', false)).toMatchObject({
      titular: 'Cuadra', tono: 'musgo', nota: 'Faltan ₡300: dentro de la tolerancia (menos de ₡500).' })
  })
  it('sobran ₡300 con el día cerrado → «Sobraron», sigue cuadrando', () => {
    expect(textoDiferencia(300, 'crc', true).nota).toBe('Sobraron ₡300: dentro de la tolerancia (menos de ₡500).')
  })
  it('faltante fuera de tolerancia → laca, sin signo', () => {
    const t = textoDiferencia(-1951, 'crc', false)
    expect(t).toMatchObject({ titular: 'Faltan ₡1.951', tono: 'laca', estado: 'faltante', nota: 'Fuera de tolerancia (₡500).' })
  })
  it('sobrante fuera de tolerancia → ORO (decisión del dueño), no verde', () => {
    expect(textoDiferencia(2300, 'crc', false)).toMatchObject({ titular: 'Sobran ₡2.300', tono: 'oro', estado: 'sobrante' })
  })
  it('día cerrado fuera de tolerancia → pasado + «quedó registrada como ajuste de cierre»', () => {
    expect(textoDiferencia(-1951, 'crc', true)).toMatchObject({
      titular: 'Faltaron ₡1.951', nota: 'Fuera de tolerancia (₡500). Quedó registrada como ajuste de cierre.' })
  })
  it('justo ₡500 ya está fuera (misma frontera que el gate)', () => {
    expect(textoDiferencia(-500, 'crc', false).titular).toBe('Faltan ₡500')
  })
  it('₡499,6 no se muestra como «₡500 dentro de la tolerancia»: se corta a ₡499', () => {
    expect(textoDiferencia(-499.6, 'crc', false).nota).toBe('Faltan ₡499: dentro de la tolerancia (menos de ₡500).')
  })
  it('céntimos que redondean a 0 → Sin diferencia', () => {
    expect(textoDiferencia(0.3, 'crc', false).nota).toBe('Sin diferencia.')
  })
})

describe('dólares — línea aparte, tolerancia US$1', () => {
  it('cuadra sin diferencia', () => {
    expect(lineaDolares(0, false)).toEqual({ texto: 'Dólares: cuadra, sin diferencia', tono: 'musgo' })
  })
  it('dentro de la tolerancia', () => {
    expect(lineaDolares(-0.4, false).texto).toBe('Dólares: cuadra, faltan $ 0,40: dentro de la tolerancia (menos de US$1)')
  })
  it('faltan $ 2,00 fuera de tolerancia → laca', () => {
    expect(lineaDolares(-2, false)).toEqual({ texto: 'Dólares: faltan $ 2,00, fuera de tolerancia (US$1)', tono: 'laca' })
  })
  it('sobran fuera de tolerancia → oro; cerrado en pasado', () => {
    expect(lineaDolares(3.5, true)).toEqual({ texto: 'Dólares: sobraron $ 3,50, fuera de tolerancia (US$1)', tono: 'oro' })
  })
  it('$ 0,999 no se muestra como $ 1,00 dentro de la tolerancia', () => {
    expect(lineaDolares(0.999, false).texto).toBe('Dólares: cuadra, sobran $ 0,99: dentro de la tolerancia (menos de US$1)')
  })
  it('montoSinSigno con miles', () => {
    expect(montoSinSigno(1234567.4, 'crc')).toBe('₡1.234.567')
    expect(montoSinSigno(1234.5, 'usd')).toBe('$ 1\u00a0234,50')
  })
})

describe('el cartel y el gate del ajuste usan la MISMA frontera', () => {
  const crc = [-100000, -501, -500, -499.99, -499, -1, 0, 1, 499, 499.99, 500, 501, 100000]
  const usd = [-5, -1, -0.999, -0.5, 0, 0.5, 0.999, 1, 5]
  it.each(crc)('₡ %s: «fuera de tolerancia» ⇔ pide motivo', d => {
    expect(!textoDiferencia(d, 'crc', false).dentroTolerancia).toBe(cierreNecesitaAjuste(d, null))
  })
  it.each(usd)('US$ %s: «fuera de tolerancia» ⇔ pide motivo', d => {
    expect(!textoDiferencia(d, 'usd', false).dentroTolerancia).toBe(cierreNecesitaAjuste(null, d))
  })
})

describe('resumenDiferencia — el titular muestra el PEOR estado de las dos monedas (verificador #348)', () => {
  it('solo ₡ (sin dato en US$): titular y nota de colones', () => {
    const r = resumenDiferencia(-1951, null, true)
    expect(r).toMatchObject({ titular: 'Faltaron ₡1.951', tono: 'laca', estado: 'faltante', pie: null })
    expect(r.detalle).toEqual([{ texto: 'Fuera de tolerancia (₡500). Quedó registrada como ajuste de cierre.', tono: 'laca' }])
  })
  it('solo US$ fuera: el titular NO dice «Cuadra»', () => {
    const r = resumenDiferencia(0, -2, true)
    expect(r).toMatchObject({ titular: 'Faltaron $ 2,00', tono: 'laca', estado: 'faltante', pie: 'Quedó registrada como ajuste de cierre.' })
    expect(r.detalle.map(l => l.texto)).toEqual(['Colones: cuadra, sin diferencia', 'Dólares: faltaron $ 2,00, fuera de tolerancia (US$1)'])
  })
  it('las dos faltan: un verbo y los dos montos', () => {
    expect(resumenDiferencia(-1951, -2, true).titular).toBe('Faltaron ₡1.951 y $ 2,00')
  })
  it('una falta y la otra sobra: manda el faltante; el detalle trae las dos con su color', () => {
    const r = resumenDiferencia(2300, -2, true)
    expect(r).toMatchObject({ titular: 'Faltaron $ 2,00', tono: 'laca' })
    expect(r.detalle).toEqual([
      { texto: 'Colones: sobraron ₡2.300, fuera de tolerancia (₡500)', tono: 'oro' },
      { texto: 'Dólares: faltaron $ 2,00, fuera de tolerancia (US$1)', tono: 'laca' },
    ])
    expect(resumenDiferencia(-1951, 3.5, false)).toMatchObject({ titular: 'Faltan ₡1.951', tono: 'laca' })
  })
  it('solo sobra: oro; todo dentro de tolerancia: Cuadra verde y sin pie', () => {
    expect(resumenDiferencia(0, 3.5, true)).toMatchObject({ titular: 'Sobraron $ 3,50', tono: 'oro' })
    expect(resumenDiferencia(-300, 0.4, true)).toMatchObject({ titular: 'Cuadra', tono: 'musgo', pie: null })
  })
})

describe('contraste del oro con texto chico (verificador #348)', () => {
  const lum = (h: string) => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
  const contraste = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
  const token = (n: string) => css.match(new RegExp(`${n}:\\s*(#[0-9a-fA-F]{6})`))![1]
  it('--c-oro-texto sobre --c-oro-fondo-texto ≥ 4,5:1', () => {
    expect(contraste(token('--c-oro-texto'), token('--c-oro-fondo-texto'))).toBeGreaterThanOrEqual(4.5)
  })
  it('los carteles «sobra» usan ese fondo, no --c-oro-fondo (4,4:1)', () => {
    expect(css).toMatch(/\.cd-cierre-resultado\.sobra \{ background: var\(--c-oro-fondo-texto\)/)
    expect(css).toMatch(/\.cierre-resumen-usd\.sobra \{ background: var\(--c-oro-fondo-texto\)/)
  })
})

describe('Montos con signo (Caja PR 3/4, SPEC §4 «Montos»)', () => {
  it('menos tipográfico (U+2212) antes del símbolo; + para lo que entra', () => {
    expect(montoConSigno(-1951, 'crc')).toBe('−₡1.951')
    expect(montoConSigno(2300, 'crc')).toBe('+₡2.300')
    expect(montoConSigno(-2, 'usd')).toBe('−$ 2,00')
    expect(montoConSigno(3.5, 'usd')).toBe('+$ 3,50')
    expect(montoConSigno(-1234567.4, 'crc')).toBe('−₡1.234.567')
  })
  it('lo que redondea a cero va sin signo', () => {
    expect(montoConSigno(0, 'crc')).toBe('₡0')
    expect(montoConSigno(-0.4, 'crc')).toBe('₡0')
    expect(montoConSigno(-0.004, 'usd')).toBe('$ 0,00')
  })
  it('lineasAjuste: una línea por moneda con ajuste; faltó laca · sobró oro; 0 = sin línea', () => {
    expect(lineasAjuste(-1951, -2)).toEqual([
      { moneda: 'crc', etiqueta: 'Colones', monto: '−₡1.951', tono: 'laca' },
      { moneda: 'usd', etiqueta: 'Dólares', monto: '−$ 2,00', tono: 'laca' },
    ])
    expect(lineasAjuste(2300, 0)).toEqual([{ moneda: 'crc', etiqueta: 'Colones', monto: '+₡2.300', tono: 'oro' }])
    expect(lineasAjuste(0, 3.5)).toEqual([{ moneda: 'usd', etiqueta: 'Dólares', monto: '+$ 3,50', tono: 'oro' }])
    expect(lineasAjuste(0, 0)).toEqual([])
  })
  it('CLASE_TONO: musgo ok · oro sobra · laca fail', () => {
    expect(CLASE_TONO).toEqual({ musgo: 'ok', oro: 'sobra', laca: 'fail' })
  })
})

describe('Ronda del verificador (Caja PR 3/4)', () => {
  it('dólares con fd, el formateador compartido de Caja', () => {
    for (const n of [0, 0.5, 2, 3.5, 1234.5, 9999.99]) expect(montoSinSigno(n, 'usd')).toBe(fd(n))
    expect(montoConSigno(-2, 'usd')).toBe('−' + fd(2))
  })
  it('tituloAjuste: con el tipo si las monedas van en el mismo sentido; sin tipo si van opuestas', () => {
    expect(tituloAjuste(lineasAjuste(-1951, 0), 'Faltante')).toBe('Ajuste de cierre en Caja Fuerte (faltante)')
    expect(tituloAjuste(lineasAjuste(-1951, -2), 'Faltante')).toBe('Ajuste de cierre en Caja Fuerte (faltante)')
    expect(tituloAjuste(lineasAjuste(2300, 3.5), 'Sobrante')).toBe('Ajuste de cierre en Caja Fuerte (sobrante)')
    expect(tituloAjuste(lineasAjuste(-1951, 3.5), 'Faltante')).toBe('Ajuste de cierre en Caja Fuerte')
    expect(tituloAjuste(lineasAjuste(2300, -2), 'Sobrante')).toBe('Ajuste de cierre en Caja Fuerte')
  })
})
