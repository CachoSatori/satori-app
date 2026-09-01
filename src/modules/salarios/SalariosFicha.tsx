import { useState, useMemo, useEffect } from 'react'
import type { Employee } from '../../shared/types/database'
import {
  departamentoDe, puestoDe, tipoReglaDe, horaHabitualHHMM,
  updateEmployeeHorasHabituales, updateEmployeeHomebankingName,
  exigirTarifasEditables, participaServicio, horarioResumen, TIPO_REGLA_LABEL,
  type TipoRegla,
} from '../../shared/api/salarios'
import { fi } from '../../shared/utils'
import { iniciales } from './salariosUi'

// Salarios · pestaña FICHA (SPEC-UI v3 §2).
//
// La hoja de una persona: identidad, contacto para comprobantes, banco y la REGLA DE
// HORARIO que ahorra las correcciones de cada quincena.
//
// ── ÚNICA FUENTE DEL HORARIO (v3, fix del piloto) ──────────────────────────────────────
// El tipo de horario (Fijo / Cortado / Flexible) y sus horas se editan ACÁ y en ningún
// otro lado. Personal y Tarifas los MUESTRAN de solo lectura, con el mismo
// `horarioResumen` que usa esta pantalla. Antes el horario también se editaba desde
// Personal y el mismo dato terminaba distinto según dónde se mirara; el arreglo no fue
// sincronizar dos formularios, fue dejar uno.
//
// Guardar acá y volver a Personal muestra el dato nuevo: las dos pestañas leen el mismo
// `employees` del módulo, y `onRefresh` lo relee de la base después de cada guardado.
//
// Lo que se puede guardar hoy se guarda (horario habitual, nombre en el banco). Lo que
// no tiene columna se muestra como HUECO explícito, no como un campo que dice guardar y
// no guarda: departamento y puesto se derivan del rol; WhatsApp, correo y cuenta
// bancaria no existen en `employees` (ver el DDL aditivo propuesto en el reporte).

interface Props {
  employees: Employee[]
  onRefresh: () => Promise<void> | void
}

// Las horas van SIEMPRE en 24 h (14:00, 02:00): el `<input type="time">` del navegador
// puede mostrar el reloj de 12 h según el idioma del sistema, pero el valor que viaja y
// el que se muestra en las tablas es "HH:MM". Nada de a.m./p.m. en nómina.
const REGLAS: { id: TipoRegla; label: string; sub: string }[] = [
  { id: 'unico',    label: TIPO_REGLA_LABEL.unico,    sub: 'una entrada y una salida' },
  { id: 'cortado',  label: TIPO_REGLA_LABEL.cortado,  sub: '2 bloques (MD + noche)' },
  { id: 'flexible', label: TIPO_REGLA_LABEL.flexible, sub: 'sin hora techo' },
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
            Identidad, contacto para comprobantes, banco y el <strong>horario</strong> — que
            se edita acá y en ningún otro lado. Personal y Tarifas lo muestran de solo lectura.
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
                <code>employees</code> no tiene columnas propias para los dos. El rol, la
                tarifa y el 10% de servicio se cambian en <strong>Tarifas</strong>;{' '}
                <strong>Personal</strong> es de solo lectura. El <strong>horario</strong> es
                de esta ficha y de ningún otro lado.
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
              ◆ Horario · el único lugar donde se edita
            </p>
            {/* Lo que Personal y Tarifas van a mostrar. Está acá para que se vea, ANTES de
                guardar, que el dato es uno solo y que esta pantalla es su dueña. */}
            <p className="sal-note sal-note-plain">
              <span className="sal-note-mk">≡</span>
              <span>
                Guardado hoy: <strong className="is-mono">{horarioResumen(emp)}</strong>
                {' '}— así se lee en <strong>Personal</strong> y en <strong>Tarifas</strong>,
                donde no se puede editar.
              </span>
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

            {/* El formulario CAMBIA según el tipo — no es un placeholder. Las horas se
                guardan y se muestran en 24 h: 14:00, 02:00. Nunca a.m./p.m. */}
            {regla === 'unico' && (
              <div className="sal-fields">
                {/* El `<input type="time">` lo pinta el NAVEGADOR y con `es-CR` muestra el
                    reloj de 12 h («04:00 p. m.»). El valor que viaja y se guarda es 24 h
                    igual; el eco de al lado es para que lo que se LEE sea lo que se guarda. */}
                <div className="field">
                  <label>Entra (24 h)</label>
                  <input
                    className="tip-input" type="time" aria-label="Hora de entrada habitual"
                    value={entrada} disabled={saving}
                    onChange={e => setEntrada(e.target.value)}
                  />
                  <span className="sal-24h" title="hora en formato 24 h">{entrada || '—'}</span>
                </div>
                <div className="field">
                  <label>Sale (24 h)</label>
                  <input
                    className="tip-input" type="time" aria-label="Hora de salida habitual"
                    value={salida} disabled={saving}
                    onChange={e => setSalida(e.target.value)}
                  />
                  <span className="sal-24h" title="hora en formato 24 h">{salida || '—'}</span>
                </div>
              </div>
            )}

            {regla === 'cortado' && (
              <p className="sal-note sal-note-warn">
                <span className="sal-note-mk">!</span>
                <span>
                  El turno cortado necesita <strong>cuatro</strong> horas (dos bloques) y
                  hoy <code>employees</code> guarda <strong>una entrada y una salida</strong>{' '}
                  (mig 061). No se puede guardar todavía: le falta una migración aditiva
                  (dos columnas más), que está <strong>propuesta y sin aplicar</strong> —
                  0 migraciones en este pase. Mientras tanto, cargá el bloque principal como{' '}
                  <strong>{TIPO_REGLA_LABEL.unico}</strong> y corregí el otro a mano en{' '}
                  <strong>Horas</strong>.
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
