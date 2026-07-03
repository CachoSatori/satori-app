// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// Autorización de gerencia por SOLO CONTRASEÑA (mig 045). Invariantes:
//   1. El modal tiene UN campo (contraseña) — el email ya no se tipea: lo devuelve el server.
//   2. Contraseña válida → resuelve { ok, managerEmail (identidad del SERVER), managerId,
//      managerPassword (para que la RPC de plata re-valide, mig 044) }.
//   3. Colisión (contraseñas de gerencia duplicadas) → el error explícito del server se muestra
//      tal cual y NO se autoriza (no se atribuye a ciegas).
//   4. Contraseña inválida → error claro, no resuelve.
//   5. owner/manager logueado → { ok: true } directo, SIN modal (la RPC autoriza por su rol).

const { rpcSpy, authState } = vi.hoisted(() => ({
  rpcSpy: vi.fn(),
  authState: { role: 'cajero' },
}))

vi.mock('./api/supabase', () => ({ supabase: { rpc: rpcSpy } }))
vi.mock('./hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: authState.role, full_name: 'Test' } }),
}))

import { ManagerOverrideProvider, useManagerOverride, type ManagerAuth } from './ManagerOverride'

// Botón de prueba: dispara requireManager() y guarda el resultado en `results`.
function Trigger({ results }: { results: ManagerAuth[] }) {
  const requireManager = useManagerOverride()
  return <button onClick={async () => { results.push(await requireManager()) }}>pedir</button>
}

const setup = () => {
  const results: ManagerAuth[] = []
  render(
    <ManagerOverrideProvider>
      <Trigger results={results} />
    </ManagerOverrideProvider>,
  )
  return results
}

describe('ManagerOverride — autorización por solo contraseña (mig 045)', () => {
  beforeEach(() => {
    rpcSpy.mockReset()
    authState.role = 'cajero'
  })

  it('cajero: el modal tiene UN solo campo (contraseña, sin email)', async () => {
    setup()
    await act(async () => { fireEvent.click(screen.getByText('pedir')) })

    const inputs = document.querySelectorAll('.cd-modal input')
    expect(inputs).toHaveLength(1)
    expect((inputs[0] as HTMLInputElement).type).toBe('password')
  })

  it('cajero + contraseña válida: resuelve con la identidad del SERVER + la contraseña para re-validar', async () => {
    rpcSpy.mockResolvedValue({ data: { user_id: 'u-boss', email: 'boss@satori.cr', role: 'manager' }, error: null })
    const results = setup()

    await act(async () => { fireEvent.click(screen.getByText('pedir')) })
    fireEvent.change(document.querySelector('.cd-modal input')!, { target: { value: 'clave-boss' } })
    await act(async () => { fireEvent.submit(document.querySelector('form.cd-modal')!) })

    expect(rpcSpy).toHaveBeenCalledWith('verify_manager_password', { p_password: 'clave-boss' })
    expect(results).toEqual([{ ok: true, managerEmail: 'boss@satori.cr', managerId: 'u-boss', managerPassword: 'clave-boss' }])
  })

  it('colisión: el error explícito del server se muestra tal cual y NO autoriza', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: 'Contraseñas de gerencia duplicadas: más de un encargado/dueño usa esta contraseña. Uno de ellos debe cambiarla para poder autorizar.' },
    })
    const results = setup()

    await act(async () => { fireEvent.click(screen.getByText('pedir')) })
    fireEvent.change(document.querySelector('.cd-modal input')!, { target: { value: 'repetida' } })
    await act(async () => { fireEvent.submit(document.querySelector('form.cd-modal')!) })

    expect(results).toHaveLength(0)   // sigue esperando: NO atribuye a ciegas
    expect(screen.getByText(/duplicadas/i)).toBeTruthy()
  })

  it('contraseña inválida: error claro y no autoriza', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { message: 'Contraseña inválida o sin permiso de gerencia' } })
    const results = setup()

    await act(async () => { fireEvent.click(screen.getByText('pedir')) })
    fireEvent.change(document.querySelector('.cd-modal input')!, { target: { value: 'mala' } })
    await act(async () => { fireEvent.submit(document.querySelector('form.cd-modal')!) })

    expect(results).toHaveLength(0)
    expect(screen.getByText(/Contraseña inválida/i)).toBeTruthy()
  })

  it('cancelar: resuelve { ok: false } sin llamar al server', async () => {
    const results = setup()
    await act(async () => { fireEvent.click(screen.getByText('pedir')) })
    await act(async () => { fireEvent.click(screen.getByText('Cancelar')) })

    expect(results).toEqual([{ ok: false }])
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('owner logueado: { ok: true } directo, sin modal ni RPC', async () => {
    authState.role = 'owner'
    const results = setup()
    await act(async () => { fireEvent.click(screen.getByText('pedir')) })

    expect(results).toEqual([{ ok: true }])
    expect(document.querySelector('.cd-modal')).toBeNull()
    expect(rpcSpy).not.toHaveBeenCalled()
  })
})
