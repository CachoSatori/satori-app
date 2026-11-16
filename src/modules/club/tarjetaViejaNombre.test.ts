// (16-nov, decisión del dueño) Nombre único «Tarjeta vieja» en todo lo que ve el personal (botón, ficha, Excepciones,
// avisos, reporte, Comparación). Solo textos: los identificadores internos (`tarjeta_manual`, `TARJETA_MANUAL`,
// `club_tarjeta_manual`, `tipo = 'tarjeta'`) y lo guardado en la base no cambian. Y en el PoS, con la tarjeta vieja se
// marca «PROMO CLUB 10 %», como con el cupón.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { aClubError, conNombreTarjetaVieja } from '../../shared/api/club'
import { MARCA_TARJETA_VIEJA } from './Escanear'

const RAIZ = join(__dirname, '..', '..', '..')
/** El código sin comentarios: lo que queda son textos y código (lo que puede llegar a la pantalla). */
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const leer = (r: string) => sinComentarios(readFileSync(join(RAIZ, r), 'utf8'))

describe('Nombre único «Tarjeta vieja»', () => {
  const pantallas = ['src/modules/club/Escanear.tsx', 'src/modules/club/Excepciones.tsx', 'src/modules/club/reporteHtml.ts',
                     'src/modules/club/Comparacion.tsx', 'src/shared/api/club.ts']

  it('ninguna pantalla del Club dice «tarjeta física» (fuera de comentarios y del traductor de avisos)', () => {
    for (const p of pantallas) {
      const t = leer(p).replace(/export const conNombreTarjetaVieja[\s\S]*?\n\n/, '')
      expect(t, p).not.toMatch(/tarjeta f[ií]sica/i)
    }
  })

  it('Excepciones y el reporte llaman «Tarjeta vieja» a TARJETA_MANUAL (el tipo interno no cambia)', () => {
    expect(leer('src/modules/club/Excepciones.tsx')).toMatch(/TARJETA_MANUAL:\s*\{ titulo: 'Tarjeta vieja'/)
    expect(leer('src/modules/club/reporteHtml.ts')).toMatch(/TARJETA_MANUAL: 'Tarjeta vieja \(piloto\)'/)
  })

  it('Escanear: botón de entrada, botón de la ficha y aviso de éxito dicen «Tarjeta vieja»', () => {
    const e = leer('src/modules/club/Escanear.tsx')
    expect(e).toMatch(/onClick=\{abrirTarjetaVieja\}>Tarjeta vieja<\/Btn>/)
    expect(e).toMatch(/setModo\('tarjeta'\)\} style=\{\{ flex: 1 \}\}>Tarjeta vieja<\/Btn>/)
    expect(e).toMatch(/`Tarjeta vieja: \+\$\{n\}/)
    expect(e).toMatch(/`Tarjeta vieja: \+\$\{p\.personas\}/)
    expect(e).toMatch(/'La tarjeta vieja está apagada en este local/)
    // los identificadores internos siguen igual
    expect(e).toMatch(/tarjeta_manual_activa/)
    expect(e).toMatch(/tarjetaManual\(/)
  })

  it('los avisos del servidor que dicen «tarjeta física» se muestran con «tarjeta vieja» (sin tocar la base)', () => {
    expect(aClubError(new Error('La tarjeta física está desactivada en este local: registrá la visita con el cupón del turista')).message)
      .toBe('La tarjeta vieja está desactivada en este local: registrá la visita con el cupón del turista')
    expect(aClubError({ message: 'Supera el tope diario de tarjeta física (20 personas por miembro): cargá el resto mañana o avisale al manager' }).message)
      .toBe('Supera el tope diario de tarjeta vieja (20 personas por miembro): cargá el resto mañana o avisale al manager')
    expect(conNombreTarjetaVieja('Tarjeta fisica y TARJETA FÍSICA')).toBe('Tarjeta vieja y TARJETA VIEJA')
    expect(conNombreTarjetaVieja('Cupón no válido')).toBe('Cupón no válido')
  })

  it('con la tarjeta vieja se marca «PROMO CLUB 10 %» en el PoS (igual que el cupón)', () => {
    expect(MARCA_TARJETA_VIEJA).toBe('«PROMO CLUB 10 %»')
  })

  it('guía rápida de caja y cartel: «Tarjeta vieja», «PROMO CLUB 10 %», sin «a confirmar» ni montos de ejemplo', () => {
    const guia = readFileSync(join(RAIZ, 'docs/club-satori/piloto/guia-rapida-caja.html'), 'utf8')
    const cartel = readFileSync(join(RAIZ, 'docs/club-satori/piloto/cartel-caja-tarjeta-vieja.html'), 'utf8')
    for (const [n, t] of [['guía', guia], ['cartel', cartel]] as const) {
      expect(t, n).not.toMatch(/tarjeta f[ií]sica/i)
      expect(t, n).not.toMatch(/a confirmar/i)
      expect(t, n).not.toMatch(/Tarjeta vieja \(sin QR\)/)
      // los únicos ₡ son el del artículo marcador (₡0) y el rótulo «₡total» del pedido: ningún monto de ejemplo
      expect(t.match(/₡[0-9][0-9.,]*/g)?.filter(m => m !== '₡0') ?? [], n).toEqual([])
    }
    const fila = guia.slice(guia.indexOf('<tr><td><b>Tarjeta vieja</b>'), guia.indexOf('</tr>', guia.indexOf('<tr><td><b>Tarjeta vieja</b>')))
    expect(fila).toMatch(/«PROMO CLUB 10 %»/)
    expect(cartel).toMatch(/«PROMO CLUB 10 %»/)
    expect(cartel).toMatch(/<h1>Tarjeta vieja<\/h1>/)
  })
})
