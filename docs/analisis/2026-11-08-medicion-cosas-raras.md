# Medición en prod de las «cosas raras» del #70 — 08-nov-2026

> Solo lectura en prod, el 08-nov. Nada se arregló en la base. **El repo es público: acá no van montos reales ni
> nombres**; los montos de cada caso se le pasaron al dueño por chat. Acá quedan los conteos, los períodos y las
> decisiones.

| # | Caso | Ocurrencias | Período | ¿Afectó plata real? |
|---|---|---|---|---|
| a | Movimientos «rechazado» | 4, todos en Banco; 0 en Caja Fuerte | jul → ago | No: el saldo de Caja Fuerte es lo único que no los excluye y no hay ninguno ahí. No entraron en ningún cierre. |
| b | Traspasos con «->» u otra flecha que no sea «→» | 0 (todos los que tienen flecha usan «→») | — | No |
| b′ | Traspaso «Diferencia apertura» en Caja Fuerte, sin flecha (la regla lo cuenta como salida) | 1 | 22-may | Decisión del dueño (abajo) |
| c | Propinas con NaN, null o vacío (montos, horas, puntos, tipo de cambio, pozos) | 0 | — | No |
| d | Pozo de barra > 0 sin nadie de barra | 0 (los turnos con barra tenían gente de barra) | — | No |
| e1 | Repartido ≠ pozo por redondeo | 130 turnos (123 por ₡1; 7 por ₡2–5) | todo el período | Sí, mínimo (₡1–5 por turno) |
| e2 | Repartido ≠ pozo por más de ₡5 | 10 turnos: 9 entre 16-ene y 25-feb, 1 el 11-jun | ene–feb, 11-jun | Decisión del dueño (abajo) |
| f | Negativos en propinas | 0 | — | No |
| f | Negativos en caja | 46 ingresos en Caja Fuerte con ₡ negativos y $ positivos; 6 traspasos negativos en Registradora | may → nov; ene → may | No: es el vuelto en colones de cobros en dólares; los de Registradora no entran al saldo de Caja Fuerte |
| g | Entradas de empleados inexistentes | 0 | — | No |
| g′ | Entradas de empleados hoy inactivos | 727 en 259 turnos | ene → ago | No en lo pagado; sí en lo que cajero y contador veían en Historial (lo arregla el #73) |
| 7 | Propina de cocina al pozo / propina de barra ignorada | 0 / 0 | — | No |
| 10 | Runner que cubre barback con datáfono | 0 | — | No |
| 15 | Sin redondeo | 614 movimientos con decimales; 27 cierres con diferencia no entera (5 de menos de ₡1) | jun → nov | No |
| 11, 16, 17 | Formatos (USD, fechas, `fi` con negativos) | no se guardan en la base | — | No (pantalla) |

## Decisiones del dueño (08-nov)
Se dejan **como datos viejos, sin cambios** (no se corrigen ni se reparten):
- el turno de propinas del **11-jun**, con su pozo sin repartir (todas las personas con 0 puntos);
- el traspaso **«Diferencia apertura» del 22-may** en Caja Fuerte;
- los **9 turnos de ene–feb** donde el pozo guardado (recalculado en el backfill de agosto) no coincide con lo pagado.

Lo que sigue: las validaciones de entrada y el historial con lo pagado van en el #73 (fuera de sagrados). Los arreglos
dentro de los sagrados (reparto al colón, barra no repartida, tipo de cambio, saldo con «rechazado», flecha ASCII,
redondeo) quedan para una sola firma más adelante.
