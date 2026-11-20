---
name: satori-estandar-pr
description: Usala al arrancar cualquier cambio en satori-app que vaya a terminar en un PR (código o docs) — rama, sagrados, gate, pruebas que muerden, hora CR, «usted», guía SOP, repo público y reporte.
---

# Estándar de PR — Satori App

Fuente única de rama, gate, pruebas, privacidad y reporte; las otras skills apuntan acá. Si esta skill y `ESTADO.md` no coinciden, gana `ESTADO.md`.

## 0. Antes de tocar nada
- [ ] Leer `CLAUDE.md`, ⚡ARRANQUE y 🛑 Reglas de `ESTADO.md`, y el handoff que apunta.
- [ ] De [docs/REGLAS-POR-INCIDENTE.md](../../../docs/REGLAS-POR-INCIDENTE.md), las filas cuyo disparador coincide con lo que vas a tocar.
- [ ] Plata, esquema, permisos o prod: frenar y pedir la firma del dueño (`satori-migraciones-y-prod`). Sin firma, solo lectura y staging.

## 1. Rama
- [ ] `git fetch origin && git switch -c claude/<tema> origin/main`. Un tema por rama; nunca sobre `main` ni `staging`. Traer `main` con `git merge origin/main`.
- [ ] Force-push solo `--force-with-lease` y en tu rama. Nunca en `main`, `staging`, ramas de Edge ni la del agente del PoS.

## 2. Sagrados (regla 8; hashes en ESTADO)
`cashUtils.ts`, `tipCalculations.ts`, `cierrePozo.ts`, `posFiscal.ts`; sin acuerdo explícito tampoco se reimplementa la lógica de cierres (`pozo.ts`, `cierrePozo.ts`, cierre del día de la 071) ni cobro, vuelto o conversión.
- [ ] Al final: `git hash-object <archivo>` = la tabla de ESTADO. Va en el PR.

## 3. Gate
Mientras trabajás, lo barato: `npx tsc -b`, `npx eslint <lo tocado>`, `npx vitest run <lo tocado>`. El gate entero, una vez antes de abrir el PR y de nuevo si cambia la cabeza, en clon o worktree limpio:
```bash
bash scripts/ci/gate.sh    # el mismo que corre el CI; sin pipes que tapen la salida
```
La última línea es el veredicto: `GATE: PASS sha=<8> tests=<n> lint=<n>/<tope> build=ok` o `GATE: FAIL paso=<nombre> sha=<8>`. Si el lint baja, bajá el tope de `scripts/ci/lint-linea-base.json` en el mismo PR.
- [ ] Si tocás `club-web/`: `cd club-web && npm ci && VITE_CLUB_URL=https://club.ejemplo.test npm run build` (sin la variable el build de producción falla a propósito).
- [ ] Un test que falla a veces no se reintenta ni se tapa con `sleep`: causa o reporte (R11).

## 4. Pruebas que muerden
- [ ] Lógica crítica (plata, caja, propinas, permisos, fechas, migraciones) lleva prueba nueva o ajustada.
- [ ] **Mutación:** romper el arreglo a propósito y ver que la prueba cae; deshacer y ver verde. En SQL, dentro de la transacción descartada (`scripts/sql/mutar_bateria.py`). En el PR: «mutación X → caen N».
- [ ] Lo que no se pudo probar se dice (NO PROBADO), no da verde. Permisos: usuario real del rol o su JWT en `begin read only` … `rollback` (regla 4).

## 5. Fechas y textos
- [ ] «Hoy» es Costa Rica: `todayCR()` / `dateCR()` de `src/shared/utils`; nunca `new Date().toISOString().slice(0, 10)`. Las pruebas de fecha fijan el reloj de noche en CR (23:30 CR = 05:30 UTC del día siguiente).
- [ ] Texto para **clientes** (club-web, portal, Wallet) en «usted» (`club-web/src/usted.test.ts`, `src/shared/wallet/usted.test.ts`); única excepción, el aviso versionado `alta_aviso`.
- [ ] Si cambia algo que ve el personal, el PR dice en concreto qué va a ver el encargado.

## 6. Guía SOP, esquema y estado
- [ ] Cambio de pantallas, botones, roles o reglas: guía de `docs/sop-app/` en el mismo PR con `verificado_en_commit`, o el PR dice por qué no.
- [ ] Migración: número de tu bloque, en `supabase/migraciones-reservadas.json`, con `scripts/sql/NNN_rollback.sql` y pruebas (`satori-migraciones-y-prod`). Nada bajo `supabase/functions/` en un PR a `main` (regla 2). Nunca revertir un `.sql` del ledger (regla 10).
- [ ] Si el PR cambia el estado real (prod, ledger, ramas, Edge), actualiza ⚡ARRANQUE.

## 7. Repo público
Reglas y las dos excepciones del correo: `CLAUDE.md`. Revisá el diff antes de cada commit: `git diff origin/main | grep -nEi '@|\+?506|[0-9]{9}|key|secret|token'` y leé cada coincidencia. Los escaneos del gate no miran `.claude/` ni todo `docs/`: ahí, a mano.

## 8. PR
- [ ] Commit con el trailer de la sesión y `Verificado:` = `gate` (la línea `GATE:` tal cual) · `gate+staging` · `gate+verificador` (solo si otro agente que no vio el trabajo lo revisó sobre ese SHA) · `ninguno (motivo)`. Push: `git -c push.negotiate=true push -u origin claude/<tema>`.
- [ ] PR por REST (GraphQL no anda), en borrador si hay que esperar OK (`-F draft=true`). Si toca plata, esquema o prod, el título empieza «⛔ NO MERGEAR sin OK —».
- [ ] Cuerpo: qué y por qué · gate con números · hashes de sagrados · mutaciones · guía SOP · riesgos · vuelta atrás · qué quedó afuera.
- [ ] No mergear desde acá: `satori-merge-y-deploy`.
- [ ] Reporte: ≤ ~200 palabras + una tabla (archivo · qué cambió · prueba); detalle al PR.

## 9. Rondas
- El autor corre el gate antes de abrir el PR y pone el SHA en el cuerpo. El verificador (otro agente) recibe hallazgos y gate de ESE SHA y no los rehace; en plata, esquema y seguridad recalcula con su SQL de solo lectura.
- Tope de 3 rondas: después se para y se trae al coordinador con la causa y lo descartado.
- Cada error que llega a prod, al revisor o al gate suma una fila a `docs/REGLAS-POR-INCIDENTE.md` en el mismo PR que lo arregla.

## 10. Poda de ESTADO y PROMPT-CONTINUACION
Al pasar los 15 KB (`wc -c`), la sesión de cierre mueve lo viejo **tal cual** a `docs/historico/` (con puntero y lista de secciones en el PR). ESTADO conserva solo lo que no sale del código ni de git, y la sección «### Numeración de migraciones» con una celda `| NNN |` por número registrado (la exige `supabase/migraciones.test.ts`). Links rotos, se corrigen en el mismo PR.
