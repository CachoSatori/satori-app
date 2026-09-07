# Reporte — Saloneros por línea (Parte A): el bug del 100% null y su cierre

**2026-09-07 · PARTE A CERRADA (cobertura 100%)**

Qué se intentó, qué salió mal, cuál era la causa real y cómo se arregló. Escrito para que quede
en el repo como registro y como lección de deploy. Honesto con los pasos en falso del
diagnóstico, a propósito.

---

## Objetivo

Atribuir la venta **por línea** al mesero que la comandó (`FAC_FacturasDet.UsuarioRegistra`), en
vez de un mesero por ticket. Esto permite las **facturas partidas** (dos meseros en una misma
factura).

Caso testigo: la **110607**, con líneas de `032` (GONZA) y `026` (MAXO), y los dos PAX (677) del
lado de `026`.

---

## Cronología

1. **Verificación de código.** Se revisó el commit `1778d0a` (`feat/pos-desglose`) contra el
   repo: persiste `usuario_registra` por línea a través de `esquema.ts` → `consulta.ts`
   (`sqlDetalle`) → `mapTicket.ts` → `ingestNdf.ts`. Cero campos de plata tocados, sagrados
   byte-idénticos. Migración de columna en staging ya corrida.

2. **Deploy del bridge + backfill.** En la PC del PoS: `git pull` a `1778d0a`, reinicio del
   agente, y `pos:backfill --todo` (976 días, 39.445 tickets, 0 errores).

3. **Spot-check → falla.** La 110607 en staging salió con `usuario_registra` **null en las 9
   líneas**. La distribución global confirmó lo peor: **0 de 221.506 líneas** con mesero (0%).

---

## Diagnóstico (incluye los pasos en falso)

- **Error 1:** se predijo que la distribución iba a "salir sana". Salió **100% null**.

- **Error 2:** se sobre-reaccionó a *"apuntamos a la tabla equivocada, hay que pasar a
  `FAC_Pedidos` (por pedido)"*. El apoyo fue el doc de esquema, que describe el salonero **por
  ticket** (`FAC_Pedidos.UsuarioRegistra`), y se pasó por alto que el detalle **también** trae el
  mesero por línea. Ismael corrigió, con query en vivo: `FAC_FacturasDet.UsuarioRegistra` existe
  (nombre exacto) y la 110607 sale partida `032`/`026`. **La premisa por-línea era correcta**;
  pasar a "por pedido" habría perdido las facturas partidas.

- **Se descartó el bridge:** el `sqlDetalle` de `1778d0a` genera bien
  `d.UsuarioRegistra AS usuario_registra` — `od('usuarioregistra')` está fijo a `facturasdet` y
  `colOpt` resuelve la columna real. El SELECT **nunca estuvo mal** (el fix de "alias explícito"
  habría sido un no-op).

### Causa raíz

La Edge Function `ingest-ndf` importa `normalizarLinea` de `src/shared/ndf/ingestNdf.ts`. El
cambio que hace que `normalizarLinea` cargue `usuario_registra` **vivía solo en
`feat/pos-desglose`** (0 en `deploy/pos-bridge-staging`, `staging`, `main`,
`integracion/analitica-staging`).

La Edge deployada (desde `deploy/pos-bridge-staging` @ `2b24d29`) corría la **versión vieja** de
esa función → descartaba el campo antes del insert (`{...l}` sin la key) → **100% null, sin
errores** (ignora el campo extra en silencio).

> El IVA sí había funcionado tocando solo el bridge porque `imp_venta` **ya existía** en el
> contrato de la Edge. `usuario_registra` es campo **nuevo** y necesitaba redeploy.

---

## El fix

- **Redeploy de `ingest-ndf` desde `feat/pos-desglose`** (que tiene el `ingestNdf.ts` correcto).
  Guardia antes de deployar: `grep -c usuario_registra src/shared/ndf/ingestNdf.ts` = 2. **El
  bridge no se tocó.**
  `supabase functions deploy ingest-ndf --project-ref hwiatgicyyqyezqwldia` (en la Mac).

  - *Nota de proceso:* el primer intento falló porque un comentario `#` quedó pegado en la línea
    del `git cherry-pick` (`fatal: bad revision '#'`) y el deploy republicó la Edge vieja. Se
    rehízo deployando directo de la feature, sin cherry-pick.

- **Backfill chico 29–31 ago** (contra la Edge nueva): 131 tickets, 801 líneas, 0 errores.

- **Spot-check 110607** ✅: `032` → 16, 53, 56, 946, 946 (5 líneas); `026` → 1080, 672, 677, 677
  (4 líneas, los dos 677 `es_pax=true`). `usuario_registra` ≠ null. Idéntico al PoS en vivo.
  **Era la Edge, confirmado de punta a punta.**

- **Backfill `--todo` completo** (contra la Edge nueva): 976 días · 39.445 tickets · 221.506
  líneas · 0 errores.

---

## Resultado final ✅

- **Cobertura: 221.496 / 221.506 líneas con `usuario_registra` = 100,0%.** Solo 10 líneas null
  (bucket "otro", ₡40k — insignificante).

- **Aclaración:** esa cifra cuenta **no-null** (todos los códigos: meseros + caja 111/222/388 +
  genérico 02 + bar). El ~78% "mesero" es el subconjunto tras clasificar por el mapa de códigos,
  que se aplica **en la app (Parte B)** — no en el dato crudo.

- El agente en vivo **NO requiere reinicio**: la Edge es server-side, los POST nuevos pegan a la
  versión nueva.

- **PARTE A CERRADA.** Sigue Parte B (app `feat/analitica`: las dos lentes + vista por persona ×
  turno).

---

## Lecciones (para no repetirlas)

1. **Edge + `src/shared/**` = chequeo de VERSIÓN DESPLEGADA, no de código.** Un cambio en código
   compartido que la Edge importa **no surte efecto hasta redeployar la Edge**. El test del
   pipeline del pase anterior cubría el **código**, no **qué versión estaba desplegada** — por eso
   el campo llegó null aun con el test verde. Síntoma clásico: columna nueva 100% null, 0 errores.
   El `grep -c` antes de deployar + backfill de 1 día + spot-check **son ese chequeo de "versión
   desplegada"**, no burocracia. → nota agregada a `docs/DEPLOY-pos-bridge-staging.md`.

2. **Guardia antes del `--todo`:** primero un backfill de **1 día + spot-check**, no el `--todo`
   de ~20 min a ciegas.

3. **`opt` vs `req` — matizado.** El silent-degrade de `opt` es real en general, pero **NO fue la
   causa de este bug, y `req` no lo habría cazado**. Acá el resolver **sí** resolvía
   `UsuarioRegistra` (la columna existe) y el SELECT emitía el campo bien; quien lo descartaba era
   la **Edge desplegada** (código viejo). `req` solo falla ruidoso cuando la columna **no se
   resuelve** — el caso "la columna no existe en la instalación", que es **otro problema**. Para
   este bug (código desplegado ≠ repo) el guard es **redeploy + grep + spot-check**.

   > Versión anterior de esta lección, corregida: decía "para campos que sabemos que existen
   > conviene evaluar `req` en vez de `opt`". Aplicado a este bug era una conclusión equivocada, y
   > cambiar `opt` → `req` en `esquema.ts` no habría cambiado nada acá (sí habría roto la ingesta
   > en una instalación del PoS donde la columna no exista).

4. **La data en vivo manda sobre el doc.** No anclarse en un doc (el de esquema describía el
   salonero por ticket) cuando la query al PoS dice otra cosa. **La query al PoS mandó.**

5. **Comandos sin comentarios inline** en los bloques copiables — el `#` rompió el cherry-pick.
