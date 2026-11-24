# Continuación — backlog abierto y priorizado (al día: 2026-11-23, cierre)

> **Punto de arranque:** [ESTADO.md](ESTADO.md) (⚡ARRANQUE y reglas) y [docs/handoffs/HANDOFF-2026-11-20.md](docs/handoffs/HANDOFF-2026-11-20.md).
> Solo lo **abierto**. Lo hecho y el detalle heredado (backlog de `staging` del 29/10, pases y olas de jun–jul, lo hecho del 05 y 10–11/11,
> P0–P3 del go-live) están en [docs/historico/PROMPT-CONTINUACION-HISTORICO.md](docs/historico/PROMPT-CONTINUACION-HISTORICO.md). Poda: pasado
> **15 KB**, la sesión de cierre mueve lo cerrado al histórico. Prioridad del proyecto: estabilizar lo que se usa a diario (caja, Bandeja,
> propinas, ventas) y el piloto del Club antes de innovar.

**Marcas:** 🖊️ firma del dueño · 👁️ validación en piso · 🔐 seguridad · 🧹 limpieza · ⛔ no mergear sin OK.

## 🟥 P0 — Ahora (20/11)
1. **👁️ Cron del Club:** repetir el 23/11 la verificación del jobid 8 (solo `select`; nunca `for update` sobre `cron.job`).
2. **👁️ Validaciones del dueño:** cierre del 20-nov (Resumen del día, correo `cierre-email` v19, aviso de propinas sin repartir) · correo de pago agrupado, paso 2 (pagar 2 de 3 facturas del proveedor de prueba) · próximo crédito real (#310, FIFO) · #229 al lanzar el Club. **Club en PAUSA** hasta Apple.
3. **Firma del dueño (#317):** no se probó en vivo; probarla el 21-nov con el primer merge de código.
3a. **Cola (en orden):** menores del #317 (comillas en `cd`; CI que verifique `git ls-files '.claude/*.local'` vacío; permitir `reset --keep`/`switch -C`) · script de anonimización de staging (spec firmada, D1/D3/D4/D5) · rehacer lo útil del #73 (Opus) · rehacer el #75 (Sonnet) · rama `staging` congelada (decidir) · métricas por PR · WhatsApp a proveedores F0 → F1a (**🖊️** migración) · costos de producto junto con Inventario · H3 de propinas (decidir).
3b. **👁️ Revisar en 20–30 días** (≈ 8–18/12) si se sigue pisando la clave FE de los tiquetes 04 (el agente toma `clave_fe` por consecutivo sin filtrar el tipo).
3c. ~~Alerta de latido del agente~~: el dueño dijo que no por ahora (19/11).
3d. **Recorrer con `satori-verificar` en staging Tiempos y Resumen** cuando haya sesión (capturas por rol).
3f. **Inventario (prioridad 4 del proyecto):** inicio de spec en [docs/inventario/SPEC-inventario-v0.md](docs/inventario/SPEC-inventario-v0.md) (24-nov). F0 = piloto en planillas (barra desde 23-nov, cocina desde 30-nov; Nosara espera al contador) → con las ENTREGAS G-012 y G-014 del Auditor, spec completa (Fable) → F1 esquema `inv_*` + conteo en la app (🖊️). Absorbe «costos de producto junto con Inventario» de la 3a.
3e. **Cola del 23-nov (detalle en ⚡ARRANQUE):** Ventas 3.5.4 (#340, en verificación) → 3.5.5 limpieza · spec 3.1 catálogo (🖊️; propuesta en [docs/ventas/SPEC-3.1-catalogo.md](docs/ventas/SPEC-3.1-catalogo.md), decisiones del dueño del 24-nov incorporadas; falta la firma de la 196 sobre el SHA del PR 3.1a) · la precarga de la apertura pisa el monto tecleado · texto en Caja Diaria cuando queda en déficit · 11 cuadros numéricos con hueco · tope de 50 puntos no validado («1e3») · 3.4 Regalías (🖊️) · deuda multi-local 067/080/190 (🖊️).
4. ~~Correos desplegados~~: en `main` y prod desde el ítem 11 (#313, #314); cerrados sin merge #241, #242, #243, #245, #235.
4b. **🧹 A04 · sacar del repo el nombre de la PC del PoS** (`pos-bridge/README.md`, `pos-bridge/.env.example` y el ESTADO de la rama del agente): se hace en la rama del agente, no desde `main` ([R12](docs/REGLAS-POR-INCIDENTE.md)).
4d. **Portal del socio (club-web):** pestañas con mayúscula uniforme «Tu red · Club Satori · Local» (decisión del dueño 17/11, B). Va en el próximo PR del portal.
4e. **🔐 Revisión de SiteGround (semana del 18/11, solo configuración, no se borra ningún sitio):** DMARC con dirección de reportes y después «quarantine» · copia de backups fuera de SiteGround · verificación en dos pasos de la cuenta · registros viejos de `staging3`.
5. **🧹 Staging:** reintentar el `drop` del índice de la v1 de la 183 (`pos_ndf_tickets_local_fecha_efectiva_idx`). La herramienta cancela los `drop`: va por sesión de CC.

## 🟧 P1 — Club Satori (piloto) — en este orden
1. **Spec de clics y embudo (D1–D9)**, firmada con las recomendaciones: construir. Después, **cartel por referente** (B: el mismo cartel del hotel cambiando solo el QR), en PR aparte.
2. **Privacidad D3 (opción A):** nombres de empleados de `personasNdf.ts` y `ventasEnVivoDatos.ts` a la base · correos y cédula de las Edge a secretos · montos reales, en un PR chico. Tras #221 la guarda `src/privacidadRepo.test.ts` ya impide sumar nuevos. Quedan también el correo y el filtro por correo de `scripts/` y los nombres de proveedores en docs históricos.
3. **Wallet:** aviso de cumpleaños al Google Wallet con link de OpenTable (PR aparte, Edge `club-pase`); cumpleaños automático por Wallet (opción A, spec §13); estado de la aprobación en [docs/club-satori/WALLET-GOOGLE-ACTIVACION.md](docs/club-satori/WALLET-GOOGLE-ACTIVACION.md).
4. **Rebase del #117** y punto de uso de la campaña `referente` de OpenTable (hoy lista, sin uso).
5. **Nosara:** completar links (ubicación, reseña, OpenTable) cuando abra; todo pensado multi-local (no volver a preguntar).
6. **Backlog sin fecha del Club:** el contador ve «Cohortes» · buscador de Escanear con socios · botón anfitrión → socio · fecha elegida en Bandeja · unificar la auditoría de la 161 y la 162 · SQL fijo de la 162 · `p_factura` tipeada por API sin ventana (174) · tarjeta del día 1 con factura del mes anterior cuenta en el mes nuevo (174) · ~~`getEdadSocio` lee tabla directo (176)~~ → mig 188 en prod (#273, 17-nov) · ~~retos de varios locales cuentan el total (176)~~ → mig 187 en prod (#272, 17-nov; también el tope de 3 armados por año, ahora por local: decisión del dueño 17-nov) · ~~el botón de WhatsApp de cumpleaños marca «enviado» sin deshacer (173)~~ → mig 186 en prod (#271, 17-nov) · la fecha del pase de Wallet (`club_pases.actualizado_en`) queda como está (decisión del dueño 17-nov; sin código) · topes por IP del portal (232).
7. **🧹 Worker del Club:** `[[unsafe.bindings]]` → `[[ratelimits]]` en `club-web/worker/wrangler.toml` (`RL_CREAR` 2001 · 5/60 y `RL_LEER` 2002 · 60/60), con prueba en `club-web/worker/index.test.mjs`; el deploy lo hace el dueño y se verifica con `/api/salud`.

## 🟧 P1 — Caja, Bandeja y ventas
1. **Ventas multi-local:** el local está fijo en `santa-teresa` (`LOCAL_POR_DEFECTO`). Antes de que abra Nosara: selector de local (o el local del manager) en Ventas, Resumen, Inicio, Inventario, Finanzas y el reporte por correo; `CORTE_POS` por local. La Edge `monthly-report` pasa al PoS en su propio PR.
2. **Lectura de facturas** (después del piloto; nada construido):
   - «Agregar» de Caja (`AgregarAsistente.tsx`) guarda solo el primer documento de una foto y no detecta duplicados.
   - Caja/Proveedores («➕ Agregar foto», `CashProveedores.tsx`): si la lectura falla, crea el documento vacío sin avisar (`extractImage` descarta el error).
   - Validar la clave FE: 50 dígitos, empieza con 506, y fecha, cédula y consecutivo coinciden con lo leído.
   - El aviso «⚠ Confianza baja» sale también con `requiere_revision` y confianza alta: ahí debe decir «Requiere revisión».
3. **Caja · documentos huérfanos al borrar un movimiento** (después del piloto, 🖊️ con firma): `delete_movement_cascade` busca los documentos después de que la FK los desvinculó. Medido en prod el 12/11: 114 `procesado` sin vínculo (112 limpiables, 2 referenciados). Propuesta: migración que sume a `v_doc_ids` los vinculados antes de la FASE 7 + script con conteo, respaldo y marcar `descartado`. No toca plata.
4. **Conciliación de compras** (recepción en la Bandeja, facturas electrónicas de Hacienda y pagos a proveedores): spec `SPEC-conciliacion-compras-FE` en los docs del proyecto (no está en este repo).
5. **Cierres de Fase 1 nunca completados en prod** (07/06 y 06/07): decidir si se completan o se documentan como hueco.
6. **Propinas · reparto semanal de cocina:** pasar la exclusión de un nombre fijo en el código a una marca en la base (🖊️ spec y firma: toca propinas).
7. **Mi Rendimiento:** Semana → Por día (alcance con el dueño) · empleados inactivos sin nombre para el salonero (el RLS de `employees` muestra el código del PoS) · día sin pax muestra −100 % en vez de «sin dato».
8. **🖊️ Umbrales del ICP** (hoy ≥13 % excelente, <10 % a mejorar): recalibrar; el histórico real da 5–9 % y el del equipo en octubre 10,6 % con el PoS.
9. **Ventas 3.4 · reporte quincenal de excepciones con anotación** (spec en [docs/ventas/SPEC-ventas-v2.md](docs/ventas/SPEC-ventas-v2.md) §5.5 ítem 6, PR #330). Antes va la fase 3.5: unificar las vistas viejas en las 5 pestañas (§12).
10. **Policy de `pos_mesas_internas` por local** (backlog del #294): hoy un manager lee la lista de todos los locales; limitar con `puede_ver_local`. 🖊️ toca permisos.
11. **Ventas · «Contexto jueves» de «Hoy»** mostró un promedio mal mientras cargaba el histórico: revisar si mezcla días del Excel y del PoS en la comparativa de las 4 últimas ocurrencias.
12. **Propinas · aviso sin repartir (#320), menores del verificador:** la propiedad «avisa ⇔ guardas» no cubre montos con céntimos (barra < ₡0,5 bloquea sin aviso) · falta una mutación del aviso con cobertura (rol efectivo vs natural en `TipsModule`) · «Quincenal» recalcula con los puntos y roles **actuales** de `role_tip_points`, no con los del turno (`payout_crc` guardado).
13. **Caja · 6 traspasos viejos con ₡ negativo (#326):** desde `validarMovimiento` ya no se editan sus montos ni los $ en la tabla (solo un ingreso con $ admite ₡ negativos al editar); decidir si se corrigen a mano (con firma) o se dejan.

## 🟧 P1 — Seguridad, Edge y deploy
1. ~~Ítem 11 · `config.toml`~~: hecho (#313, 20-nov). Cada merge que toca `supabase/functions/` despliega por Branching (regla 2 de ESTADO).
2. **🔐 Rotar los secretos de ingesta** (`POS_INGEST_SECRET` prod y staging, `INGEST_SECRET` de BioTime, y su copia en los `.env` de las PCs): pospuesto por el dueño (06/11); con las tareas paradas y verificando `pos_ndf_cursor.last_error` null después. **Revocar `claude-code-prod`** solo después de identificar en Supabase si es la credencial de las sesiones de CC (se reemplaza, nunca se revoca solo).
3. **🔐 4 `SECURITY DEFINER` ejecutables por `anon`:** `get_my_role` (analizar policies antes del revoke), `handle_new_user`, `log_movement_edit`, `unif_on_cash_movement`.
4. **Gate en el deploy:** `deploy.yml` publica sin correr `vitest` (HALLAZGOS #14).
5. **`version.json` lleva al login** desde el navegador (el service worker responde `index.html`): agregar `/\/version\.json$/` a `navigateFallbackDenylist` en `vite.config.ts`.
6. **👁️ Proveedores A+B** sin validar en piso y **DNS de Resend + `RESEND_API_KEY`** (depende del dueño).
7. **Edge `extract-document`:** prueba funcional en staging (v29) antes de cualquier pase.
8. **Sin confirmar desde el 30/10:** el environment `github-pages` dejó un deploy en `waiting` (regla de protección): revisar Settings → Environments.
9. **Guardia de Bash para las marcas = barrera blanda, cerrada (#317, #322):** #322 fue el último ajuste; no se persiguen más variantes. La barrera fuerte es la firma por «Aprobar» + el SHA exacto por REST + la protección de `main` (scripts/hooks/README.md).

## 🟦 P2 — Esperan decisión o firma del dueño
- **Bloque 152+ de migraciones:** la 083 (`my_turno_stats_higiene`), la 084 (SAL-AUD-01), la 087 (`employee_edits_audit`) y la 088 (`employees_recibe_reparto_cocina`) con su paquete de pase; la MAINTAIN de `authenticated` en las tablas de caja.
- **⏸️ Salarios:** pase por fase (migs 055–061 solo en staging), 6 activos sin código BioTime, `fecha_ingreso`, consulta al contador (bruto vs neto, vacaciones). Antes decidir con el contador qué montos sigue viendo el manager (`salary_lines`, `employee_payments`, que además escribe).
- Edición de propinas en Historial por cajero con autorización · foto de comprobante obligatoria · `propina-pool` (¿la propina electrónica va al mismo pool?) · reconciliación prod vs Excel del dueño · Etapa 2 de la Bandeja · merch de mostrador (familia 21) en categoría propia.
- **Ítem 9:** actualizar los dos agentes + re-ingesta 2025 del `01` a ROSAURA (450 tickets, 2025-01-01 → 2025-09-21).
- **🧹 Limpieza:** respaldos `*_pre_migracion_2026_07` de staging (¿se borran?; ya cerrados a `anon` y `authenticated`) · `src/shared/api/auth.ts` sin imports, assets sin uso y `public/_redirects` · alinear `integracion/analitica-staging` con `staging` · ledger de staging sin las filas 065 y 066 · `pos-bridge/backfill.test.ts` no carga sin el paquete `mssql` · deuda de lint (eslint 80, tope 83) · el agente de BioTime publica solo a staging.

## ⬛ P3 — Lejos / bloqueante
**PILAR** de sesión/auth escalable y multi-tenant (bloquea el gran pase del PoS) · **FE-CR** (factura electrónica real) · **gran pase del PoS propio a prod**, detrás del PILAR.

## Notas que siguen valiendo
- ⛔ Ninguna sesión corre `club_vencer` fuera de una transacción con ROLLBACK; en la app, simular → confirmar con el total.
- Local Club sigue en 15 % hasta el lanzamiento del Club (después 10 % + cortesía).
- Análisis del mediodía y del Local Club (nov 2026): conclusiones en `docs/analisis/2026-11-mediodia-localclub/README.md` §0.
