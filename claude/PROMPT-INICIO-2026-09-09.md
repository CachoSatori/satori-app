# PROMPT DE INICIO — sesión del 2026-09-09 (Satori · reconciliar módulo Ventas)

> Pegar al arrancar el chat. Referenciado desde `claude/HANDOFF-2026-09-08.md` (⏭️ ARRANQUE).

Soy Ismael (Satori Sushi Bar, Santa Teresa/Nosara). Sos mi asesor técnico senior; Claude Code
ejecuta; yo decido y valido en piso. **El repo manda** — verificá contra el código y los docs antes
de opinar. Voseo costarricense, directo y conciso.

## Ponete al día (leé antes de responder, en serio, no de resumen)

1. `ESTADO.md` — la verdad del repo.
2. `claude/HANDOFF-2026-09-08.md` — la sesión anterior, completa (incluye el mapa de fases y el
   diagnóstico del arranque lento).
3. Contexto: `claude/VALIDACION-cuadre-pos-agosto-2026-09-04.md` y
   `claude/SPEC-ventas-pos-migracion.md` **si están**. Profundizá de verdad; cruzá contra el repo.

## Mapa de fases (dónde estamos)

- P1 adaptador ✅ · P2 swap de fuente ✅ · P3 paridad ✅ (agosto/mayo/junio 2026 cuadran;
  2024-2025 vs reporte oficial 99,94 %).
- **RECONCILIAR el módulo Ventas** ← acá arrancamos.
- Después: «En vivo → Hoy» (fundir la pestaña) → **P4** retiro del Excel (apagar carga xls,
  archivar «Cargar XLS» + parser, **NO borrar**; con firma).

## En qué vamos a trabajar: RECONCILIAR el módulo Ventas

Ahora que la fuente pasó de Excel a `pos_ndf` (P2), hay cosas en las pestañas que no se ven del
todo igual, aunque la plata cuadre. El foco es recorrer el módulo **pestaña por pestaña** y acomodar
cómo se muestra la info.

**Diferencias YA identificadas del cambio de fuente (para saber qué mirar):**

- **Delivery ~4-6 % más bajo** — definición nueva (canal real `canal='delivery'` vs proxy "sin
  cargo de servicio" del xls). Correcto pero distinto.
- **Columnas COMIDAS / BEBIDAS no cerraban en Paridad** (mayo/junio) — montos chicos, no son neta;
  entender qué representan.
- **Familia 29 = GreenSeason** pero el código la etiqueta "Bentos" (`mapTicket.FAMILIA_BENTOS`,
  `CATEGORIA_FAMILIA[29]`, 2 tests) — mal rótulo, rename limpio, no toca plata.
- **2024 = 0 % cobertura salonero** → Saloneros / Evaluación / ICP vacíos en 2024 (no regresión).
- **2024-2025 ahora con detalle diario** que antes no existía (`ventas_dias` iba solo de ene-2026)
  → historia más llena.
- El **mix sale de familias del PoS** (whitelist `[2,3,4,5,13,16,29]`).
- **−0,057 % histórico** en días viejos puntuales (7-mar-2024) — ruido.

## Specs en cola

- `claude/SPEC-descomposicion-de-venta.md` («por qué bajó/subió»): **FIRMADO**, desbloqueado
  post-P2. Candidato **después** de reconciliar.
- Revisá la carpeta `claude/` por otros specs vivos.

## Qué hacer PRIMERO (no cambies nada todavía)

1. Confirmame en 3-4 líneas que entendiste el estado (P2, qué cambió al pasar al PoS).
2. **Preguntame:** qué es puntualmente lo que estoy viendo que no se ve igual, por qué pestaña
   empezamos a reacomodar, y si el SPEC de descomposición entra en esta tanda o después.
3. Proponé un **orden** para recorrer las pestañas (Hoy, Saloneros, Saloneros x Línea, Mix,
   Cajeros, Análisis, Histórico…) cruzando cada una contra las diferencias de arriba.

## Guardrails

No tocar sagrados (`cashUtils`, `tipCalculations`, `computeTotals`, `posFiscal`, cierres), IVA,
`total_crc`, caja, propinas. Nada de plata/esquema sin mi firma. Cambios en rama; valido en staging;
prod no se toca. Gate verde.

## Track paralelo (cuando yo lo pida, NO por default): carga lenta del app (>1 min)

Ya diagnosticado por CC (handoff §9). **NO** es que el auth espere el realtime (premisa vieja,
equivocada). Dos problemas: (1) bootstrap serial hasta 24s con contención de lock; (2) el loop del
socket porque `isConnected()` trata `'connecting'` como caído y lo mata con `disconnect()`. Fix en
3 piezas, **empezar por la pieza 1** (`connectionState()` en vez de `isConnected()`, sacar el
`disconnect()`; rompe el loop, riesgo bajo) y medir. Antes de tocar, confirmar en el console: si
`ensureRealtimeHealthy: start` aparece **antes** de que resuelva el bootstrap, y si sale
`[auth] lock … no adquirido en 5s` (+ si hay otra pestaña / la PC del PoS abierta).
