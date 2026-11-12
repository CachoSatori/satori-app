# IDs del auditor ↔ commit ↔ SHA ↔ prueba que falla sin el arreglo

> DOC-AUD-02 (Grok, r7, 09-nov). Este archivo es la tabla de verdad entre los números del auditor y el trabajo hecho.
> Reglas desde hoy:
> - Un **ID del auditor** (`CLUB-AUD-nn`, `R-nn`, `Grok nn`, `G-nn`) se usa solo cuando el trabajo responde a **ese** ítem
>   del registro del auditor.
> - Los hallazgos propios de Claude llevan prefijo propio: **`CLAUDE-HALL-nn`**.
> - «Prueba que falla sin el arreglo» quiere decir que se **deshizo** el arreglo y se corrió la prueba:
>   - SQL: dentro de la transacción descartada de la batería, con `scripts/sql/mutar_bateria.py` y
>     `scripts/sql/mutaciones_r7.json`;
>   - código: en una copia del archivo.
>
>   En los dos casos, la prueba **cayó**.

## 1. Renombre: lo que estaba como CLUB-AUD-71…74 y no era del auditor
En la tanda «pre2» (08-nov) usé los números 71–74 para hallazgos que **no** describen lo mismo que el registro del
auditor: su CLUB-AUD-71 es, por ejemplo, «convertir un socio en anfitrión solo por `club_rol_activar_anfitrion`»
(P-R7-A). Pasaron a prefijo propio en el código, las pruebas y los docs vigentes (075, batería, `075_rollback.sql`,
club-web, la app, PLAN y RUNBOOK). Las bitácoras de esa fecha (`NOCHE-2026-11-08-pre2.md`,
`NOCHE-2026-11-08-RESUMEN.md`, `AVANCE-LC.md`) quedan como historia: esta tabla es la traducción.

| Antes (mal) | Ahora | Qué es | Commit | Prueba |
|---|---|---|---|---|
| CLUB-AUD-71 | **CLAUDE-HALL-01** | Un alta provisional vencida sin confirmar no se renueva en caja; la valida gerencia distinta de quien la cargó | `64d969a` | batería 57 («CLAUDE-HALL-01: …») |
| CLUB-AUD-72 | **CLAUDE-HALL-02** | Autoalta con un WhatsApp existente: no cambia nada, deja una solicitud | `208cdc2` | batería 57 («CLAUDE-HALL-02: …») |
| CLUB-AUD-73 | **CLAUDE-HALL-03** | Purga de autoaltas sin validar; aviso fiel; `aviso_version` en caja | `b6ab9b3` | batería 57 («CLAUDE-HALL-03: …») |
| CLUB-AUD-74 | **CLAUDE-HALL-04** | Tope por prefijo de red en `/api/alta`; alerta al 80 % del cupo; Turnstile de prod en el RUNBOOK | `80cbfa3` | batería 57 y `club-web/functions/_lib/api.test.mjs` |
| — | **CLAUDE-HALL-05** (nuevo, sin tocar) | `authenticated` tiene MAINTAIN en 75 tablas de `public` (10 del Club): la 075 §3 revoca una lista sin `maintain` y los privilegios por defecto de `postgres` lo dan | — | Diagnóstico y propuesta en [`CLAUDE-HALL-05-maintain.md`](CLAUDE-HALL-05-maintain.md) (sin aplicar) |


Lo que el auditor tiene como CLUB-AUD-72, 73 y 74 **no lo tengo en el repo**. No lo doy por hecho por haber usado esos
números.

## 2. P-R7-F: R02, 55, 56, 60, 61, 43, 47, 48 y 64

| ID del auditor | Estado | Arreglo (SHA) | Dónde (líneas de hoy) | Prueba que FALLA sin el arreglo |
|---|---|---|---|---|
| **R02** | Arreglado | `8a76ed8`: sin el código de PROMO CLUB, las dos verificaciones salen «pendiente de configuración». Base: `495331b` (R-02 CUPON_SIN_PROMO) | `supabase/migrations/075_club_satori_esquema.sql` ~3218–3226 (dentro de `club_excepciones`) | Batería **22** y **44** («R02: sin artículo marcador … sale "pendiente de configuración"»). Sin el arreglo (`where false` en ese tramo; mutación `R02`) **caen las dos**. |
| **55** | **ABIERTO: hace falta el texto del auditor** | — | No está en el repo ni en el historial de ninguna rama, ni como CLUB-AUD-55 ni como Grok 55. | Sin el texto del registro del auditor no se puede ubicar, arreglar ni probar. **No se da por cerrado.** |
| **56** (G-56) | Arreglado el mecanismo; **falta la firma del dueño** y decidir las excepciones de funciones (Grok 114) | `4a2ded8` (análisis real del SQL, B1), `a17857b` (lista cerrada del migrador y aplicar firmado), `1f040bb` (lista blanca de funciones, Grok 114) | `scripts/club/sql_g56.py`: `revisar` ~463, `revisar_migrador` ~554, `_llamadas` ~256, `INMUTABLES` ~50 | `test_sql_g56.py`: `Trucados.test_el_filtro_viejo_los_dejaba_pasar` muestra que el filtro anterior **aceptaba** los 4 trucados de la auditoría; `test_el_nuevo_los_rechaza` los rechaza. `Grok114.test_el_filtro_anterior_los_dejaba_pasar` toma el archivo de `a17857b` y muestra que **aceptaba** una llamada por forma; `test_el_nuevo_los_rechaza_por_la_llamada` las rechaza. |
| **60** | **ABIERTO: hace falta el texto del auditor** | — | Ni CLUB-AUD-60 ni Grok 60 en el repo ni en el historial. | Igual que el 55: **no se da por cerrado** hasta tener el texto. |
| **61** (G-61) | Mecanismo y frenos de modo prod arreglados; **falta la lectura de prod con la firma** (no corre sin `--prod-firmado`) | `4fb5f28` (G-61 mecánico), `4a2ded8` (B6: A = B y piso en modo prod); hoy: la prueba no sale a la red | `scripts/sql/gate61.sh` 49–57 (modo prod) y 63–64 (lectura de prod solo firmada) | `gate61_test.sh` («modo prod: A = B», «prod: A = B (mismo archivo)», «prod: MIN_OBJETOS bajo el piso», «ningún caso salió a la red»). Con el `gate61.sh` de `4fb5f28` (antes de B6) **caen 3**. |
| **43** (CLUB-AUD-43) | **Parcial**: la lista W1–W14 del auditor no está en el repo | `3439244` (4 asserts reforzados) y `4a0f202` (ítem 43 del PLAN: 16 asserts y un arreglo en `club_sin_cruce_elegir`) | batería 53 (check «solo el socio puede estar pendiente»), 33, 43, 45; 70–87 | Batería **53** «solo el socio puede estar pendiente (check)». Sin el check (mutación `CLUB-AUD-43`) **cae** («anfitrión pendiente» aceptado). Las mutaciones M1–M4 de `4a0f202` están en `NOCHE-2026-11-09-A.md`. **Falta contrastar con W1–W14.** |
| **47** (CLUB-AUD-47) | Arreglado, en la rama del puente | `c9a7d9e` (puente). Fijado en el código del pase `5da233a` | `src/shared/ndf/ingestNdf.ts` ~793 (`localDelSecreto`: un secreto repetido → nadie entra), en `claude/puente-item11-prod-v2` | `ingestNdf.test.ts:592` («CLUB-AUD-47: secretos de 32 o más, sin repetir»). Sin el control de repetidos **cae** «el mismo secreto en dos locales es un error de configuración: nadie entra». |
| **48** (CLUB-AUD-48) | Arreglado, en la rama del puente | `c9a7d9e` (puente). Fijado en `5da233a` | `src/shared/ndf/ingestNdf.ts` ~309–325 (`MAX_TEXTO`, `MAX_CLAVE`) | `ingestNdf.test.ts:603` («CLUB-AUD-48: topes de largo»). Sin el recorte ni el descarte **cae** «un texto largo se recorta; una clave larga descarta el registro». |
| **64** (CLUB-AUD-64) | **NO arreglado**: plan con fechas propuestas (§4), sin implementar | — | `docs/club-satori/PLAN-CRM-cierre.md` | No hay prueba: no hay arreglo. Las pruebas del plan están en §4. |

**55 y 60 (09-nov):** quedan **abiertos**. Para cerrarlos hace falta que el auditor pase el texto de cada ítem (qué
describe y dónde). Con el texto se agregan acá con su arreglo, su SHA y su prueba que falla sin el arreglo.

## 3. Arreglos de la r7 (09-nov)

| ID del auditor | Arreglo (SHA) | Dónde | Prueba que FALLA sin el arreglo |
|---|---|---|---|
| **R7-02** | `15ac3af` | 075: columna `club_miembro_roles.baja_por` + trigger `club_roles_baja_por_trg` (~4095–4125); `club_roles_desde_miembro` (no reactiva un rol con `baja_por = 'socio'`); `club_socio_baja_portal` | Batería **86**. Con las funciones de antes (mutación `R7-02`) **caen 4**, entre ellas «reactivación de la persona: el rol de socio que dio de baja el propio socio SIGUE en baja». |
| **CLUB-AUD-66** | `cc1f142` | 075: `club_cupon_usar`, los dos replays (~1060 y ~1076) | Batería **87**. Con la función de antes (mutación `CLUB-AUD-66`) **caen 3**: otras personas en el replay, pendiente con otro cupón, pendiente con otras personas. |
| **P-R7-A** (CLUB-AUD-71 residual) | — (solo diagnóstico y plan; espera el OK) | `docs/club-satori/P-R7-A-plan.md` | — |

## 4. CLUB-AUD-64 (cerrar el CRM viejo): plan con fecha, sin implementar
Plan: [`PLAN-CRM-cierre.md`](PLAN-CRM-cierre.md). Las tablas son `customers`, `customer_interactions`,
`loyalty_config` y `loyalty_rewards`. **No son del Club**; son del CRM viejo, que está pausado.

Dato nuevo (staging, 09-nov, **después de la 089**): `anon` **sigue** con SELECT, TRUNCATE, REFERENCES, TRIGGER y
MAINTAIN en las cuatro. La 089 limpia solo las tablas **sin** política, y estas tienen. El paso 2 del plan sigue
haciendo falta.

| Fecha (propuesta; la fija el dueño) | Paso | Dónde |
|---|---|---|
| **lun 16-nov** | Migración y rollback escritos en una rama propia, con el número reservado con caja (la 091 y la 092 ya las usan otras ramas). Pruebas de la batería: como cajero `customers` → 0 o permiso denegado; como anon → permiso denegado; como owner → igual que antes. Cada una con su mutación «falla sin el arreglo». | rama nueva, sin aplicar |
| **mar 17-nov** | Aplicar en staging (fuera de 23:35–00:45). Batería, paridad y prueba 82. Front: esconder la tarjeta del CRM a cajero y contador. Guía de `docs/sop-app/` en el mismo PR. | staging |
| **jue 19-nov** | Paso 0 en prod, **solo lectura y con la firma del dueño**: el mismo cuadro y un `count(*)` por tabla. Si difiere de staging, se ajusta el plan y se vuelve al 16-nov. | prod, lectura |
| **a fijar por el dueño, después del piloto del Club** | Export de respaldo, migración en prod con firma y verificación del paso 6. | prod |

Hoy no hay pase del CRM: el pase de hoy es el del puente.

## 5. Cómo se reproduce
```bash
CAJERO_UUID=… OWNER_UUID=… MANAGER_UUID=… SALONERO_UUID=… CONTADOR_UUID=… \
  python3 scripts/sql/mutar_bateria.py scripts/sql/mutaciones_r7.json
```
Corre en STAGING, en la transacción que la batería ya descarta: nada queda. Resultado del 09-nov:
- R02: caen 2;
- CLUB-AUD-43: cae 1;
- R7-02: caen 4;
- CLUB-AUD-66: caen 3.

Con el arreglo puesto, la batería da **580/580**.

**Nota sobre G-61:** al correr las pruebas de hoy contra el `gate61.sh` de `4fb5f28`, el caso «prod: A = B» de entonces
llevaba el ref de prod y `--prod-firmado`. El script viejo no frenaba A = B y **mandó a prod la consulta de solo lectura
del catálogo**. Fue un error mío al armar la prueba de «falla sin el arreglo». Desde hoy `gate61_test.sh` corre **sin
red** (un `curl` falso que lo anota y hace fallar la prueba si alguien lo llama), y ningún caso usa el ref de prod con
la firma. Hora, consulta, cierre y la regla del dueño («ningún script de prueba tiene el ref de prod»): AVANCE-LC.md,
09-nov mañana.
