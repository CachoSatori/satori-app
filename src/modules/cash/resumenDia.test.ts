import { describe, it, expect } from 'vitest'
import { agregarTema, resumenVacio, SIN_NOVEDADES, TEMAS_RESUMEN, AVISO_RESUMEN_VACIO } from './resumenDia'

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
