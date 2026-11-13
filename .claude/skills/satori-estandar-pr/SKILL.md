---
name: satori-estandar-pr
description: Usala al arrancar cualquier cambio en satori-app que vaya a terminar en un PR (código o docs) — rama, sagrados, gate, pruebas que muerden, hora CR, «usted», guía SOP, repo público y reporte.
---

# Estándar de PR — Satori App

El repo manda: si esta skill y `ESTADO.md` no coinciden, gana `ESTADO.md` (y se corrige esta skill en un PR).

## 0. Antes de tocar nada
- [ ] Leer `CLAUDE.md`, el bloque ⚡ARRANQUE y las **🛑 Reglas operativas** de `ESTADO.md`, y el handoff que apunta.
- [ ] Si la tarea toca plata, esquema, permisos o prod: frenar y pedir la firma del dueño antes (ver
      `satori-migraciones-y-prod`). Sin firma escrita, solo lectura y staging.

## 1. Rama
- [ ] `git fetch origin && git switch -c claude/<tema> origin/main`. Nunca trabajar sobre `main` ni `staging`.
- [ ] Un tema por rama. Para traer `main`: `git merge origin/main` (merge commit).
- [ ] Force-push solo con `--force-with-lease` y solo en tu rama de trabajo. **Nunca** en `main`, `staging` ni en una
      rama de la que se despliega código (`staging`, que publica Cloudflare; las de Edge Functions de la regla 2; la
      del agente del PoS).

## 2. Sagrados (regla 8 de ESTADO: por hash de blob, no por `git diff`)
| Archivo | Hash en `main` |
|---|---|
| `src/modules/cash/cashUtils.ts` | `b597c697` |
| `src/shared/utils/tipCalculations.ts` | `7603ba5a` |
| `posFiscal.ts` (con `computeTotals`, la fórmula fiscal) | `a3fd445f`, **solo en `staging`**: en `main` no existe |

Además, sin acuerdo explícito no se reimplementa: la lógica de cierres de caja (la matemática del «debería»:
`src/modules/cash/pozo.ts`, `cierrePozo.ts`, el cierre del día de la 071) ni cobro, vuelto o conversión.
- [ ] Al final: `git hash-object <archivo>` de cada uno = la tabla de ESTADO. Va en el PR.

## 3. Gate completo, en copia limpia
En un clon o `git worktree` limpio de la cabeza del PR (los untracked del árbol de trabajo engañan):
```bash
npm ci
npx tsc -b                 # 0 errores
npx vite build             # OK
npx vitest run             # todo verde (incluye supabase/migraciones.test.ts, club-web y los escaneos del repo)
npx eslint . | tail -1     # cantidad <= la de main medida en el mismo momento, sin errores nuevos tuyos
```
- [ ] La línea base de lint se mide en `origin/main` el mismo día (no copiar el número de ESTADO: cambia).
- [ ] Si tocás `club-web/` (páginas, `functions/`, `worker/`) o la API del Club:
      `cd club-web && npm ci && VITE_CLUB_URL=https://club.ejemplo.test npm run build` (sin `VITE_CLUB_URL` el build de
      producción falla a propósito). Sus pruebas corren dentro del `vitest` de la raíz.
- [ ] El repo no corre pruebas en los PR y `deploy.yml` no corre `vitest`: **este gate es el único**. Va con números
      en el PR (tests, lint antes/después, hashes de sagrados).

## 4. Pruebas que muerden
- [ ] Toda lógica crítica (plata, caja, propinas, permisos, fechas, migraciones) lleva prueba nueva o ajustada.
- [ ] **Mutación:** romper el arreglo a propósito (invertir la condición, volver al código viejo) y ver que la prueba
      **cae**; deshacer y ver que vuelve a verde. En SQL, la mutación va dentro de la transacción descartada de la
      batería (`scripts/sql/mutar_bateria.py`). En el PR: «mutación X → caen N».
- [ ] Una prueba que ya no puede probar algo lo dice (NO PROBADO) y no da verde.
- [ ] Permisos: con un usuario real del rol o con su JWT simulado en `begin read only` … `rollback` (regla 4). «Ver
      como» no prueba permisos.

## 5. Fechas: «hoy» es Costa Rica
- [ ] `todayCR()` y `dateCR()` de `src/shared/utils` (UTC-6, sin horario de verano). Nunca
      `new Date().toISOString().slice(0, 10)` ni la hora local de la máquina.
- [ ] Las pruebas de fechas fijan el reloj **de noche en CR** (p. ej. 23:30 CR = 05:30 UTC del día siguiente): ahí se
      rompía la prueba `buscarNull` de `CashMovimientos`.

## 6. Textos
- [ ] Todo texto que lee un **cliente** (club-web, portal, pase de Wallet) va en «usted». Lo cuidan
      `club-web/src/usted.test.ts` y `src/shared/wallet/usted.test.ts`. Única excepción: el aviso de privacidad
      versionado (`alta_aviso`), que cambia solo con versión nueva y migración.
- [ ] Antes de cambiar algo que ve el personal, el PR dice en concreto qué va a ver el encargado.

## 7. Guía de uso (`docs/sop-app/`)
- [ ] Si cambian pantallas, botones, roles o reglas de un módulo: su guía se actualiza **en el mismo PR**, con
      `verificado_en_commit` (sigue `PLANTILLA.md`; el mapa está en `INVENTARIO.md`).
- [ ] Si no se actualiza, el PR dice por qué.

## 8. Esquema, Edge Functions y estado
- [ ] Migración nueva: número del bloque de tu rama, registrado en `supabase/migraciones-reservadas.json` y en la tabla
      de ESTADO en el mismo PR, con `scripts/sql/NNN_rollback.sql` y sus pruebas. Detalle: `satori-migraciones-y-prod`.
- [ ] Nada bajo `supabase/functions/` en un PR a `main` hasta cerrar el ítem 11 (regla 2).
- [ ] Nunca sacar ni revertir el `.sql` de una migración que está en el ledger de prod (regla 10).
- [ ] Si el PR cambia el estado real (prod, ledger, ramas, Edge), actualiza el bloque ⚡ARRANQUE (Definition of Done).

## 9. Repo público
Nunca al repo (código, tests, docs, commits, cuerpo del PR): nombres de personas, clientes o proveedores, teléfonos,
correos, cédulas, contraseñas, llaves, tokens, secretos ni montos reales. Ejemplos con datos ficticios. Única excepción:
el correo público del negocio, solo en el aviso del Club y su prueba (ver `CLAUDE.md`).
- [ ] Revisar el diff antes de cada commit: `git diff origin/main | grep -nEi '@|\+?506|[0-9]{9}|key|secret|token'`
      y leer cada coincidencia.
- [ ] Los escaneos del gate (`src/*Repo*.test.ts`, `refProdEnPruebas.test.ts`) no miran `.claude/` ni todo `docs/`:
      ahí la revisión es a mano.

## 10. PR en borrador
- [ ] Commit con el trailer de la sesión. Push: `git -c push.negotiate=true push -u origin claude/<tema>`.
- [ ] PR en **borrador** contra `main` (REST: `gh api repos/CachoSatori/satori-app/pulls … -F draft=true`). Si toca
      plata, esquema o prod, el título empieza con «⛔ NO MERGEAR sin OK —».
- [ ] Cuerpo: qué y por qué · gate con números · hashes de sagrados · mutaciones · guía SOP · riesgos · vuelta atrás ·
      qué quedó afuera.
- [ ] Nunca mergear ni desplegar desde esta skill: eso es `satori-merge-y-deploy`, con el OK del dueño.

## 11. Reporte final
Máximo ~200 palabras + **una** tabla (archivo · qué cambió · prueba). Número de PR, gate en una línea, riesgos y dudas
para el dueño. El detalle va al PR, no al chat.
