# PASE · Ítem 11 — `supabase/config.toml` + Edge Functions de `main` = prod

> ⛔ **Lleva firma del dueño sobre el SHA exacto.** Vía: **merge → Branching** (no se despliega nada a mano).
> Armado el 20-nov-2026 en solo lectura: nada desplegado, ningún secreto tocado, ninguna base escrita.

## Qué pasa y qué no
- **Pasa:** al mergear, Branching despliega en PROD las 8 funciones declaradas en `supabase/config.toml` con el código de
  `supabase/functions/` (y lo que importan de `src/shared/`), con el `verify_jwt` de cada una. El código es **el que corre hoy**.
- **No pasa:** ninguna migración (este PR no trae `.sql`), ningún secreto, nada de `[auth]`/`[api]` (Branching los ignora en
  prod sin `[remotes.*]`, y el archivo no tiene ninguno: lo prueban `supabase/config.test.ts` y R04, con lista blanca: solo `project_id` y `verify_jwt`). El agente del PoS no se toca.

## Fuente de cada función (código bajado de prod con `get_edge_function`, solo lectura, 20-nov)

| Función | Versión prod | `verify_jwt` | Fuente en el repo | Diferencias prod ↔ fuente |
|---|---|---|---|---|
| `monthly-report` | v24 | true | `claude/reporte-mensual-desde-pos` @ `50831a8e` (#245) | `index.ts`: remitente propio (`FROM_EMAIL`); el commit tiene el de prueba de Resend |
| `extract-document` | v20 | true | `claude/extract-document-sin-datos` @ `190b5f59` | ninguna (ESTADO decía `8a8dfb6`: era la v19 o anterior) |
| `cierre-email` | v17 | true | `claude/cierre-email-redondeo` @ `87364a84` (gen de #288) | `correo-estandar.ts`, `plantilla.ts`, `resumen.ts`: solo el largo de las líneas `// ────` de los comentarios |
| `pago-notificar` | v16 | true | `claude/pago-notificar-agrupado` @ `9088687b` | ninguna |
| `ventas-dia-contador` | v5 | true | `claude/ventas-dia-contador-redondeo` @ `78e95953` | 7 archivos: líneas `// ────` de comentarios; `archivos.ts`: el BOM va como carácter y no como `'﻿'` (mismo valor) |
| `ingest-ndf` | v13 | **false** | `claude/puente-item11-prod-v2` @ `5da233a5` | prod tiene finales de línea CRLF (se subió desde Windows); en el repo, LF |
| `alta-empleado` | v12 | true | `claude/alta-empleado-fn` @ `942d12f5` | ninguna |
| `club-pase` | v7 | **false** | `claude/club-pase-edge` @ `5cc50737` (= `6c5848e`) | ninguna; `src/shared/wallet/*` de `main` = prod |

En el repo va **el texto de prod** (no el de la rama) salvo tres cosas, todas en comentarios o finales de línea:
1. `ingest-ndf`: LF en vez de CRLF.
2. `alta-empleado/index.ts` línea 4 e `ingest-ndf/index.ts` línea 21: el nombre de pila del dueño → «el dueño» (repo público, `privacidadRepo`).
3. `ventas-dia-contador/ventasPos.gen.js`: es el de `78e95953`; se verificó por su cabecera (fuente `@ce4974e6`,
   `sha256(cuerpo) b68c506e…` = el cuerpo del archivo) y no byte a byte (la respuesta no se pudo guardar entera).

**`ingest-ndf` importa de `src/shared/`.** `ingestNdf.ts` de `main` era anterior al ítem 11 del puente (sin mesa de la factura,
consecutivo, clave FE, apertura ni topes de largo): este PR lo reemplaza por el de prod (con sus pruebas). `mapTicket.ts` y
`utils/index.ts` quedan los de `main` (más nuevos): difieren de prod en comentarios, `LOGINS_SISTEMA`, `SALONEROS_CONOCIDOS`,
`horaCR` y `fi`, que la función no usa; lo que sí usa (`mapTotalProvisorio`, `num`, `isCajeroName`) es idéntico.

## Orden y qué ve cada uno
1. Merge a `main` (ventana D1). Branching: migraciones (ninguna nueva) → despliega las 8 funciones. Sube una versión cada una
   (v25, v21, v18, v17, v6, v14, v13, v8); el `ezbr_sha256` cambia aunque el código sea el mismo.
2. **Agente del PoS:** sigue mandando `x-ingest-secret` a `ingest-ndf`. Con `verify_jwt = false` y el mismo código, no ve
   diferencia. **No hace falta tocar la PC del PoS** (el `PLAN-agente-item11.md` es del ítem 11 *del puente*, ya en prod; no aplica).
3. Personal y clientes: nada visible (mismo código).

## Humo después (solo lectura)
- `list_edge_functions`: las 8 funciones con versión +1, `verify_jwt` igual a la tabla y `ezbr_sha256` antes → después anotado.
- `get_edge_function` de cada una = los archivos del merge.
- Latido del PoS (`ingest-ndf`): `pos_ndf_cursor.last_poll_at` avanza y `last_error` null en los 2–3 ciclos siguientes.
- Despliegue de `main` en Supabase sin error (el Preview por PR está desactivado).

## Criterios de parada
- Algún `verify_jwt` distinto de la tabla, o `ingest-ndf` con 401 en el log → vuelta atrás de esa función ya.

## Vuelta atrás (por función)
- Redesplegar la versión anterior desde su fuente (tabla) con firma: `supabase functions deploy <fn> --project-ref <prod> --use-api`
  (`--no-verify-jwt` solo en `ingest-ndf` y `club-pase`). Para `monthly-report` la fuente exacta de la v24 es este mismo
  archivo de `main` (el commit `50831a8e` tiene otro remitente).
- Si el problema es la configuración: revert del merge **y** sacar `config.toml` hace que Branching deje de desplegar.
  Ojo: con `config.toml` en `main`, Branching despliega las funciones declaradas en **cada push a `main`**: un cambio de Edge mergeado sin firma es un cambio en prod.

## Después del merge
- ESTADO regla 2 queda como en este PR (R04 nueva: `supabase/functions/` entra con `config.toml` en regla).
- Los PRs de Edge viejos se cierran o se rebasan (lista en el PR).

## Firma y bitácora
- [ ] Firma del dueño sobre el SHA: ______ (fecha y hora -06:00)
- [ ] Ejecución (merge): ______ · Control: ______
