// @vitest-environment happy-dom
//
// D18 ampliada (dueño 23-nov ~23:50 CR): el contador ve «Equipo» → «Competencias» SOLO PARA MIRAR.
//   · En pantalla: sin «+ Nueva» ni «×» (owner y manager sí los ven).
//   · En la API: `saveComp` y `deleteComp` rechazan su rol ANTES de tocar la base (aunque una pantalla lo intentara).
// Datos ficticios.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const llamadas: string[] = []
vi.mock('../../shared/api/supabase', () => {
  const cadena = (op: string) => {
    llamadas.push(op)
    const q: Record<string, unknown> = {}
    q.filter = () => Promise.resolve({ error: null })
    return q
  }
  return {
    supabase: {
      from: () => ({
        delete: () => cadena('delete'),
        insert: () => { llamadas.push('insert'); return Promise.resolve({ error: null }) },
      }),
    },
  }
})

import VentasCompetencias from './VentasCompetencias'
import { saveComp, deleteComp } from '../../shared/api/ventas'
import type { Comp } from '../../shared/types/ventas'

const comp: Comp = {
  id: 'c1', nombre: 'Copa de prueba', tipo: 'semanal', inicio: '2026-11-01', fin: '2026-11-07',
  premio: 'Premio ficticio', prods: [{ name: 'ROLLO A', pts: 1 }], parts: ['Persona A'],
}

beforeEach(() => { llamadas.length = 0 })
afterEach(() => cleanup())

describe('Competencias · D18: el contador solo mira', () => {
  it.each(['owner', 'manager'])('%s ve «+ Nueva» y «×»', role => {
    render(<VentasCompetencias dias={{}} pm={{}} comps={[comp]} onRefresh={() => {}} role={role} />)
    expect(screen.getByText('+ Nueva')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Eliminar Copa de prueba' })).toBeTruthy()
  })

  it('el contador ve la competencia y su ranking, sin «+ Nueva» ni «×»', () => {
    render(<VentasCompetencias dias={{}} pm={{}} comps={[comp]} onRefresh={() => {}} role="contador" />)
    expect(screen.getByText('Copa de prueba')).toBeTruthy()
    expect(screen.getByText('▼ Ver ranking')).toBeTruthy()
    expect(screen.queryByText('+ Nueva')).toBeNull()
    expect(screen.queryByRole('button', { name: /Eliminar/ })).toBeNull()
    expect(document.body.textContent).not.toContain('✓ Crear competencia')
  })

  it.each(['contador', 'salonero', 'cajero', ''])('la API rechaza crear y dar de baja con rol «%s» sin tocar la base', async role => {
    await expect(saveComp(comp, role)).rejects.toThrow('no crearlas ni darlas de baja')
    await expect(deleteComp('c1', role)).rejects.toThrow('no crearlas ni darlas de baja')
    expect(llamadas).toEqual([])
  })

  it.each(['owner', 'manager'])('la API deja crear y dar de baja a %s', async role => {
    await saveComp(comp, role)
    await deleteComp('c1', role)
    expect(llamadas).toEqual(['delete', 'insert', 'delete'])
  })
})
