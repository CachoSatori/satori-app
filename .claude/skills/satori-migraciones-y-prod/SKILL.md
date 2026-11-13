---
name: satori-migraciones-y-prod
description: Usala antes de crear una migración, tocar una base (staging o prod), desplegar o cambiar una Edge Function o un secreto de satori-app — staging descartado, firma, regla 1, regla 2, verificación antes/después y vuelta atrás.
---

# Migraciones, Edge Functions y prod — Satori App

**Nada que toque prod (esquema, datos, Edge, secretos, Auth) sin la firma explícita y escrita del dueño, sobre el SHA
exacto.** La firma se anota en el PASE (`docs/pases/`) con fecha y hora `-06:00`. Sin firma: solo lectura.

## 0. Ritual antes de cualquier comando de base (regla 7)
- [ ] Leer el ref en pantalla: `yiczgdti…` = **PROD** · `hwiatgic…` = staging. Nunca SQL de escritura sin haberlo leído.
- [ ] Tokens de Supabase para sesiones: alcance solo a staging, vencimiento corto, se revocan al terminar.
- [ ] Ningún secreto, llave ni token se muestra, se copia, se pega en el chat ni va al repo. Si una salida trae un
      valor, se filtra antes de mostrarla (solo nombre y digest).

## 1. Crear la migración
- [ ] Leer «Numeración de migraciones» de `ESTADO.md` **en `main`**. Número = siguiente libre del bloque de tu rama
      (CAJA 087–99 · CLUB + puente 100–149 · PASE 150–199 solo renumeraciones). Un número usado no se reutiliza.
- [ ] Registrarlo en `supabase/migraciones-reservadas.json` y en la tabla de ESTADO en el mismo PR
      (`supabase/migraciones.test.ts` lo exige).
- [ ] Con número ≤ al último del ledger de prod no entra: se renumera al siguiente libre de 150–199 con `origen`
      (regla 3; Supabase no aplica una versión menor que la última).
- [ ] Junto: `supabase/migrations/NNN_nombre.sql`, `scripts/sql/NNN_rollback.sql` y las pruebas (`scripts/sql/NNN_pruebas…`).

## 2. Staging: en transacción descartada
- [ ] Primero cada prueba en una transacción que termina en `rollback` (`begin; <migración>; <pruebas>; rollback;`):
      la batería corre sin dejar nada. Lecturas en `begin read only` … `rollback`.
- [ ] Mutaciones dentro de esa misma transacción descartada: cada assert tiene que caer sin el arreglo.
- [ ] Recién con eso, y con el OK del dueño, se aplica en staging con su fila del ledger. Anotar hora CR y resultado.
- [ ] Staging tiene deuda conocida (le faltan las filas 065 y 066): no tomarlo como espejo exacto de prod.

## 3. Paquete del pase (`docs/pases/PASE-NNN-….md`)
Formato del `PASE-089`: qué pasa y qué no · SHA y huellas · responsables (ejecución y control, **no** la misma persona)
· prerrequisitos · lecturas previas en prod (solo lectura) · prueba en staging · humo antes y después
(`begin read only` … `rollback`; regla: después = antes salvo lo esperado) · criterios de parada · vuelta atrás · orden
· firma y bitácora.

## 4. Las dos vías a prod (el PASE dice cuál; nunca se mezclan)
**Regla 1:** Supabase Branching corre `migrate` contra PROD en cada push a `main`.
- **A mano antes del merge** (la regla 1 escrita; así entraron 062–069, 071–074, 076–077, 081 y 082): Management API, una transacción con
  el archivo exacto + su fila en `supabase_migrations.schema_migrations`; se verifica y **después** se mergea, así
  Branching no tiene nada que hacer. Entre la aplicación y el merge, cualquier push a `main` hace fallar a Branching
  («Remote migration versions not found…»): nadie más pushea a `main` en esa ventana.
- **Merge → Branching** (la vía usada desde la 085, 10-nov): no se aplica nada a mano; el merge del PR la aplica. Si el
  día del pase aparece una razón para hacerlo a mano, **se para** y se rehace el paquete.

Verificación después, en las dos:
- [ ] Ledger: **exactamente 1 fila por versión con su `name`** (Branching parte las migraciones en statements: no se
      compara md5) + el catálogo esperado + el humo de «después».
- [ ] Check «Supabase Preview» del merge en success y su log con «All migrations are up to date».
- [ ] Bitácora en el §9/§10 del PASE y el bloque ⚡ARRANQUE de ESTADO (ledger «N · último»).

Nunca: `repair --status reverted` sobre algo aplicado; sacar o revertir el `.sql` de una migración que está en el
ledger de prod (regla 10).

## 5. Edge Functions (regla 2)
- [ ] **Ningún PR a `main` con archivos bajo `supabase/functions/` hasta cerrar el ítem 11** (`config.toml`). Sin él,
      Branching despliega con `verify_jwt = true` y además pisaría prod con el código viejo que tiene `main`.
- [ ] Hasta entonces: despliegue **manual**, desde la rama que tiene el código vivo, con firma, y con el SHA anotado:
      `supabase functions deploy <fn> --project-ref <ref> --use-api` (sin Docker).
- [ ] `verify_jwt` según la tabla de ESTADO. Con `--no-verify-jwt` solo las que llaman sin JWT de usuario:
      `ingest-ndf` (el agente del PoS manda `x-ingest-secret`) y `club-pase` (club-web, portón `x-club-web`). Las demás,
      on. Un error acá es un 401 en cada ciclo o una función abierta.

**Antes y después de cada despliegue o cambio de secreto** (Management API o CLI, solo lectura):
- [ ] Por función: versión, `verify_jwt`, hash (`ezbr_sha256`) y fecha de actualización.
- [ ] Secretos: **solo nombre y digest** (como `supabase secrets list`). Nunca el valor.
- [ ] **Cambiar cualquier secreto sube la versión de TODAS las funciones del proyecto** sin cambiar código ni hash:
      una versión nueva no es un despliegue. Para saber si cambió el código, mirar el hash.
- [ ] Prueba funcional mínima después (p. ej. `ingest-ndf`: tickets del PoS que siguen entrando).

## 6. Vuelta atrás (escrita antes, no improvisada)
- [ ] Migración: `scripts/sql/NNN_rollback.sql` en el orden inverso (p. ej. 151 antes que 150) y, **en el mismo momento**,
      un PR que saca su `.sql` de `main`: si queda, Branching la vuelve a aplicar; si sale sin rollback, Branching falla.
- [ ] Con actividad real en las tablas ya no se borra: se apaga la función o el local y se arregla con una migración
      nueva.
- [ ] Edge: volver a desplegar la fuente anterior (hash conocido) o volver el secreto anterior (digest conocido).
- [ ] Código de la app: revert del merge (el `.sql` de lo que está en el ledger se queda).
- [ ] Criterios de parada en el PASE: si algo no coincide con lo esperado, **se para y se avisa**. No se improvisa en
      prod.

## 7. Reporte
Ref leído · qué se corrió y dónde (staging / prod) · hora CR · ledger antes → después · Edge antes → después (versión,
hash, digest) · resultado del humo · vuelta atrás disponible. Sin valores de secretos.
