# Satori App — Estado del proyecto

> Solo lo que no sale del código ni de git. Lo viejo va tal cual a [docs/historico/ESTADO-HISTORICO.md](docs/historico/ESTADO-HISTORICO.md)
> (incluye el ESTADO íntegro previo a la poda del 20-nov).

## ⚡ ARRANQUE — foto real (se REEMPLAZA en cada entrega)
**Al día: 2026-11-20 (05:30 -06:00).** `main` = `311bca6d` (merge #304, 05:20). **Ledger prod = 194 · staging = 194** (190–194 aplicadas el
19-nov, md5 = prod; la 189 se OMITE a propósito: agenda un cron con la URL de prod). **Punto de entrada:**
[docs/handoffs/HANDOFF-2026-11-19.md](docs/handoffs/HANDOFF-2026-11-19.md).
- **Entró el 19–20-nov:** #264, #257, #299, #301, #302, #300, #303, #304.
- **Edge prod:** `pago-notificar` v16 (vuelta atrás v15); el resto igual. **Agente PoS prod** (`agente-fe`): latido OK (último poll ~3 min).
- **Protección de `main`:** «Gate» requerido · rama al día (`strict`) · sin excepción para admins. Las sesiones en la nube no pueden cambiarla (403):
  GitHub → Settings → Branches. Arnés a prueba hasta el 3-dic.
- **Decisiones del dueño (19–20-nov):** Club en PAUSA hasta que Apple apruebe la Wallet · sin alerta de latido por ahora · WhatsApp automático a
  proveedores: spec en curso, prioridad alta (foto en la base, migración con firma) · **PRs solo de `.md` se mergean sin OK del dueño con Gate verde,
  solo de 23:30 a 15:00** (a prueba hasta el 3-dic) · **D1 nueva (20-nov):** libre 23:30–15:00, 15:00–19:00 con OK, 19:00–23:30 urgente con OK · NO se adopta auto-merge de código · `settings.json` con deny + hooks, spec de staging para agentes y esta poda: en curso.
- **Pendiente del dueño:** correo de pago agrupado (PR #303, ya en `main`) · #229 al lanzar el Club (0 visitas de socios desde el 17-nov).
- **Cron:** job 4 (quincena) aplicado el 16-nov, **NO volver a aplicar**. Job 8 (Club): repetir la verificación el 23-nov. Job 10 (`ventas-dia-contador`): primer envío 1-dic.
- **Deploy:** `version.json` y `/api/salud` dan 403 por el proxy de la sesión: verificar por los runs «Deploy to GitHub Pages», «Cloudflare Pages: satori-club» y «Supabase Preview».

> **Definition of Done:** ninguna entrega se cierra sin ⚡ARRANQUE al día (mismo PR o PR de docs inmediato). **El repo manda:** si este archivo y la realidad no coinciden, gana la realidad y se corrige el archivo.

| Puntero | Valor |
|---|---|
| `main` (PROD, Pages `/satori-app/`; «Gate» requerido) | `311bca6d` |
| `staging` | sin cambios desde el 13/11 (`4726b7f`); su base ya está al día (ledger 194) |
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
2. **Edge Functions (ítem 11, PR #313, a la espera de firma):** hasta ese merge, ningún PR a `main` con `supabase/functions/` (despliegue manual desde la rama viva, con firma). Desde el merge, con `supabase/config.toml` válido (lista blanca: solo `project_id` y `verify_jwt` por función; R04 en `scripts/ci/edgeConfig.mjs`), **las Edge entran por merge y Branching las despliega en cada push a `main`**: código de Edge en `main` = cambio en prod (firma). El Preview por PR está desactivado. Humo después del merge: versión, `verify_jwt` y `ezbr_sha256` de las 8 funciones y latido del PoS (`satori-merge-y-deploy` §4). Paquete: [PASE-item11-config-edge](docs/pases/PASE-item11-config-edge.md).
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

| Función en prod (20-nov, leído de prod) | Fuente del código desplegado |
|---|---|
| `monthly-report` v24 | `50831a8e` (#245) + remitente propio (sin commit; va en el PR del ítem 11) |
| `extract-document` v20 | `190b5f59`, rama `claude/extract-document-sin-datos` |
| `cierre-email` v17 | `87364a84`, rama `claude/cierre-email-redondeo` (comentarios aparte) |
| `pago-notificar` v16 | `9088687b`, rama `claude/pago-notificar-agrupado` |
| `ventas-dia-contador` v5 | `78e95953`, rama `claude/ventas-dia-contador-redondeo` (comentarios aparte) |
| `ingest-ndf` v13 | `5da233a5`, rama `claude/puente-item11-prod-v2` |
| `alta-empleado` v12 | `942d12f5`, rama `claude/alta-empleado-fn` |
| `club-pase` v7 | `5cc50737` (= `6c5848e`), rama `claude/club-pase-edge` |

- **Cloudflare:** Pages `satori-club` y Worker `satori-club-api` (Workers Builds desde `main`; secretos a mano). **Agentes del PoS:** staging @ `14bd278`; prod `agente-fe` @ `07782e49`. `biotime-bridge` publica solo a staging.

---

## 🗃️ Migraciones

### Numeración de migraciones
> **Fuente de verdad:** `supabase/migraciones-reservadas.json` (origen → número final de cada una), que lee `supabase/migraciones.test.ts`. La tabla número a número está en el [histórico](docs/historico/ESTADO-HISTORICO.md).

1. **Bloques por rama:** CAJA / operación **087–99** (**lleno**; un número nuevo de caja hay que pedirlo al dueño) · CLUB SATORI + puente **100–149** (próximo libre **139**) · PASE A PROD **150–199** (solo renumeraciones del pase; próximo libre **195**). La **086** queda libre.
2. Cada PR que agrega una migración actualiza el registro. El gate falla si no está registrada, queda fuera del bloque de su rama o repite número.
3. **Pase a prod:** ninguna migración entra con número ≤ al último del ledger de prod; se renombra al siguiente libre del bloque 150–199, en el mismo PR (archivo, rollback, pruebas, scripts), con `origen` en el registro. Branching rechaza una versión menor que la última aplicada.
4. Un número usado no se reutiliza. Las versiones son **texto**: `0090` y `0095` son históricas y distintas de `090` / `095`.

**Ledger de prod: 194**. Staging: 194 (189 omitida; faltan las filas viejas 065 y 066).

Números registrados (lo exige el test; origen y destino en el JSON y en el histórico):
| 075 | 078 | 080 | 081 | 082 | 083 | 084 | 085 | 087 | 088 | 089 | 090 | 091 | 092 | 093 | 094 | 095 | 096 | 097 | 098 | 099 | 100 | 101 | 102 | 103 | 104 | 105 | 106 | 107 | 108 | 109 | 110 | 111 | 112 | 113 | 114 | 115 | 116 | 117 | 118 | 119 | 120 | 121 | 122 | 124 | 125 | 126 | 127 | 128 | 129 | 130 | 131 | 132 | 133 | 134 | 135 | 136 | 137 | 138 | 150 | 151 | 153 | 155 | 156 | 157 | 158 | 159 | 160 | 161 | 162 | 163 | 164 | 165 | 166 | 167 | 168 | 169 | 170 | 171 | 172 | 173 | 174 | 175 | 176 | 177 | 178 | 179 | 180 | 181 | 182 | 183 | 184 | 185 | 186 | 187 | 188 | 189 | 190 | 191 | 192 | 193 | 194 |

## 🔒 Abierto que sigue vigente
- **Seguridad en prod:** 4 `SECURITY DEFINER` ejecutables por `anon` (`get_my_role`, `handle_new_user`, `log_movement_edit`, `unif_on_cash_movement`); sin `supabase/config.toml`.
- **Caja · documentos huérfanos al borrar un movimiento** (`delete_movement_cascade`): después del piloto, con firma.
