---
name: satori-migraciones-y-prod
description: Usala antes de crear una migración, tocar una base (staging o prod), desplegar o cambiar una Edge Function o un secreto de satori-app — staging descartado, firma, regla 1, regla 2, verificación antes/después y vuelta atrás.
---

# Migraciones, Edge Functions y prod — Satori App

**Nada que toque prod (esquema, datos, Edge, secretos, Auth) sin firma explícita y escrita del dueño sobre el SHA exacto**, anotada en el PASE (`docs/pases/`) con fecha y hora `-06:00`. Sin firma: solo lectura.

## 0. Ritual (regla 7)
- [ ] Leer el ref en pantalla (`yiczgdti…` PROD · `hwiatgic…` staging) antes de cualquier SQL de escritura.
- [ ] Tokens de sesión: solo staging, vencimiento corto, se revocan al terminar. Ningún secreto se muestra, copia ni va al repo; si una salida trae un valor, se filtra (solo nombre y digest).

## 1. Crear la migración
- [ ] Número = siguiente libre del bloque de tu rama (bloques y reglas de numeración: «Numeración de migraciones» de `ESTADO.md` en `main`). Registrarlo en `supabase/migraciones-reservadas.json` (el test lo exige). Número ≤ último del ledger de prod: se renumera a 150–199 con `origen`.
- [ ] Junto: `supabase/migrations/NNN_nombre.sql`, `scripts/sql/NNN_rollback.sql` y pruebas (`scripts/sql/NNN_pruebas…`).

## 2. Staging: transacción descartada
- [ ] Cada prueba en `begin; <migración>; <pruebas>; rollback;`; lecturas en `begin read only` … `rollback`. Las mutaciones van dentro: cada assert cae sin el arreglo.
- [ ] Recién con eso y el OK del dueño se aplica en staging con su fila del ledger (hora CR y resultado). Staging tiene deuda conocida (filas 065 y 066): no es espejo exacto de prod.

## 3. Paquete del pase (`docs/pases/PASE-NNN-….md`)
Formato del `PASE-089`: qué pasa y qué no · SHA y huellas · responsables (ejecución y control, no la misma persona) · prerrequisitos · lecturas previas en prod (solo lectura) · prueba en staging · humo antes y después (después = antes salvo lo esperado) · criterios de parada · vuelta atrás · orden · firma y bitácora.

## 4. Vías a prod (el PASE dice cuál; nunca se mezclan)
- **Merge → Branching** (desde la 085): no se aplica nada a mano; el merge la aplica. Si el día del pase aparece una razón para hacerlo a mano, se para y se rehace el paquete.
- **A mano antes del merge** (histórica): Management API, una transacción con el archivo exacto + su fila en `supabase_migrations.schema_migrations`; se verifica y después se mergea. Entre ambos pasos cualquier push a `main` rompe Branching («Remote migration versions not found…»): nadie más pushea.

Verificación en las dos: ledger con **exactamente 1 fila por versión con su `name`** (Branching parte en statements: no se compara md5) + catálogo esperado + humo de «después» · check «Supabase Preview» en success, «All migrations are up to date» · bitácora en el PASE y ⚡ARRANQUE (ledger «N · último»). Nunca `repair --status reverted` sobre algo aplicado ni revertir un `.sql` del ledger (regla 10).

## 5. Edge Functions (regla 2)
- [ ] Hasta cerrar el ítem 11: despliegue **manual** desde la rama con el código vivo, con firma y SHA anotado: `supabase functions deploy <fn> --project-ref <ref> --use-api` (sin Docker).
- [ ] `verify_jwt` según ESTADO; `--no-verify-jwt` solo en las que llaman sin JWT de usuario (`ingest-ndf`, `club-pase`). Un error acá es un 401 en cada ciclo o una función abierta.
- [ ] Antes y después de cada despliegue o cambio de secreto (solo lectura): por función versión, `verify_jwt`, hash `ezbr_sha256` y fecha; secretos solo nombre y digest. **Cambiar un secreto puede no subir la versión**: confirmarlo por la lista de secretos, y el código por el hash.
- [ ] Prueba funcional mínima después (p. ej. `ingest-ndf`: siguen entrando tickets). Si el proxy bloquea `*.supabase.co`, queda como pendiente anotado en el PR/PASE, no como probado.

## 6. Vuelta atrás (escrita antes)
- [ ] Migración: `NNN_rollback.sql` en orden inverso y, en el mismo momento, un PR que saca su `.sql` de `main` (si queda, Branching la reaplica). Con actividad real en las tablas no se borra: se apaga la función o el local y se corrige con migración nueva.
- [ ] Edge: volver a la fuente anterior (hash) o al secreto anterior (digest). App: revert del merge (el `.sql` del ledger se queda).
- [ ] Si algo no coincide con lo esperado, se para y se avisa; no se improvisa en prod.

## 7. Reporte
Ref leído · qué se corrió y dónde · hora CR · ledger antes → después · Edge antes → después (versión, hash, digest) · humo · vuelta atrás disponible. Sin valores de secretos.
