// Datos FICTICIOS para las pruebas de ventas-dia-contador (repo público: sin nombres ni montos reales).
// Un `DiasMap` como el que arma `armarDiasMap` desde el PoS: un bucket de mesero (con parte de delivery) y
// uno de caja por día, con decimales para que se vea el redondeo. Solo lo usan las pruebas.

type Bucket = Record<string, unknown>

function mesero(total: number, pax: number, delivery = 0): Bucket {
  return {
    pax, total, com: total * 0.6, beb: total * 0.4, iCom: total * 0.6, iBeb: total * 0.4,
    iva: total * 0.13, serv: (total - delivery) * 0.1, promPax: pax ? total / pax : 0, promPlato: 0, promBebida: 0,
    ratioCB: 0, ratioU: 0, bebPax: 0, prods: [['PRODUCTO FICTICIO', 1, total]], ...(delivery ? { delivery } : {}),
  }
}
function caja(salon: number, delivery: number, pax: number): Bucket {
  const total = salon + delivery
  return { esCajero: true, pax, total, salon, delivery, iva: total * 0.13, serv: salon * 0.1, ordenes: 3, ticketProm: total / 3, prods: [] }
}

/**
 * Días con ventas en `fechas`; el resto del mes no aparece (como la pantalla: solo días con datos).
 * Los montos dependen del día del mes, así cada fila es distinta.
 */
export function diasFicticios(fechas: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fechas) {
    const d = Number(f.slice(8, 10))
    out[f] = {
      fileName: 'pos', uploadedAt: f,
      saloneros: {
        'MESERO A': mesero(100_000.37 + d * 1_013.11, 20 + d, d % 3 === 0 ? 12_345.5 : 0),
        'MESERO B': mesero(80_500.2 + d * 707.07, 15 + (d % 5)),
        'CAJA 1': caja(30_000.15 + d * 99.9, 9_000.45, d % 2),
      },
    }
  }
  return out
}
