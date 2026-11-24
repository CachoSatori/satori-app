import { describe, it, expect, vi } from 'vitest'
// Carteles del Cierre del día (SPEC-caja-estandar §3.2 y §4). Datos ficticios.
vi.mock('../../shared/api/cash', () => ({}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 640) }))
vi.mock('../../shared/api/tips', () => ({ getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: null }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn() }))
import { estadoFases, textoDiferencia, lineaDolares, montoSinSigno } from './textoDiferencia'
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
    expect(lineaDolares(-0.4, false).texto).toBe('Dólares: cuadra, faltan $0,40: dentro de la tolerancia (menos de US$1)')
  })
  it('faltan $2,00 fuera de tolerancia → laca', () => {
    expect(lineaDolares(-2, false)).toEqual({ texto: 'Dólares: faltan $2,00, fuera de tolerancia (US$1)', tono: 'laca' })
  })
  it('sobran fuera de tolerancia → oro; cerrado en pasado', () => {
    expect(lineaDolares(3.5, true)).toEqual({ texto: 'Dólares: sobraron $3,50, fuera de tolerancia (US$1); quedó registrada como ajuste de cierre', tono: 'oro' })
  })
  it('$0,999 no se muestra como $1,00 dentro de la tolerancia', () => {
    expect(lineaDolares(0.999, false).texto).toBe('Dólares: cuadra, sobran $0,99: dentro de la tolerancia (menos de US$1)')
  })
  it('montoSinSigno con miles', () => {
    expect(montoSinSigno(1234567.4, 'crc')).toBe('₡1.234.567')
    expect(montoSinSigno(1234.5, 'usd')).toBe('$1.234,50')
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
