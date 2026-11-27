/**
 * AvisoProvisorio — fase 0 de la spec de compras/stock/costos (decisión P4 del dueño, 27-nov; §11 y §12.2).
 * Las pantallas que hoy muestran un stock sin base real (Stock, Consumo, pedido sugerido del Dashboard y la entrada
 * a stock de la Revisión) llevan esta etiqueta hasta F3-mín y F4. Solo presentación: no oculta ni cambia nada.
 * Mismo estilo que el aviso dorado de Consumo («Esta fecha ya tiene consumo registrado…»).
 */
export const PROVISORIO_TITULO = 'Provisorio · no usar para decidir'
export const PROVISORIO_DETALLE = 'Los números de stock se rehacen desde cero con las facturas electrónicas y los conteos.'

export default function AvisoProvisorio({ compacto = false }: { compacto?: boolean }) {
  return (
    <div role="note" aria-label={PROVISORIO_TITULO}
      style={{ fontSize: compacto ? '0.72rem' : '0.78rem', color: 'var(--c-oro-texto)', background: 'var(--c-oro-fondo)',
        border: '1px solid var(--c-oro)', borderRadius: 2, padding: compacto ? '0.35rem 0.65rem' : '0.5rem 0.75rem',
        marginBottom: '0.75rem' }}>
      <div style={{ fontWeight: 700 }}>⚠ {PROVISORIO_TITULO}</div>
      <div style={{ color: 'var(--c-tinta)', marginTop: 2 }}>{PROVISORIO_DETALLE}</div>
    </div>
  )
}
