-- ── 066 · pos_ndf_ticket_lines.usuario_registra — el mesero que comandó CADA línea ───────────
--
-- `FAC_FacturasDet.UsuarioRegistra` del PoS: permite atribuir la venta por LÍNEA (lentes de
-- saloneros) en vez de acreditar la factura entera a quien la abrió. La Edge `ingest-ndf` la
-- inserta (`LineaRow.usuario_registra`) y la app la lee (`getLineasDeTickets`): sin la columna,
-- la ingesta y la lectura de líneas fallan.
--
-- En STAGING esta columna se creó A MANO (commit 1778d0a: "la columna ya la creó el dueño en
-- staging"), sin archivo de migración. Esta es su repo-truth, para que prod la tenga por el
-- camino normal. Idempotente: en staging es un no-op.
--
-- SOLO ESQUEMA: una columna nullable, sin default, sin datos. `null` = el PoS no trajo usuario
-- (histórico) o la instalación no tiene la columna.

alter table public.pos_ndf_ticket_lines
  add column if not exists usuario_registra text;

comment on column public.pos_ndf_ticket_lines.usuario_registra is
  'FAC_FacturasDet.UsuarioRegistra: login del PoS que comando ESTA linea (p. ej. 026). Atribucion por linea de las lentes de saloneros. null = sin dato.';
