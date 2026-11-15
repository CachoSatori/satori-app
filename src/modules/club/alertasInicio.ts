/**
 * 164 (SPEC-club-v2 ítem 10, B6): textos del bloque «Club · Para revisar hoy» del Inicio (owner y manager).
 * Cada aviso se entiende solo (qué pasó, cuánto, con qué umbral y dónde se revisa) y lleva a la pantalla donde se revisa.
 * Lo calcula `club_alertas_inicio` (solo devuelve lo que pasó el umbral del local); acá solo se arma el texto.
 * Pantallas del personal: voseo, como el resto de la app.
 */
import type { AlertaInicio } from '../../shared/api/club'

export interface AvisoClub {
  id: string
  /** Lo que pasó, en una línea. */
  titulo: string
  /** Por qué importa y qué hacer, en una línea. */
  texto: string
  /** La píldora: el número clave. */
  estado: string
  /** La pantalla donde se revisa. */
  path: string
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const nombre = (s: string | undefined) => (s && s.trim() ? s.trim() : 'Sin nombre')

/** Ruta del Club con la pestaña (y, si hace falta, la ficha o el tipo de excepción) ya elegidos. */
export function rutaClub(vista: 'miembros' | 'reportes' | 'excepciones', extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ vista, ...extra })
  return `/club?${q.toString()}`
}

/** Con más de un local encendido, cada aviso dice de qué local es y su link elige ese local en el Club. */
export function avisoClub(a: AlertaInicio): AvisoClub {
  const d = a.detalle ?? {}
  const v = avisoSinLocal(a)
  if (!d.local) return v
  const q = new URLSearchParams(v.path.split('?')[1] ?? '')
  q.set('local', d.local)
  return {
    ...v,
    titulo: d.multilocal ? `${nombre(d.local_nombre ?? d.local)} · ${v.titulo}` : v.titulo,
    path: `/club?${q.toString()}`,
  }
}

function avisoSinLocal(a: AlertaInicio): AvisoClub {
  const d = a.detalle ?? {}
  switch (a.tipo) {
    case 'ANFITRION_24H': {
      const quien = `${nombre(d.miembro)}${d.tipo_miembro === 'equipo' ? ' (equipo)' : ''}`
      return {
        id: a.ref,
        titulo: `${quien} sumó ${plural(a.cantidad, 'visita', 'visitas')} con cupón o tarjeta en 24 horas`,
        texto: `Es más de lo normal (el aviso salta con más de ${a.umbral}). Abrí su ficha y revisá que cada mesa haya venido de verdad.`,
        estado: `${a.cantidad} en 24 h`,
        path: d.miembro_id ? rutaClub('miembros', { miembro: d.miembro_id }) : rutaClub('miembros'),
      }
    }
    case 'MISMO_USUARIO': {
      const dias = d.dias ?? 0
      const usuario = nombre(d.usuario)
      if (d.que === 'equipo') {
        return {
          id: a.ref,
          titulo: `${usuario} cargó ${plural(a.cantidad, 'tarjeta', 'tarjetas')} de ${nombre(d.miembro)} (equipo) en ${plural(dias, 'día', 'días')}`,
          texto: `El aviso salta con más de ${a.umbral}: el ranking del equipo premia desempeño. Abrí su ficha y revisá cada tarjeta con su factura.`,
          estado: `${a.cantidad} veces`,
          path: d.miembro_id ? rutaClub('miembros', { miembro: d.miembro_id }) : rutaClub('miembros'),
        }
      }
      return {
        id: a.ref,
        titulo: `${usuario} registró al socio ${nombre(d.miembro)} ${plural(a.cantidad, 'vez', 'veces')} en ${plural(dias, 'día', 'días')}`,
        texto: `El aviso salta con más de ${a.umbral}. En Reportes → «Visitas de socios por usuario», revisá que cada visita tenga su factura.`,
        estado: `${a.cantidad} veces`,
        path: rutaClub('reportes'),
      }
    }
    case 'VISITAS_SIN_FACTURA':
      return {
        id: a.ref,
        titulo: `${plural(a.cantidad, 'visita', 'visitas')} de socio sin factura (ayer y hoy)`,
        texto: 'Cada visita del socio tiene que cruzar con una factura del PoS. Revisalas en Reportes → «Visitas de socios por usuario», columna «Sin factura».',
        estado: plural(a.cantidad, 'visita', 'visitas'),
        path: rutaClub('reportes'),
      }
    case 'CANJE_SIN_CODIGO':
      return {
        id: a.ref,
        titulo: `${plural(a.cantidad, 'canje', 'canjes')} sin código sin resolver`,
        texto: 'Canjes aprobados sin el celular del socio (últimos 30 días). Revisalos y resolvelos con nota en Excepciones; los tuyos los resuelve otra persona.',
        estado: plural(a.cantidad, 'canje', 'canjes'),
        path: rutaClub('excepciones', { tipo: 'CANJE_SIN_CODIGO' }),
      }
    default:
      return { id: String((a as { ref?: string }).ref ?? 'otro'), titulo: 'Aviso del Club', texto: 'Revisalo en el Club.', estado: '', path: '/club' }
  }
}

/** Canjes sin código que ya muestra el bloque del Club, del mismo local que cuenta «excepciones abiertas»: el elegido
 *  en el Club o, sin elegir, el único encendido (con dos o más sin elegir esa lectura falla y no hay nada que descontar). */
export function canjesEnBloque(alertas: AlertaInicio[] | 'fallo' | null, local: string | null): number {
  if (!Array.isArray(alertas)) return 0
  return alertas.filter(a => a.tipo === 'CANJE_SIN_CODIGO' && (local === null || a.detalle?.local === local))
    .reduce((t, a) => t + a.cantidad, 0)
}
