import { useState, useMemo } from 'react'
import type { Employee } from '../../shared/types/database'
import { departamentoDe, puestoDe } from '../../shared/api/salarios'
import { fi } from '../../shared/utils'
import { iniciales } from './salariosUi'

// Salarios · pestaña LIQUIDACIONES (SPEC-UI v3 §7) — CASCARÓN A PROPÓSITO.
//
// Qué hace: arma el desglose de una salida (preaviso, cesantía, vacaciones y aguinaldo
// proporcionales, días trabajados) y lo suma. Los montos se cargan A MANO.
//
// Qué NO hace, y no es un olvido: NO calcula cesantía ni preaviso. Las reglas de Costa
// Rica dependen del motivo (renuncia vs despido con o sin causa), de la antigüedad y de
// topes que cambian; inventarlas acá sería poner un número con cara de oficial en la
// plata de alguien que se va. Van con su SPEC firmado por el contador.
//
// Sin tabla: no hay `liquidaciones` en el esquema (ver el DDL aditivo propuesto en el
// reporte). Este borrador vive en la pantalla y se pierde al salir — está dicho abajo.

interface Props { employees: Employee[] }

interface Concepto { key: string; label: string; nota?: string }

const CONCEPTOS: Concepto[] = [
  { key: 'preaviso',   label: 'Preaviso',                    nota: '₡0 si avisó' },
  { key: 'cesantia',   label: 'Cesantía',                    nota: 'según el motivo' },
  { key: 'vacaciones', label: 'Vacaciones proporcionales' },
  { key: 'aguinaldo',  label: 'Aguinaldo proporcional' },
  { key: 'dias',       label: 'Días trabajados del período' },
]

const MOTIVOS = ['Renuncia', 'Despido con responsabilidad', 'Despido sin responsabilidad', 'Fin de contrato']

function num(s: string): number {
  const n = Number((s ?? '').replace(/[^\d.-]/g, ''))
  return isNaN(n) ? 0 : n
}

export default function SalariosLiquidaciones({ employees }: Props) {
  const [empId, setEmpId]     = useState('')
  const [motivo, setMotivo]   = useState(MOTIVOS[0])
  const [ultimo, setUltimo]   = useState('')
  const [montos, setMontos]   = useState<Record<string, string>>({})

  const activos = useMemo(() => employees.filter(e => e.is_active), [employees])
  const emp     = activos.find(e => e.id === empId) ?? null
  const total   = CONCEPTOS.reduce((s, c) => s + num(montos[c.key] ?? ''), 0)

  return (
    <div className="admin-section">
      <div className="sal-phead">
        <div>
          <div className="sal-eyebrow">Salida de un empleado</div>
          <h2>Liquidaciones</h2>
          <p>
            Cuando alguien se va, su liquidación se arma acá, entra al <strong>costo
            laboral</strong> y queda en el <strong>historial</strong> — no escondida
            dentro de las horas.
          </p>
        </div>
      </div>

      <p className="sal-note sal-note-warn">
        <span className="sal-note-mk">!</span>
        <span>
          <strong>Fórmulas CR pendientes del contador.</strong> Cesantía y preaviso
          dependen del motivo (renuncia vs despido con o sin causa), de la antigüedad y de
          topes que cambian. Acá los montos se cargan <strong>a mano</strong>: la pantalla
          suma y deja el desglose, no calcula. Y todavía <strong>no se guarda</strong> —
          no hay tabla de liquidaciones en el esquema—, así que este borrador se pierde al
          cambiar de pestaña.
        </span>
      </p>

      <div className="sal-card">
        <p className="sal-mini-hd">Quién y por qué</p>
        <div className="sal-bar">
          <span className="sal-bar-label">Empleado</span>
          <select
            className="tip-input"
            aria-label="Empleado a liquidar"
            value={empId}
            onChange={e => setEmpId(e.target.value)}
          >
            <option value="">— elegir —</option>
            {activos.map(e => (
              <option key={e.id} value={e.id}>{e.full_name}</option>
            ))}
          </select>
          <span className="sal-bar-label">Motivo</span>
          <select
            className="tip-input"
            aria-label="Motivo de la salida"
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
          >
            {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <span className="sal-bar-label">Último día</span>
          <input
            className="tip-input"
            type="date"
            aria-label="Último día trabajado"
            value={ultimo}
            onChange={e => setUltimo(e.target.value)}
          />
        </div>

        {emp && (
          <div className="sal-who" style={{ marginTop: '0.75rem' }}>
            <span className="sal-ini">{iniciales(emp.full_name)}</span>
            <div>
              <div className="sal-name">{emp.full_name}</div>
              <div className="sal-name-meta">
                {departamentoDe(emp.role)} · {puestoDe(emp.role)}
                {emp.fecha_ingreso ? ` · ingresó ${emp.fecha_ingreso}` : ' · sin fecha de ingreso cargada'}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="sal-costbox">
        <div className="sal-costbox-head">
          <span className="sal-note-mk" style={{ color: 'var(--sal-teal)' }}>▦</span>
          <b>Desglose</b>
          <span className="sal-spacer" />
          <span className="sal-pill is-plain">borrador · no se guarda</span>
        </div>
        {CONCEPTOS.map(c => (
          <div className="sal-costrow" key={c.key}>
            <span className="sal-costrow-l">
              {c.label}
              {c.nota && <span className="sal-pill is-plain" style={{ fontSize: '11px' }}>{c.nota}</span>}
            </span>
            <span className="sal-costrow-r">
              <input
                className="tip-input is-num"
                inputMode="numeric"
                style={{ width: 120, textAlign: 'right' }}
                aria-label={`Monto de ${c.label}`}
                value={montos[c.key] ?? ''}
                placeholder="0"
                disabled={!emp}
                onChange={e => setMontos(m => ({ ...m, [c.key]: e.target.value }))}
              />
            </span>
          </div>
        ))}
        <div className="sal-costrow is-total">
          <span className="sal-costrow-l">Total liquidación</span>
          <span className="sal-costrow-r">{fi(total)}</span>
        </div>
      </div>

      <p className="sal-legend" style={{ padding: '0 12px' }}>
        Cuando el SPEC de liquidación CR esté firmado, esta pantalla calcula en vez de
        pedir: la fecha de ingreso y el motivo ya están acá, que es lo que esas fórmulas
        necesitan. Hasta entonces el número lo pone quien lo puede sostener.
      </p>
    </div>
  )
}
