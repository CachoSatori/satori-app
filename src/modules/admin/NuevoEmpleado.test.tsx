// @vitest-environment happy-dom
// Admin → «+ Nuevo empleado» (05/11): formulario, roles sin owner, contraseña temporal una vez,
// errores de la función con mensaje fijo.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Employee } from '../../shared/types/database'

const fn = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../shared/api/supabase', () => ({ supabase: { functions: { invoke: fn.invoke } } }))

import NuevoEmpleado from './NuevoEmpleado'

const emps = [
  { id: 'e1', full_name: 'Ana Pérez', role: 'cajero', is_active: true, profile_id: null },
  { id: 'e2', full_name: 'Ya Vinculado', role: 'salonero', is_active: true, profile_id: 'p9' },
  { id: 'e3', full_name: 'Inactivo', role: 'salonero', is_active: false, profile_id: null },
] as Employee[]

const httpError = (status: number, body: Record<string, unknown>) =>
  ({ data: null, error: { context: new Response(JSON.stringify(body), { status }) } })

const campo = (label: RegExp) => screen.getByText(label).parentElement!.querySelector('input, select') as HTMLInputElement

beforeEach(() => fn.invoke.mockReset())

describe('NuevoEmpleado', () => {
  it('lista de roles sin owner; vinculables = activos sin cuenta', () => {
    render(<NuevoEmpleado employees={emps} onClose={vi.fn()} onCreated={vi.fn()} />)
    const roles = Array.from(campo(/^Rol$/).querySelectorAll('option')).map(o => o.textContent)
    expect(roles).not.toContain('Propietario')
    expect(roles).toContain('Cajero')
    const vinc = Array.from(campo(/Vincular con empleado/).querySelectorAll('option')).map(o => o.textContent)
    expect(vinc).toEqual(['— Sin vincular —', 'Ana Pérez'])
  })

  it('elegir el empleado completa nombre y rol; crea y muestra la contraseña temporal UNA vez', async () => {
    fn.invoke.mockResolvedValue({ data: { user_id: 'u1', email: 'ana@x.com', full_name: 'Ana Pérez', role: 'cajero', employee_linked: true, temp_password: 'AbCd2345EfGh' }, error: null })
    const onCreated = vi.fn()
    render(<NuevoEmpleado employees={emps} onClose={vi.fn()} onCreated={onCreated} />)
    fireEvent.change(campo(/Vincular con empleado/), { target: { value: 'e1' } })
    expect(campo(/Nombre completo/).value).toBe('Ana Pérez')
    expect(campo(/^Rol$/).value).toBe('cajero')
    fireEvent.change(campo(/^Correo$/), { target: { value: 'Ana@X.com' } })
    fireEvent.click(screen.getByText('Crear cuenta'))
    expect(await screen.findByTestId('temp-password')).toHaveProperty('textContent', 'AbCd2345EfGh')
    expect(fn.invoke).toHaveBeenCalledWith('alta-empleado', { body: { action: 'crear', full_name: 'Ana Pérez', email: 'Ana@X.com', role: 'cajero', employee_id: 'e1' } })
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/No se vuelve a mostrar/)).toBeTruthy()
  })

  it('validación local: sin rol no llama a la función', () => {
    render(<NuevoEmpleado employees={[]} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(campo(/Nombre completo/), { target: { value: 'Juan Soto' } })
    fireEvent.change(campo(/^Correo$/), { target: { value: 'juan@x.com' } })
    fireEvent.click(screen.getByText('Crear cuenta'))
    expect(screen.getByRole('alert').textContent).toBe('Elegí el rol')
    expect(fn.invoke).not.toHaveBeenCalled()
  })

  it.each([
    [409, { code: 'email_existe', error: 'Ya existe una cuenta con ese correo', ref: 'r1' }, 'Ya existe una cuenta con ese correo'],
    [403, { code: 'no_autorizado', error: 'Solo un owner activo puede dar de alta empleados', ref: 'r2' }, 'Solo un owner activo puede dar de alta empleados'],
    [500, { code: 'interno', error: 'No se pudo crear la cuenta', ref: 'ab12cd34' }, 'No se pudo crear la cuenta (ref ab12cd34)'],
  ])('error %i → mensaje fijo de la función', async (status, body, msg) => {
    fn.invoke.mockResolvedValue(httpError(status, body))
    render(<NuevoEmpleado employees={[]} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(campo(/Nombre completo/), { target: { value: 'Juan Soto' } })
    fireEvent.change(campo(/^Correo$/), { target: { value: 'juan@x.com' } })
    fireEvent.change(campo(/^Rol$/), { target: { value: 'salonero' } })
    fireEvent.click(screen.getByText('Crear cuenta'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(msg))
    expect(screen.queryByTestId('temp-password')).toBeNull()
  })

  it('sin red → «Sin conexión — no se creó nada»', async () => {
    fn.invoke.mockResolvedValue({ data: null, error: new Error('Failed to fetch') })
    render(<NuevoEmpleado employees={[]} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(campo(/Nombre completo/), { target: { value: 'Juan Soto' } })
    fireEvent.change(campo(/^Correo$/), { target: { value: 'juan@x.com' } })
    fireEvent.change(campo(/^Rol$/), { target: { value: 'salonero' } })
    fireEvent.click(screen.getByText('Crear cuenta'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Sin conexión — no se creó nada'))
  })
})
