// @vitest-environment happy-dom
// Inventario → 📨 Facturas electrónicas (compras F1): la pantalla de control muestra la última ingesta (en rojo si pasa
// de 6 h), lo de hoy, lo que quedó para revisar y los errores; si la base dice 42501, lo dice sin inventar números.
// La pestaña solo aparece para owner y contador. Datos ficticios.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { todayCR } from '../../shared/utils'

const H = vi.hoisted(() => ({ resultado: null as unknown }))
vi.mock('../../shared/api/feIngesta', () => ({ getResumenIngesta: vi.fn(async () => H.resultado) }))

import InvFacturasFe from './InvFacturasFe'

afterEach(cleanup)

const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

describe('InvFacturasFe', () => {
  it('al día: última ingesta sin alerta, conteo de hoy, revisar y errores', async () => {
    H.resultado = { ok: true, resumen: {
      latidos: [{ fuente: 'santa-teresa', ultimo_en: hace(8) }],
      dias: [{ dia: todayCR(), nuevo: 6, duplicado: 1, revisar: 2, no_comprobante: 0, sin_xml: 1, error: 0 }],
      revisar: [{ estado: 'receptor_distinto', motivo: 'cédula del receptor no configurada', n: 1 }],
      errores: [{ ts: hace(30), resultado: 'error', motivo: 'XML ilegible: prueba', fin_clave: '0000000001' }],
      ultima: hace(8),
    } }
    render(<InvFacturasFe />)
    expect(await screen.findByText('6 nuevas')).toBeTruthy()
    expect(screen.getByText(/1 duplicadas · 0 con error · 1 correos sin XML/)).toBeTruthy()
    expect(screen.getByTestId('fe-ultima').className).not.toContain('red')
    expect(screen.getByText('Receptor distinto')).toBeTruthy()
    expect(screen.getByText('XML ilegible: prueba')).toBeTruthy()
    expect(screen.getByText('…0000000001')).toBeTruthy()
  })
  it('sin ingesta hace más de 6 h: en rojo, con el aviso', async () => {
    H.resultado = { ok: true, resumen: { latidos: [{ fuente: 'santa-teresa', ultimo_en: hace(7 * 60) }], dias: [], revisar: [], errores: [], ultima: hace(7 * 60) } }
    render(<InvFacturasFe />)
    expect(await screen.findByText('Revisar el script del correo')).toBeTruthy()
    expect(screen.getByTestId('fe-ultima').className).toContain('red')
  })
  it('sin permiso: muestra el mensaje y ningún número', async () => {
    H.resultado = { ok: false, error: 'Solo el owner y el contador ven esta pantalla.' }
    render(<InvFacturasFe />)
    expect(await screen.findByText('Solo el owner y el contador ven esta pantalla.')).toBeTruthy()
    expect(screen.queryByText(/nuevas/)).toBeNull()
  })
})

describe('pestaña en Inventario', () => {
  it('solo owner y contador la tienen', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const fuente = readFileSync(join(__dirname, 'InventarioModule.tsx'), 'utf8')
    expect(fuente).toMatch(/\{ id: 'fe',\s+label: '📨 Facturas electrónicas', roles: \['owner','contador'\] \}/)
  })
})
