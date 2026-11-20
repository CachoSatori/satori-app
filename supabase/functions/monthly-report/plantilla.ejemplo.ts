// Datos FICTICIOS para las pruebas y la vista previa de las plantillas (repo público: ningún nombre ni monto
// real). Las cifras están inventadas y son coherentes entre sí solo lo justo para que el correo se lea bien.
import type { VentasCorreo, PropinasCorreo } from './plantilla.ts'
import { planReporte } from './periodo.ts'

export const planMesEjemplo = planReporte('mes', '2026-10')
export const planQuincenaEjemplo = planReporte('quincena', '2026-11')

export const ventasEjemplo: VentasCorreo = {
  total: 48_250_000, salon: 41_300_000, caj: 4_150_000, delivery: 2_800_000,
  pax: 3_120, iCom: 9_840, iBeb: 6_210, diasVentas: 30, prevNeta: 41_000_000,
  topSal: [
    { nombre: 'ANA PRUEBA', ventas: 7_900_000, servicios: 26, ticketProm: 14_100, constancia: 87, irs: 91 },
    { nombre: 'LUIS EJEMPLO', ventas: 7_200_000, servicios: 27, ticketProm: 13_250, constancia: 90, irs: 88 },
    { nombre: 'SOFÍA FICTICIA', ventas: 6_400_000, servicios: 24, ticketProm: 13_600, constancia: 80, irs: 84 },
    { nombre: 'MARCO DEMO', ventas: 5_800_000, servicios: 22, ticketProm: 12_900, constancia: 73, irs: 77 },
    { nombre: 'JULIA MUESTRA', ventas: 5_100_000, servicios: 20, ticketProm: 13_050, constancia: 67, irs: 74 },
    { nombre: 'PEDRO MODELO', ventas: 4_300_000, servicios: 18, ticketProm: 12_400, constancia: 60, irs: 68 },
    { nombre: 'ELENA PRUEBA', ventas: 2_900_000, servicios: 12, ticketProm: 12_700, constancia: 40, irs: 59 },
    { nombre: 'TOMÁS EJEMPLO', ventas: 1_700_000, servicios: 8, ticketProm: 11_900, constancia: 27, irs: 48 },
  ],
  topComida: [
    { nombre: 'ROLL DE EJEMPLO', qty: 612, monto: 5_814_000 },
    { nombre: 'NIGIRI DE PRUEBA', qty: 540, monto: 3_780_000 },
    { nombre: 'TATAKI FICTICIO', qty: 288, monto: 3_168_000 },
    { nombre: 'GYOZAS DE MUESTRA', qty: 410, monto: 2_460_000 },
    { nombre: 'ENSALADA DEMO', qty: 205, monto: 1_640_000 },
  ],
  topBebidas: [
    { nombre: 'LIMONADA DE PRUEBA', qty: 820, monto: 2_460_000 },
    { nombre: 'CERVEZA EJEMPLO', qty: 690, monto: 2_415_000 },
    { nombre: 'CÓCTEL FICTICIO', qty: 310, monto: 1_860_000 },
    { nombre: 'SAKE DE MUESTRA', qty: 140, monto: 1_260_000 },
    { nombre: 'TÉ DEMO', qty: 260, monto: 520_000 },
  ],
  semanas: [
    { sem: '1', total: 9_100_000, dias: 7, avg: 1_300_000 },
    { sem: '2', total: 9_800_000, dias: 7, avg: 1_400_000 },
    { sem: '3', total: 10_150_000, dias: 7, avg: 1_450_000 },
    { sem: '4', total: 9_450_000, dias: 7, avg: 1_350_000 },
    { sem: '5', total: 2_800_000, dias: 2, avg: 1_400_000 },
  ],
  diasSem: [
    { dia: 'Sábado', avg: 1_820_000, count: 5 },
    { dia: 'Viernes', avg: 1_700_000, count: 5 },
    { dia: 'Jueves', avg: 1_380_000, count: 4 },
    { dia: 'Domingo', avg: 1_310_000, count: 4 },
    { dia: 'Miércoles', avg: 1_150_000, count: 4 },
    { dia: 'Martes', avg: 1_060_000, count: 4 },
    { dia: 'Lunes', avg: 990_000, count: 4 },
  ],
}

export const propinasEjemplo: PropinasCorreo = {
  pool: 6_480_000, barra: 1_150_000, turnos: 58,
  amCount: 28, pmCount: 30, amPool: 2_380_000, pmPool: 4_100_000,
  topProp: [
    { nombre: 'ANA PRUEBA', take: 640_000, dias: 26, rol: 'salonero', prom: 24_615, constancia: 45 },
    { nombre: 'LUIS EJEMPLO', take: 612_000, dias: 27, rol: 'salonero', prom: 22_667, constancia: 47 },
    { nombre: 'RAÚL FICTICIO', take: 560_000, dias: 25, rol: 'barman', prom: 22_400, constancia: 43 },
    { nombre: 'SOFÍA FICTICIA', take: 530_000, dias: 24, rol: 'salonero', prom: 22_083, constancia: 41 },
    { nombre: 'CARLA DEMO', take: 480_000, dias: 26, rol: 'cocina', prom: 18_462, constancia: 45 },
    { nombre: 'MARCO DEMO', take: 455_000, dias: 22, rol: 'salonero', prom: 20_682, constancia: 38 },
    { nombre: 'IVÁN MUESTRA', take: 410_000, dias: 23, rol: 'runner', prom: 17_826, constancia: 40 },
    { nombre: 'JULIA MUESTRA', take: 398_000, dias: 20, rol: 'salonero', prom: 19_900, constancia: 34 },
  ],
  sectores: [
    { rol: 'salonero', total: 3_110_000, pct: 48 },
    { rol: 'barman', total: 1_150_000, pct: 17.7 },
    { rol: 'cocina', total: 1_240_000, pct: 19.1 },
    { rol: 'runner', total: 620_000, pct: 9.6 },
    { rol: 'manager', total: 360_000, pct: 5.6 },
  ].sort((a, b) => b.total - a.total),
  semanas: [
    { sem: '1', total: 1_400_000, avg: 107_692, count: 13 },
    { sem: '2', total: 1_520_000, avg: 116_923, count: 13 },
    { sem: '3', total: 1_610_000, avg: 123_846, count: 13 },
    { sem: '4', total: 1_480_000, avg: 113_846, count: 13 },
    { sem: '5', total: 470_000, avg: 78_333, count: 6 },
  ],
  diasSem: [
    { dia: 'Sábado', avg: 152_000, count: 9 },
    { dia: 'Viernes', avg: 138_000, count: 9 },
    { dia: 'Domingo', avg: 112_000, count: 8 },
    { dia: 'Jueves', avg: 106_000, count: 8 },
    { dia: 'Miércoles', avg: 98_000, count: 8 },
    { dia: 'Martes', avg: 91_000, count: 8 },
    { dia: 'Lunes', avg: 84_000, count: 8 },
  ],
}
