// Tests de CARACTERIZACIÓN de cashUtils.ts (sagrado).
// Fijan lo que el código HACE HOY, no lo que "debería" hacer. Si algo se ve mal, queda marcado
// con `// RARO:` y el test igual fija el comportamiento actual. NO se tocó cashUtils.ts.
// Todos los montos son inventados.
import { describe, it, expect } from 'vitest'
import {
  saldoCajaFuerte,
  isEgreso,
  tipoColor,
  formatDate,
  fi,
  fd,
  MOVEMENT_TYPES,
  EGRESO_TYPES,
  CAJAS_ORIGEN,
  METODOS_PAGO,
  METODOS_PAGO_PROVEEDOR,
  CATEGORIAS_DEFAULT,
  PROPINAS_POR_PAGAR_DESDE,
} from './cashUtils'
import type { CashMovement } from '../../shared/types/database'

const NBSP = ' ' // separador de miles que usa toLocaleString('es-CR')

function mov(over: Partial<CashMovement>): CashMovement {
  return {
    movement_type: 'ingreso',
    amount_crc: 0,
    amount_usd: 0,
    caja_origen: 'Caja Fuerte',
    status: 'aprobado',
    subcategory: '',
    ...over,
  } as CashMovement
}

describe('saldoCajaFuerte — día realista (montos inventados)', () => {
  // Un día con dos cierres de registradora, pagos varios, depósito al banco y un pendiente.
  const dia: CashMovement[] = [
    mov({ movement_type: 'traspaso', subcategory: 'Registradora → Caja Fuerte', amount_crc: 385_000, amount_usd: 120 }),
    mov({ movement_type: 'traspaso', subcategory: 'Registradora → Caja Fuerte', amount_crc: 612_500, amount_usd: 240 }),
    mov({ movement_type: 'egreso_mercaderia', subcategory: 'Proveedor', amount_crc: 48_750 }),
    mov({ movement_type: 'egreso_personal', subcategory: 'Propinas por SINPE', amount_crc: 23_500 }),
    mov({ movement_type: 'egreso_operativo', subcategory: 'Gas', amount_crc: 31_200 }),
    mov({ movement_type: 'egreso_socios', subcategory: 'Retiro de socios', amount_usd: 200 }),
    mov({ movement_type: 'traspaso', subcategory: 'Caja Fuerte → Banco', amount_crc: 500_000 }),
    mov({ movement_type: 'traspaso', subcategory: 'Caja Fuerte → Caja Proveedores', amount_crc: 150_000 }),
    mov({ movement_type: 'ingreso', subcategory: 'Cambio en caja', amount_crc: 20_000 }),
    mov({ movement_type: 'traspaso', subcategory: 'Otro traspaso', amount_crc: 5_000 }),
    // no cuentan:
    mov({ movement_type: 'egreso_mercaderia', subcategory: 'Proveedor', amount_crc: 99_000, status: 'pendiente' }),
    mov({ movement_type: 'egreso_operativo', subcategory: 'Gas', amount_crc: 12_000, caja_origen: 'Caja Proveedores' }),
    mov({ movement_type: 'ingreso', subcategory: 'Ventas efectivo noche', amount_crc: 700_000, caja_origen: 'Registradora' }),
  ]

  it('₡: 997.500 entra − 48.750 − 23.500 − 31.200 − 500.000 − 150.000 + 20.000 − 5.000 = 259.050', () => {
    expect(saldoCajaFuerte(dia).crc).toBe(259_050)
  })

  it('$: 360 entra − 200 de socios = 160', () => {
    expect(saldoCajaFuerte(dia).usd).toBe(160)
  })

  it('no muta la lista y el orden de los movimientos no cambia el resultado', () => {
    const copia = dia.map(m => ({ ...m }))
    const alReves = [...dia].reverse()
    expect(saldoCajaFuerte(alReves)).toEqual({ crc: 259_050, usd: 160 })
    expect(dia).toEqual(copia)
  })
})

describe('saldoCajaFuerte — monedas', () => {
  it('solo ₡', () => {
    expect(saldoCajaFuerte([mov({ amount_crc: 45_000 }), mov({ movement_type: 'egreso_operativo', amount_crc: 5_000 })]))
      .toEqual({ crc: 40_000, usd: 0 })
  })

  it('solo $', () => {
    expect(saldoCajaFuerte([mov({ amount_usd: 300 }), mov({ movement_type: 'egreso_socios', amount_usd: 120 })]))
      .toEqual({ crc: 0, usd: 180 })
  })

  it('mixto en un mismo movimiento: ₡ y $ se llevan por separado, nunca se convierten', () => {
    expect(saldoCajaFuerte([mov({ amount_crc: 10_000, amount_usd: 20, exchange_rate: 515 })]))
      .toEqual({ crc: 10_000, usd: 20 })
  })

  it('el exchange_rate del movimiento se ignora (0, null o cualquier valor)', () => {
    expect(saldoCajaFuerte([
      mov({ amount_crc: 1_000, amount_usd: 1, exchange_rate: 0 }),
      mov({ amount_crc: 1_000, amount_usd: 1, exchange_rate: null }),
    ])).toEqual({ crc: 2_000, usd: 2 })
  })
})

describe('saldoCajaFuerte — redondeo y decimales', () => {
  it('no redondea: suma decimales tal cual (deriva de punto flotante incluida)', () => {
    // RARO: no redondea al colón ni al centavo; 10,10 + 20,20 da 30,299999999999997 y
    // 0,10 + 0,20 da 0,30000000000000004. La UI formatea con fi/fd y lo esconde.
    const r = saldoCajaFuerte([mov({ amount_crc: 10.1, amount_usd: 0.1 }), mov({ amount_crc: 20.2, amount_usd: 0.2 })])
    expect(r.crc).toBe(30.299999999999997)
    expect(r.usd).toBe(0.30000000000000004)
  })

  it('medios colones se mantienen: 1.000,5 + 999,5 = 2.000', () => {
    expect(saldoCajaFuerte([mov({ amount_crc: 1_000.5 }), mov({ amount_crc: 999.5 })]).crc).toBe(2_000)
  })

  it('un solo medio colón queda en 0,5 (no redondea)', () => {
    expect(saldoCajaFuerte([mov({ amount_crc: 0.5 })]).crc).toBe(0.5)
  })

  it('montos muy grandes suman exacto dentro del rango seguro', () => {
    const r = saldoCajaFuerte([
      mov({ amount_crc: 4_000_000_000, amount_usd: 2_500_000 }),
      mov({ amount_crc: 3_500_000_000, amount_usd: 1_000_000 }),
      mov({ movement_type: 'egreso_socios', amount_crc: 1_250_000_000 }),
    ])
    expect(r).toEqual({ crc: 6_250_000_000, usd: 3_500_000 })
  })

  it('NaN en el monto cuenta como 0 (NaN es falsy en `|| 0`)', () => {
    expect(saldoCajaFuerte([mov({ amount_crc: NaN, amount_usd: NaN }), mov({ amount_crc: 500 })]))
      .toEqual({ crc: 500, usd: 0 })
  })
})

describe('saldoCajaFuerte — negativos y devoluciones', () => {
  it('un egreso con monto negativo SUMA (devolución cargada en negativo)', () => {
    // RARO: no se valida el signo; un egreso de −10.000 aumenta el saldo en 10.000.
    expect(saldoCajaFuerte([mov({ amount_crc: 50_000 }), mov({ movement_type: 'egreso_mercaderia', amount_crc: -10_000 })]).crc)
      .toBe(60_000)
  })

  it('un ingreso con monto negativo RESTA', () => {
    expect(saldoCajaFuerte([mov({ amount_crc: 50_000 }), mov({ movement_type: 'ingreso', amount_crc: -7_500 })]).crc)
      .toBe(42_500)
  })

  it('el saldo puede quedar negativo (no hay piso en 0)', () => {
    expect(saldoCajaFuerte([mov({ movement_type: 'egreso_operativo', amount_crc: 15_000, amount_usd: 5 })]))
      .toEqual({ crc: -15_000, usd: -5 })
  })
})

describe('saldoCajaFuerte — status y caja', () => {
  it('un movimiento RECHAZADO sigue contando en el saldo', () => {
    // RARO: solo se excluye 'pendiente'. Un egreso 'rechazado' (que nunca ocurrió) resta igual.
    // pozo.ts lo documenta como "arrastre del modelo viejo" y ahí sí se excluye.
    expect(saldoCajaFuerte([
      mov({ amount_crc: 100_000 }),
      mov({ movement_type: 'egreso_mercaderia', amount_crc: 40_000, status: 'rechazado' }),
    ]).crc).toBe(60_000)
  })

  it('un ingreso rechazado también suma', () => {
    expect(saldoCajaFuerte([mov({ amount_crc: 25_000, status: 'rechazado' })]).crc).toBe(25_000)
  })

  it('caja_origen se compara exacto: "caja fuerte" en minúscula queda afuera', () => {
    expect(saldoCajaFuerte([mov({ amount_crc: 9_000, caja_origen: 'caja fuerte' })]).crc).toBe(0)
  })

  it('un traspaso "Registradora → Caja Fuerte" cargado con caja_origen Registradora NO entra', () => {
    expect(saldoCajaFuerte([mov({ movement_type: 'traspaso', subcategory: 'Registradora → Caja Fuerte', amount_crc: 80_000, caja_origen: 'Registradora' })]).crc)
      .toBe(0)
  })

  it('un movement_type desconocido se ignora', () => {
    expect(saldoCajaFuerte([mov({ movement_type: 'ajuste' as CashMovement['movement_type'], amount_crc: 3_000 })]).crc).toBe(0)
  })
})

describe('saldoCajaFuerte — dirección del traspaso', () => {
  const t = (subcategory: string | null, amount_crc = 10_000) =>
    saldoCajaFuerte([mov({ movement_type: 'traspaso', subcategory: subcategory as string, amount_crc })]).crc

  it('sin espacios alrededor de la flecha también vale', () => {
    expect(t('Banco→Caja Fuerte')).toBe(10_000)
    expect(t('Caja Fuerte→Banco')).toBe(-10_000)
  })

  it('subcategory vacía o null → resta', () => {
    expect(t('')).toBe(-10_000)
    expect(t(null)).toBe(-10_000)
  })

  it('"Caja Fuerte → Caja Fuerte" suma', () => {
    expect(t('Caja Fuerte → Caja Fuerte')).toBe(10_000)
  })

  it('con flecha ASCII "->" se toma como salida', () => {
    // RARO: solo reconoce la flecha "→"; "Banco -> Caja Fuerte" (texto libre) resta en vez de sumar.
    expect(t('Banco -> Caja Fuerte')).toBe(-10_000)
  })

  it('"Caja Fuerte" sin flecha (texto libre) → resta', () => {
    expect(t('Ajuste Caja Fuerte')).toBe(-10_000)
  })
})

describe('isEgreso / tipoColor', () => {
  it('isEgreso: los 4 egresos sí, ingreso y traspaso no', () => {
    expect(MOVEMENT_TYPES.filter(isEgreso)).toEqual(EGRESO_TYPES)
    expect(isEgreso('ingreso')).toBe(false)
    expect(isEgreso('traspaso')).toBe(false)
  })

  it('tipoColor por tipo, y cualquier texto que empiece con "egreso" es rojo', () => {
    expect(tipoColor('ingreso')).toBe('#7ec8a0')
    expect(tipoColor('egreso_personal')).toBe('#c23b22')
    expect(tipoColor('egreso_inventado')).toBe('#c23b22')
    expect(tipoColor('traspaso')).toBe('#c8a96e')
    expect(tipoColor('otro')).toBe('#888')
    expect(tipoColor('')).toBe('#888')
  })
})

describe('formatDate', () => {
  it('AAAA-MM-DD → DD/MM/AAAA', () => {
    expect(formatDate('2026-11-08')).toBe('08/11/2026')
  })

  it('vacío → vacío', () => {
    expect(formatDate('')).toBe('')
  })

  it('fecha incompleta o con hora', () => {
    // RARO: no valida el formato; sin día sale "undefined", y con hora la pega al día.
    expect(formatDate('2026-11')).toBe('undefined/11/2026')
    expect(formatDate('2026-11-08T10:00:00')).toBe('08T10:00:00/11/2026')
  })
})

describe('fi / fd (re-exportados desde shared/utils)', () => {
  it('fi redondea al colón con Math.round', () => {
    expect(fi(1_234.5)).toBe(`₡ 1${NBSP}235`)
    expect(fi(2.5)).toBe('₡ 3')
    expect(fi(0)).toBe('₡ 0')
    expect(fi(1_000_000_000)).toBe(`₡ 1${NBSP}000${NBSP}000${NBSP}000`)
  })

  it('fi con negativos: Math.round redondea -x,5 hacia arriba y -0,4 muestra "-0"', () => {
    // RARO: −1.234,5 sale −1.234 (y +1.234,5 sale 1.235): el redondeo no es simétrico.
    expect(fi(-1_234.5)).toBe(`₡ -1${NBSP}234`)
    // RARO: −0,4 se muestra como "₡ -0".
    expect(fi(-0.4)).toBe('₡ -0')
  })

  it('fi / fd con null, undefined o NaN → "—"', () => {
    expect(fi(null)).toBe('—')
    expect(fi(undefined)).toBe('—')
    expect(fi(NaN)).toBe('—')
    expect(fd(null)).toBe('—')
  })

  it('fd: dos decimales con coma', () => {
    expect(fd(1_234.5)).toBe(`$ 1${NBSP}234,50`)
    expect(fd(0.005)).toBe('$ 0,01')
    expect(fd(-0.005)).toBe('$ -0,01')
  })
})

describe('constantes (fijadas tal cual)', () => {
  it('cajas, métodos y corte de propinas', () => {
    expect(CAJAS_ORIGEN).toEqual(['Caja Proveedores', 'Caja Fuerte', 'Registradora', 'Banco'])
    expect(METODOS_PAGO).toEqual(['Efectivo', 'Transferencia', 'SINPE', 'Bitcoin'])
    expect(METODOS_PAGO_PROVEEDOR).toEqual(['Efectivo', 'Transferencia'])
    expect(PROPINAS_POR_PAGAR_DESDE).toBe('2026-06-06')
  })

  it('las subcategorías de traspaso: las que dicen "→ Caja Fuerte" son exactamente las que suman', () => {
    const suman = CATEGORIAS_DEFAULT.traspaso.filter(
      s => saldoCajaFuerte([mov({ movement_type: 'traspaso', subcategory: s, amount_crc: 1 })]).crc === 1,
    )
    expect(suman).toEqual(['Registradora → Caja Fuerte', 'Banco → Caja Fuerte'])
  })
})
