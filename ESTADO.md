# Satori App — Estado del proyecto

> Vivo y corto (poda >15 KB: lo viejo va a [docs/historico/ESTADO-HISTORICO.md](docs/historico/ESTADO-HISTORICO.md)).
> Ahí está la foto íntegra del 17/11: tabla de PRs del 15–17/11, bitácora por migración, filas de los ledgers, camino de las
> ventas, qué hay en prod y en staging, pendientes de estabilización, seguridad abierta y notas. Más viejo: [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md).

## ⚡ ARRANQUE — foto real (se REEMPLAZA en cada entrega, no se acumula)
**Al día: 2026-11-18 (mañana).** `main` = `00d4e4a` (tras #284, #285 y #282). **Ledger de prod = 189** (cron jobid 10 `satori-ventas-dia-contador`, `0 13 1,16 * *` = 07:00 CR los días 1 y 16; primer envío el 1-dic). Sagrados iguales (tabla de abajo). **Punto de entrada:** [docs/handoffs/HANDOFF-2026-11-13.md](docs/handoffs/HANDOFF-2026-11-13.md) (los del 15–18-nov están en el proyecto privado).
- **Entró a `main` el 17–18-nov:** #255–#258, #260, #261, #263, #265, #266, #268 (mig 185), #269, #270, #271–#273 (migs 186–188), #274, #284 (correo del contador y mig 189), #285 (resumen del cierre como función pura, sin Edge) y #282 (guía 6.13 del Club).
- **Edge de prod:** `cierre-email` **v16** (desde `f8b6c2a6`, rama de #283: resumen de ventas en el correo de cierre, remitente propio; ezbr `c222f5df…`; vuelta atrás = `b02d2841` + remitente) · `ventas-dia-contador` **v4** (desde `060b539`, rama de #281; ezbr `439b3914…`; `verify_jwt` on). El resto, como está en la tabla de Edge.
- **Agente del PoS de prod:** `C:\satori\agente-sal` @ `89c5aa42` (pase #262 hecho el 18-nov: tarea cambiada 06:23:43, re-backfill 2024-01…2026-11 completo, N = 11.505; salón 90 d sin salonero 370 → 172). Vuelta atrás: `C:\satori\agente-d9` @ `578f38c`, con la config en `C:\satori\sal-vuelta`. Bitácora en la rama de #262 (no va a `main`).
- **Staging:** ledger **188** (185–188 aplicadas el 18-nov 06:04 por la sesión de CC del dueño).
- **Hallazgos nuevos (no es plata):** (1) el agente toma `clave_fe` por número de consecutivo sin filtrar el tipo de documento: tiquetes tipo 04 de mar/abr-2026 quedan con la clave de la factura 01 del mismo consecutivo (675 filas al 18-nov) y crece con cada factura nueva; arreglo en curso. (2) El reporte de ventas redondea por grupo (salonero) y después suma: el total del día puede moverse ±₡1 si cambia el salonero; arreglo propuesto: sumar y redondear por día. Detalle en [HALLAZGOS.md](HALLAZGOS.md).
- **Cola (Menor):** `cierre_read` deja leer cierres a cualquier usuario autenticado del local (cualquiera puede disparar el correo con resumen; los datos solo llegan al dueño); la Edge del cierre lee filas crudas de 4 días.
- **Abiertos sin firma:** #262 (rama del agente, no va a `main`), #259 (fast-check, 3 hallazgos `it.fails`), #257, #264, #252, #246 (SPEC Ventas v2). **Falta validación física del dueño:** #229 (en servicio), Club 186–188 y Ventas #274 en prod.
- **Cron:** job 4 (quincena) aplicado el 16-nov, **NO volver a aplicar**. Job 8 (Club): repetir la verificación el 23-nov.
- **Deploy:** `version.json` y `/api/salud` no se ven desde la sesión (proxy 403): verificar por los runs «Deploy to GitHub Pages», «Cloudflare Pages: satori-club» y «Supabase Preview».

> **Definition of Done:** ninguna entrega se cierra sin ⚡ARRANQUE al día (mismo PR o PR de docs inmediato). **El repo manda:** si este archivo y la realidad no coinciden, gana la realidad y se corrige el archivo.

| Puntero | Valor |
|---|---|
| `main` (PROD, Pages `/satori-app/`, sin regla de protección) | `00d4e4a` (#282) |
| `staging` | sin cambios desde el 13/11 (`4726b7f`); su base está en ledger 184 (ponerla al día: en cola) |
| `feat/pos-desglose` | `14bd278`: rama del **agente** del PoS (`pos-bridge/`), no se mergea a `main` |
| Refs Supabase | **PROD `yiczgdtirrkdvohdquzf`** (`satori-app`) · **STAGING `hwiatgicyyqyezqwldia`** (`satori-staging`) |
| Gate de `main` (17/11 23:23) | vitest 2933 pasan / 4 skip · eslint 80 (tope 83) · build OK |
| Merges (regla D1) | libre 23:30–15:50 · bloqueado 15:50–19:00 · 19:00–23:30 solo con OK del dueño en el momento |

**Sagrados (por hash de blob):**

| Archivo | Hash |
|---|---|
| `src/shared/utils/tipCalculations.ts` | `7603ba5a` |
| `src/modules/cash/cashUtils.ts` | `b597c697` |
| `cierrePozo.ts` | `bf22ee44` (referencia del 16/11) |
| `posFiscal.ts` (con `computeTotals`) | `a3fd445f`, solo en `staging`; en `main` no existe |

Docs: [ROADMAP.md](ROADMAP.md) · backlog [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · [HALLAZGOS.md](HALLAZGOS.md) · [PASE-POZO-A-PROD.md](PASE-POZO-A-PROD.md) · SPECs [docs/README.md](docs/README.md) · incidentes → reglas [docs/REGLAS-POR-INCIDENTE.md](docs/REGLAS-POR-INCIDENTE.md).

---

## 🛑 Reglas operativas (leer antes de tocar `main` o una base)
1. **Branching corre `migrate` contra PROD en cada push a `main`** Desde la 085 las migraciones entran **por merge → Branching**. «A mano antes del merge» es histórico: solo con firma del dueño y verificando antes el ref.
2. **Ningún PR a `main` con archivos bajo `supabase/functions/` hasta cerrar el ítem 11** (versionar `ingest-ndf` con `config.toml`): sin `config.toml`, Branching despliega con `verify_jwt=true` y el agente del PoS (solo `x-ingest-secret`) recibe 401. El código de `main` está atrasado y pisaría prod: `monthly-report` (anterior a SEC-02), `extract-document` (prod = `8a8dfb6`, rama `claude/busy-brown-ssjq4e`; el de `main` deja la Bandeja vacía con `claude-sonnet-5-5`), `ingest-ndf` y `alta-empleado` (ramas aparte). `club-pase` entra con **`verify_jwt = false`** (el portón es `x-club-web`); hasta el ítem 11 se despliega a mano desde `claude/club-pase-edge`.
3. **Merges D1 (13/11):** libre 23:30–15:50 · bloqueado 15:50–19:00 · 19:00–23:30 solo con OK explícito del dueño en el momento. Una sola sesión de CC mergea a la vez, solo sus PRs.
4. **«Ver como» usa los permisos del owner:** probar permisos con un usuario real del rol o su JWT en `begin read only` … `rollback`.
5. **ICP = propina electrónica declarada (voluntaria: tarjeta/SINPE) / neta de sus mesas.** El 10 % de servicio no entra al numerador ni al denominador; `payout_crc` no es ICP; barra: «no aplica».
6. **El PoS se lee por las funciones de la 067** (`pos_ventas_tickets_rango`, `pos_ventas_lineas`, `pos_ventas_latido`), sin medios de pago ni `clase_ingreso`. **`pos_ndf_*` cerradas a gerencia** (`owner/manager/contador`), sin policy nueva. Excepción: «En vivo» (solo gerencia).
7. **Ritual antes de cualquier comando de base:** confirmar el ref (`yiczgdti…` PROD, `hwiatgic…` staging); nunca SQL de escritura sin haberlo leído.
8. **Sagrados por hash de blob, no por `git diff`.** Nunca reimplementarlos sin acuerdo explícito.
9. **Un deploy se verifica por contenido, no por HTTP 200** (el fallback del SPA devuelve `index.html` a cualquier ruta).
10. **Nunca revertir ni borrar el `.sql` de una migración que está en el ledger de prod** (si no, Branching falla en cada push; pasó con la 074). Si se revierte el código, el archivo se queda.
11. **La fecha del movimiento de caja es el día en que se registró (el turno), nunca la de la factura** (14/11). La de factura va a la descripción («· fact AAAA-MM-DD») y se analiza con `src/shared/utils/fechaFactura.ts` (clave FE manda; sin clave, la única lectura día/mes posible; si hay dos, la pantalla pregunta; más de 7 días avisa, no bloquea).
12. **Bitácora de permisos (165) caída = no se cambian roles ni activaciones** (fail closed, 14/11). Si hay que cortar un acceso igual: (1) ban o cambio de clave en Supabase Auth; (2) si además hay que desactivar, soporte, como dueño de la tabla y en UNA transacción: `alter table public.profiles disable trigger trg_profiles_bitacora_permisos;` → `update public.profiles set is_active = false where id = '<UUID>';` → `alter table public.profiles enable trigger trg_profiles_bitacora_permisos;`; (3) anotarlo a mano con `origen = 'manual'` y la hora real cuando vuelva.  Guía 6.6.

---

## ☁️ Edge, Cloudflare, cron y agentes (leído 12–17/11; solo lectura)
Versiones re-leídas 18-nov. Las fuentes de las ramas de correo todavía no tienen el FROM nuevo (pendiente en cola). `on`/`off` = `verify_jwt`. Confirmar secretos por su lista (nombre + huella); el código, por `ezbr_sha256`

| Función | PROD | STAGING |
|---|---|---|
| `monthly-report` | v24 · on (desde `50831a8e`, #245+#241, + remitente propio 18-nov) | v9 · on |
| `extract-document` | v20 · on (código desde `8a8dfb6`, rama `claude/busy-brown-ssjq4e`, modelo `claude-sonnet-5-5`) | v29 desde `190b5f5` |
| `cierre-email` | v16 · on (desde `f8b6c2a6`, rama de #283, + remitente propio) | v15 · on |
| `pago-notificar` | v15 · on (desde `588c5593`, #243, + remitente propio) | — |
| `ventas-dia-contador` | v4 · on (desde `060b539`, rama de #281; ezbr `439b3914…`) | — |
| `ingest-ndf` | v13 · off (código v3 del 09/11 desde `5da233a`; vive en `claude/puente-item11-prod-v2`) | v21 · off |
| `ingest-punches` | — | v13 · off |
| `alta-empleado` | v12 · on (rama `claude/alta-empleado-fn`) | v8 · on |
| `club-pase` | v7 · off (rama `claude/club-pase-edge` @ `6c5848e`) | v1 · off (`WALLET_ENTORNO` = `stg`) |

- **Cloudflare:** Pages `satori-club` y Worker `satori-club-api` (Workers Builds desde `main`; secretos a mano; `/api/salud`). **Cron del Club:** jobid 8.
- **Agentes del PoS:** «Satori PoS Bridge» (staging, @ `14bd278`) y «… PROD» (`C:\satori\agente-sal` @ `89c5aa42` desde el 18/11, cuenta SYSTEM). `biotime-bridge` publica solo a staging (`ingest-punches`).
- **Ventas = solo PoS** (firmado 16/11): ninguna pantalla lee `ventas_dias`; `ventas_hist` solo antes del 2024-01-05. Guarda: `src/ventasSoloPos.test.ts`.

---

## 🗃️ Migraciones

### Numeración de migraciones (regla del dueño, 08/11)
> **Fuente de verdad:** `supabase/migraciones-reservadas.json`, que lee `supabase/migraciones.test.ts`. La bitácora larga de cada número está en el [histórico](docs/historico/ESTADO-HISTORICO.md).

1. **Bloques por rama:** CAJA / operación **087–99** (**lleno**: la 099 fue la última, 17/11; un número nuevo de caja hay que pedirlo al dueño) · CLUB SATORI + puente **100–149** (próximo libre **137**; 134, 135 y 136 se reservaron para pasar directo a 190, 191 y 193) · PASE A PROD **150–199** (solo renumeraciones del pase; la **190** (`pos_ventas_resumen`) está en prod desde el 18-nov; la **191** la toma `claude/pos-ventas-solo-lo-suyo` (#292, sin firma); la **192** la pide #295 (propinas); la **193** la toma `claude/ventas-v2-23-tiempos` (#294, sin firma; provisoria: el número se fija al mergear); próximo libre **194**). La **086** queda libre.
2. Cada PR que agrega una migración actualiza esta tabla y el registro. El gate falla si no está registrada, queda fuera del bloque de su rama o repite número.
3. **Pase a prod:** ninguna migración entra con número ≤ al último del ledger de prod; se renombra al siguiente libre del bloque 150–199 (nunca a uno de creación), en el mismo PR (archivo, rollback, pruebas, scripts, fila del ledger de staging), con `origen` en el registro. Branching rechaza una versión menor que la última aplicada.
4. Un número usado no se reutiliza. Las versiones son **texto**: `0090` y `0095` son históricas y distintas de `090` / `095`.

**Ledger de prod: 189** (150–189 por merge → Branching, 11/11–18/11; PASE de cada una en `docs/pases/`). Staging: 188; le faltan las filas viejas 065 y 066.

| Número | Detalle (nombre en el registro JSON; `←` origen, `→` renumerada) |
|---|---|
| 075 | → 150 |
| 078 | no usar (fue Prom/PAX, pasó a 080) |
| 080 | prod |
| 081 | prod |
| 082 | prod |
| 083 | solo staging |
| 084 | solo staging |
| 085 | prod |
| 087 | propuesta sin firma; irá a 152+ |
| 088 | propuesta sin firma; irá a 152+ |
| 089 | prod |
| 090 | prod |
| 091 | prod |
| 092 | prod |
| 093 | prod |
| 094 | prod |
| 095 | prod |
| 096 | → 153 |
| 097 | → 177 |
| 098 | → 178 |
| 099 | → 185 (seguridad: obligar a cambiar la contraseña; PR en borrador, sin firma) |
| 100 | → 151 |
| 101 | → 159 |
| 102 | → 155 |
| 103 | → 156 |
| 104 | → 157 |
| 105 | → 158 |
| 106 | → 160 |
| 107 | → 161 |
| 108 | → 162 |
| 109 | → 163 |
| 110 | → 164 |
| 111 | → 165 |
| 112 | → 166 |
| 113 | → 167 |
| 114 | → 168 |
| 115 | → 169 |
| 116 | → 170 |
| 117 | → 171 |
| 118 | → 172 |
| 119 | → 173 |
| 120 | → 174 |
| 121 | → 175 |
| 122 | → 176 |
| 124 | → 179 |
| 125 | → 180 |
| 126 | → 181 |
| 127 | → 182 |
| 128 | → 183 |
| 129 | → 184 |
| 130 | → 186 (cumpleaños: el owner deshace «enviado»; #271, en prod 17-nov) |
| 131 | → 187 (retos: un local por reto + tope de 3 armados por año por local; #272, en prod 17-nov) |
| 132 | → 188 (getEdadSocio por función con control de local; #273, en prod 17-nov) |
| 133 | → 189 (cron del correo quincenal de ventas por día al contador; reservado para pasar directo a 189) |
| 134 | → 190 (Ventas v2: `pos_ventas_resumen`, solo lectura; reservado para pasar directo a 190) |
| 135 | → 191 (ventas del PoS: cada uno ve solo lo suyo + `pos_nombres_por_login`; reservado para pasar directo a 191; la 134 → 190 es de `claude/ventas-v2-resumen-fn`) |
| 136 | → 193 (Ventas v2 «Tiempos»: `pos_ventas_tiempos`, `pos_ventas_internas`, `pos_mesas_internas`; reservado para pasar directo a 193, provisoria) |
| 150 | ← 075 |
| 151 | ← 100 |
| 153 | ← 096 |
| 155 | ← 102 |
| 156 | ← 103 |
| 157 | ← 104 |
| 158 | ← 105 |
| 159 | ← 101 |
| 160 | ← 106 |
| 161 | ← 107 |
| 162 | ← 108 |
| 163 | ← 109 |
| 164 | ← 110 |
| 165 | ← 111 |
| 166 | ← 112 |
| 167 | ← 113 |
| 168 | ← 114 |
| 169 | ← 115 |
| 170 | ← 116 |
| 171 | ← 117 |
| 172 | ← 118 |
| 173 | ← 119 |
| 174 | ← 120 |
| 175 | ← 121 |
| 176 | ← 122 |
| 177 | ← 097 |
| 178 | ← 098 |
| 179 | ← 124 |
| 180 | ← 125 |
| 181 | ← 126 |
| 182 | ← 127 |
| 183 | ← 128 |
| 184 | ← 129 |
| 185 | ← 099 (#268, en prod 17-nov) |
| 186 | ← 130 (#271, en prod 17-nov) |
| 187 | ← 131 (#272, en prod 17-nov) |
| 188 | ← 132 (#273, en prod 17-nov) |
| 189 | ← 133 (cron `satori-ventas-dia-contador`, 1 y 16 a las 07:00 CR; en prod 18-nov, jobid 10; PASE-189) |
| 190 | ← 134 (`pos_ventas_resumen`, Ventas v2 «Resumen»; en prod 18-nov por #291; PASE-190) |
| 191 | ← 135 (cierra la fuga de la 067: personal solo lo suyo, manager sus locales; + `pos_nombres_por_login`; #292 en borrador, sin firma; PASE-191) |
| 193 | ← 136 (`pos_ventas_tiempos`: horas de todos los canales, tiempo sentado, `pos_mesas_internas` + `pos_ventas_internas`; #294 en borrador, sin firma; provisoria: se fija al mergear; PASE-193) |

083, 084, 087 y 088 (caja) van a 152+ con su paquete.

## 🔒 Abierto que sigue vigente
- **Seguridad en prod:** 4 `SECURITY DEFINER` ejecutables por `anon` (`get_my_role`, `handle_new_user`, `log_movement_edit`, `unif_on_cash_movement`); sin `supabase/config.toml`.
- **Caja · documentos huérfanos al borrar un movimiento** (`delete_movement_cascade`): después del piloto, con firma.
