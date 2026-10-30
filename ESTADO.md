# Satori App — Estado del proyecto

## ⚡ ARRANQUE — foto real del repo y de las bases (se REEMPLAZA en cada entrega, no se acumula)
**Al día: 2026-10-30.** Cada dato de este bloque se verificó contra `origin` y contra las dos bases
(Management API, solo lectura) el mismo día. Lo de julio (pozo único, ramas viejas, ledger de 39 filas)
está archivado en [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md), no borrado.

> **Regla (Definition of Done):** ninguna entrega se cierra sin actualizar este bloque ⚡ARRANQUE, en el
> mismo commit. **El repo manda:** si este archivo y la realidad no coinciden, gana la realidad y se
> corrige el archivo.

| Puntero | Hash | Qué es |
|---|---|---|
| `main` | **`43e843d`** | **PROD.** GitHub Pages (base `/satori-app/`). Run de Pages #247 sobre `43e843d`: build OK 17:42 UTC, deploy OK 17:55 UTC del 30/10. |
| `staging` | **`a4b11ae`** | Desarrollo: `main` + PoS propio + Salarios/BioTime + FE SIM + inventario COGS. Proyecto Supabase de staging. |
| `integracion/analitica-staging` | **`a54d6ec`** | ⚠️ **4 commits atrás de `staging`** (FF posible). Según el ESTADO de septiembre, Cloudflare Pages publica `satori-staging.pages.dev` desde esta rama; lo de `staging` sale como deploy de *preview*. Alinear con OK. |
| `feat/pos-desglose` | **`14bd278`** | Rama del **agente** del PoS (`pos-bridge/`). No se mergea a `main`. |

**Merges a `main` de octubre (todos merge commit):**

| PR | Merge | Fecha | Qué entró |
|---|---|---|---|
| #13 | **`9ada841`** | 29/10 | Espejo del PoS a prod, solo ventas, con `FUENTE_VENTAS='xls'`. Migs 062–066 ya estaban en el ledger de prod. Sin `supabase/functions/`. |
| #14 | **`c7b2f4b`** | 29/10 | Modo `'xls'` sin regresión (cajas de turno) · Paridad · Mi Rendimiento «Ver como» (solo owner) · fix PECHE. |
| #15 | **`ba23a24`** | 30/10 | ICP = propina electrónica declarada · Mi Rendimiento sigue `FUENTE_VENTAS` · **mig 067** (lectura del PoS por funciones, sin medios de pago) · franja de aviso. |
| #16 | **`43e843d`** | 30/10 | **`FUENTE_VENTAS = 'pos'`** (una línea). |

- **`FUENTE_VENTAS = 'pos'` en prod desde el 30/10, validado físicamente por Ismael.** Ventas y Mi Rendimiento
  leen el PoS fusionado con el Excel de respaldo (`{...xls, ...pos}`). Volver atrás = revert del merge de #16.
- **Sagrados (hash de blob):** `tipCalculations.ts` **`7603ba5a`** · `cashUtils.ts` **`b597c697`** (iguales en
  `main` y `staging`) · `posFiscal.ts` **`a3fd445f`** (solo existe en `staging`).
- **Gate de `main`:** `tsc -b` 0 · `vite build` (production) OK · **1293 tests** (con env dummy) · lint de lo tocado.
- **Refs Supabase:** **PROD = `yiczgdtirrkdvohdquzf`** (`satori-app`) · **STAGING = `hwiatgicyyqyezqwldia`** (`satori-staging`).

Documentos: fases → [ROADMAP.md](ROADMAP.md) · backlog → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) ·
hallazgos → [HALLAZGOS.md](HALLAZGOS.md) · historial → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) ·
pozo de caja → [PASE-POZO-A-PROD.md](PASE-POZO-A-PROD.md) · índice de SPECs → [docs/README.md](docs/README.md).

---

## 🛑 Reglas operativas (leer antes de tocar `main` o una base)

1. **Supabase Branching corre `migrate` contra PROD en cada push a `main`.** La integración de GitHub está atada
   a `main` (una sola rama, `main`, sin previews). El log del run lo dice explícito
   (`Connecting to database... All migrations are up to date.`). **Por eso las migraciones se aplican a mano en
   prod ANTES del merge** (Management API, una transacción con el archivo exacto + su fila en
   `supabase_migrations.schema_migrations`), se verifican, y recién después se mergea: Branching queda sin nada
   que hacer. Así entraron 062–066 y la 067.
2. **Ningún PR a `main` con archivos bajo `supabase/functions/` hasta cerrar el ítem 11** (versionar
   `ingest-ndf` con `config.toml`). Sin `config.toml`, Branching despliega las funciones que cambian con
   `verify_jwt=true`, y el agente del PoS solo manda `x-ingest-secret` → 401 en cada ciclo.
3. **No mergear a `main` entre las 17:00 y las 23:00 CR** (servicio de la noche).
4. **«Ver como» usa los permisos del owner.** Sirve para ver lo que ve otro empleado, no para probar permisos:
   **los permisos se prueban con un usuario real de ese rol** (o simulando su JWT en una transacción
   `read only` + `rollback`).
5. **ICP = propina electrónica declarada (solo la voluntaria del cliente: tarjeta/SINPE) / neta de sus mesas.**
   El 10 % de servicio es un impuesto aparte: **no entra** ni al numerador ni al denominador. Lo cobrado del
   reparto del pool (`payout_crc`) no es ICP. Barra (barman/barback): «no aplica».
6. **La lectura del PoS para cualquier rol va por las funciones de la 067** (`pos_ventas_tickets_rango`,
   `pos_ventas_lineas`, `pos_ventas_latido`), **sin medios de pago ni `clase_ingreso`**. **Las tablas
   `pos_ndf_*` quedan cerradas a gerencia** (`owner/manager/contador`); no se les abre una policy.
   Excepción vigente y legítima: «En vivo» (solo gerencia) todavía lee las tablas directo
   (`getTicketsJornada`, `getTicketsDeJornadas`, `getMesasAbiertas`, `getUltimoPollPoS`,
   `getPedidosCerradosJornada`).
7. **Ritual antes de cualquier comando de base:** confirmar el *ref* del proyecto (`yiczgdti…` = PROD,
   `hwiatgic…` = staging). Nunca correr SQL de escritura sin haber leído el ref.
8. **Sagrados por hash de blob, no por `git diff`** (ver arriba). Nunca reimplementarlos sin acuerdo explícito.
9. **Verificar un deploy por contenido, no por HTTP 200:** el fallback del SPA devuelve `index.html` para
   cualquier ruta.

---

## 🔁 El camino de las ventas: PoS → app

```
PoS «Nube de Fuego» (SQL Server, PC del PoS DESKTOP-25PRDR1)
   │  lee FAC_* (read-only)
   ▼
agente pos-bridge (tarea programada de Windows; dos instancias, una por entorno)
   │  POST + x-ingest-secret
   ▼
Edge Function ingest-ndf (verify_jwt = false; service-role)  ──►  escribe
   ▼
pos_ndf_tickets · pos_ndf_ticket_lines · pos_ndf_open · pos_ndf_cursor   (RLS: solo gerencia; sin policies de escritura)
   │
   ├──► funciones 067 (SECURITY DEFINER, rol chequeado adentro, sin medios de pago)
   │        pos_ventas_tickets_rango · pos_ventas_lineas · pos_ventas_latido
   │        ▼
   │     app: ventasFuente.cargarDias / cargarDiasEager / cargarDeFondo ({...xls, ...pos})
   │          → Ventas (Hoy, Cajeros, Mix, Saloneros, ICP, Histórico…) · Mi Rendimiento · lentes de saloneros
   │          → si el PoS no se puede leer: estadoPos ≠ 'ok' + franja «Mostrando solo el Excel…»
   │
   └──► lectura directa (solo gerencia): «En vivo» (mesas abiertas, jornada, latido del agente)
```

- **Tickets en prod:** 40.549 (2024-01-06 → 2026-10-30). En staging: 40.781.
- **Día del reporte** = fecha CR de `fecha_registra` (el mismo corte que el reporte del PoS). «En vivo» y los
  turnos siguen usando la jornada por lote de cierre.
- **El Excel (`ventas_dias`) quedó como respaldo:** en prod el último día cargado es el **20/10**. La pestaña
  «Cargar XLS» y Paridad siguen vivas hasta que se retiren (backlog).

### Agentes en las PCs

| Agente | PC | Carpeta / versión | Publica a | Latido 30/10 |
|---|---|---|---|---|
| «Satori PoS Bridge» | PoS (`DESKTOP-25PRDR1`) | `C:\satori\satori-app` @ `14bd278` ¹ | staging · `ingest-ndf` v10 | `last_poll_at` 18:13 UTC, `last_error` null |
| «Satori PoS Bridge PROD» | PoS (`DESKTOP-25PRDR1`) | `C:\satori\satori-app-prod` @ `4d3513a` ¹ | **prod** · `ingest-ndf` v1 | `last_poll_at` 18:12 UTC, `last_error` null |
| `biotime-bridge` | PC del reloj (ST) | — | staging · `ingest-punches` v6 | ⚠️ **última sync 14/09 17:12 UTC** (22.969 marcas): parado desde entonces |

¹ Versión según el backlog del 29/10 (no verificable desde fuera de la PC). Las dos tareas del PoS arrancan
solas tras un reinicio (validado el 29/10).

### Edge Functions (Management API, 30/10)

| Función | PROD | STAGING |
|---|---|---|
| `monthly-report` | v9 · `verify_jwt` off | — |
| `extract-document` | v7 · on | v15 · on |
| `cierre-email` | v2 · on | v8 · on |
| `pago-notificar` | v2 · on | — |
| `ingest-ndf` | **v1 · off** (desplegada a mano; su código no está en `main`) | v10 · off |
| `ingest-punches` | — | v6 · off |

---

## 🗃️ Migraciones

| Entorno | Ledger (`schema_migrations`) | Detalle |
|---|---|---|
| **PROD** | **45 filas** | `001–008 · 0090 · 0095 · 010–021 · 038–054 · 062–067`. **055–061 NO están en prod** (Salarios/BioTime, solo staging). La 067 se aplicó a mano el 30/10 antes del merge de #15. |
| **STAGING** | 66 filas | Hasta la 064 + la 067. ⚠️ **Le faltan las filas 065 y 066** aunque sus columnas existen (deuda de ledger, en el backlog). |

- **Próximo número libre: `068`** (ninguna rama tiene un archivo ≥ 068).
- 🚫 Nunca `repair --status reverted` sobre algo aplicado. El CLI ordena archivos por **nombre** y el ledger por
  **versión** (por eso `009` → `0090`). La `026` en prod es una excepción permanente documentada.

**Mig 067 · `pos_ventas_lectura_equipo`** (prod y staging): tres funciones `SECURITY DEFINER`, `search_path=public`,
rol chequeado adentro (`owner, manager, contador, salonero, barman, barback, runner, cocina`), `revoke` a
`public`/`anon`, paginación con orden total adentro. `pos_ventas_tickets_rango` devuelve **17 columnas** (las que
usan `armarDia` y las lentes); nunca medios de pago, vuelto, dólares, cxc, `numero_pedido`, `total_fuente`,
`ingested_at` ni `clase_ingreso`. Verificada en prod (30/10): owner y manager función = tabla fila por fila
(40.538 tickets / 3.476 líneas de octubre, 0 diferencias) · salonero: tabla 0, función 563 tickets de octubre ·
cajero y sin perfil: 0 · `anon`: `permission denied`. El contrato de columnas lo fija
`src/shared/api/posNdf.contrato067.test.ts`.

---

## 🧩 Qué hay en PROD y qué solo en STAGING

Leyenda: ✅ en prod y validado en piso · 🟢 en prod, falta validar en piso · 🧪 solo staging · 🔲 no construido.

| Módulo | Estado |
|---|---|
| **Caja: POZO único + T3 (los 8 ítems)** | ✅ prod |
| Propinas (pool por `covered_role`, `pool_total_crc` fuente única) | ✅ prod |
| Bandeja unificada + Revisión de inventario · autorización por contraseña (045) · elegibilidad de propina (048) | ✅ prod |
| Finanzas/P&L · reportes + emails · admin · auth · realtime · offline | ✅ prod |
| Proveedores A (notificación de pago, mig 047) + B (saldo a favor, migs 053/054) + comprobantes | 🟢 prod, sin validar en piso; el correo sale recién con el DNS de Resend |
| **Ventas desde el PoS** (puente, migs 062–066, `FUENTE_VENTAS='pos'`, Paridad, En vivo, Frente C, lentes por línea) | ✅ prod (30/10) |
| **Mi Rendimiento** (casa del empleado; «Ver como» solo owner; sigue `FUENTE_VENTAS`) | ✅ prod |
| **ICP** (propina electrónica declarada; barra «no aplica»; benchmark único) | ✅ prod (30/10) |
| **Lectura del PoS para el equipo** (mig 067 + franja de aviso) | ✅ prod (30/10); probada con salonero real en staging |
| Salarios F0 (055) · U0a/U0b (056/058) · BioTime F1 (057, `ingest-punches`) | 🧪 staging · BioTime parado desde el 14/09 |
| PoS propio (comandero, KDS, cobro + splits, ticket/FE SIM, inventario COGS; migs 022–037, `posFiscal.ts`) | 🧪 staging · bloqueado por el PILAR de auth |
| PILAR de auth multi-tenant · FE-CR real | 🔲 |

### Seguridad que sigue abierta en prod (medido 30/10)

- **4 funciones `SECURITY DEFINER` ejecutables por `anon`:** `get_my_role`, `handle_new_user`,
  `log_movement_edit` (052) y `unif_on_cash_movement`. Las de la 067 y las de plata no.
- **Sin `supabase/config.toml`:** el `verify_jwt` de las funciones no está versionado.
- **`deploy.yml` no corre `vitest`** antes de publicar a prod.
- **`monthly-report` con `verify_jwt` off.**

---

## 📝 Notas que ahorran una sesión

- **Qué cubre cada fuente de ventas:** `ventas_dias` (detalle diario con saloneros) = enero 2026 → 20/10/2026 en
  prod · `ventas_hist` (reporte general, sin salonero) = 2023–2025 · `pos_ndf_*` = 6-ene-2024 → hoy. 2023 no tiene
  detalle diario en ninguna fuente; sobrevive por `ventas_hist`.
- **El delivery baja ~4-5 % con el PoS y no es un bug:** el Excel llamaba delivery a toda venta sin servicio; el PoS
  usa el canal real.
- **La historia 2024-2025 da −0,057 % contra el Excel** (concentrado en días viejos puntuales, p. ej. 7-mar-2024).
  Ruido para analítica; resolver el drill-down antes de usarlo para algo contable.
- **2024 no tiene salonero** (cobertura 0 %): Saloneros/Evaluación/ICP salen vacíos en 2024. No es regresión.
- **ICP del equipo de octubre:** con el Excel daba 15,7 % (inflado: ventas al 20/10, propinas al 28/10); con el PoS
  da 10,6 %. Los umbrales de la pestaña (≥13 % excelente, <10 % a mejorar) están pendientes de recalibrar.
- **`version.json` desde el navegador lleva al login:** el service worker responde `index.html` a toda navegación
  bajo `/satori-app/` (su denylist solo tiene `/inbox/share`). Con Cmd+Shift+R, `view-source:` o una ventana de
  incógnito nueva se ve el JSON. Arreglo en el backlog.
- **`database.ts` puede mentir la nullability** frente a `supabase.gen.ts`; las lecturas castean la fila cruda.
- **`navigator.share` es no-opcional en el lib DOM de TS:** chequear con `typeof nav.share === 'function'`.
- **Para cherry-picks a prod, usar un git worktree aislado**; los untracked del árbol principal bloquean el checkout.
