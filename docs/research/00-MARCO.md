# Research PoS — Fase 0: Marco de comparación y selección

> Satori App · 2026-07-10 · Ejecutado de corrido por orden del dueño (sesión desatendida).
> **Toda conclusión de este research es RECOMENDACIÓN pendiente de firma del dueño** — nada entra al roadmap sin firma.

## Los 6 sistemas seleccionados (decisión del asesor, dueño ausente — revisable)

| # | Sistema | Por qué está en la lista |
|---|---|---|
| 1 | **Toast** | Líder absoluto de PoS de restaurantes en EEUU; referencia de mercado en flujos de servicio completo, KDS y propinas. |
| 2 | **Square for Restaurants** | El estándar de simplicidad/bajo costo; mejor onboarding del mercado; referencia de UX para equipos no técnicos. |
| 3 | **Lightspeed Restaurant** | Referencia en inventario/reportes avanzados y multi-local; fuerte fuera de EEUU. |
| 4 | **TouchBistro** | PoS iPad-first pensado POR restauranteros; referencia de operación offline-first en piso. |
| 5 | **Oracle Simphony (MICROS)** | El estándar enterprise/hotelería/franquicias — exactamente el norte del PILAR multi-tenant de Satori. |
| 6 | **Fudo** | Jugador LatAm relevante (contexto real de Satori: español, mercados con SINPE/facturación local, restaurantes chicos). |

Suplentes considerados: Lavu, Clover, SpotOn, Soft Restaurant (muy fuerte en México/Centroamérica — si el dueño prefiere, se puede sumar o reemplazar a Fudo en una iteración posterior).

## Plantilla de ficha (los 11 ejes — idénticos para los 6)

1. **Comandero / toma de pedidos** — mesas, cursos, modificadores, envío a cocina.
2. **KDS / cocina** — pantallas, tiempos, priorización, comunicación salón↔cocina.
3. **Cobro** — medios de pago, splits, propina en el cobro, vuelto, anti-doble-cobro.
4. **Propinas** — captura, pooling, distribución (puntos/horas/%), pago al staff, reporting.
5. **Caja / arqueo** — apertura/cierre de caja, conteo, diferencias, auditoría de movimientos, multi-caja.
6. **Inventario / COGS** — recetas, depleción por venta, costos, compras, alertas.
7. **Reportes / analítica** — P&L, ventas por período/turno/ítem, laboral, exportación.
8. **Personal** — roles/permisos, turnos, fichaje, performance.
9. **Fiscal / facturación** — impuestos, facturación electrónica, adaptabilidad a normativas locales (relevante: Hacienda CR 4.4).
10. **Offline / robustez** — qué funciona sin internet, cómo sincroniza, qué se pierde.
11. **Multi-local / franquicia** — gestión centralizada, menús por local, reporting consolidado, modelo de sesión/dispositivos.

Por sistema, además: **fortalezas destacadas**, **debilidades reales** (fuentes: usuarios, no marketing), **pricing/modelo de negocio**, y **qué le robaría Satori**.

## Método

- Fase 1: deep research multi-fuente con verificación adversarial de afirmaciones (docs oficiales + G2/Capterra/Reddit para debilidades reales), fuentes citadas.
- Fase 2: síntesis POR FLUJO (no por sistema) → catálogo de mejores prácticas.
- Fase 3: cruce contra ROADMAP.md/ESTADO.md reales del repo → veredicto por ítem: **YA-SUPERIOR / REPLICAR / MEJORAR / DESCARTAR**, con justificación.
- Fase 4: documentos finales en `docs/research/` (vía Claude Code, con firma) + handoff.

## Principio rector del gap analysis

Satori NO parte de cero: caja de 2 fases con arqueo real, propinas por puntos con vía-real de pago, ledger trazable e idempotente, offline-first con outbox — en varios de estos flujos Satori ya está por encima del mercado SMB. El análisis debe reconocer dónde Satori ya gana, no asumir que lo de afuera es mejor.
