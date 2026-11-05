# Club Satori

Módulo propio de la app que reemplaza la página externa de créditos (Firebase `creditos-73bac`): une referentes y créditos, concierges PM y, más adelante, el Local Club con pases de Wallet.

**Fase actual:** F0 ✅ en prod (05/11, migs 072 y 073). **F1a ✅ en staging** (05/11): esquema, RLS y funciones en la **mig 075** (`supabase/migrations/075_club_satori_esquema.sql`), solo staging; el PR **no se mergea hasta el piloto** (Branching la aplicaría en prod). Pruebas: `scripts/sql/075_pruebas_staging.sql` (48/48) · rollback: `scripts/sql/075_rollback.sql` (probado). Ajustes del 05/11: personas para el próximo **medio** crédito (múltiplo de 3); factura obligatoria y normalizada (sin espacios, en mayúsculas) en cupón y canje; tope de créditos canjeados por día (hora CR) = `max_creditos_por_visita`. Sigue F1b (migración desde Firestore) y F1c (pantallas de staff).

**Pendiente para la F1c:** alta y edición de miembros y negocios por funciones (hoy no hay escritura directa) · mensaje claro en caja cuando el referente del cupón está dado de baja · historial de `club_config` (trigger de auditoría: quién, cuándo, valor anterior y nuevo). Para la F1d: tope por IP en `club_cupon_crear`.

- [SPEC.md](SPEC.md) — el spec: objetivo, fases F0–F3, flujos, modelo de datos, pantallas, seguridad y migración.
- [PERFIL-SISTEMA-ACTUAL.md](PERFIL-SISTEMA-ACTUAL.md) — relevamiento de solo lectura del sistema actual (bot de Grok, 05-nov). Sin datos de contacto.

Backlog → [PROMPT-CONTINUACION.md](../../PROMPT-CONTINUACION.md) («🟧 Después») · Fases → [ROADMAP.md](../../ROADMAP.md).

**F1d ✅ en staging** (05/11): las páginas públicas `/r/`, `/c/` y `/p/` viven en [`club-web/`](../../club-web/README.md). Es un mini-sitio aparte, con una Pages Function propia y tope por IP, en español e inglés. En la 075 se sumaron `club_cupon_ver` y `club_cupon_contacto` (anon). Pruebas: 85/85. Lighthouse en móvil: 100/100. **Pendiente de Ismael:** crear el proyecto `satori-club` en Cloudflare Pages, cargar las variables y el KV, y apuntar `club.satoricostarica.com`. Los pasos están en el README de `club-web`.

