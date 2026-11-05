# Club Satori

Módulo propio de la app que reemplaza la página externa de créditos (Firebase `creditos-73bac`): une referentes y créditos, concierges PM y, más adelante, el Local Club con pases de Wallet.

**Fase actual:** F0 ✅ en prod (05/11, migs 072 y 073). **F1a ✅ en staging** (05/11): esquema, RLS y funciones en la **mig 075** (`supabase/migrations/075_club_satori_esquema.sql`), solo staging; el PR **no se mergea hasta el piloto** (Branching la aplicaría en prod). Pruebas: `scripts/sql/075_pruebas_staging.sql` (48/48) · rollback: `scripts/sql/075_rollback.sql` (probado). Ajustes del 05/11: personas para el próximo **medio** crédito (múltiplo de 3); factura obligatoria y normalizada (sin espacios, en mayúsculas) en cupón y canje; tope de créditos canjeados por día (hora CR) = `max_creditos_por_visita`. Sigue F1b (migración desde Firestore) y F1c (pantallas de staff).

**F1c ✅ en staging** (05/11): funciones de staff en la misma 075 (alta y edición de miembros y negocios, búsqueda sin contactos, tarjeta manual, `club_resolver`, regenerar QR, historial de `club_config`, `REFERENTE_INACTIVO`; la caja ya no lee `token_portal`), 77/77 pruebas. Front en `src/modules/club` (ruta `/club`: Escanear, Miembros, Negocios), en una rama apilada sobre la de la F1a; no se mergea a `main`. Formato de los QR: `src/modules/club/qrFormato.ts` (`/r/{8}`, `/c/{10}`, `/p/{token}`). Falta el recorrido real con usuarios de staging. Para la F1d: tope por IP en `club_cupon_crear`.

- [SPEC.md](SPEC.md) — el spec: objetivo, fases F0–F3, flujos, modelo de datos, pantallas, seguridad y migración.
- [PERFIL-SISTEMA-ACTUAL.md](PERFIL-SISTEMA-ACTUAL.md) — relevamiento de solo lectura del sistema actual (bot de Grok, 05-nov). Sin datos de contacto.

Backlog → [PROMPT-CONTINUACION.md](../../PROMPT-CONTINUACION.md) («🟧 Después») · Fases → [ROADMAP.md](../../ROADMAP.md).

**F1f ✅ en staging** (05/11): en `/club` se sumaron **Excepciones** y **Reportes** (owner y manager), con un contador de excepciones abiertas en la tarjeta Club del inicio.
- **SQL, en la 075:**
  - `club_excepciones`: `REGISTRO_SIN_FACTURA` es exacta; `CREDITOS_SIN_CANJE` y `CANJE_MONTO_DISTINTO` son probables, porque se infieren del `cxc` en múltiplos de medio crédito; `PROMO_SIN_CUPON` se enciende sola cuando se carga `club_config.promo_articulo_codigo`.
  - `club_excepcion_resolver` y `club_reporte_mes`.
- **Pruebas:** 100/100.
- **PDF:** sigue el [estándar de reportes](ESTANDAR-reportes.md), con 3 páginas A4, fuentes incrustadas y un anexo CSV.
- **Factura:** se compara solo por dígitos y sin ceros a la izquierda. Falta confirmar qué número ve el cajero.

