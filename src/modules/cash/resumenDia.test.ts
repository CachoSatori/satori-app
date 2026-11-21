import { describe, it, expect } from 'vitest'
import {
  agregarTema, resumenVacio, SIN_NOVEDADES, TEMAS_RESUMEN, AVISO_RESUMEN_VACIO,
  ETIQUETA_MOTIVO, PLACEHOLDER_MOTIVO, MOTIVO_MAX, PLACEHOLDER_RESUMEN, AVISO_RESUMEN_IGUAL_MOTIVO,
  normalizarTexto, resumenIgualMotivo,
} from './resumenDia'

describe('resumenDia — reglas del «Resumen del día»', () => {
  it('vacío o solo espacios/saltos = vacío; cualquier texto no', () => {
    expect(resumenVacio('')).toBe(true)
    expect(resumenVacio('   ')).toBe(true)
    expect(resumenVacio(' \n\t ')).toBe(true)
    expect(resumenVacio('x')).toBe(false)
    expect(resumenVacio(SIN_NOVEDADES)).toBe(false)
  })

  it('los 5 temas y el texto exacto de «Sin novedades» y del aviso', () => {
    expect([...TEMAS_RESUMEN]).toEqual(['Queja', 'Personal', 'Emergencia', '86', 'Mantenimiento'])
    expect(SIN_NOVEDADES).toBe('Sin novedades')
    expect(AVISO_RESUMEN_VACIO).toBe('Escribí el resumen del día o tocá Sin novedades')
  })

  it('cuadro vacío → solo «Tema: »', () => {
    expect(agregarTema('', 'Queja')).toBe('Queja: ')
    expect(agregarTema('  \n ', '86')).toBe('86: ')
  })

  it('con texto → «Tema: » en una línea nueva, sin duplicar saltos', () => {
    expect(agregarTema('Mesa 4 contenta', 'Personal')).toBe('Mesa 4 contenta\nPersonal: ')
    expect(agregarTema('Queja: demora  ', 'Emergencia')).toBe('Queja: demora\nEmergencia: ')
    expect(agregarTema('algo\n', 'Mantenimiento')).toBe('algo\nMantenimiento: ')
  })

  it('«Sin novedades» se reemplaza al elegir un tema', () => {
    expect(agregarTema('Sin novedades', 'Queja')).toBe('Queja: ')
  })
})

describe('resumenDia — el resumen y el motivo de la diferencia son distintos (21-nov)', () => {
  it('textos y tope del motivo', () => {
    expect(ETIQUETA_MOTIVO).toBe('¿Por qué hubo diferencia? *')
    expect(PLACEHOLDER_MOTIVO).toBe('Ej.: vuelto mal dado en una mesa')
    expect(MOTIVO_MAX).toBe(160)
    expect(PLACEHOLDER_RESUMEN).toBe('Qué pasó hoy: quejas, personal, 86, mantenimiento… (la diferencia va aparte)')
    expect(AVISO_RESUMEN_IGUAL_MOTIVO).toBe('El resumen del día y el motivo de la diferencia tienen que ser distintos')
  })

  it('normaliza: bordes, minúsculas y espacios/saltos colapsados', () => {
    expect(normalizarTexto('  Faltó   CAMBIO\n en  la\tmesa  ')).toBe('faltó cambio en la mesa')
    expect(normalizarTexto(' \n ')).toBe('')
  })

  it('iguales exactos o iguales tras normalizar → true', () => {
    expect(resumenIgualMotivo('Faltó cambio', 'Faltó cambio')).toBe(true)
    expect(resumenIgualMotivo('Faltó cambio', '  faltó   CAMBIO ')).toBe(true)
    expect(resumenIgualMotivo('Faltó cambio\nen la mesa 4', 'faltó cambio en la mesa 4')).toBe(true)
  })

  it('distintos → false; «Sin novedades» con un motivo real es válido', () => {
    expect(resumenIgualMotivo('Noche tranquila', 'Vuelto mal dado')).toBe(false)
    expect(resumenIgualMotivo(SIN_NOVEDADES, 'Vuelto mal dado en una mesa')).toBe(false)
    expect(resumenIgualMotivo('Faltó cambio en la mesa 4', 'Faltó cambio')).toBe(false)
  })

  it('si alguno está vacío no cuenta como igual (lo cubren sus propios avisos)', () => {
    expect(resumenIgualMotivo('', '')).toBe(false)
    expect(resumenIgualMotivo('  ', ' ')).toBe(false)
    expect(resumenIgualMotivo('algo', '')).toBe(false)
  })
})
