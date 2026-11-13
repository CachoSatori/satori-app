-- 152 (origen 101) · Aviso de privacidad del Club v1.2 (12-nov, pedido del dueño; se aplica solo con su firma): el texto en español pasa de «vos» a «usted».
-- Mismo sentido; el inglés no cambia. La huella del texto completo (club-web/src/i18n.ts → alta_aviso, UTF-8) se registra
-- igual que la v1.1 (migración 150, B8). Quien aceptó v1.1 queda con v1.1 en su fila: esto no toca a los socios ni a los
-- contactos, solo la versión que se pide aceptar desde ahora.
-- ⚠️ Orden: club-web manda `acepto: 'v1.2'` y la base rechaza un alta con otra versión. Esta migración y el deploy de
-- club-web tienen que entrar juntos (o con el local apagado). Va directo al bloque de pase: el ledger de staging y el de prod ya están en 151.

insert into public.club_avisos_privacidad (version, sha256_es, sha256_en) values
  ('v1.2', '661a25dd310346231d49429c7bf216c3bc84d5670bd107d35ae638028a607df7', '748b783881f21370e3238517996a2a47780b0c7a18c597ecc7528a56018fddf7')
on conflict (version) do nothing;

alter table public.club_config alter column aviso_privacidad_version set default 'v1.2';
-- El historial de club_config (club_config_auditar) deja una fila por local con el cambio de versión.
update public.club_config set aviso_privacidad_version = 'v1.2' where aviso_privacidad_version = 'v1.1';
