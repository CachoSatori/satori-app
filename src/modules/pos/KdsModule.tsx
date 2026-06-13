import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRealtimeRefetch } from '../../shared/hooks/useRealtimeRefetch'
import {
  getLocations, getKdsTickets, getKdsSettings, getAllProducts, bumpItem, bumpTicket,
} from '../../shared/api/pos'
import type { PosLocation, KdsTicket, KdsSettings, PosOrderItem } from '../../shared/api/pos'
import { timerColor, fmtElapsed, sortForTicket, thresholdFor, isPostre } from '../../shared/utils/kds'
import type { KdsColor } from '../../shared/utils/kds'
import { EmptyState } from './comanderoShared'

const COURSE_LABEL: Record<string, string> = { bebida: '🥤', entrada: '🥢', principal: '🍣' }
const COLOR_BG: Record<KdsColor, string> = { verde: '#1f6f3f', ambar: '#9a6b00', rojo: '#9a1f1f' }
const COLOR_BORDER: Record<KdsColor, string> = { verde: '#2a7a6a', ambar: '#d49a00', rojo: '#e23b22' }

/** PoS F3 — KDS web para las TVs/tablet de barra. Comandas en vivo por Realtime,
 *  ítems ordenados por categoría (orden de Admin), timer verde→rojo por curso,
 *  vistas salón/delivery separadas, bump (✓ listo) → la comanda desaparece. */
export default function KdsModule() {
  const navigate = useNavigate()
  const [locations, setLocations] = useState<PosLocation[]>([])
  const [loc, setLoc] = useState('santa-teresa')
  const [tickets, setTickets] = useState<KdsTicket[]>([])
  const [settings, setSettings] = useState<KdsSettings>({ location_id: 'santa-teresa', category_order: [], course_thresholds: { bebida: 300, entrada: 600, principal: 900 }, subcategory_order: [], postres_priority: true, postres_threshold: 240 })
  const [tipos, setTipos] = useState<Map<string, string>>(new Map())
  const [view, setView] = useState<'salon' | 'delivery'>('salon')
  // Estación de ESTA pantalla: cocina solo recibe comida; barra solo bebida (refinamiento 06-12)
  const [station, setStation] = useState<'cocina' | 'barra'>('cocina')
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([getKdsTickets(loc), getKdsSettings(loc)])
      setTickets(t); setSettings(s)
    } catch (e) { setError(e instanceof Error ? e.message : 'Error cargando KDS') }
  }, [loc])

  useEffect(() => {
    getLocations().then(setLocations).catch(() => { /* selector default */ })
    getAllProducts().then(ps => setTipos(new Map(ps.map(p => [p.nombre, p.tipo])))).catch(() => { /* sin tipos: orden por nombre */ })
    load()
  }, [load])
  useRealtimeRefetch('rt-kds', ['pos_orders', 'pos_order_items'], load)
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id) }, [])

  const channels = view === 'salon' ? ['salon', 'barra'] : ['delivery']
  // Ruteo por estación: filtra los ÍTEMS de cada comanda; nada cruzado llega acá.
  // Compatibilidad: ítems viejos sin snapshot ('cocina' default) caen en cocina.
  const shown = useMemo(() => tickets
    .filter(t => channels.includes(t.order.channel))
    .map(t => ({ ...t, items: t.items.filter(it => (it.station ?? 'cocina') === station) }))
    .filter(t => t.items.length > 0), [tickets, view, station]) // eslint-disable-line react-hooks/exhaustive-deps

  const elapsed = (it: PosOrderItem) => it.marched_at ? Math.floor((now - new Date(it.marched_at).getTime()) / 1000) : 0
  const colorOf = (it: PosOrderItem): KdsColor =>
    timerColor(elapsed(it), thresholdFor(it.course, it.subcategory ?? '', settings.course_thresholds, settings.postres_threshold ?? 240))
  const worstColor = (items: PosOrderItem[]): KdsColor => {
    const rank: KdsColor[] = ['verde', 'ambar', 'rojo']
    return items.reduce<KdsColor>((w, it) => rank.indexOf(colorOf(it)) > rank.indexOf(w) ? colorOf(it) : w, 'verde')
  }

  const onBump = (id: string) => bumpItem(id, true).then(load).catch(e => setError(e.message))
  const onBumpTicket = (orderId: string) => bumpTicket(orderId).then(load).catch(e => setError(e.message))

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', color: '#f0ead8' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 1rem', borderBottom: '1px solid #333' }}>
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem', color: '#c8a96e' }}>厨</span>
        <h1 style={{ fontSize: '1.1rem', margin: 0 }}>KDS · {station === 'cocina' ? 'Cocina' : 'Barra'}</h1>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['cocina', 'barra'] as const).map(st => (
            <button key={st} onClick={() => setStation(st)}
              style={{ padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem',
                border: '1px solid #444', background: station === st ? '#2a7a6a' : 'transparent', color: station === st ? '#fff' : '#7fb8a8' }}>
              {st === 'cocina' ? '🔪 Cocina' : '🍸 Barra'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: '0.5rem' }}>
          {(['salon', 'delivery'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: '6px 16px', borderRadius: 4, cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                border: '1px solid #444', background: view === v ? '#c8a96e' : 'transparent', color: view === v ? '#0d0d0d' : '#c8a96e' }}>
              {v === 'salon' ? 'Salón / Barra' : 'Delivery'}
            </button>
          ))}
        </div>
        <select value={loc} onChange={e => setLoc(e.target.value)}
          style={{ background: '#1a1a1a', color: '#f0ead8', border: '1px solid #444', borderRadius: 4, padding: '5px 8px', marginLeft: '0.5rem' }}>
          {(locations.length ? locations : [{ id: loc, name: loc, is_active: true }]).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#888' }}>{shown.length} comanda{shown.length === 1 ? '' : 's'} · en vivo</span>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: '1px solid #333', color: '#c8a96e', borderRadius: 3, padding: '4px 12px', cursor: 'pointer' }}>← Inicio</button>
      </header>
      {error && <div style={{ color: '#e23b22', padding: '0.5rem 1rem', fontSize: '0.85rem' }} onClick={() => setError(null)}>⚠ {error} (tocá para cerrar)</div>}

      {shown.length === 0 && (
        <EmptyState tone="dark" icon={station === 'cocina' ? '🔪' : '🍸'}
          title={`Cocina al día — sin comandas en ${view === 'salon' ? 'salón/barra' : 'delivery'}`}
          hint="Marchá un pedido desde el comandero y aparece acá al instante." />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.75rem', padding: '0.75rem' }}>
        {shown.map(({ order, items }) => {
          const ordered = sortForTicket(items, settings.subcategory_order ?? [], settings.postres_priority ?? true,
            it => it.subcategory ?? '', it => tipos.get(it.product_name) ?? '')
          const wc = worstColor(items)
          const oldest = items.reduce((m, it) => Math.max(m, elapsed(it)), 0)
          return (
            <div key={order.id} style={{ border: `2px solid ${COLOR_BORDER[wc]}`, borderRadius: 8, background: '#161616', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ background: COLOR_BG[wc], padding: '0.4rem 0.6rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <strong style={{ fontSize: '1rem' }}>{order.table_name}</strong>
                <span style={{ fontSize: '0.7rem', opacity: 0.85 }}>{order.channel} · {order.pax}p · {order.salonero_name}</span>
                <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: '1.05rem' }}>{fmtElapsed(oldest)}</span>
              </div>
              <div style={{ padding: '0.4rem 0.6rem', flex: 1 }}>
                {ordered.map(it => {
                  const c = colorOf(it)
                  return (
                    <div key={it.id} onClick={() => onBump(it.id)}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '5px 0', borderBottom: '1px solid #262626', cursor: 'pointer' }}>
                      <span style={{ fontSize: '0.8rem' }}>{isPostre(it.subcategory ?? '') ? '🍰' : (COURSE_LABEL[it.course] ?? '·')}</span>
                      <span style={{ flex: 1, fontSize: '0.92rem' }}>
                        {it.qty > 1 && <strong>{it.qty}× </strong>}{isPostre(it.subcategory ?? '')
                          ? <strong style={{ color: '#f2c14e' }}>{it.product_name} · POSTRE ⚡</strong> : it.product_name}
                        {it.modifiers.length > 0 && <span style={{ color: '#c8a96e', fontSize: '0.78rem' }}> · {it.modifiers.map(m => m.name).join(', ')}</span>}
                        <span style={{ color: '#777', fontSize: '0.72rem' }}> · as.{it.seat}</span>
                        {it.note ? <span style={{ color: '#f2c14e', fontSize: '0.8rem', display: 'block' }}>📝 {it.note}</span> : null}
                      </span>
                      <span style={{ fontSize: '0.68rem', fontVariantNumeric: 'tabular-nums', color: COLOR_BORDER[c] }}>{fmtElapsed(elapsed(it))}</span>
                      <span style={{ fontSize: '0.85rem', color: '#2a7a6a' }}>✓</span>
                    </div>
                  )
                })}
              </div>
              <button onClick={() => onBumpTicket(order.id)}
                style={{ border: 'none', background: '#2a7a6a', color: '#fff', padding: '0.55rem', fontWeight: 800, cursor: 'pointer', fontSize: '0.9rem' }}>
                ✓ Listo toda la comanda
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
