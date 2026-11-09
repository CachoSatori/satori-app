# Orden de los pases (al 09-nov-2026, 07:50 CR) — checklist, nada se ejecuta desde acá

> Cada paso entra **solo** con su firma y con el paso anterior cerrado. Firma siempre **Ismael** (el dueño); Grok audita
> y su GO es condición, no firma. Ninguna sesión mergea a `main` fuera de su paso, ni durante el servicio (19–22 h
> CR), ni durante un congelamiento. Los SHA son los de hoy: si una rama se mueve, se vuelve a verificar su gate.

| # | Paso | Rama / PR · SHA | Gate (todo tiene que cumplirse) | Evidencia | Firma | Estado |
|---|---|---|---|---|---|---|
| 1 | **Puente a prod**: 081, 082 **v3** y Edge `ingest-ndf` (lo ejecuta la sesión del Club) | `claude/puente-item11-prod-v2` · código `5da233a` (base del Edge `e4678b3`) | paquete v2 firmado; GO de Grok sobre la 082 v3; fecha fijada por el dueño; `main` congelado desde el inicio | `docs/puente/PASE-PROD-2026-11-09.md` y `ENSAYO-STAGING-v2.md` (rama v2) | Ismael | ⏳ reprogramado (fecha a definir) |
| 2 | **#71**: sincronía del ledger (081 y 082 v3 en `main`, byte a byte) | [#71](https://github.com/CachoSatori/satori-app/pull/71) · `0a33df4` | §7 del pase sin aborto; md5 del ledger de prod = archivos del #71 (081 `d4acf8da…`, 082 v3 `edb7ffc5…`); nadie más mergeando | run de Branching «All migrations are up to date» | Ismael | ⏳ espera el paso 1 |
| 3 | **085** (SEC-01c) por Branching | `claude/rls-is-active` · `50c8855` (rebasar sobre `main` con el #71 adentro) | §7 sin aborto **y** §8 en verde (✅ 08-nov: DESPUES 31/31, ROLLBACK 33/33); #71 mergeado y Branching en verde; catálogo de prod igual al respaldo (sha256 `4db2c15b…`) | `docs/pases/PASE-085-rls-lectura-rol-activo.md` §8 | Ismael | ⏳ espera los pasos 1–2 |
| 4 | **089 y 090 a staging** (no a prod todavía) | 089: `claude/anon-revoke` · `a7df008` (mig `d59d3a9`) · 090: `claude/anon-default-privs` · `b63599d` (mig con el comentario del gate) | 085 en prod; prueba de la 089 7/7 (✅ 08-nov, descartada); gate de catálogo de la 090 (✅ `docs/pases/GATE-090-catalogo.md`); ventana nocturna de staging; invertir el caso negativo de la prueba 82 del Club junto con la 090 | `docs/pases/089-prueba-staging-2026-11-08.md`, `GATE-090-catalogo.md` | Ismael | ⏳ |
| 5 | **#73** (arreglos fuera de sagrados) | [#73](https://github.com/CachoSatori/satori-app/pull/73) · `2c0e990` | `main` descongelado (#71 mergeado); gate verde (vitest 1510); recorrido corto en staging/preview (lista en el PR); el dueño vio los bloqueos nuevos de edición | cuerpo del #73 | Ismael | ⏳ |
| 6 | **#70** (caracterización de sagrados + medición) | [#70](https://github.com/CachoSatori/satori-app/pull/70) · `2aed133` | juntos o después del #73 sin rojo (✅ probados juntos: 95/95) | cuerpo del #70 | Ismael | ⏳ |
| 7 | **#65** (Login del PoS) | [#65](https://github.com/CachoSatori/satori-app/pull/65) · `a167113` | gate verde; «solo owner» solo con el 42501 del trigger del login; la regla de la base (trigger del Club, Grok 106) entra con la 075 — el #65 no depende de ella | cuerpo del #65 | Ismael | ⏳ |
| 8 | **#68** (deuda de lint) | [#68](https://github.com/CachoSatori/satori-app/pull/68) · `6c35c0a` | **después del #73**: rebase sobre `main` sin quitar ninguna validación del #73; revisión del preview por Ismael | cuerpo del #68 | Ismael | ⏳ espera el paso 5 |

**Fuera de este orden (sin firma todavía):** 087 (`claude/employees-audit`, prueba 5/5), 088 PROP-AUD-01
(`claude/prop-aud-01`), 091 multilocal fase 0 (`claude/multilocal-fase0`), 092 R7-01 (`claude/employees-borrado-owner`),
084 Salarios (staging; `claude/salarios-rls` + #63), SEC-02b (#61, paquete en `claude/pase-sec-02b`; va después del
puente y de la 085).
