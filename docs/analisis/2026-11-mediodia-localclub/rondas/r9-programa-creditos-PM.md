# Ronda 9 — Programa de créditos (tarjetas) y comisiones PM: conciliación con el PoS · 04-nov-2026

Reporte: https://claude.ai/artifact/9Ad3sbMcV4q2gMLfJbNXcq

## Fuentes entregadas por Ismael (no se guardan en el repo)

Las planillas tienen teléfonos, correos y cédulas: quedan fuera del repo.

- `reporte_creditos.xlsx`: export del sistema web de créditos (creditos-73bac), con las hojas Resumen, Personas, Mes a mes y Club.
- `Listado de Personas y Tiendas`: socios del sistema de créditos y el mensaje de bienvenida (dice que 1 crédito = ₡14.000).
- **SOP:**
  - `PROGRAMA_CREDITOS.docx`: propuesta de subir el crédito de ₡16k a ₡18k y de pagar un variable al gestor.
  - `DEBITACIÓN DE CRÉDITOS`: cómo se cobra una mesa con créditos.
  - `CÓMO CERRAR LAS MESAS PM`: cómo se cierra la regalía PM.
  - `PROTOCOLO DE RECLUTAMIENTO DE CONCIERGES Y PM`: el programa PM, vigente desde mar-2024.

## Cómo funcionan los programas

| Programa | Qué recibe el cliente | Qué recibe quien refiere | Cierre en el PoS |
|---|---|---|---|
| Tarjetas + créditos (desde oct-2022) | 10 % | 1 crédito cada 6 personas, de ₡12k → 14k → 16k → (hoy unos) 18k. Máximo 2 por visita, solo en salón | Cliente «CRÉDITOS NUEVO» y forma de pago «Créditos», que queda como `CuentaCobrar` |
| Club / PM concierges (desde mar-2024) | Postre de cortesía | 10 % del subtotal, en efectivo cada mes (factura «Concierge/PM» en caja de proveedores) o consumido | «REGALÍA PM (nombre)» |
| Gestor | — | US$200 fijos por mes | — |

## Conciliación

**Personas con tarjeta: PoS (mesas con 10 %, Q25) contra el reporte**

| Período | PoS | Reporte | Lectura |
|---|---|---|---|
| 2024 | 2.935 | 1.543 | VIP al 10 % mezclada |
| Ene–abr 2025 | 905 | 594 | VIP al 10 % mezclada |
| May–dic 2025 | 553 | 422 | El PoS da 31 % más |
| Ene–nov 2026 | 1.037 | 1.124 | Cuadra (8 %) |

- **Mes a mes:** no cuadra porque las tarjetas se cargan con atraso. En el reporte, oct-2025 y oct-2026 figuran en 0.
- **El documento PROGRAMA_CREDITOS dice 1.427 personas en 2025.** El reporte da 1.016. Hay que confirmar de dónde sale.

**Créditos canjeados: reporte contra D12 (`CuentaCobrar` de las facturas «CREDITO»)**

| | 2025 | Ene–oct 2026 |
|---|---|---|
| Créditos consumidos | 165,5 | 146,5 |
| Facturas | 121 | 121 |
| Cuenta por cobrar | ₡1,99M | ₡2,63M |
| ₡ por crédito | 12.006 | 17.927 (cuadra con ₡18k) |

- **Meses que no cuadran:** mar, may y sep-2026 dan más de ₡20k por crédito, y oct-2026 da ₡47k. Puede haber canjes cobrados en el PoS sin descontarse del sistema, o descontados en otra fecha. Hay que revisarlo mesa por mesa.
- **Créditos otorgados en 2026:** 186, para 1.124 personas (1 cada 6,0). La regla se cumple.

## Costo real del programa de tarjetas, por mes (2026)

| Concepto | Monto |
|---|---|
| Descuento 10 % | ₡147k |
| Créditos: comida | ₡55k |
| Créditos: IVA + servicio | hasta ₡60k |
| Gestor | ₡99k |
| **Total** | **₡300–360k** |

- **Margen que dejan los clientes con tarjeta:** unos ₡1,0M por mes, o sea unos 3× el costo. No todo es venta nueva.
- **Corrección a lo que decíamos antes:** el beneficio no es «₡2.000 por tarjeta», sino ₡3.000 por persona (un crédito de ₡18k cada 6 personas).

**PM**
- Desde mar-2024 se cargaron ₡879k en comisiones: ₡578k pagados y ₡301k pendientes. Es un promedio de unos ₡27k por mes.
- Ese pago es en efectivo y no aparece en la venta.

## Saldos pendientes

- **Créditos sin usar:** 172, en manos de 128 personas. A ₡18k son ₡3,1M de valor; el costo real, si se canjean todos, sería de ₡0,65 a 1,4M.
  - No vencen.
  - Del total histórico se canjeó el 74 % (773,5 de 1.049,5).
- **Comisiones PM por pagar:** ₡301k en efectivo.

## D16 — Mesas y regalías PM (resultado en `datos/r8/d16_pm.csv`)

| | 2024 (mar–dic) | 2025 | 2026 (ene–oct) |
|---|---|---|---|
| Mesas PM en el PoS | 54 | 38 | 10 |
| Subtotal | ₡2,69M | ₡1,59M | ₡0,44M |

- **Comisiones contra PoS:** el 10 % de las mesas PM suma ₡472k desde mar-2024, pero en el Club se cargaron ₡879k (+86 %).
  - Posibles causas: mesas PM que no se anotaron con nombre en el PoS, o comisiones cargadas de más.
  - Hay que cruzar el Excel de comisiones contra el PoS antes de pagar los ₡301k pendientes.
- **Regalía PM:** solo hubo una (feb-2025).
- **El canal casi desapareció en 2026.**
- **Valor del crédito:** confirmado por Ismael en ₡18.000.

### SQL

```sql
SELECT CONVERT(char(7), f.FechaRegistra, 120) AS mes,
       CASE WHEN UPPER(ISNULL(f.MotivoRegalia, '')) LIKE '%PM%' THEN 'regalia PM' ELSE 'mesa referida PM' END AS tipo,
       COUNT(DISTINCT f.NumeroFactura) AS facturas,
       ROUND(SUM(d.Cantidad * d.PrecioVenta - ISNULL(d.Descuento, 0)), 0) AS subtotal,
       ROUND(SUM(d.MontoTotal), 0) AS total,
       ROUND(SUM(d.CostoTotal), 0) AS costo
FROM FAC_Facturas f
JOIN FAC_FacturasDet d ON d.NumeroFactura = f.NumeroFactura
WHERE f.Estado = 'C' AND f.FechaRegistra >= '2024-03-01'
  AND (UPPER(ISNULL(f.NombreCliente, '')) LIKE '% PM' OR UPPER(ISNULL(f.NombreCliente, '')) LIKE '% PM %'
       OR UPPER(ISNULL(f.MotivoRegalia, '')) LIKE '%PM%')
GROUP BY CONVERT(char(7), f.FechaRegistra, 120),
         CASE WHEN UPPER(ISNULL(f.MotivoRegalia, '')) LIKE '%PM%' THEN 'regalia PM' ELSE 'mesa referida PM' END
ORDER BY 1, 2;
```

## Propuestas

- Confirmar el valor actual del crédito.
- Que los créditos venzan a los 12 meses.
- Revisar los meses que no cuadran.
- Cargar las tarjetas cada semana.
- Pagar o confirmar las comisiones PM pendientes.
- Definir con el contador «a crédito» contra regalía.
- **Backlog de la app:** en cada mesa, el código de quien refirió; conciliación automática; comisiones PM como costo del programa.

## VIP 10 % contra 15 %, separando las tarjetas de hotel con el reporte (04-nov)

Socios estimados al 10 % = mesas-persona con 10 % en el PoS (Q25) − personas con tarjeta según el reporte de créditos.

| Personas por mes | Socios 10 % (est.) | Socios 15 % | Club total | Sin descuento |
|---|---|---|---|---|
| Ene–abr 2024 | 166 | 50 | 217 | 1.849 |
| Ene–abr 2025 | 78 | 126 | 204 | 1.895 |
| Ene–abr 2026 | 0 | 293 | 293 | 1.796 |
| May–oct 2024 | 84 | 66 | 150 | 1.302 |
| May–oct 2025 | 23 | 236 | 259 | 903 |
| May–oct 2026 | 11 | 195 | 206 | 998 |

**Qué dice:**
- **Pasar la VIP de 10 % a 15 % no trajo gente:** −6 %.
- **El relanzamiento como Local Club sí trajo gente:** +73 % en baja 2025 y +44 % en alta 2026. Lo más probable es que el crecimiento venga del nombre, la promo y la difusión, no del 15 %.
- **Ruido:** ±20 personas por mes, por el atraso en cargar las tarjetas.
