PROMPT CC — Reversión del scaffold: integrar "En vivo" en el módulo ventas (v2)
2026-09-02. Corrige el enfoque: NO es un módulo nuevo. La UI va integrada en `src/modules/ventas/` como pestaña "En vivo", reutilizando el modelo existente. Reversión sobre la misma rama `feat/analitica-pos-scaffold` (9713b3d).
CONTEXTO
Ya armaste el scaffold en `feat/analitica-pos-scaffold` (9713b3d) como módulo nuevo. Cambio de enfoque: no es un módulo nuevo. La UI va integrada en el módulo existente `src/modules/ventas/` como pestaña "En vivo", reutilizando el modelo de datos que ya existe. Reversioná lo hecho sobre la misma rama.
REGLA DURA (por encima de todo)
No cambiar el comportamiento actual del módulo ventas ni de nada en producción. La pestaña "En vivo" es puramente ADITIVA y lee del mock. Todo lo existente (pestañas actuales, `xlsParser`, cierres, consumidores de `DiaData`, sagrados) se comporta EXACTO como hoy. Si algo te obliga a modificar lógica existente para que "En vivo" funcione, PARÁ y reportá en vez de tocarlo.
CAMBIOS respecto de lo que ya hiciste
1. UI → dentro de ventas

* Mové la pantalla "Ventas en vivo" a `src/modules/ventas/` como pestaña "En vivo".
* ELIMINÁ el módulo standalone `src/modules/analitica-pos/` y revertí su wiring: la ruta `/analitica-pos` en `App.tsx` y el tile en `HomePage.tsx`. No debe quedar módulo, ni ruta, ni tile propios.
* Reusá los componentes ya hechos (`RitmoPorHora`, la piel `.apos`, el mock, el manejo de `servicioEnCurso`) re-homeados bajo ventas. Mantené la piel scopeada para no filtrar estilos.

2. Tipos → alineados al modelo existente

* Reutilizá `DiaData` y lo de `xlsParser.ts` como base. El total del día y el desglose usan el mismo modelo que ya consume ventas, para que "En vivo" y las pestañas actuales hablen el mismo idioma.
* Lo live-only (ritmo por hora, snapshot en vivo, `servicioEnCurso`) extiende ese modelo de forma ADITIVA: tipos/campos nuevos opcionales, sin cambiar el significado ni el tipo de ningún campo existente.
* Excluí el "artículo pax" del mix de productos, consistente con el modelo actual. El mock debe reflejarlo.
* Adaptá los tests de contrato a `DiaData` (no a un contrato paralelo).

3. Agente pos-bridge

* Queda como está (carpeta nueva). Ajustá README/`mapRow` para que el objetivo del feed sea la misma forma que hoy produce el import de xls (`ventas_dias` / `DiaData`) + el detalle live — así a futuro el PoS reemplaza el import manual. Sigue siendo TODO/hueco (sin DDL, sin conexión real).

GUARDRAILS

* Rama `feat/analitica-pos-scaffold`, sin merge, sin tocar `main`.
* NO tocar la lógica de parsing de `xlsParser.ts`; como mucho EXTENDER tipos de forma aditiva (si se puede sin tocarlo, mejor).
* NO tocar sagrados (`posFiscal.ts`, `tipCalculations.ts`, `cashUtils.ts`, `computeTotals`), NO DDL, NO migraciones, NO plata real, NO credenciales.
* Todos los tests existentes (ventas y resto): verdes y sin cambios de comportamiento.
* "En vivo" con datos mock, marcada claramente como preliminar hasta cablear datos reales.
* La integración del live DENTRO de las pestañas existentes (primera pestaña, etc.) queda para DESPUÉS de confirmar datos reales — ahora solo la pestaña aditiva.

CRITERIOS DE ACEPTACIÓN

* "En vivo" es una pestaña dentro de `ventas`. NO existe módulo `analitica-pos` standalone, ni ruta `/analitica-pos`, ni tile propio.
* Tipos alineados a `DiaData`/`xlsParser.ts`; extensiones solo aditivas; artículo pax excluido del mix.
* Comportamiento del módulo ventas actual sin cambios; todos sus tests verdes.
* `pos-bridge` compila; `mapRow`/README apuntan a la forma `ventas_dias`/`DiaData` (+ detalle live) como TODO.
* build / tests / typecheck / lint verdes; sagrados byte-idénticos; 0 migraciones; `main` intacto.
* Reporte: qué movió, qué extendió (y por qué es backward-compatible), y confirmación explícita de que el ventas actual no cambió de comportamiento.
