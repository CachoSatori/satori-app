import { useState, useMemo, useEffect } from 'react'
import type { Employee } from '../../shared/types/database'
import {
  departamentoDe, puestoDe, tipoReglaDe, horaHabitualHHMM,
  updateEmployeeHorasHabituales, updateEmployeeHomebankingName,
  exigirTarifasEditables, participaServicio,
  type TipoRegla,
} from '../../shared/api/salarios'
import { fi } from '../../shared/utils'
import { iniciales } from './salariosUi'

// Salarios · pestaña FICHA (SPEC-UI v3 §2).
//
// La hoja de una persona: identidad, contacto para comprobantes, banco y la REGLA DE
// HORARIO que ahorra las correcciones de cada quincena.
//
// Lo que se puede guardar hoy se guarda (horario habitual, nombre en el banco). Lo que
// no tiene columna se muestra como HUECO explícito, no como un campo que dice guardar y
// no guarda: departamento y puesto se derivan del rol; WhatsApp, correo y cuenta
// bancaria no existen en `employees` (ver el DDL aditivo propuesto en el reporte).

interface Props {
  employees: Employee[]
  onRefresh: () => Promise<void> | void
}

const REGLAS: { id: TipoRegla; label: string; sub: string }[] = [
  { id: 'unico',    label: 'Único',    sub: 'entra / sale fijos' },
  { id: 'cortado',  label: 'Cortado',  sub: '2 bloques (MD + noche)' },
  { id: 'flexible', label: 'Flexible', sub: 'sin hora techo' },
]

export default function SalariosFicha({ employees, onRefresh }: Props) {
  const activos = useMemo(() => employees.filter(e => e.is_active), [employees])
  const [empId, setEmpId] = useState('')
  const emp = employees.find(e => e.id === empId) ?? null

  const [regla, setRegla]     = useState<TipoRegla>('flexible')
  const [entrada, setEntrada] = useState('')
  const [salida, setSalida]   = useState('')
  const [banco, setBanco]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [ok, setOk]           = useState<string | null>(null)

  // Al cambiar de persona, el formulario se rearma con SUS datos. Sin esto, el horario
  // de quien mirabas antes queda en pantalla y se guardaría sobre otro empleado.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!emp) return
    setRegla(tipoReglaDe(emp))
    setEntrada(horaHabitualHHMM(emp.hora_entrada_habitual) ?? '')
    setSalida(horaHabitualHHMM(emp.hora_salida_habitual) ?? '')
    setBanco(emp.nombre_homebanking ?? '')
    setError(null); setOk(null)
  }, [emp])

  const handleGuardar = async () => {
    if (!emp) return
    setSaving(true); setError(null); setOk(null)
    try {
      // Misma cerradura que Empleados / Tarifas: con un período cerrado sin pagar, los
      // datos que entran al cálculo no se tocan hasta que se reabra con motivo.
      await exigirTarifasEditables()
      // En FLEXIBLE la regla se borra a propósito: "sin hora techo" es no tener horas
      // habituales, no tener unas viejas escondidas que sigan pre-rellenando impares.
      await updateEmployeeHorasHabituales(
        emp.id,
        regla === 'flexible' ? '' : entrada,
        regla === 'flexible' ? '' : salida,
      )
      await updateEmployeeHomebankingName(emp.id, banco)
      await onRefresh()
      setOk('Ficha guardada.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando la ficha')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-section">
      <div className="sal-phead">
        <div>
          <div className="sal-eyebrow">
            {emp ? `${emp.full_name} · ${departamentoDe(emp.role)} / ${puestoDe(emp.role)}` : 'Elegí una persona'}
          </div>
          <h2>Ficha</h2>
          <p>
            Identidad, contacto para comprobantes, banco y la regla de horario que ahorra
            las correcciones de cada quincena.
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={handleGuardar}
          disabled={!emp || saving}
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      <div className="sal-bar">
        <span className="sal-bar-label">Empleado</span>
        <select
          className="tip-input"
          aria-label="Empleado"
          value={empId}
          onChange={e => setEmpId(e.target.value)}
        >
          <option value="">— elegir —</option>
          {activos.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
      </div>

      {error && <p className="field-error" style={{ padding: '0 12px' }}>{error}</p>}
      {ok && <p className="sal-note sal-note-teal"><span className="sal-note-mk">✓</span><span>{ok}</span></p>}

      {!emp ? (
        <p style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.45, fontSize: '0.8rem' }}>
          Elegí a alguien para ver y editar su ficha.
        </p>
      ) : (
        <div className="sal-ficha-grid">
          <div>
            <div className="sal-card">
              <p className="sal-mini-hd">Datos</p>
              <div className="sal-who" style={{ marginBottom: '0.9rem' }}>
                <span className="sal-ini">{iniciales(emp.full_name)}</span>
                <div>
                  <div className="sal-name">{emp.full_name}</div>
                  <div className="sal-name-meta">
                    {emp.biotime_emp_code ? `BioTime · ${emp.biotime_emp_code}` : 'sin código de BioTime'}
                  </div>
                </div>
              </div>
              <div className="sal-fields">
                <div className="field">
                  <label>Departamento</label>
                  <div className="sal-val">{departamentoDe(emp.role)}</div>
                </div>
                <div className="field">
                  <label>Puesto</label>
                  <div className="sal-val">{puestoDe(emp.role)}</div>
                </div>
                <div className="field">
                  <label>Tarifa vigente</label>
                  <div className="sal-val is-mono">
                    {(emp.hourly_rate_crc ?? 0) > 0 ? `${fi(emp.hourly_rate_crc ?? 0)}/h` : '—'}
                  </div>
                </div>
                <div className="field">
                  <label>10% de servicio</label>
                  <div className="sal-val">
                    {participaServicio(emp)
                      ? <span className="sal-pill is-plum">Participa</span>
                      : <span className="sal-pill is-plain">No participa</span>}
                  </div>
                </div>
              </div>
              <p className="sal-legend">
                Departamento y puesto se derivan del <strong>rol</strong>: hoy{' '}
                <code>employees</code> no tiene columnas propias para los dos. El rol y la
                tarifa se cambian en <strong>Personal</strong>.
              </p>
            </div>

            <div className="sal-card">
              <p className="sal-mini-hd">Banco y contacto</p>
              <div className="field">
                <label>Nombre en el homebanking</label>
                <input
                  className="tip-input"
                  aria-label="Nombre en el homebanking"
                  value={banco}
                  placeholder={emp.full_name}
                  disabled={saving}
                  onChange={e => setBanco(e.target.value)}
                />
              </div>
              <p className="sal-legend">
                El banco identifica al beneficiario <strong>por el nombre</strong>: sin
                alias cargado, el archivo exporta el nombre del empleado.
                <br />
                <strong>WhatsApp, correo y número de cuenta todavía no tienen columna</strong>{' '}
                en <code>employees</code>. El SPEC los pide obligatorios para los
                comprobantes; van con una migración aditiva propia, no con un campo que
                acepte texto y lo tire.
              </p>
            </div>
          </div>

          <div className="sal-card sal-card-regla">
            <p className="sal-mini-hd" style={{ color: 'var(--sal-gold)' }}>
              ◆ Regla de horario · Capa 3
            </p>
            <div className="sal-ruletype">
              {REGLAS.map(r => (
                <button
                  key={r.id}
                  type="button"
                  className={`sal-ruletype-btn ${regla === r.id ? 'is-on' : ''}`}
                  aria-pressed={regla === r.id}
                  disabled={saving}
                  onClick={() => setRegla(r.id)}
                >
                  {r.label}
                  <small>{r.sub}</small>
                </button>
              ))}
            </div>

            {/* El formulario CAMBIA según el tipo — no es un placeholder. */}
            {regla === 'unico' && (
              <div className="sal-fields">
                <div className="field">
                  <label>Entra</label>
                  <input
                    className="tip-input" type="time" aria-label="Hora de entrada habitual"
                    value={entrada} disabled={saving}
                    onChange={e => setEntrada(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Sale</label>
                  <input
                    className="tip-input" type="time" aria-label="Hora de salida habitual"
                    value={salida} disabled={saving}
                    onChange={e => setSalida(e.target.value)}
                  />
                </div>
              </div>
            )}

            {regla === 'cortado' && (
              <p className="sal-note sal-note-warn">
                <span className="sal-note-mk">!</span>
                <span>
                  El turno cortado necesita <strong>cuatro</strong> horas (dos bloques) y
                  hoy <code>employees</code> guarda <strong>una entrada y una salida</strong>{' '}
                  (mig 061). No se puede guardar todavía: va con una migración aditiva
                  propia. Mientras tanto, cargá el bloque principal como{' '}
                  <strong>Único</strong> y corregí el otro a mano en <strong>Horas</strong>.
                </span>
              </p>
            )}

            {regla === 'flexible' && (
              <p className="sal-note sal-note-teal">
                <span className="sal-note-mk">◆</span>
                <span>
                  Sin hora techo. Cada impar se propone en blanco y se completa a mano.
                  Guardar con Flexible <strong>borra</strong> el horario habitual que
                  hubiera cargado.
                </span>
              </p>
            )}

            <p className="sal-note sal-note-warn">
              <span className="sal-note-mk">!</span>
              <span>
                Un impar de BioTime <strong>siempre se avisa</strong>, sea cual sea la
                regla. La regla propone cómo completarlo — nunca apaga la alerta.
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
