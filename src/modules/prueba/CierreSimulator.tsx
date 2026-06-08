/**
 * CierreSimulator — Simulador del cierre de Caja Fuerte (SOLO LECTURA)
 *
 * Carga datos reales del día (cash_movements + cierre si existe) pero NO GUARDA NADA.
 * Sirve para validar la lógica del cierre por ledger con datos reales, sin riesgo,
 * antes de enchufar el helper al cierre real (Paso 2).
 *
 * Usa el MISMO helper `saldoCajaFuerte` que usará el cierre real:
 *   Debería quedar = saldoCajaFuerte(ledger − movimientos que genera este cierre)
 *                    + ventas efectivo − propinas − retiro
 *   Diferencia     = total contado − debería quedar
 */
import { useState, useEffect, useMemo } from 'react'
import type { CashMovement, CashCierreDia } from '../../shared/types/database'
import { getAllCashMovements, getCierresDia } from '../../shared/api/cash'
import { saldoCajaFuerte, fi, fd, todayStr } from '../cash/cashUtils'

function N(v: number | ''): number { return Number(v) || 0 }

// Estilos y subcomponente a nivel de módulo (NO dentro del render → evita remontar
// los inputs en cada tecla y la regla react-hooks/static-components).
const card = { background: 'var(--t-paper,#f5f0e8)', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 4, padding: '0.875rem 1rem' } as const
const lbl  = { fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#5a5040' }
const num  = { fontFamily: "'DM Mono', monospace", fontWeight: 700 } as const
const inputStyle = { width: '100%', background: '#111', border: '1px solid #2a2a2a', color: 'var(--t-gold,#a07830)', padding: '6px 10px', borderRadius: 2, fontSize: '0.9rem', fontFamily: "'DM Mono', monospace" } as const

function Field({ label, value, onChange }: { label: string; value: number | ''; onChange: (v: number | '') => void }) {
  return (
    <div>
      <div style={{ ...lbl, marginBottom: 3 }}>{label}</div>
      <input type="number" value={value} placeholder="0"
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle} />
    </div>
  )
}

export default function CierreSimulator() {
  const today = todayStr()
  const [fecha, setFecha] = useState(today)
  const [movs, setMovs] = useState<CashMovement[]>([])
  const [loading, setLoading] = useState(true)

  // Campos editables (el admin ajusta a mano)
  const [ventasM, setVentasM] = useState<number | ''>('')
  const [ventasN, setVentasN] = useState<number | ''>('')
  const [propinas, setPropinas] = useState<number | ''>('')
  const [retiro, setRetiro] = useState<number | ''>('')
  const [sepProv, setSepProv] = useState<number | ''>('')
  const [sepReg, setSepReg] = useState<number | ''>('')
  const [remanente, setRemanente] = useState<number | ''>('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([getAllCashMovements(), getCierresDia(fecha)])
      .then(([allMovs, cierres]: [CashMovement[], CashCierreDia[]]) => {
        if (cancelled) return
        setMovs(allMovs)
        // Prellenar desde el cierre cargado de esa fecha (si existe) — solo lectura
        const c = cierres.find(x => x.tipo === 'completo') ?? cierres.find(x => x.tipo === 'parcial_mediodia')
        setVentasM(c?.ef_real_m_crc || '')
        setVentasN(c?.ef_real_n_crc || '')
        setPropinas((c ? (c.propinas_m_crc || 0) + (c.propinas_n_crc || 0) : '') || '')
        setRetiro(c?.otros_n_crc || '')
        setSepProv(c?.sep_diaria_crc || '')
        setSepReg(c?.sep_registradora_crc || '')
        setRemanente(c?.remanente_crc || '')
      })
      .catch(() => { if (!cancelled) setMovs([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fecha])

  // Saldo Caja Fuerte según el ledger, EXCLUYENDO las ventas-de-cierre de esta fecha
  // (esas se re-suman desde el formulario → evitar doble conteo). El retiro es 'traspaso'
  // y el helper ya lo excluye.
  const baseMovs = useMemo(
    () => movs.filter(m => !(m.subcategory === 'Ventas cierre' && (m.description || '').includes(fecha))),
    [movs, fecha])
  const saldoBase = useMemo(() => saldoCajaFuerte(baseMovs), [baseMovs])

  // Saldo CF "tal cual el ledger" (incluyendo todo) — informativo
  const saldoLedgerFull = useMemo(() => saldoCajaFuerte(movs), [movs])

  const ventasEf      = N(ventasM) + N(ventasN)
  const deberia       = saldoBase.crc + ventasEf - N(propinas) - N(retiro)
  const totalContado  = N(sepProv) + N(sepReg) + N(remanente)
  const diferencia    = totalContado - deberia
  const cuadra        = Math.abs(diferencia) < 500

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '0.5rem' }}>
      {/* Banner permanente de modo prueba */}
      <div style={{ background: 'rgba(160,120,48,.12)', border: '1.5px solid #a07830', borderRadius: 4, padding: '0.625rem 0.875rem', marginBottom: '1rem', fontSize: '0.82rem', fontWeight: 700, color: '#a07830' }}>
        🧪 MODO PRUEBA — no se guarda nada. Cargá datos reales y validá el cálculo; al recargar queda limpio.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        <div style={{ fontWeight: 700 }}>Simulador de cierre de Caja Fuerte</div>
        <input type="date" value={fecha} max={today} onChange={e => setFecha(e.target.value)}
          style={{ background: '#1a1a1a', border: '1px solid #333', color: 'var(--t-gold,#a07830)', padding: '5px 10px', borderRadius: 2, fontSize: '0.82rem' }} />
      </div>

      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>Cargando datos reales…</div>
      ) : (
        <>
          {/* Saldo Caja Fuerte según sistema */}
          <div style={{ ...card, background: 'var(--t-ink,#0d0d0d)', border: 'none', marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9a9488' }}>Saldo Caja Fuerte según sistema (ledger)</div>
            <div style={{ ...num, fontSize: '1.6rem', color: 'var(--t-gold,#c8a96e)' }}>
              {fi(saldoLedgerFull.crc)}{saldoLedgerFull.usd ? <span style={{ fontSize: '1rem', color: '#7ab4d4', marginLeft: 8 }}>{fd(saldoLedgerFull.usd)}</span> : null}
            </div>
            <div style={{ fontSize: '0.66rem', color: '#9a9488', marginTop: 4 }}>
              Base del cálculo (sin las ventas-de-cierre de {fecha}, que se suman del formulario): <span style={num}>{fi(saldoBase.crc)}</span>
            </div>
          </div>

          {/* Campos editables */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: '0.625rem', marginBottom: '1rem' }}>
            <Field label="Ventas efectivo mediodía ₡" value={ventasM} onChange={setVentasM} />
            <Field label="Ventas efectivo noche ₡"    value={ventasN} onChange={setVentasN} />
            <Field label="Propinas ₡"                 value={propinas} onChange={setPropinas} />
            <Field label="Retiro a banco ₡"           value={retiro} onChange={setRetiro} />
          </div>
          <div style={{ ...lbl, marginBottom: 6 }}>Conteo físico — separaciones</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: '0.625rem', marginBottom: '1rem' }}>
            <Field label="Caja Proveedores ₡" value={sepProv} onChange={setSepProv} />
            <Field label="Caja Registradora ₡" value={sepReg} onChange={setSepReg} />
            <Field label="Remanente CF ₡" value={remanente} onChange={setRemanente} />
          </div>

          {/* Desglose en vivo */}
          <div style={{ ...card, marginBottom: '0.75rem' }}>
            <div style={{ ...lbl, marginBottom: 8 }}>Debería quedar = saldo CF + ventas − propinas − retiro</div>
            {[
              ['Saldo Caja Fuerte (base)', saldoBase.crc],
              ['+ Ventas efectivo (M+N)', ventasEf],
              ['− Propinas', -N(propinas)],
              ['− Retiro a banco', -N(retiro)],
            ].map(([l, v]) => (
              <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '2px 0' }}>
                <span style={{ color: '#5a5040' }}>{l}</span><span style={num}>{fi(v as number)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--t-border,#d4cfc4)', marginTop: 6, paddingTop: 6, fontWeight: 700 }}>
              <span>Debería quedar</span><span style={num}>{fi(deberia)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '2px 0', marginTop: 4 }}>
              <span style={{ color: '#5a5040' }}>Total contado (Prov + Reg + Remanente)</span><span style={num}>{fi(totalContado)}</span>
            </div>
          </div>

          {/* Diferencia */}
          <div style={{ ...card, background: cuadra ? 'rgba(74,154,106,.12)' : 'rgba(194,59,34,.1)', border: `1.5px solid ${cuadra ? '#4a9a6a' : '#c23b22'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ ...lbl, color: cuadra ? '#4a9a6a' : '#c23b22' }}>Diferencia (contado − debería)</div>
              <div style={{ ...num, fontSize: '1.5rem', color: cuadra ? '#4a9a6a' : '#c23b22' }}>{diferencia >= 0 ? '+' : ''}{fi(diferencia)}</div>
            </div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: cuadra ? '#4a9a6a' : '#c23b22' }}>
              {cuadra ? '✅ Cuadra' : diferencia > 0 ? '↑ Sobra' : '↓ Falta'}
            </div>
          </div>

          <div style={{ fontSize: '0.66rem', color: '#888', marginTop: '0.75rem', lineHeight: 1.5 }}>
            <code>saldoCajaFuerte</code> ya usa la lógica canónica: + ingresos efectivo con <code>caja_origen='Caja Fuerte'</code>
            (ventas de cierre), − egresos no pendientes (caja_origen 'Caja Fuerte' o método 'Efectivo'); excluye pendientes,
            traspasos y transferencias. Es el mismo helper que usa el cierre real del día.
          </div>
        </>
      )}
    </div>
  )
}
