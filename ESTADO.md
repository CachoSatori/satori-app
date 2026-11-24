# Satori App — Estado del proyecto

> Solo lo que no sale del código ni de git. Lo viejo va tal cual a [docs/historico/ESTADO-HISTORICO.md](docs/historico/ESTADO-HISTORICO.md)
> (incluye el ESTADO íntegro previo a la poda del 20-nov).

## ⚡ ARRANQUE — foto real (se REEMPLAZA en cada entrega)
**Al día: 2026-11-24 (tarde, ~15:10 CR).** `main` = `334323c3` (merge #355). **Ledger prod = 195 · staging = 195** (ningún merge del 24-nov tocó `supabase/`; próximo libre del bloque 150–199: 196; la 189 se OMITE a propósito: agenda un cron con la URL de prod). **Punto de entrada:**
[docs/handoffs/HANDOFF-2026-11-20.md](docs/handoffs/HANDOFF-2026-11-20.md) (los handoffs del 21-nov en adelante viven en los documentos del proyecto de Claude, no en el repo).
- **Entró el 24-nov (hora CR; firma/OK del dueño por chat ~12:12 y ~13:27):** #347 Ventas 3.5.5 limpieza (`5a30b397`) · #352 pruebas con reloj fijo, R34 (`b5cc64cc`) · #348 Caja PR0: carteles de fases, «Cuadra/Faltan/Sobran» con la peor moneda, título (`222db677`) · #349 Caja PR1: estándar de los SOP, crema y Tabler (`31c2505f`) · #353 Caja: la precarga no pisa lo tecleado + aviso de déficit (`40d16c7d`) · #351 cuadros numéricos del resto de pantallas, R35 (`60f87907`) · #356 Metas: individual vacía usa la general (`6ff47566`) · #354 Ventas Equipo, menores (`ff216a5c`) · **#355** Caja: editar un pago no lo pierde si falla la red, hallazgo 252, R36 (`334323c3`, 15:06 CR). Lo del 23-nov y antes: [ESTADO-HISTORICO](docs/historico/ESTADO-HISTORICO.md) y handoffs.
- **Abierto:** #350 spec 3.1 catálogo (9 decisiones del dueño + firma de la mig 196 propuesta) · viejos: #324, #287, #262, #252. Riesgo anotado: la base todavía deja escribir competencias al contador (`ventas_comps_write`, hallazgo 253; cerrarlo = migración con firma).
- **Validación física pendiente del dueño:** Caja (carteles, crema, precarga, editar pago) · cuadros numéricos (Metas, Productos, Recetas, Cumpleaños, Puntos por rol) · Metas con meta individual vacía.
- **Regla operativa nueva (24-nov):** solo la sesión coordinadora del día actualiza ramas y mergea; las sesiones de tareas programadas dejan PRs y no tocan ramas ajenas después de entregar.
- **Decisiones del dueño (23-nov):** sin tabla propia por temporada en «Tiempos» (alcanza la barra) · negativos bloqueados en puntos por rol · plugin «satori» con `/arranque` a prueba hasta el 3-dic.
- **Archivos sagrados, sin cambios:** `tipCalculations.ts` `7603ba5a` · `cashUtils.ts` `b597c697` · `cierrePozo.ts` `bf22ee44` (tabla de abajo).
- **Edge prod:** `monthly-report` v25 · `extract-document` v21 · `cierre-email` v19 · `pago-notificar` v17 · `ventas-dia-contador` v6 · `ingest-ndf` v14 (verify_jwt false) · `alta-empleado` v13 · `club-pase` v8 (verify_jwt false). Cada merge que toca `supabase/functions/` despliega por Branching (#313). Agente PoS prod (`agente-fe`): latido OK.
- **Protección de `main`:** «Gate» requerido · rama al día (`strict`) · sin excepción para admins. Las sesiones en la nube no pueden cambiarla (403). Arnés a prueba hasta el 3-dic.
- **Decisiones vigentes:** Club en PAUSA hasta que Apple apruebe la Wallet · sin alerta de latido · **D1 (20-nov): 23:30–15:00 libre · 15:00–19:00 con OK del dueño · 19:00–23:30 solo urgente con OK** · PRs solo de `.md` se mergean sin OK únicamente de 23:30 a 15:00 · NO auto-merge de código.
- **Firma (#317):** en una sesión que clona el repo a mitad de conversación los hooks no cargan; se firma por chat con el SHA fijado (#323, #338, #339, #341, #355). Sigue sin confirmarse en una sesión que arranque ya con el repo clonado.
- **Pendiente del dueño:** correo de pago agrupado, paso 2 · próximo crédito real (#310) · #229 al lanzar el Club · validar en su Chrome lo de Caja (el navegador en la nube oculta lo que tipea una persona).
- **Cola (en orden):** RPC de reemplazo atómico de pagos (migración, con firma, antes de Nosara) · pendiente de cambio solo en el aparato (#355) · InvIngredientes: revisar en el local · flake de VentasTiempos · `ventas_comps_write` deja escribir al contador (hallazgo 253, migración con firma) · línea «Dólares» repetida en Caja · borrar `VentasContabilidad.tsx` en un PR de Edge · #324 con el dueño · nombres de inactivos B (con firma) · deuda multi-local: 067, 080 y 190 no limitan al manager a su local (antes de Nosara, con firma) · 3.4 Regalías (con firma) · Inventario (G-011 entregada; G-012 y G-014 pendientes) · rama `staging` congelada (decidir) · WhatsApp a proveedores F0 → F1a · cron del Club (job 8, verificar) · H3 de propinas (decidir).
- **Cron:** job 4 (quincena) **NO volver a aplicar**. Job 8 (Club): repetir la verificación. Job 10 (`ventas-dia-contador`): primer envío 1-dic.
- **Deploy:** `version.json` y `/api/salud` dan 403 por el proxy de la sesión: verificar por los runs «Deploy to GitHub Pages», «Cloudflare Pages: satori-club» y «Supabase Preview».

> **Definition of Done:** ninguna entrega se cierra sin ⚡ARRANQUE al día (mismo PR o PR de docs inmediato). **El repo manda:** si este archivo y la realidad no coinciden, gana la realidad y se corrige el archivo.

| Puntero | Valor |
|---|---|
| `main` (PROD, Pages `/satori-app/`; «Gate» requerido) | `334323c3` |
| `staging` | sin cambios desde el 13/11 (`5158698`, #167); su base ya está al día (prod 195; staging 195) |
| `feat/pos-desglose` | `14bd278`: rama del **agente** del PoS (`pos-bridge/`), no se mergea a `main` |
| Refs Supabase | **PROD `yiczgdtirrkdvohdquzf`** (`satori-app`) · **STAGING `hwiatgicyyqyezqwldia`** (`satori-staging`) |
| Gate | `bash scripts/ci/gate.sh` (único; mismo en CI y local) |

**Sagrados (hash de blob, regla 8; el CI los lee de aquí):**

| Archivo | Hash |
|---|---|
| `src/shared/utils/tipCalculations.ts` | `7603ba5a` |
| `src/modules/cash/cashUtils.ts` | `b597c697` |
| `cierrePozo.ts` | `bf22ee44` |
| `posFiscal.ts` (con `computeTotals`, solo `staging`) | `a3fd445f` |

[ROADMAP](ROADMAP.md) · [PROMPT-CONTINUACION](PROMPT-CONTINUACION.md) · [HALLAZGOS](HALLAZGOS.md) · [PASE-POZO-A-PROD](PASE-POZO-A-PROD.md) · [docs/README](docs/README.md) (SPECs) · [REGLAS-POR-INCIDENTE](docs/REGLAS-POR-INCIDENTE.md).

---

## 🛑 Reglas operativas (leer antes de tocar `main` o una base)
1. **Branching corre `migrate` contra PROD en cada push a `main`.** Las migraciones entran por merge → Branching; «a mano antes del merge» solo con firma del dueño y verificando el ref.
2. **Edge Functions (ítem 11, PR #313, en `main` desde el 20-nov):** con `supabase/config.toml` válido (lista blanca: solo `project_id` y `verify_jwt` por función; R04 en `scripts/ci/edgeConfig.mjs`), **las Edge entran por merge y Branching las despliega en cada push a `main`**: código de Edge en `main` = cambio en prod (firma). El Preview por PR está desactivado. Humo después del merge: versión, `verify_jwt` y `ezbr_sha256` de las 8 funciones y latido del PoS (`satori-merge-y-deploy` §4). Paquete: [PASE-item11-config-edge](docs/pases/PASE-item11-config-edge.md).
3. **Merges (D1, cambio del dueño 20/11):** libre 23:30–15:00 · 15:00–19:00 solo con OK del dueño en el momento para ese PR · 19:00–23:30 solo si es urgente y con OK del dueño (la cita dice URGENTE). Una sola sesión de CC mergea a la vez, solo sus PRs. **Excepción (20/11, a prueba hasta el 3-dic):** un PR solo de `.md` con Gate verde se mergea sin OK del dueño **solo de 23:30 a 15:00**; fuera de esa franja sigue la regla general. Lo hace cumplir la guardia de `scripts/hooks/` (marca de OK con el número de PR y `--match-head-commit`).
4. **«Ver como» usa los permisos del owner:** probar permisos con un usuario real del rol o su JWT en `begin read only` … `rollback`.
5. **ICP = propina electrónica declarada (voluntaria: tarjeta/SINPE) / neta de sus mesas.** El 10 % de servicio no entra al numerador ni al denominador; `payout_crc` no es ICP; barra: «no aplica».
6. **El PoS se lee por las funciones de la 067** (`pos_ventas_tickets_rango`, `pos_ventas_lineas`, `pos_ventas_latido`), sin medios de pago ni `clase_ingreso`. **`pos_ndf_*` cerradas a gerencia** (`owner/manager/contador`; «En vivo» también). **Ventas = solo PoS** (16/11): ninguna pantalla lee `ventas_dias`; `ventas_hist` solo antes del 2024-01-05 (guarda `src/ventasSoloPos.test.ts`).
7. **Ritual antes de cualquier comando de base:** confirmar el ref (`yiczgdti…` PROD, `hwiatgic…` staging); nunca SQL de escritura sin haberlo leído.
8. **Sagrados por hash de blob, no por `git diff`.** Nunca reimplementarlos sin acuerdo explícito.
9. **Un deploy se verifica por contenido, no por HTTP 200** (el fallback del SPA devuelve `index.html` a cualquier ruta).
10. **Nunca revertir ni borrar el `.sql` de una migración que está en el ledger de prod** (Branching falla en cada push; pasó con la 074). Si se revierte el código, el archivo se queda.
11. **La fecha del movimiento de caja es el día en que se registró (el turno), nunca la de la factura** (14/11). La de factura va a la descripción («· fact AAAA-MM-DD»; `fechaFactura.ts`).
12. **Bitácora de permisos (165) caída = no se cambian roles ni activaciones** (fail closed). Si hay que cortar un acceso igual: (1) ban o cambio de clave en Auth; (2) si hay que desactivar, como dueño de la tabla y en UNA transacción: `alter table public.profiles disable trigger trg_profiles_bitacora_permisos;` → `update public.profiles set is_active = false where id = '<UUID>';` → `alter table public.profiles enable trigger trg_profiles_bitacora_permisos;`; (3) anotarlo a mano con `origen = 'manual'` y la hora real cuando vuelva. Guía 6.6.
13. **Turno de prod (18/11):** una sola sesión toca prod o `main` a la vez. Un prompt de CC que toca prod empieza con «TURNO DE PROD: esta sesión de CC».
14. **Staging, conector (18/11):** si el conector cancela una confirmación (`drop`, `delete`), NO se reescribe el SQL para esquivarla. La batería la corre la sesión de CC del dueño (Management API, ref de staging fijo, ROLLBACK).

---

## ☁️ Edge, Cloudflare y agentes
`verify_jwt`: **off** solo en `ingest-ndf` (el agente manda `x-ingest-secret`) y `club-pase` (portón `x-club-web`); el resto **on** (`ingest-punches` no existe en prod). Secretos: por su lista (nombre + huella); código: por `ezbr_sha256`, no por versión.

| Función en prod (20-nov, tras el ítem 11) | Versión |
|---|---|
| `monthly-report` | v25 |
| `extract-document` | v21 |
| `cierre-email` | v19 |
| `pago-notificar` | v17 |
| `ventas-dia-contador` | v6 |
| `ingest-ndf` | v14 (verify_jwt false) |
| `alta-empleado` | v13 |
| `club-pase` | v8 (verify_jwt false) |

El código de `main` es el desplegado (Branching); las fuentes por rama de antes del ítem 11 están en el [histórico](docs/historico/ESTADO-HISTORICO.md).

- **Cloudflare:** Pages `satori-club` y Worker `satori-club-api` (Workers Builds desde `main`; secretos a mano). **Agentes del PoS:** staging @ `14bd278`; prod `agente-fe` @ `07782e49`. `biotime-bridge` publica solo a staging.

---

## 🗃️ Migraciones

### Numeración de migraciones
> **Fuente de verdad:** `supabase/migraciones-reservadas.json` (origen → número final de cada una), que lee `supabase/migraciones.test.ts`. La tabla número a número está en el [histórico](docs/historico/ESTADO-HISTORICO.md).

1. **Bloques por rama:** CAJA / operación **087–99** (**lleno**; un número nuevo de caja hay que pedirlo al dueño) · CLUB SATORI + puente **100–149** (próximo libre **140**) · PASE A PROD **150–199** (solo renumeraciones del pase; próximo libre **196**; la 195 = origen 139, #323). La **086** queda libre.
2. Cada PR que agrega una migración actualiza el registro. El gate falla si no está registrada, queda fuera del bloque de su rama o repite número.
3. **Pase a prod:** ninguna migración entra con número ≤ al último del ledger de prod; se renombra al siguiente libre del bloque 150–199, en el mismo PR (archivo, rollback, pruebas, scripts), con `origen` en el registro. Branching rechaza una versión menor que la última aplicada.
4. Un número usado no se reutiliza. Las versiones son **texto**: `0090` y `0095` son históricas y distintas de `090` / `095`.

**Ledger de prod: 195**. Staging: 195 (189 omitida; faltan las filas viejas 065 y 066).

Números registrados (lo exige el test; origen y destino en el JSON y en el histórico):
| 075 | 078 | 080 | 081 | 082 | 083 | 084 | 085 | 087 | 088 | 089 | 090 | 091 | 092 | 093 | 094 | 095 | 096 | 097 | 098 | 099 | 100 | 101 | 102 | 103 | 104 | 105 | 106 | 107 | 108 | 109 | 110 | 111 | 112 | 113 | 114 | 115 | 116 | 117 | 118 | 119 | 120 | 121 | 122 | 124 | 125 | 126 | 127 | 128 | 129 | 130 | 131 | 132 | 133 | 134 | 135 | 136 | 137 | 138 | 139 | 150 | 151 | 153 | 155 | 156 | 157 | 158 | 159 | 160 | 161 | 162 | 163 | 164 | 165 | 166 | 167 | 168 | 169 | 170 | 171 | 172 | 173 | 174 | 175 | 176 | 177 | 178 | 179 | 180 | 181 | 182 | 183 | 184 | 185 | 186 | 187 | 188 | 189 | 190 | 191 | 192 | 193 | 194 | 195 |

## 🔒 Abierto que sigue vigente
- **Seguridad en prod:** 4 `SECURITY DEFINER` ejecutables por `anon` (`get_my_role`, `handle_new_user`, `log_movement_edit`, `unif_on_cash_movement`); sin `supabase/config.toml`.
- **Caja · documentos huérfanos al borrar un movimiento** (`delete_movement_cascade`): después del piloto, con firma.
