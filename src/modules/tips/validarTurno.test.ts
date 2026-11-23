// Nada negativo en el reparto (decisión del dueño, 20-nov-2026). Datos ficticios.
import { describe, expect, it } from 'vitest'
import { TEXTO_TIPO_CAMBIO, alEscribir, esIlegible, sinIlegibles, montoGuardable, validarTipoCambio, validarTurno, valorInput, type DatosTurno } from './validarTurno'

const base = (patch: Partial<DatosTurno> = {}): DatosTurno => ({
  lineas: [
    { nombre: 'Sala Uno', activa: true, hours: 8, propina_crc: 1000, propina_usd: '' },
    { nombre: 'Barra Uno', activa: true, hours: 6, propina_crc: '', propina_usd: '' },
  ],
  efectivoCRC: 20000, efectivoUSD: '', barraCRC: 5000, barraElecCRC: '', exchangeRate: 500,
  ...patch,
})
const linea = (patch: Record<string, unknown>) => base({ lineas: [{ nombre: 'Sala Uno', activa: true, hours: 8, ...patch }] })

describe('validarTurno', () => {
  it('un turno normal pasa (vacíos = 0)', () => {
    expect(validarTurno(base())).toBeNull()
    expect(validarTurno(base({ efectivoCRC: '', barraCRC: null }))).toBeNull()
  })

  it('horas negativas → «Las horas no pueden ser negativas» con el nombre', () => {
    expect(validarTurno(linea({ hours: -3 }))).toBe('Las horas no pueden ser negativas: revisá a Sala Uno.')
    expect(validarTurno(linea({ hours: '-0.5' }))).toBe('Las horas no pueden ser negativas: revisá a Sala Uno.')
  })

  it('0 horas sí se acepta (lo cuida guardasCierre si deja pozo sin cobrar)', () => {
    expect(validarTurno(linea({ hours: 0 }))).toBeNull()
  })

  it('una persona NO marcada no se revisa', () => {
    expect(validarTurno(base({ lineas: [{ nombre: 'Sala Uno', activa: false, hours: -3 }] }))).toBeNull()
  })

  it('propinas por persona negativas', () => {
    expect(validarTurno(linea({ propina_crc: -1 }))).toBe('Los montos no pueden ser negativos: revisá la propina ₡ de Sala Uno.')
    expect(validarTurno(linea({ propina_usd: -2 }))).toBe('Los montos no pueden ser negativos: revisá la propina $ de Sala Uno.')
  })

  it.each([
    ['efectivoCRC', '💵 Efectivo ₡'], ['efectivoUSD', '💵 Efectivo $'],
    ['barraCRC', '🍸 Barra efectivo'], ['barraElecCRC', '🍸 Barra electrónico'],
  ] as const)('pozo %s negativo', (campo, etiqueta) => {
    expect(validarTurno(base({ [campo]: -100 }))).toBe(`Los montos no pueden ser negativos: revisá «${etiqueta}».`)
  })

  it('valores que no son números', () => {
    expect(validarTurno(base({ efectivoCRC: 'abc' }))).toBe('No se puede leer «💵 Efectivo ₡» (¿quedó un «-»?): borralo y escribilo de nuevo, solo con números.')
    expect(validarTurno(linea({ hours: Number.NaN }))).toBe('No se pueden leer las horas de Sala Uno (¿quedó un «-»?): borralas y escribilas de nuevo, solo con números.')
    expect(validarTurno(linea({ propina_crc: Infinity }))).toBe('No se puede leer la propina ₡ de Sala Uno (¿quedó un «-»?): borrala y escribila de nuevo, solo con números.')
  })

  it('con dólares, el tipo de cambio tiene que ser > 0', () => {
    expect(validarTurno(base({ efectivoUSD: 10, exchangeRate: -500 }))).toBe(TEXTO_TIPO_CAMBIO)
    expect(validarTurno(base({ efectivoUSD: 10, exchangeRate: 0 }))).toBe(TEXTO_TIPO_CAMBIO)
    expect(validarTurno(linea({ propina_usd: 5 }))).toBeNull()
    expect(validarTurno({ ...linea({ propina_usd: 5 }), exchangeRate: -1 })).toBe(TEXTO_TIPO_CAMBIO)
  })

  it('sin dólares el tipo de cambio no frena el cierre', () => {
    expect(validarTurno(base({ exchangeRate: -500 }))).toBeNull()
  })
})

describe('validarTipoCambio (turno nuevo)', () => {
  it.each([[500, null], [0.5, null], ['640', null], [0, TEXTO_TIPO_CAMBIO], [-640, TEXTO_TIPO_CAMBIO], ['', TEXTO_TIPO_CAMBIO], [null, TEXTO_TIPO_CAMBIO], [Number.NaN, TEXTO_TIPO_CAMBIO]])(
    '%s → %s', (v, esperado) => { expect(validarTipoCambio(v)).toBe(esperado) })
})

describe('cuadro ilegible (validación física del dueño, 23-nov)', () => {
  it('esIlegible: solo con validity.badInput', () => {
    expect(esIlegible({ validity: { badInput: true } })).toBe(true)
    expect(esIlegible({ validity: { badInput: false } })).toBe(false)
    expect(esIlegible({})).toBe(false)
  })
  it('valorInput: NaN va como \'\' (React no borra lo que se ve); lo demás, igual', () => {
    expect(valorInput(Number.NaN)).toBe('')
    expect(valorInput(0)).toBe(0)
    expect(valorInput(-450)).toBe(-450)
    expect(valorInput('')).toBe('')
  })
  it('NaN (ilegible) no se autoguarda y frena el cierre nombrando a la persona', () => {
    expect(montoGuardable(Number.NaN)).toBe(false)
    expect(validarTurno(base({ lineas: [{ nombre: 'Sala Uno', activa: true, hours: 8, propina_crc: Number.NaN }] })))
      .toMatch(/^No se puede leer la propina ₡ de Sala Uno/)
  })
})

describe('alEscribir y sinIlegibles (revisión del verificador, 23-nov)', () => {
  it('alEscribir: el mismo manejador en onChange y onInput (React 19 no avisa "" → "")', () => {
    const vistos: unknown[] = []
    const p = alEscribir(el => vistos.push(el))
    const el = {} as HTMLInputElement
    p.onChange({ currentTarget: el }); p.onInput({ currentTarget: el })
    expect(vistos).toEqual([el, el])
  })
  it('sinIlegibles: NaN → \'\'; lo demás, igual', () => {
    expect(sinIlegibles({ hours: Number.NaN, propina_crc: -450, propina_usd: '', active: true }))
      .toEqual({ hours: '', propina_crc: -450, propina_usd: '', active: true })
  })
})
