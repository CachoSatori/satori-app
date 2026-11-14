// Fixture compartida de las pruebas del Tablero (datos ficticios; mismos números que scripts/sql/160_pruebas.sql).
import type { TableroMes } from '../../shared/api/club'

export function tableroDePrueba(over: Partial<TableroMes> = {}): TableroMes {
  return {
    mes: '2001-03', local: 'p160-a', local_nombre: 'Local P160 A', parcial: false, generado_en: '2001-04-02T12:00:00Z',
    pos_sin_datos: false,
    config: { cortesia_costo_pct: 35, valor_credito_crc: 18000, personas_por_credito: 6 },
    plata: {
      venta_respaldada_crc: 33500, facturas_club: 3, facturas_mes: 4, venta_mes_crc: 43500,
      descuento_estimado_crc: 3500, descuento_lineas: 2, descuento_facturas: 2, lineas_sin_referencia: 1,
      cortesias_lineas: 1, cortesias_unidades: 1, cortesias_lista_crc: 4000, cortesias_costo_crc: 1400, cortesias_sin_precio: 0,
      canjes: 1, creditos_canjeados: 1.5, canjes_crc: 27000, costo_total_crc: 31900, tasa_efectiva_pct: 95.2,
      por_motivo: { socio: { facturas: 2, venta_crc: 29000 }, cupon: { facturas: 1, venta_crc: 4500 }, canje: { facturas: 1, venta_crc: 10000 } },
    },
    regalia: { facturas: 1, crc: 10000, en_canjes_crc: 10000 },
    comparacion: {
      con_socio: { facturas: 2, venta_crc: 29000, personas: 3, tiquete_crc: 14500, personas_por_factura: 1.5, por_persona_crc: 9667 },
      sin_socio: { facturas: 2, venta_crc: 14500, personas: 5, tiquete_crc: 7250, personas_por_factura: 2.5, por_persona_crc: 2900 },
      con_cupon: { facturas: 1, venta_crc: 4500, personas: 3, tiquete_crc: 4500, personas_por_factura: 3, por_persona_crc: 1500 },
    },
    pasivo: {
      saldo_inicial: { personas: 12, creditos: 2, crc: 36000 }, emitidos: { personas: 9, creditos: 1.5, crc: 27000 },
      carga_inicial: { personas: 6, creditos: 1, crc: 18000 }, canjeados: { personas: -9, creditos: -1.5, crc: -27000 },
      vencidos: { personas: -3, creditos: -0.5, crc: -9000 }, ajustes: { personas: 3, creditos: 0.5, crc: 9000 },
      saldo_final: { personas: 18, creditos: 3, crc: 54000 }, canjeable_creditos: 3, cuentas_con_saldo: 3,
      congelado: { personas: 12, creditos: 2, crc: 36000, cuentas: 2 },
    },
    ...over,
  }
}

export function tableroVacio(): TableroMes {
  const cero = { personas: 0, creditos: 0, crc: 0 }
  const g = { facturas: 0, venta_crc: 0, personas: 0, tiquete_crc: null, personas_por_factura: null, por_persona_crc: null }
  const t = tableroDePrueba({ pos_sin_datos: true, regalia: { facturas: 0, crc: 0, en_canjes_crc: 0 },
    comparacion: { con_socio: g, sin_socio: g, con_cupon: g } })
  t.plata = { ...t.plata, venta_respaldada_crc: 0, facturas_club: 0, facturas_mes: 0, venta_mes_crc: 0, descuento_estimado_crc: 0,
    descuento_lineas: 0, descuento_facturas: 0, lineas_sin_referencia: 0, cortesias_lineas: 0, cortesias_unidades: 0,
    cortesias_lista_crc: 0, cortesias_costo_crc: 0, canjes: 0, creditos_canjeados: 0, canjes_crc: 0, costo_total_crc: 0,
    tasa_efectiva_pct: null, por_motivo: { socio: { facturas: 0, venta_crc: 0 }, cupon: { facturas: 0, venta_crc: 0 }, canje: { facturas: 0, venta_crc: 0 } } }
  t.pasivo = { saldo_inicial: cero, emitidos: cero, carga_inicial: cero, canjeados: cero, vencidos: cero, ajustes: cero,
    saldo_final: cero, canjeable_creditos: 0, cuentas_con_saldo: 0, congelado: { ...cero, cuentas: 0 } }
  return t
}
