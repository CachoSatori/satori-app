# Continuación — backlog priorizado (handoff 2026-07-17)

> **✅ OLA 2026-07 + post-ola CERRADAS · ventana de ESTABILIZACIÓN CERRADA.** `main` = **`880c863`** (PROD) · `staging` = **`8c41965`**. Migs PROD out-of-band: **≤021 + 038–046 + subset core de 026**. Secret **`ANTHROPIC_MODEL=claude-sonnet-4-5` en prod** ✓. **Todo lo operativo está en prod y validado en piso por el dueño** (ver ESTADO §b). Backlog por prioridad **P0–P3** abajo; las secciones §0… de más abajo son **referencia histórica**.
>
> **🆕 COLA ACTUAL — orden del asesor (2026-07-17). El circuito de siempre: el asesor diseña/revisa · Claude Code ejecuta · el dueño firma y valida en piso. NO construir nada hasta confirmar por dónde arrancar.**
> 1. **SPEC notificación de pago a proveedores** — esperando firma del dueño (vive en el proyecto de Claude, `claude/SPEC-notificacion-pago-proveedores.md`; **fuera del repo**). Al firmar: **mig 047** + **prerequisito DNS**. → **P1 #9**.
> 2. **Edición de propinas en Historial por CAJERO con autorización de gerencia** — FIRMADO 2026-07-17; patrón mig 045 `requireManager`, sin esquema; plata-adyacente → **revisión estricta**. → **P1 #10**.
> 3. **Reconciliación del ledger de migraciones** — sesión dedicada; el asesor prepara el **plan read-only primero**. → **P1 #2**.
> 4. **Hora-CR en bordes de período** (PLATA fiscal). → **P1 #4**.
> 5. **DNS SiteGround** (corta) — remitente propio `@satoricostarica.com` + destinatario `satorisushibar@gmail.com`; momento para **rotar `RESEND_API_KEY`**. → **P1 #11**.
> 6. **FE-CR** (bloquea F3) + **diseño del PILAR** incorporando **C4/C5/B1** del research. → **P3**.
>
> **⏳ Validación viva pendiente:** **smoke real de C3** — el email del cierre nocturno (a `cachorrogp@gmail.com`, por el sandbox de Resend) sale **solo** al confirmarse el cierre completo; **lo confirma el dueño**.
>
> **🆕 Sesión 2026-07-09 → 17 (7 mejoras a PROD, validadas en piso):** propinas ef/elec (mig 046) · cierre ventas-0 + resumen · **Proveedores** rojo=deuda → simplificado a lista + buscador (**2 huérfanos rechazados en prod → P1 #1 / P2 #5 SALDADOS**) · **hotfix buscador Movimientos null-safe** · **quick-wins C2+C3+buscador** (P1 #8). Research de 6 PoS FIRMADO. Detalle → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) (bloque 2026-07-09→17).

---

## 🟥 P0 — ESTABILIZACIÓN — ✅ CERRADA

> La ventana de observación de prod quedó **cerrada** (07-06 → 17): todo lo operativo se validó en piso sin incidentes de plata. Se retoma construcción según la **COLA ACTUAL** de arriba, con firma por ítem. Ya no aplica el congelamiento.

## 🟧 P1 — DEUDA CORTA (técnica/datos, acotada)

1. **✅✅ SALDADO EN PROD 2026-07-16 — Proveedores: el rojo cuenta DEUDA REAL → simplificado a lista sola** (diagnóstico read-only 2026-07-06 + firma 2026-07-09; ambos pases en prod). **P1 #1 / P2 #5 CERRADOS.** Recordatorio del hallazgo: el **"14" en rojo NO eran pendientes** — era `overdueCount` (agenda de ciclo, etiqueta engañosa "pagos pendientes"); los **pendientes reales** son **5** en prod (3 legítimos + **2 huérfanos** `supplier_id` NULL, **₡150.043,52**; uno de 2020). **En prod (UI/lógica, sin esquema, sagrados intactos):** (a) el **rojo cuenta `pendCount`** = movimientos `status='pendiente'` (deuda real, **incluye huérfanos**) — lógica pura en `proveedoresStatus.ts`, testeada; (b) la **agenda de ciclo** (`overdueCount` → `agendaCount`) quedó como **indicador ámbar aparte**, NO rojo; (c) proveedor **'Puntual'** (valor de `ciclo_pago`, **sin migración** — es texto libre) sale de la agenda → **mata el "14"**; (d) la pestaña **Pendientes** tiene **✕ Rechazar** (con **autorización de gerencia**, funciona con `supplier_id` NULL).
    **✅ SMOKE DEL DUEÑO HECHO (2026-07-16):** rechazó los **2 huérfanos** desde la pestaña Pendientes en prod (Distribuidora Isleña 2020-07-09 ₡74.126,92 y GRUPO PAMPA 2026-07-06 ₡75.916,60, **cero SQL**) → **Pendientes 5→3**, validado en piso. (El "que el badge diga 5" quedó *moot*: el 2º pase retiró el badge rojo — la confirmación vino por Pendientes.)
    **✅ 2026-07-16 — SIMPLIFICACIÓN FIRMADA Y EN PROD** (ex-rama `fix/proveedores-simplificar`; los pases `prod/pase-proveedores-*` ya se mergearon a `main` por FF y se borraron de origin). Tras ver el fix en prod, el dueño decidió que la pestaña **Proveedores sea SOLO la lista de proveedores**. **Eliminado de `CashProveedores.tsx`:** el badge rojo "N pendientes por pagar" + su panel "Deuda pendiente registrada" (`showPending`) — **es un duplicado**: la pestaña Pendientes, al lado, ya notifica con su propio badge (`cd-pend-badge`, `CashModule.tsx:135`) —; el chip ámbar "N con ciclo de compra vencido"; y los banners de "Agenda de compra". **Conservado:** la lista/tarjetas con agregar/editar/desactivar tal cual, y **dentro de cada tarjeta** su deuda (`pendingCRC`), su ciclo acordado (**incluida 'Puntual'** y su semántica), último/próximo pago y total pagado. **`CashPendientes` intacto** (Rechazar y todo lo demás). **Sin código muerto:** `contarAgenda`/`contarPendientes`/`totalPendienteCRC` quedaron sin uso (nadie más los importaba) → borrados con sus tests; `computeSupplierStatus`/`esProveedorPuntual` siguen porque los usan las tarjetas. UI-only, cero esquema, sagrados byte-idénticos. Detalle → **HALLAZGOS.md** (2026-07-06) + `REPORTE_pendientes_huerfanos_2026-07-06.md`.
2. **🔴 Reconciliación del ledger de migraciones — AHORA EN AMBOS ENTORNOS.** prod: ledger **≤021 + 038–046 + subset core de 026 out-of-band**; staging: **022–038 + 039–046 out-of-band**; + **009** (drift) + **035** (fantasma, solo en `propina-pool`). `db push`/`repair` **FRENADOS** hasta una sesión dedicada de infraestructura (resolver 035/`propina-pool` primero; **NO tocar el historial**). Todo idempotente. Detalle → ESTADO §c + §3 abajo.
3. **✅ RESUELTO 2026-07-06 — Tokens de GitHub rotados.** PAT classic **"Claude CLI" regenerado con scopes mínimos** (`repo` + `workflow`; se quitó `admin:org`) → el valor viejo del transcript local queda invalidado. OAuth **"GitHub CLI" revocado** → el `gho_` expuesto queda inutilizado → **re-login limpio** (credencial nueva en el keyring de macOS). Ya no hay tokens vivos comprometidos. Detalle → §0bis abajo.
4. **🖊️👁️ Hora-CR en bordes de período (PLATA).** Las queries de plata (`finance.ts:132/139` P&L borde de año, y similares) acotan `created_at` en **UTC** (+6h vs CR) → un cierre de noche puede caer en el período equivocado. Construir los límites con `dateCR`. Cambia números → valida la dueña. `fix/fecha-cr-consistente` ya en staging. Detalle → §1 abajo.
5. **🟢 Prolijidad (no bloquea):** subir `node-version: 20`→22 en `deploy.yml`; 404 menores en `/caja` y `propinas:1`; warning cosmético de recharts. Detalle → §2 abajo.
6. **🛑 Import histórico Excel→app — CANCELADO por decisión del dueño (2026-07-09).** Costo/beneficio negativo. Se ejecutó y verificó en STAGING (Fase A diseño + Fase B import: 10.842 `cash_movements` + tabla `ventas_efectivo_hist` 2.448 turnos, checksum md5 exacto Excel↔DB) y luego se **revirtió completo** (staging = pre-migración: `cash_movements` **967**, `suppliers` **83**, `ventas_efectivo_hist` **DROP**; rollback **quirúrgico** que preservó 26 vínculos hijos reales; **backups conservados 30 días**). **prod NUNCA se tocó.** El histórico vive en los Excel del dueño (`MIGRACION-COMPLETA-Satori.xlsx`, `VENTAS-RECONSTRUIDAS-Satori.xlsx`); el conocimiento del análisis QUEDA válido (convención de ventas, TC de la casa, corr 0,978 vs PoS). Detalle → HALLAZGOS.md (2026-07-08 + cierre 2026-07-09). **No reabrir sin nueva firma.**
7. **🧹🖊️ Arranque limpio de PROD (post-estabilización · NO es migración, es LIMPIEZA).** Cuando el dueño **declare prod confiable**: eliminar los datos **pre-arranque** (el doble registro viejo) y **conservar** el sinceramiento USD y la operación viva. **Fecha de corte a definir. Requiere diseño + firma.** Distinto del import cancelado (#6): acá no se trae histórico, solo se limpia el arranque. ⚠️ Al validar saldos post-limpieza, ojo con **`saldoCajaFuerte` sin ancla + que no lee el efectivo de ventas** (HALLAZGOS 2026-07-09).
8. **🔬 Research quick-wins (FIRMADOS 2026-07-10, firma al ejecutar) → [docs/research/03-GAP-ANALYSIS.md](docs/research/03-GAP-ANALYSIS.md).** **C2** historial over/short del cierre + **C3** email del cierre al owner (un solo lote de reportes) · **C1** tips-owing por empleado. **Al diseñar el PILAR:** incorporar **C4/C5/B1**. **FE-CR = sesión dedicada propia (bloquea F3).** Descartes **D1–D4** registrados (no reabrir sin firma).
    **✅ 2026-07-17 — C2 + C3 + buscador de Proveedores EN PROD** (`main` = `880c863`; smoke del dueño en staging **3/3**). **SIN esquema, sagrados intactos, cero migraciones.**
    - **C2 — historial de sobrantes/faltantes** (`cierreStats.ts` puro + sección nueva en `CashResumen`, respeta su filtro por mes): lista por cierre completo (fecha · diferencia ₡ con signo/color sobrante/faltante/cuadró · ajuste tipo/motivo) + agregados (cuántos cuadraron vs no · neto · absoluto). **Display de lo ya sellado en `cash_cierres_dia`, NO recalcula.** NULL-safe (`diferencia_crc`/`ajuste_*` son nullable en la base). Test: `cierreStats.test.ts` (7 casos, fixture null).
    - **C3 — email del cierre al owner** (patrón Square): al confirmarse el cierre COMPLETO, `CashCierre` dispara `sendCierreEmail(cierreId)` **fire-and-forget** (si el email falla, el cierre NO se rompe). Edge Function **`cierre-email`** (patrón Resend) **con el fix del hallazgo #2: EXIGE `Authorization` (JWT verificado) y relee la fila server-side con el token del usuario (RLS = portón), NO service_role** — patrón `extract-document`. **✅ Deployada a STAGING y PROD** (ACTIVE v1 en ambos; portón de auth verificado: sin JWT → 401). `RESEND_API_KEY` ya estaba en prod; **`REPORT_TO_EMAIL` NO se seteó** → destinatario default `cachorrogp@gmail.com` (único que Resend entrega hoy con el sender sandbox → `monthly-report` intocado). **⏳ SMOKE REAL PENDIENTE: el cierre nocturno manda el primer email solo — lo confirma el dueño.**
    - **➕ Buscador en Proveedores** — filtro en vivo por nombre/categoría/contacto, **null-safe desde el día uno**, estado vacío "Sin coincidencias". Test: `CashProveedores.buscar.test.tsx` (5 casos, fixture null).
    - Gates del pase: build prod EXIT 0 · **231 tests sin env** (línea de main) · sagrados VACÍO · cero migs. **C1 (tips-owing por empleado) sigue en cola.**
9. **🖊️ SPEC notificación de pago a proveedores — esperando firma del dueño (COLA #1).** El SPEC vive en el **proyecto de Claude** (`claude/SPEC-notificacion-pago-proveedores.md`), **fuera del repo** — no está en `docs/`. Al firmar: implica **mig 047** (nueva, aún NO existe en ninguna base) + **prerequisito DNS** (§P1 #11, para el remitente propio del correo). Al arrancar: traer el SPEC al repo (`docs/`) y actualizar `docs/README.md`.
10. **🖊️ Edición de propinas en Historial por CAJERO con autorización de gerencia — FIRMADO 2026-07-17 (COLA #2).** El cajero puede editar propinas desde el Historial pasando **contraseña de manager/dueño** que se re-valida server-side, **mismo patrón que editar-pago en Caja** (mig 045 `verify_manager_password` + `requireManager`). **SIN esquema.** **Plata-adyacente → revisión estricta del asesor** (toca el path de propinas). No confundir con la edición de propinas que ya existe para roles con permiso.
11. **🖊️ DNS SiteGround (tarea corta) — habilita remitente propio + destinatario real (COLA #5).** Configurar DNS en SiteGround para: (a) remitente propio `@satoricostarica.com` (saca a Resend del modo sandbox `onboarding@resend.dev`), (b) recién entonces el destinatario de los correos puede pasar a `satorisushibar@gmail.com`. ⚠️ `REPORT_TO_EMAIL` es variable **COMPARTIDA con `monthly-report`** (mirar ambos antes de setear). Momento natural para **rotar `RESEND_API_KEY`** (la de staging quedó expuesta en un transcript 2026-07-17; el dueño aceptó el riesgo; rotarla es trivial).

## 🟨 P2 — DECISIONES DE PRODUCTO (esperan a la dueña / uso real en prod)

1. **🖊️ Bandeja Etapa 2** (entrada foto-primero 100% dentro de Caja Diaria) — hoy diseñada sin código. Construir **SOLO si** tras usar la Etapa 1 **en prod** sigue haciendo falta. Detalle → §4 + ROADMAP §Etapa 2.
2. **🖊️ `propina-pool`** (rama sin merge) — propina de tarjeta/SINPE ¿al mismo pool que efectivo o separada? `git show propina-pool:ESTADO-PROPINA-POOL.md`. Detalle → §7.
3. **🖊️ Foto de comprobante obligatoria al pagar propina** — firmado, diferido (fuera de scope de la ola); toca `pagarPropina`/`propinaPago.ts`.
4. **🖊️ Al borrar una factura, ¿borrar también su foto/documento?** (hoy queda; impide recargar la misma factura por el dedupe de hash). Decisión de la dueña.
5. **✅ CERRADO 2026-07-16 — Semántica del rojo "pagos pendientes" en Proveedores.** Recorrido completo: firmado 2026-07-09 (el rojo = deuda real; la agenda de ciclo, indicador aparte) → **en prod 2026-07-16** (`main` = `7377240`) → y ese mismo día, **viéndolo en prod, el dueño firmó simplificar**: la pestaña Proveedores es **SOLO la lista**, sin indicadores de cabecera (el rojo era **duplicado** de la pestaña Pendientes; la agenda era ruido). **La información no se perdió — vive en la tarjeta de cada proveedor** (su deuda, su ciclo incluida **'Puntual'**, último/próximo pago). Rama `fix/proveedores-simplificar`, sin merge. Ver **P1 #1** para el detalle. Detalle → HALLAZGOS.md + `REPORTE_pendientes_huerfanos_2026-07-06.md`.
6. **✅ CERRADO — EN PROD, VALIDADAS EN PISO (2026-07-10). Las 2 features están en producción** (pasaron juntas en el pase 2026-07-09/10; `main` = `6c65f25`). Sagrados intactos en ambas (`tipCalculations.ts` byte-idéntico; `cashUtils`/`computeTotals`/`posFiscal` sin tocar).
    - **(i) Propinas efectivo/electrónico** (`feat/propinas-efectivo-electronico`): la cuenta por pagar de propinas se genera **SOLO por lo electrónico** (datáfono/SINPE); el efectivo se lo queda el equipo, nunca genera movimiento ni pendiente; el reparto/`take_home` no cambia. **Esquema:** mig **046** (`tip_sessions.pool_barra_electronico_crc`) aplicada a **STAGING y PROD** out-of-band. SPEC → [docs/SPEC-propinas-efectivo-electronico.md](docs/SPEC-propinas-efectivo-electronico.md).
    - **(ii) Cierre del día — ventas ₡0 + resumen** (`feat/cierre-ventas-cero-y-resumen`): cerrar con ventas ₡0 **solo con confirmación explícita** (campo vacío bloquea); **modal de resumen** antes de confirmar. **SIN esquema** (solo UI/gates; el persistido no cambió).
    - **✅ PASE EJECUTADO 2026-07-10 (en orden):** **1º** mig **046 a PROD** out-of-band (Management API + `NOTIFY pgrst`; `schema_migrations` intacto → prod **038–046 + subset 026**); **2º** merge FF a `main` (`6c65f25`) + deploy (`version.json` live = `6c65f25`); **3º** **smoke en piso en prod ✓**. No había pendientes viejos de propinas en prod (0 `status='pendiente'`). Distinto de `propina-pool` (P2 #2, la pregunta pool-único-vs-separado).

## 🟦 P3 — PILAR + GRAN PASE DEL PoS (lejos; bloqueante)

1. **🚧 PILAR — arquitectura de sesión/auth escalable y multi-tenant.** El PoS lleva ~10 dispositivos concurrentes; objetivo hotelería/franquicias. Diseño + prueba de carga simulando N dispositivos, NO un parche. **🔴 BLOQUEA el gran pase del PoS.** Detalle → §PILAR abajo + ROADMAP.
2. **🖊️ GRAN PASE del PoS a PROD — DIFERIDO.** migs 022–037, buckets `facturas`/`productos`/`documents`, regenerar tipos; validación física del PoS (§6). Solo tras el pilar. **Es lo único que hoy separa `staging` de prod.** Detalle → §5.

> **Diferido con decisión (NO reabrir sin nueva firma):** Tier 1 (monto-on-modify desde Revisión) **DESCARTADO** por la dueña — la Revisión NO modifica caja.

---

# 📚 Referencia histórica (secciones de abajo)

> Lo que sigue es el **registro histórico** de las sesiones 2026-06-22 → 2026-07-03 (RCAs, el plan viejo de "PASE A PROD" y las prioridades previas, ya cumplidas o subsumidas por el pase único). Se conserva como contexto de ingeniería. **El backlog vigente es el de arriba (P0–P3).**

---

## 🗄️ (histórico) PASE A PROD — PLAN DE LA SESIÓN ANTERIOR — ✅ EJECUTADO 2026-07-04

> **✅ CÓMO SE EJECUTÓ REALMENTE (vs este plan):** NO fue cherry-pick FF-only de los 10 commits (conflictúan — la ola edita archivos que main no tenía). Se **portó el CONTENIDO** de los archivos de staging a la rama `prod/pase-ola-2026-07` sobre `main`, **excluyendo el PoS**, y se hizo **FF a main** (`92c0831`). Las **migs 038–045 se aplicaron a prod out-of-band vía Management API curl** (`db query --linked` colgaba) **SIN** la reconciliación previa del ledger (el paso 1 quedó como deuda P1, no bloqueó). Secret Sonnet ✅. Sinceramiento USD y smoke físico → **quedaron pendientes (P0)**.
>
> **Plan original (histórico):** llevar toda la ola `a4b1be3..ddb1c08` de `staging` a `main`/PROD, en orden, sin romper nada. **Guardrails de siempre:** nada a `main` sin orden explícita, **NUNCA `staging`→`main` en bloque** (solo cherry-pick FF-only, en orden), sagrados intactos, build+tests verdes por commit, y el **RITUAL del link** antes de cualquier comando de base (`cat supabase/.temp/project-ref` → `hwiatgicyyqyezqwldia` para staging; para prod, confirmar `yiczgdtirrkdvohdquzf` a conciencia y con doble check).

**Los 5 pasos (en este orden):**

1. **🔴 Reconciliación del ledger de migraciones — ANTES de aplicar nada nuevo a prod.** En staging, `schema_migrations` tiene 022–038 pero **039–045 se aplicaron out-of-band** (039 dashboard, 040–044 `db query`, 045 `db query --linked`), y arrastra 009 (drift) + 035 (fantasma, solo en `propina-pool`). `db push` se frena por 009/035. Hay que decidir cómo queda el ledger de **prod** (que hoy está en ≤021) para que las migs nuevas entren limpias. Sesión de reconciliación primero, o al menos su plan firmado. **Sin esto, aplicar migs a prod es a ciegas.**
2. **Cherry-pick FF-only de la ola a `main`, en orden** (`a4b1be3` → `4fddc5e` → `46ab5c6` → `86739f5` → `a628dbf` → `d5c8138` → `2784d93` → `e959fe5` → `a0e361c` → `380cb9a` → `ddb1c08`). Recordar que gran parte de la ola **depende del esquema 038–045** (Revisión, cascada, autorización por contraseña) → el código no funciona en prod sin las migraciones aplicadas. Evaluar si el pase de código y el de esquema van juntos o el esquema primero.
3. **Aplicar migraciones 038–045 en PROD** (con el resultado del paso 1). Verificar cada una; `verify_manager_password` (045) es SECURITY DEFINER — revisar grants/`revoke` como en staging.
4. **Replicar el secret `ANTHROPIC_MODEL=claude-sonnet-4-5`** en el proyecto Supabase de **prod** (`supabase secrets set --project-ref yiczgdtirrkdvohdquzf ANTHROPIC_MODEL=claude-sonnet-4-5`). Hoy solo está en staging; mejora la lectura de facturas (validado por Ismael). Reversible al instante (env var).
5. **Sinceramiento USD de Caja Fuerte en prod:** repetir el ajuste inicial (los −$2678 son espejo de staging) con el **conteo físico USD del día del pase** (Movimientos → Ingreso · Otro CF, USD = físico − saldo ledger, ₡ = 0). Recién la fórmula USD firmada empieza a cuadrar desde ese punto.
6. **Verificar el deploy vivo:** `version.json` de GitHub Pages = el `main` nuevo, y smoke físico con la dueña.

> **Ojo con el secret Sonnet:** es infra fuera del repo, no viaja con el cherry-pick. Fácil de olvidar. Anotarlo como checklist aparte del git.

---

## ★ (histórico) PENDIENTES NUEVOS — por prioridad (previos al pase)

> **Nota:** el pase a prod YA se ejecutó (2026-07-04). El backlog vigente está arriba (**P0–P3**); esta sección se conserva como contexto previo.

> **🆕 DIFERIDOS CON DECISIÓN (2026-07-03):**
> - **Foto de comprobante obligatoria al pagar propina** — firmado, pero **fuera de scope de la ola** (deliberadamente no se metió en propinas-vía-real). Pase siguiente, con firma. Toca el flujo de `pagarPropina` / `propinaPago.ts`.
> - **Tier 1 (monto-on-modify desde Revisión) — DESCARTADO por la dueña.** La decisión firmada es que la Revisión de inventario **no modifica la caja** (no reescribe montos del `cash_movement`). No reabrir sin nueva firma.

> **✅ HECHO (sesión previa 2026-06-28) — Hallazgo B + estabilización del render de Propinas PORTADOS A PROD** (`a14da50`, cherry-pick selectivo `52d26b9`+`a14da50`; deploy verde, `version.json.commit=a14da50`). El **bug prod-down de Propinas** quedó cerrado en prod; B también. Matemática intacta (`calcTurno` byte-idéntico, payout idéntico), validados en staging. Smoke en prod pendiente del OK de la dueña. **Nota:** la "Ola 2 — Bandeja Etapa 1 + migs 038/039" que este backlog viejo pintaba como próximo foco quedó **subsumida** por el pase único de la ola 2026-07-03 (que incluye 038–045 y todo el código de unificación ya construido).

> **✅ Cerrado el 2026-06-28 (cont.):** (a) **portar el `.gitignore` de `supabase/.temp/` a main** — hecho (`52d1475`, FF; un clon fresco de main ya no arranca en prod); (b) **bumpear las GitHub Actions a `@v5`/Node 24** — hecho en main (`52d1475`) y staging (`3b821f0`); deploy verde y warning de Node 20 desaparecido; `deploy.yml` byte-idéntico entre main y staging.

1. **🟡 [opcional, no bloqueante] Prueba cross-user del IDOR en prod.** Confirmar que un usuario con rol **fuera de caja** (sin acceso por RLS de storage, mig 016) recibe **`403` "Sin acceso al documento"** al pedir el documento de otro. El cierre ya está fundamentado en código + RLS + lectura física OK con rol de caja; esto es cinturón-y-tiradores.
2. **🟢 [deuda menor, aparte] Subir el `node-version: 20` del build a Node 22 (LTS).** Las **acciones** del workflow ya están en Node 24 (`@v5`); lo que queda es el **`node-version: 20`** del paso de build (`deploy.yml`, dentro de `setup-node`) — es el Node del **toolchain del build de prod**, por eso va en su propio cambio (no se metió con el bump de acciones). Node 20 se retira de los runners el 16-sep-2026; `setup-node` igual lo baja, así que no rompe, pero conviene subirlo. Cambio de CI, sin runtime de la app.
3. **🟡 [pendiente conocido, ajeno a este operativo] Check "Supabase Preview" del GitHub App en rojo crónico.** Sale `failure` en **todos** los commits de main (idéntico en `a0d9f0d` / `1788520` / `52d1475`) — es **pre-existente**, no lo causa ningún cambio de esta sesión. Lo que importa para validar un deploy a prod es `build` + `deploy` (GitHub Pages) y `Cloudflare Pages`, que sí dan verde. Mirar aparte: parece **config/secret del GitHub App de Supabase branching**, no código del repo. Si un cambio toca `supabase/` (migraciones/functions/config), recién ahí investigar si es propio.

> **🛠️ Nota de proceso (aprendizaje 2026-06-28):** una rama de prep destinada a FF a `main` tiene que sentarse **directo sobre `origin/main` actual**. Si `main` avanzó desde que se creó la rama (otro pase entró), hay que **`git rebase origin/main` ANTES del FF** — si no, el diff muestra reversiones espurias y `git merge --ff-only` falla. Si la rama ya estaba pusheada, tras rebasar: `git push --force-with-lease=<rama>:<OLD_SHA>` (**nunca** force-push a `main`). Pasó esta sesión con la rama del untrack de `.temp/` (se creó del main viejo `a0d9f0d`; main avanzó al bump `1788520`; se rebasó antes del FF).


Estado (baseline del handoff 2026-06-26 — **hoy prod = `main` `52d1475`** = `a0d9f0d` (IDOR alineado) + Actions `@v5` + untrack de `.temp/`, ver bloque superior): **PROD (`main`, entonces `79d8004`) ya tenía las OLAS 1 y 1.1 de estabilidad + el fix de la PANTALLA NEGRA del bootstrap + la
durabilidad de `createDayMovement` (todo ✅ validado físicamente) → la app vuelve a ser usable sin cuelgues.** main = capa de
inteligencia + fix SW viejo + fix fechas-borde + canario Realtime/candado + **Ola 1** (saga Realtime/suspensión + durabilidad
de escritura de caja, SIN diag) + **Ola 1.1** (timeout/abort del flush del outbox) + **fix PANTALLA NEGRA** (`5f22754`) +
**🆕 durabilidad `createDayMovement`** (FF `5f22754`→`79d8004`). STAGING (**`69d7749`**) = todo el PoS + Bandeja Etapa 1 + esos fixes + la saga
Realtime/suspensión + durabilidad de caja + flush del outbox con tope + auth-recovery (mergeado) + switch de diag solo-staging
(`[rt-diag]`) + IDOR de `extract-document` cerrado (`c38a252`) + borrado de caja → cascada de inventario (mig 039)
+ **🆕 esta sesión (2026-06-26): esquema 040–043 de la unificación APLICADO a la base de staging** (vía `db query`, no en `schema_migrations`; archivos ✅ **MERGEADOS a staging** `63ca7ce`) + **entorno de tests DOM** (happy-dom+RTL, smoke anti-loop). **🆕 El IDOR ya pasó a prod (2026-06-28).** **Pendiente de pase a prod:** la mig 039 (cherry-pick sobre main limpio, con firma). Auth-recovery quedó **DIFERIDO** (gate >1h pasó; ya mergeado — §0-bis).
Guardrails de siempre:
**nada a `main`/PROD sin orden explícita, DDL solo migraciones aditivas, sagrados intactos** (`cashUtils`,
`tipCalculations`, `computeTotals`, cierres, cobro/vuelto, `posFiscal`), builds+tests+eslint verdes por commit.
Estado completo → [ESTADO.md](ESTADO.md) · Fases → [ROADMAP.md](ROADMAP.md) · Hallazgos de auditoría → [HALLAZGOS.md](HALLAZGOS.md) ·
RCA Realtime → [docs/rca/2026-06-22-realtime-suspension.md](docs/rca/2026-06-22-realtime-suspension.md) · RCA auth → [docs/HANG-RCA-2.md](docs/HANG-RCA-2.md).

Marcadores: ✅ hecho · 🖊️ espera FIRMA/DECISIÓN de la dueña (plata) · 👁️ espera VALIDACIÓN FÍSICA ·
🟢 ingeniería lista para arrancar · 🔴 bloqueante / urgente.

> **Ya resuelto y EN PROD:** SW viejo (`fde9264`), fechas de borde de mes (`ff836a0`), y el canario
> Realtime/candado de auth. Eran las tres causas viejas del "se traba". **La causa NUEVA (Realtime tras suspensión
> profunda) + la durabilidad de escritura de caja + el timeout/abort del flush del outbox YA ESTÁN EN PROD y validadas
> físicamente** vía **OLA 1 (`2358f6c`)** y **OLA 1.1 (`ead4727`+`483d29c`)** — la cola del outbox drena sola. **🆕 También
> EN PROD: el fix de la PANTALLA NEGRA del bootstrap** (`5f22754`, ✅ validado físicamente) **y la durabilidad de
> `createDayMovement`** (`79d8004`, ✅ validada). **🆕 EN PROD (2026-06-28): el prerequisito de seguridad #1 (IDOR en
> `extract-document`) quedó CERRADO en producción** (versión segura desplegada al Supabase de prod + `main` alineado
> `a0d9f0d`; smoke `401`; lectura física OK con rol de caja). En staging sigue además la integridad borrado→inventario
> (mig 039, validada end-to-end por la dueña). **El foco AHORA es la OLA 2: Bandeja Etapa 1 + mig 038 a prod (§1)** — el
> IDOR **ya no bloquea y ya está en prod**; lo que falta pasar con la Bandeja es la mig 039.

---

## ★ PRÓXIMO (2026-06-26) — construcción del módulo de unificación Bandeja↔Caja

El **diseño** (SPEC firmado) y el **esquema** (migraciones 040–043) ya están: las 4 fueron **firmadas y aplicadas a la
base de staging** vía `supabase db query` (NO `db push` → no en `schema_migrations`; archivos ✅ **MERGEADOS a
staging** `63ca7ce`). Decisión **OPCIÓN A** firmada: `accounting_entries` es
auditoría/reversión, **no alimenta el P&L** (ver SPEC §19). Lo que sigue:

1. **🟢 PRIMER PASO — regenerar los tipos TS contra staging.** Ya existen en la base `accounting_entries`,
   `inventory_review_task`, las RPCs (`post_accounting_entry`, `complete_inventory_review`, `discard_inventory_review`,
   `unif_on_cash_movement`) y las 3 columnas de `cash_movements`. ⚠️ **RITUAL del link primero** (ver abajo y HALLAZGOS):
   confirmar `cat supabase/.temp/linked-project.json` → ref `hwiatgicyyqyezqwldia` ANTES de cualquier comando de Supabase.
2. **🟢 Construir F3–F5 del SPEC:** módulo de Inventarios (cola + completar revisión vía `complete_inventory_review`),
   el **"Agregar" único** en Caja Diaria con clasificación advisory, y la cascada extendida en la UI.
3. **✅ RESUELTO — archivos `040–043*.sql` MERGEADOS a `staging`** (`63ca7ce`): el repo ya es **fiel** al esquema de la base
   (sin drift archivo↔base).

> 🛑 **RITUAL OBLIGATORIO antes de CUALQUIER comando de base** (aprendizaje crítico de esta sesión, ver HALLAZGOS.md):
> `cat supabase/.temp/linked-project.json` → el `"ref"` DEBE ser `hwiatgicyyqyezqwldia` (staging). El CLI estaba
> **enlazado a PROD** (`yiczgdtirrkdvohdquzf`) sin avisar; lo cazó el guardrail. Nunca correr DB sin confirmar el ref.

### DIFERIDOS (sesiones dedicadas, no bloquean lo de arriba)
- **Reconciliación del ledger de migraciones** (009 drift · 035 fantasma en `propina-pool` · 039 dashboard · 040–043 por
  `db query`): `db push` se frena por 009/035; NO usar `push`/`repair` hasta una **sesión dedicada de infraestructura**
  (resolver 035/`propina-pool` primero). Todo es idempotente. Ver ESTADO §d.
- **Auth-recovery** (§0-bis): DIFERIDO; su **precondición — el Hallazgo B (drain del outbox en `SIGNED_IN`) — quedó ✅ resuelta y 🆕 EN PROD** (`a14da50`). Si se retoma, ya no está bloqueado por B.
- **Riesgo latente `/caja` + Cmd+Shift+R** → ya registrado (RCA en la rama `rca/caja-hardreload-hang`, sin mergear); redirige a `/login` ~20s,
  recuperable. No bloquea el módulo nuevo. (No re-investigar salvo que la dueña lo priorice.)

---

## 0. ✅ RESUELTO esta sesión — Realtime tras suspensión profunda (máquina de 3 estados + gateo + endurecimiento)

`ensureRealtimeHealthy` (en `src/shared/api/supabase.ts`) quedó rediseñada como **MÁQUINA DE 3 ESTADOS** y **validada
físicamente** en el staging desplegado. **Ya NO es un pendiente** — queda acá como referencia para la Ola 1 (pase quirúrgico, §1).
- **`ONLINE_SUBSCRIBED`** (token fresco CONFIRMADO) → `setAuth` + revive socket si cayó + **única** emisión de `rt:healthy`.
- **`OFFLINE_WAITING`** (red zombi / refresh colgado) → NO emite, renueva el TCP, reintenta con backoff (3s→30s, un único timer).
- **`SESSION_EXPIRED`** (solo si `refresh.error`) → NO toca el socket; deja actuar el deslogueo declarativo.

**Regla madre cumplida:** nunca `rt:healthy` ni re-suscribir sin token fresco confirmado; ningún camino en loop. Esto
mató el **loop `InvalidJWT`** del viejo emit-on-timeout (`63ef0bb`). Encima: **gateo del emit** (flag `healthyAwaited`:
emite solo si hay recuperación pendiente → arregla la regresión de arranque) y **endurecimiento de `SESSION_EXPIRED`**
(`getSession→null` transitorio del arranque ya no desloguea; árbitro único = `refresh.error`) — `3a0fd20`.
**Validado con `window.__satoriDiag`:** `armZombie`→`OFFLINE_WAITING` + backoff sin loop ni `InvalidJWT`; `disarm`→`ONLINE_SUBSCRIBED`
emite y recupera a SUBSCRIBED; **arranque sin cascada CLOSED**; **foco rutinario → `setAuth` SIN emit**. `useRealtimeRefetch`
byte-idéntico (su contrato no cambió). Cronología → **`docs/rca/2026-06-22-realtime-suspension.md`** + `ESTADO-ARCHIVO.md` (2026-06-24).

---

## 0-bis. ✅ Auth-recovery — el loop `OFFLINE_WAITING` tras suspensión LARGA (MERGEADO en staging · DIFERIDO)

La máquina de 3 estados (§0, EN PROD) cubría el caso validado, pero **quedaba un modo de falla distinto**: tras una
suspensión **larga**, `getSession`/`refreshSession` **no vuelven** (el fetch interno queda sobre el socket zombi) y
`classifyRealtime` caía en `if (!sessionRead) return OFFLINE_WAITING` **sin escape** → loop eterno, el token no se
refresca y **el outbox no drena**. **El primer intento (bajar el lock 10s→5s, `ccef5f1`) fue un RED HERRING:** el escape
`no adquirido` disparó **0 veces** en TODOS los logs (incl. suspensión real ~4h) → el cuelgue es el fetch de auth, no la
adquisición del lock. Queda como hardening inofensivo.

**Fix real (client-side, solo staging):**
- `e0df9ae` — contador de timeouts consecutivos de `getSession`; tras **N=3** → `SESSION_EXPIRED` + `signOut({scope:'local'})`
  → `/login` → reingreso → el outbox drena (el signOut local NO toca el IndexedDB del outbox).
- `14e4546` — `signOut` SOLO en el path forzado (`forced:true`); el `refresh.error` vuelve a su comportamiento original
  (sin logout espurio) + **latch one-shot** (se limpia con sesión fresca en `onAuthStateChange`) → mata el ping-pong.

> ✅ **ESTADO CORREGIDO (2026-06-26):** está **MERGEADO en staging** (no vive "solo en una rama") y el **gate de
> suspensión real >1h PASÓ** — validado físicamente por la dueña: **la app desplegada se recupera sin este fix** → queda
> **DIFERIDO (posiblemente innecesario)**, NO es un pendiente bloqueante. **Si se retoma**, su precondición — el
> **Hallazgo B** (drain del outbox en `SIGNED_IN`) — **ya está ✅ CERRADA en staging** (`492eaa5`, ver PRIORIDAD 2). El lock `ccef5f1` fue red
> herring (hardening). Diagnóstico → **`docs/HANG-RCA-2.md`**.
> 🔧 **Identidad de build = `{base}version.json`→`.commit`**, NO un hash de chunk.

---

## 0-ter. ✅ PANTALLA NEGRA (splash 祭 eterno tras suspensión / cold-launch) — RESUELTO y EN PROD (`5f22754`)

**Causa raíz (capa de ARRANQUE, NO realtime):** en `useAuth.tsx` el bootstrap llamaba `getSession()` **y** `loadProfile()`
**sin tope**; sus `.finally(setLoading(false))`/`await` solo corren si la promesa SETTLEA → sobre el socket zombi se
colgaban → `loading` quedaba `true` para siempre → splash negro. Ningún fix de realtime tocaba esta capa de arranque
(Hallazgo A; por eso fallaba hace una semana). **Fix (3 commits sobre `692055d`):** `0adf30e` getSession con `withTimeout`
(→/login al vencer ~8s) · `f0f8127` loadProfile con `withTimeout`+1 reintento + `PrivateRoute` corta perfil nulo ·
`8bed794` `PublicRoute` exige `user&&profile` (corrige un LOOP `/`↔`/login` que introdujo `f0f8127`). Palanca de diag
`ee5878a` (`__satoriDiag.armBootHang('getSession'|'loadProfile')`, solo-staging). **✅ VALIDADO en staging** (determinístico
con `armBootHang` + natural; Service Worker Clients mostró `…/login`; build prod EXIT 0 + 138/138 tests).

> 🚀 **YA EN PROD** (`main` `5f22754`, FF `483d29c`→`5f22754`, commits `a1342c8`+`fd2755c`+`5f22754`): deploy confirmado
> por `version.json.commit=5f22754`. ⏳ **VALIDACIÓN FÍSICA EN DISPOSITIVO PENDIENTE** — la dueña la hace en el restaurante;
> NO marcar validado hasta su OK.
>
> ### ⚠️ RECETA DE PROD (registrada para NO redescubrirla) — NO es "cherry-pick de los 3 y listo"
> Cherry-pickear `0adf30e`+`f0f8127`+`8bed794` sobre `main` da **1 conflicto + 1 build break**. Receta correcta =
> **esos 3 commits + DOS `export` en `src/shared/api/supabase.ts`**, nada más:
> 1. **Conflicto en `withTimeout`:** quedarse con el **cuerpo de MAIN** (`_label`, SIN traza/`console.warn`) **+ `export`** →
>    `export const withTimeout = <T>(p: Promise<T>, ms: number, _label: string, fallback: T) => {`. **NO** la versión de
>    staging (la que dice "y deja rastro en consola" / usa `label` + loguea).
> 2. **Build break:** `useAuth.tsx` importa `withTimeout` **y** `AUTH_OP_TIMEOUT_MS` (en main existen pero NO exportados) →
>    `export const AUTH_OP_TIMEOUT_MS = 8_000` (sin cambiar el valor). En staging el `export` venía de `ccef5f1` (lock
>    10s→5s, **red herring que NO va a prod**); en el hotfix se exporta a mano sin traerlo.
> **NO traer** `ee5878a` (palanca `armBootHang`) ni `ccef5f1` (lock). Verificado: build prod **EXIT 0**, **vitest 42/42**,
> dist sin diag, diff = **4 archivos (+205/−11)**.

---

## 0-quater. 🆕 RESUELTO esta sesión (2026-06-26, SOLO en staging) — IDOR de `extract-document` + integridad borrado→inventario

**(1) IDOR de la Edge Function `extract-document` — CERRADO** (`c38a252`, desplegado a staging Supabase, **validado los 2 lados**).
Bajaba del bucket privado `documents` con la `service_role` **sin verificar al llamante** → cualquiera con la URL bajaba
cualquier factura; CORS `*`. Fix (contrato `{ image_path }`→`{ documentos[] }` intacto): exige `Authorization` (→`401`),
cliente con **ANON key + ese token** (aplica RLS), `auth.getUser()` (→`401`), **download con ese cliente** (no service_role) →
RLS de storage de mig 016 es el portón (→`403`); CORS por **allowlist** (`https://cachosatori.github.io` +
`https://satori-staging.pages.dev`). Validado: positivo (extracción en bandeja OK) + negativo (`curl` sin Authorization → `401`).
**Era el prerequisito de seguridad #1 de la Ola 2.** **🆕 ACTUALIZACIÓN 2026-06-28: ya pasó a PROD** — la versión segura se desplegó al Supabase de prod (`functions deploy --project-ref yiczgdtirrkdvohdquzf`) y `main` quedó alineado (`a0d9f0d`, byte-idéntico a staging); smoke `401` + validación física (lectura OK con rol de caja). Pendiente OPCIONAL: prueba cross-user (→ `403`).

**(2) Borrado de caja → cascada de inventario + auditoría — mig 039 + RPC** (`82d55cd`+tipos `a3dfacf`, **validado end-to-end
por la dueña**). Antes `inventory_movements.cash_movement_id` era `ON DELETE SET NULL` (mig 017) → al borrar el `cash_movement`
de una factura su inventario quedaba **huérfano** (inventario inflado + asientos duplicados al recargar). Ahora corre por la RPC
**`delete_movement_cascade(p_movement_id, p_note)`** (SECURITY DEFINER, 1 transacción): valida owner/manager, snapshotea,
audita en `movement_deletions`, borra inventario ligado + movimiento; idempotente. App: `deleteCashMovement(id, note)` enruta
TODO por la RPC, **requiere conexión** (offline BLOQUEA, NO encola un borrado parcial), **nota obligatoria** + `requireManager()`
en CashMovimientos y CashTurno. Test `cash.cascade.test.ts`. NO toca sagrados.

> ⚠️ **mig 039 aplicada por el SQL editor del DASHBOARD** (firma de la dueña), NO por `db push` → **no quedó en
> `supabase_migrations.schema_migrations`**. Un futuro `db push` la verá pendiente y la re-aplicará: es **idempotente**, no
> rompe. Discrepancia de ledger junto con la **035** (ver ESTADO §d).
> 🖊️ **SUB-DECISIÓN ABIERTA (a probar):** al borrar una factura se va movimiento + inventario, pero la **FOTO/documento queda**.
> ¿Borrarla también para poder **recargar la factura sin que el dedupe por hash la frene**? Decisión de la dueña.

---

## ★ PRIORIDAD 1 (pases a prod pendientes) — integridad mig 039 (+ auth-recovery diferido)
> ✅ La **PANTALLA NEGRA** (`5f22754`, §0-ter), **la durabilidad de `createDayMovement`** (`79d8004`) **y 🆕 el IDOR de
> `extract-document`** (desplegado al Supabase de prod + `main` alineado `a0d9f0d`, 2026-06-28) **ya pasaron a prod,
> validados** — salen de esta lista.

Cada pase es **NUEVO desde `main`**, NUNCA mergear `staging`→`main` en bloque; verificación: `VITE_APP_ENV=production npm run build`
EXIT 0 + suite verde + ritual de identidad `{base}version.json`→`.commit`; firma de la dueña. Orden lo decide la dueña:
1. **🆕 Integridad borrado→inventario** (`82d55cd` código + **mig 039 sobre la BASE de prod**, hoy NO aplicada) — pase de
   código por pase quirúrgico + aplicar la mig 039 en prod, con firma. La 039 es idempotente (ver nota §0-quater).
2. **Auth-recovery** (`e0df9ae`+`14e4546`) — **DIFERIDO, NO bloqueante** (§0-bis): el gate de suspensión >1h **pasó** y la app
   se recupera sin él → posiblemente innecesario. Su precondición — la **PRIORIDAD 2** (drain del outbox en `SIGNED_IN`) —
   **ya está ✅ cerrada en staging** (`492eaa5`). No es candidato de pase salvo que reaparezca el síntoma. Client-side, sin migración.

> ✅ **El IDOR de `extract-document` ya NO está en esta lista — pasó a prod el 2026-06-28** (ver §0-quater).

## ★ PRIORIDAD 2 — ✅ RESUELTO Y EN PROD — Hallazgo B: drain del outbox en `SIGNED_IN` (PLATA)
**CERRADO en staging y 🆕 PORTADO A PROD** (`a14da50`, cherry-pick `52d26b9`; smoke en prod pendiente del OK de la dueña). Origen: `492eaa5`, rama `fix/outbox-flush-on-signin`, mergeada por FF; client-side, **sin migración**. Antes
`outbox.ts` flusheaba por `'online'` / arranque / un backoff que se apaga con la cola vacía; faltaba el disparo en
`SIGNED_IN`/re-login → "el outbox drena al reloguear" (premisa del fix de auth-recovery, §0-bis) no estaba garantizado. **Fix:**
`initOutbox` engancha `onAuthStateChange` y, vía el predicado exportado `shouldFlushOnAuthEvent` (SOLO `SIGNED_IN`;
`TOKEN_REFRESHED`/`INITIAL_SESSION`/`SIGNED_OUT` no drenan), replica el patrón del handler de `online` (reset de backoff +
`autoFlush`, **no** `flushNow` directo); guard `outboxWired` contra doble-registro. **NO** toca el `onAuthStateChange` global de
`supabase.ts` ni `flushNow`/`supabaseExecutor`. +4 tests del gateo; build prod **EXIT 0** + 155 verdes. ⏳ Validación física
pendiente (es plata). → **desbloquea la precondición del auth-recovery**. Detalle → [HALLAZGOS.md](HALLAZGOS.md) §B.

---

## 1. 🟢 PLAN DE PASE A PROD — OPCIÓN A de la dueña: ESTABILIDAD primero, en 3 OLAS — **Ola 1 y 1.1 ✅ HECHAS**
**Principio:** la **estabilidad (Olas 1 + 1.1) fue ANTES que cualquier feature** y **ya está en prod, validada**.
⚠️ **Staging está ~143 commits y ~16 migraciones adelante de main → NUNCA mergear `staging`→`main`; a prod se va por
_cherry-pick selectivo_.** Hacer las olas EN ORDEN → **la SIGUIENTE es la Ola 2**.

### Ola 1 ✅ HECHA (en prod `2358f6c`, validada físicamente) — pase QUIRÚRGICO de estabilidad a MAIN
**Qué se hizo:** cherry-pick/port de la **cadena de la saga Realtime** (worker:true + blindaje por timeout + máquina de 3
estados + gateo del emit + endurecimiento `SESSION_EXPIRED`) **+ la durabilidad de escritura de caja (§0.2)**, SIN el PoS,
sin la Bandeja, sin migraciones (client-side puro). **La instrumentación se borró por prefijo:** logs `[rt-diag]` +
módulo `realtimeReproSwitch` fuera de main; tree-shaking confirmado (grep del dist de prod por `__satoriDiag|rt-diag|armZombie`
→ VACÍO). En `staging` el diag sigue activo por diseño. Caja/propinas/ventas de vuelta en prod **sin cuelgues**.

### Ola 1.1 ✅ HECHA (en prod `ead4727`+`483d29c`, validada físicamente) — timeout/abort del flush del outbox
**Qué se hizo:** las 5 llamadas de red del `supabaseExecutor` (`src/shared/offline/outbox.ts`) envueltas en
`withWriteTimeout` + `.abortSignal()` (mismo patrón que `cash.ts`), con **GUARDARRAÍL DE PLATA**: un timeout devuelve
`'retry'`, NUNCA `'fatal'` (fatal borra la op de la cola = pago perdido). **La cola del outbox drena sola tras suspender
la máquina** (antes el flush quedaba colgado en "por sincronizar" sobre el socket TCP zombi). Tests en `outbox.test.ts`.

### Ola 2 🟢🖊️ — (SIGUIENTE foco de features, tras la estabilidad ya pasada) — Bandeja ETAPA 1 a prod con la mig 038
**Qué:** la **Etapa 1** (bandeja unificada `/inbox`, foto+IA Claude, enlace proveedor↔caja, visibilidad de pendientes)
**ya está construida y validada en staging** — esta ola la **activa en prod**. Da **foto+IA real sin construir nada nuevo**.
Es **esquema → firma de la dueña** (mig 038). ⚠️ **A verificar al planearla:** si la **mig 038 / la Etapa 1 se separan
limpio de las migraciones del PoS (022–037)** o vienen acopladas (define si se puede pasar la Bandeja sin arrastrar el PoS).
> ✅ **PREREQUISITO DE SEGURIDAD #1 — CERRADO EN PROD (2026-06-28, §0-quater):** el **IDOR en `extract-document`** ya
> está corregido **y desplegado en el Supabase de prod** + `main` alineado (`a0d9f0d`). **Ya NO es un pendiente de la Ola 2:**
> la Bandeja puede subir a prod sin arrastrar este fix (ya está allí). Pendiente OPCIONAL: prueba cross-user (→ `403`). Detalle → [HALLAZGOS.md](HALLAZGOS.md).

### Ola 3 🔲 — (cuando la base esté sólida y probada) — CONSTRUIR la Bandeja ETAPA 2
**Qué:** entrada **foto-primero 100% dentro de Caja Diaria** — hoy **🔲 DISEÑADA, SIN código** (no hay nada en
`src/modules/cash` ni `inbox`). Se construye **solo si** tras usar la Etapa 1 sigue haciendo falta.
> **🖊️ DECISIÓN ABIERTA de la dueña (define si la Ola 3 se hace):** *¿la Bandeja **Etapa 1** (unificada con IA, ya lista
> y validada) ALCANZA, o se necesita la **Etapa 2** (integración foto-primero dentro de Caja Diaria, a construir)?*

### 🆕 PRÓXIMO PROYECTO — SPEC de la unificación Bandeja↔Caja (arranca por DISEÑO, NO construir todavía)
Colapsar Bandeja y Caja Diaria en un solo flujo: **un único "Agregar"** en Caja Diaria · **auto-clasificar**
Proveedores/Operativa como ayuda visual (sugerencia, el humano confirma) · **sacar "Ingresar a inventario" del cajero** →
que el **contador/manager** lo revise y complete en el módulo de **Inventarios** · **asiento contable automático**.
**Primer entregable = documento de diseño; NO escribir código hasta tener el SPEC + firma.** Detalle → ROADMAP §1ter.

> **NO confundir con el GRAN PASE del PoS** (migs 022–037, comandero/KDS/cobro): es un **proyecto aparte y DIFERIDO**,
> posterior a estas olas y **bloqueado por el PILAR de escalabilidad de sesión/auth** (abajo) + validación física del PoS (§6).
> La dueña eligió OPCIÓN A (estabilidad), **no** el gran pase del PoS.

### 0.1 — Pendientes secundarios anotados (del trabajo de Realtime/caja)
- **(a) UX — el revive tarda hasta ~30 s en encolar tras suspensión.** Con la red zombi, la primera escritura de caja
  puede tardar hasta ~30 s en caer al outbox (suma de topes de 8s + reintentos). **Funciona** (no se pierde el pago,
  ver durabilidad de caja, ítem 0.2), pero la espera se nota. Ya con la máquina de 3 estados; re-evaluar la UX si molesta.
- **(d) Menor — `SESSION_EXPIRED` transitorio en el arranque (inofensivo).** En el primer tick del arranque
  `getSession()` puede dar `null` → se ve un `SESSION_EXPIRED` transitorio en los logs `[rt-diag]` (**solo en staging**;
  en prod los `[rt-diag]` ya no existen tras la Ola 1). **Inofensivo** (no desloguea ni emite; lo arbitra `refresh.error`); no urgente.
- **(b) ✅ HECHO esta sesión — `createDayMovement` blindado** (`dea9486`, en staging). Mismo patrón que
  `registerCashMovement`: id+`client_op_id` en el cliente, `withWriteTimeout`+`.abortSignal()`, reintento único, y ante
  timeout/red-zombi **encola incondicionalmente en el outbox** (idempotente por `client_op_id`). Contrato intacto
  (`Promise<string>`); sin tocar sagrados. Test en `cash.durability.test.ts` (2 casos nuevos). **🆕 YA EN PROD (`79d8004`),
  VALIDADA:** el cherry-pick `399fc0b` se **re-cortó** sobre `5f22754` (rama `hotfix/createdaymovement-durability-prod-v2`)
  porque la rama vieja `hotfix/createdaymovement-durability-prod` había quedado stale sobre el main pre-pantalla-negra; FF limpio, sin `supplier_id`.
- **(c) 🔽 RIESGO LATENTE — baja prioridad — `Cmd+Shift+R` estando en `/caja`.** **Síntoma observado (corregido):**
  NO es un cuelgue infinito. En **staging Y prod** la app **redirige a `/login` tras ~20 s** y es **recuperable, SIN
  pérdida de datos** (el arranque de auth está acotado: `getSession`/`loadProfile` con `withTimeout` → al vencer cae a
  `/login`; el outbox preserva cualquier escritura). **RCA:** `docs/rca/RCA-caja-hardreload-hang.md` (rama
  `rca/caja-hardreload-hang`). El RCA documenta **dos debilidades latentes reales** que **NO son el síntoma observado**
  pero conviene blindar a futuro: el **`import()` de chunks sin tope** y el **`idbGet` (fallback de `cachedFetch`) sin
  tope** — bajo red zombi podrían colgar en vez de redirigir. **Decisión de la dueña:** registrado, **diferido, NO
  bloquea el módulo nuevo.**

### 0.2 — ✅ Durabilidad de escritura de Caja (ya en staging `0dd258b`)
`registerCashMovement`/`updateCashMovement`/`deleteCashMovement`: el reintento ahora corre con `withWriteTimeout` (no
puede colgar) y, ante timeout o error de red, **encola INCONDICIONALMENTE en el outbox** (idempotente por
`client_op_id`); solo errores reales del server (RLS/FK/constraint) suben con throw. **Root cause** del bug viejo:
confiar en `isOffline()`/`navigator.onLine`, que en red zombi vale `true` → nunca encolaba y se perdía el pago.
Invariante: **toda escritura de caja termina confirmada en el server o encolada — nunca colgada, nunca descartada.**
Test `cash.durability.test.ts`. (No requiere acción; queda como referencia del patrón a replicar en (b).)

## 0bis-A. ⚠️ FOOTGUN de build — `npm run build` local compila como STAGING
Cualquier `npm run build` local **SIN forzar `VITE_APP_ENV`** compila como **STAGING**, no como prod: hay un
`.env.local` que setea `VITE_APP_ENV=staging` y Vite lo carga en **todos** los modos. Consecuencia: el bloque de
diagnóstico gateado por `VITE_APP_ENV==='staging'` (y cualquier código solo-staging) **queda incluido**, no se
tree-shakea. **Para verificar tree-shaking / un build prod real:** forzar el valor explícito —
`VITE_APP_ENV=production npm run build` (process.env gana sobre `.env.local`) o mover `.env.local` aparte. Verificado
en esta sesión: con `VITE_APP_ENV` ≠ staging (explícito **o** sin setear, como en CI) el DCE **elimina** el bloque +
su `import()` → no queda chunk del diag y `window.__satoriDiag` es `undefined`.

## 0bis-B. ⚠️ GOTCHA DE VERIFICACIÓN — `tsc --noEmit` es un FALSO VERDE (usar `npm run build`)
El `tsconfig.json` raíz tiene `"files": []` + `references` (estilo solución) → **`npx tsc --noEmit` no chequea NINGÚN
archivo** (es no-op). El typecheck REAL es **`npm run build`** = `tsc -b` (compila los proyectos referenciados, incl. los
`*.test.ts` vía `tsconfig.app.json`). En el pase de la Ola 1.1 un cast en un test (`SupabaseClient as Record<…>`) pasó
`tsc --noEmit` pero **rompió `tsc -b`** (TS2352); quedó latente en staging y solo apareció en el pase a prod. **Regla:
toda verificación de un pase corre `VITE_APP_ENV=production npm run build`, NUNCA `tsc --noEmit`.** Castear tipos
incompatibles en tests: `x as unknown as T`.

---

## 0bis. ✅ RESUELTO 2026-07-06 — Tokens de GitHub rotados (seguridad)

1. **OAuth "GitHub CLI" (`gho_`) — REVOCADO.** El token que estaba **embebido en el remote de `SATORI PROPINAS`** ya se
   había limpiado del `.git/config` (`git remote set-url` sin credenciales; auth por osxkeychain); ahora además se
   **revocó la autorización OAuth** → el `gho_` expuesto queda **invalidado**, con **re-login limpio** (credencial nueva
   en el keyring de macOS).
2. **PAT classic `ghp_` "Claude CLI" — REGENERADO con scopes mínimos** (`repo` + `workflow`; **se quitó `admin:org`**).
   El valor viejo (que había quedado en un transcript local de Claude Code, `~/.claude/projects/.../*.jsonl`) queda
   **inutilizado**. (No estaba configurado en ningún remote/env/MCP; solo persistía en ese log.)

---

## 🚧 PILAR BLOQUEANTE — Arquitectura de sesión/auth escalable y multi-tenant (ALTA prioridad)

> **🔴 BLOQUEA el pase del PoS a PROD (ítem 5).**

La app hoy usa un **candado de sesión** (`navigator.locks`) que se contiende con pocos dispositivos.
El PoS llevará **~10 dispositivos concurrentes** (5 tablets salón + 2 cajas + 2 KDS + 1 cocina),
distintos usuarios al mismo tiempo. Antes del rollout del PoS hay que **rediseñar cómo cada dispositivo
mantiene su sesión sin pelear por el refresh del token**. **Objetivo de diseño:** escalable a
**HOTELERÍA con MÚLTIPLES restaurantes** y a **FRANQUICIAS** (multi-local / multi-tenant). **NO es un
parche:** es **diseño + prueba de carga simulando N dispositivos** antes de tocar prod. **Bloquea el
pase del PoS a producción.**

---

## 1. 🖊️👁️ Hora-CR en bordes de período (PLATA — cambia números, valida la dueña)
**Misma familia que el `-31`, NO tocada en el fix porque cambia atribuciones.** El fix de fechas resolvió el
400 (cobertura por día), pero las queries de plata siguen acotando `created_at` en **UTC** (`…Z`), con offset
**+6h** vs CR. Lugares: `finance.ts:132/139` (P&L borde de **año** — NO da 400 porque dic tiene 31, pero el
31-dic de noche cae en el año equivocado) y similares. **Diseño:** construir los límites en hora CR (mismo
`dateCR` ya usado). **Bloqueado por:** validación física de la dueña contra un cierre conocido (cambia números).
Ver `_handoff/RCA-FECHAS-BORDE.md` §5 + `fix/fecha-cr-consistente` (ya en staging, también pendiente de validar).

## 2. 🔲 Pendientes menores en PROD (prolijidad, NO bloquean — detectados en la validación física de las Olas)
- **404 de un recurso en la ruta `/caja`** (🆕 esta sesión) — aparece en consola, no rompe el flujo. Identificar el
  recurso (asset/manifest/SW/icono) en DevTools → Network y agregarlo o quitar la referencia. *(Relacionado, a mirar
  junto: §0.1(c) "Cmd+Shift+R en `/caja` → redirige a /login tras ~20s, riesgo latente".)*
- **404 menor sobre `propinas:1`** — probablemente un icono o source-map; las pantallas cargan igual.
- **Warning cosmético de recharts** (🆕) — `width(-1)/height(-1)` con contenedor de 0px al montar; solo ruido en consola,
  sin impacto visual. Envolver el chart para que no renderice con tamaño 0, o suprimir.
- **La Lenovo del restaurante (KDS de cocina) quedó con bundle viejo** (🆕) — requiere **Unregister SW + Clear site data**
  una vez en ese equipo para tomar el deploy nuevo (el watchdog de arranque debería curarlo solo; si no, a mano).

## 3. 🖊️ Migraciones — discrepancia 035 + verificar 038
- **035:** el ledger de staging la tiene **como aplicada** aunque el archivo solo vive en `propina-pool` (sin merge).
  Sesión dedicada de propinas: entender el origen ANTES de tocar nada. **NO tocar el historial de migraciones**.
- **038 (Bandeja):** el registro previo la marca **aplicada y firmada en STAGING** (`0205654`); este handoff la dejó
  anotada para **confirmar su estado real en el ledger** antes de actuar. A **PROD va con el pase del PoS** (sin aplicar aún ahí).
- Detalle en `_handoff/038-apply.log`. (No puedo verificar el estado del ledger desde acá — cero contacto con la base.)

## 4. 🔲 Bandeja ETAPA 2 — entrada única foto-primero 100% dentro de Caja Diaria (DISEÑADA, SIN código → es la Ola 3)
**= la Ola 3 de §1, y solo si la DECISIÓN ABIERTA de la dueña dice que la Etapa 1 no alcanza.** Hoy no hay código en
`src/modules/cash` ni `inbox`. La Bandeja **Etapa 1** (lo que SÍ está hecho y validado en staging) es distinta. Diseño de la Etapa 2:
- **Una sola entrada foto-primero** dentro de **Caja Diaria**; se **retira** el camino `facturas` (queda legacy).
- **Foto OBLIGATORIA** por pago. La **IA lee y SUGIERE** tipo/categoría (mercadería/operativo/personal/socios)
  mapeando a las categorías existentes; el **humano confirma** (nunca auto-commit de montos).
- **Propinas:** pide **turno (AM/PM)+fecha** en vez de proveedor y **concilia el pendiente**.
- **Offline — Opción A:** se registra el pago igual sin red; la IA procesa la foto al volver internet.

## 5. 🖊️ GRAN PASE del PoS a PROD — DIFERIDO (NO es una de las 3 olas)
La dueña eligió OPCIÓN A (estabilidad, §1). El gran pase del PoS es un **proyecto aparte y posterior**: consolidar las
migraciones del PoS (**022–037**) con guard anti-staging; crear buckets `facturas`/`productos`/`documents` en prod;
regenerar tipos. Bloqueado por el **PILAR de escalabilidad de sesión/auth** (abajo) + validación física del PoS (§6).
(La **Bandeja Etapa 1 + mig 038** NO espera a esto: va sola en la **Ola 2** — ver §1, sujeto a verificar que la 038 se
separe limpio de 022–037.)

## 6. 👁️ Validación física pendiente en staging (construido, verde, sin probar en piso)
Checklist en [REPORTE-NOCHE-2.md](REPORTE-NOCHE-2.md): **cobro + anti-doble-cobro** (mig 033), **comandero pro**,
**FE estructura (SIM)**, **inventario activo** (stock baja por receta + COGS al cerrar).

## 7. 🖊️ DECISIÓN dueña — propina PoS → pool (`propina-pool`, sin merge)
¿Propina de tarjeta/SINPE al **mismo** pool que efectivo (implementado) o **separada**? Sin tocar
`tipCalculations`. `git show propina-pool:ESTADO-PROPINA-POOL.md`.

## 8. 🟢 Deudas a futuro (documentadas, no urgentes)
- **Cuentas por pagar / crédito a proveedores 7-15-30 días** (fecha de PAGO ≠ fecha de registro).
- **Alerta de cambio de precio** de un producto (que el contador la detecte → ajustar la receta).
- **Offline robusto** con base local que sincroniza al volver internet.
- **Unidades de inventario por presentación** (kilo/litro/gramos; huevos por maple/caja) por ingrediente.
- **FE real:** emisor certificado CR (Hacienda 4.4) detrás de `FeProvider`. Bloqueado por CIIU/CABYS de la contadora.

## 9. 🟢 Deuda de lint del repo (ingeniería lista, baja prioridad)
`npm run lint` (eslint .) reporta **81 problemas (69 err + 12 warn) preexistentes** repartidos en ~30 archivos —
NO de ningún fix reciente. **Se absorbe en la estabilización por módulo:** al tocar un módulo, se limpia su lint
ahí; **NO barrido masivo** (68/69 son manuales — solo 1 autofixable con `--fix` — y caen en módulos en uso →
riesgo sin ganancia funcional). Dos grupos:
- **Grupo A (~28, cosmético/seguro):** `no-unused-vars`, `preserve-caught-error` (3 en `cash.ts`, solo
  observabilidad — NO matemática), `react-refresh/only-export-components`, `eslint-disable` muertos.
- **Grupo B (~41, correctness/perf-adjacent — revisar por archivo, NO `--fix` a ciegas):**
  `react-hooks/set-state-in-effect`, `react-hooks/refs`, `react-hooks/preserve-manual-memoization`.
