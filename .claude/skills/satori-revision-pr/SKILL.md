---
name: satori-revision-pr
description: Usala cuando te piden revisar un PR de satori-app que construyó otra sesión — checklist de plata, esquema, permisos, sagrados, hora CR, offline, privacidad, Edge y deploy, con veredicto listo / cambios / bloquea.
---

# Revisión de PR — Satori App

Revisás algo que no construiste. No confíes en el reporte del autor: verificá contra el diff, el repo y `ESTADO.md`.
Solo lectura: no pusheás a la rama ajena ni mergeás.

## 0. Preparar
- [ ] `gh pr view <n> --json title,body,headRefOid,baseRefName,isDraft` y `gh pr diff <n> --name-only`.
- [ ] Clon o worktree limpio en la cabeza exacta (`headRefOid`). Anotá el SHA revisado: un push nuevo invalida la
      revisión.
- [ ] Leé las 🛑 Reglas operativas de `ESTADO.md` y lo que dice el PR que hace. Todo hallazgo se compara contra eso.

## 1. Gate propio (no el del autor)
- [ ] `npm ci && npx tsc -b && npx vite build && npx vitest run`, y `npx eslint .` contra la cuenta de `origin/main`
      medida hoy. Si toca `club-web/`: su build con `VITE_CLUB_URL` de prueba.
- [ ] Los números coinciden con los del PR. Si no, es hallazgo.

## 2. Checklist
**Plata y caja**
- [ ] ¿Cambia un monto, un saldo, el «debería» de un cierre, propinas, el pozo o la Caja Fuerte? Cada camino nuevo de
      escritura en `cash_*` / propinas: ¿quién lo dispara, en qué estado, qué pasa si se repite?
- [ ] Redondeos, colones/dólares, tipo de cambio. ICP según la regla 5 (el 10 % de servicio no entra).

**Sagrados (regla 8)**
- [ ] `git hash-object src/modules/cash/cashUtils.ts` = `b597c697…` y `src/shared/utils/tipCalculations.ts` = `7603ba5a…`.
      `posFiscal.ts` solo en `staging` (`a3fd445f…`). Lógica de cierres (`pozo.ts`, `cierrePozo.ts`) sin reimplementar.

**Esquema, RLS y permisos**
- [ ] Toda migración: número en su bloque y registrado (`supabase/migraciones-reservadas.json` + tabla de ESTADO), con
      rollback y pruebas. ¿Toca prod sin firma? → bloquea.
- [ ] Policies nuevas o cambiadas: ¿qué ve y escribe cada rol, `anon` incluido? ¿`SECURITY DEFINER` con
      `search_path` fijo, rol chequeado adentro y `revoke` a `public`/`anon`?
- [ ] Lectura del PoS por las funciones de la 067; `pos_ndf_*` solo gerencia (regla 6).
- [ ] Las pruebas de permisos usan un usuario real del rol o su JWT en `begin read only` … `rollback` (regla 4).

**Migraciones fuera del ledger y vía del pase**
- [ ] ¿Algún `.sql` ya aplicado en prod cambia, se borra o se revierte? → bloquea (regla 10).
- [ ] ¿El PR dice por qué vía entra a prod (merge → Branching, o a mano antes del merge, regla 1) y tiene su PASE en
      `docs/pases/`? Número ≤ al último del ledger de prod → tiene que ir al bloque de pase 150–199.

**Edge Functions (regla 2)**
- [ ] ¿Hay archivos bajo `supabase/functions/` en un PR a `main`? Hasta el ítem 11 → bloquea. `main` tiene código
      viejo de `monthly-report`, `extract-document` y otros: un despliegue de Branching pisaría prod.

**Hora de Costa Rica**
- [ ] «Hoy» y días operativos con `todayCR()` / `dateCR()`. Buscar en el diff `toISOString().slice(0, 10)`,
      `new Date().getDate()`, `getHours()` sin zona. Las pruebas de fecha corren de noche en CR.

**Offline y outbox**
- [ ] Si toca escrituras que pasan por la cola (`src/shared/offline/outbox.ts`, `OFFLINE.md`): cada operación lleva `client_op_id` y el
      servidor la trata idempotente; el replay en orden no duplica plata ni se traba con un error.

**Privacidad y textos**
- [ ] Ningún nombre, teléfono, correo, cédula, monto real, ref de prod en una prueba, llave ni secreto (ver
      `CLAUDE.md`). Revisar también docs, comentarios, el cuerpo del PR y los commits.
- [ ] Textos para clientes en «usted» (`usted.test.ts` de club-web y de Wallet).

**Pruebas que muerden**
- [ ] Para el cambio central, hacé vos una mutación (revertir el arreglo en la copia limpia) y mirá que algo caiga. Si
      nada cae, la prueba no prueba: hallazgo.
- [ ] Las pruebas no hablan con un proyecto real (env falsa de `vite.config.ts`).

**Guía SOP**
- [ ] Si cambian pantallas, botones, roles o reglas: la guía de `docs/sop-app/` cambió en el mismo PR con
      `verificado_en_commit`, o el PR explica por qué no.

**Riesgos de deploy**
- [ ] ¿Qué publica el merge? App (GitHub Pages), club-web (Pages), Worker (Workers Builds desde `main`), Branching
      (migraciones). ¿Algo necesita configuración en un panel antes del merge (variable, binding, secreto)?
- [ ] ¿Rompe algo con el service worker o con usuarios que tienen la versión vieja abierta?
- [ ] ¿La vuelta atrás está escrita y es posible (revert del merge + rollback SQL, sin borrar el `.sql` del ledger)?
- [ ] ¿Se actualizó el bloque ⚡ARRANQUE si cambia el estado real?

## 3. Salida
Hallazgos ordenados de más grave a menos, cada uno con evidencia:

| # | Gravedad | Archivo:línea | Qué pasa | Escenario concreto | Qué pedir |
|---|---|---|---|---|---|

Gravedades: **bloquea** (plata, permisos, datos, prod o una regla de ESTADO) · **cambio** (tiene que arreglarse
antes del merge) · **menor** (puede ir después, con ítem en el backlog).

Veredicto, en una línea, sobre el SHA revisado:
- **Listo**: sin hallazgos que bloqueen ni cambios pendientes. Igual necesita el OK del dueño para mergear.
- **Cambios**: lista corta de lo que falta.
- **Bloquea**: qué regla rompe y qué haría falta.

Lo que no pudiste verificar (sin acceso a la base, al panel, etc.) va aparte como «NO VERIFICADO», nunca como OK.
