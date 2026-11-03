# Análisis mediodía, menú y Local Club (nov 2026)

Análisis hecho entre el 29-oct y el 03-nov-2026 con datos del PoS Nube de Fuego (ago-2024 a oct-2026).
Objetivo: decidir qué hacer con el menú de mediodía (familia 29 GREENSEASON) y con el descuento Local Club.

**Reportes publicados (claude.ai):**
- Para socios (conciso): https://claude.ai/artifact/WtEwjaxWhDdDyqnpPMDt4o
- Resumen con detalle: https://claude.ai/artifact/2ZWjtnE72jC28A5kSvjQyf
- Estrategia de mediodía (detalle): https://claude.ai/artifact/UFxajJtFfVkVGHUHL5x8HG

Todo es **solo lectura**: nada de esto toca la base ni el código de la app.

---

## 1. Resultados

### Menú de mediodía

| Período (mañana) | Gasto promedio por persona |
|---|---|
| 2024 | ₡12.753 |
| ene–jun 2025 | ₡11.956 |
| jul–nov 2025 (con menú) | ₡10.700 |
| dic 2025–feb 2026 (con menú) | ₡10.476 |
| mar–oct 2026 (con menú) | ₡11.232 |

- Personas jul–nov 2025: +40 % contra 2024.
- Margen por persona: carta ₡10.500–11.800, menú ₡5.900–6.500.
- Punto de equilibrio: el 44 % o más de las personas del menú tienen que ser clientes nuevos.
- Efecto por mes: temporada baja 2025 +₡470k (73 % nuevos). Temporada alta −₡625k (no concluyente; +₡530k si se cuenta el efecto en la noche).
- Delivery: pedidos de mañana +21 % con la misma venta. Delivery de noche −33 % desde 2024.
- **Recomendación:**
  - Menú ejecutivo solo en temporada baja (mayo a mediados de diciembre), con 5 platos: Bento, Casado, Bowl Teriyaki, Sakura Poke y Sushi Duo.
  - ₡1.000 más por plato (+₡130k/mes).
  - Combo con bebida (+₡50k/mes).
  - Corregir el costo del Bento (+₡20k/mes).

### Local Club y descuentos (noche)

| Grupo | Venta por persona | Margen por persona | Período |
|---|---|---|---|
| Sin descuento | ₡17.212 | ₡13.084 | mar–ago 2026 |
| Tarjeta 10 % | ₡16.384 | ₡12.026 | mar–ago 2026 |
| LC carta | ₡13.902 | ₡10.019 | mar–ago 2026 |
| LC menú | ₡13.912 | ₡9.135 | sep–oct 2025 |

**Comparación sep–oct 2025 (con menú LC) contra sep–oct 2026:**
- Personas LC por mes: 194 contra 131. El resto: 592 contra 611.
- Margen LC por mes: ₡2,12M contra ₡1,36M.
- Escenarios: +₡753k / +₡392k (prudente) / −₡100k (este no pasó).

**Costo de los descuentos:**
- Costo del descuento LC: unos ₡514k/mes (mar–ago 2026) y ₡268k/mes (sep–oct 2026).
- VIP card de 10 % a 15 %: no trajo gente. Personas con descuento ene–abr: 330 en 2024 y 331 en 2025.
- Volver LC al 10 %:
  - Ahorra unos ₡170k/mes en alta y ₡90k en baja (unos ₡1,6M/año).
  - Deja de convenir si se pierde más del 7 % de las visitas LC.
  - Con un regalo (unos ₡400 por persona contra ₡820 del 5 % extra) el ahorro es unos ₡0,8M/año.

**Otros hallazgos:**
- Favoritos LC: Subarashi, Rainbow, Super Maguro, Pollo Teriyaki, Ginger Mint Lemonade y El Gusano/Margarita. Piden menos entradas y postres.
- Marcado de LC en caja: unos 20 % de las mesas LC no se marcan (40 % de las cerradas por caja).
- Tarjetas de hoteles y tiendas: el programa cuesta unos ₡205k/mes reales y deja unos ₡11.500 de margen por persona. Se mantiene.
- Personal 30 %: unos ₡54k/mes, subiendo jul–oct 2026.
- Créditos de tarjetas (ver §3):
  - Unos ₡263k/mes cerrados «a crédito». El PoS los cuenta como venta, y la app es igual al PoS.
  - La salida real es de ₡115k/mes como máximo (comida unos ₡55k, IVA unos ₡34k, servicio unos ₡26k).

**Recomendación:**
- LC al 10 % + regalo, como prueba de 2–3 meses medida contra el mismo mes del año anterior.
- Menú corto LC de noche en temporada baja (unos +₡390k/mes, estimación prudente).
- Mantener las tarjetas.
- Que caja marque siempre LOCAL CLUB.
- Evaluar con el contador cerrar los créditos como regalía.

**Preguntas abiertas:**
- ¿El servicio de las mesas de crédito entra al reparto de propinas?
- El tratamiento del IVA de esas mesas (contador).

---

## 2. Definiciones (usarlas igual en specs y reportes futuros)

- **Neta:** suma de líneas `estado='C'`, excluyendo las familias 6 (PERSONAL), 17 (X CORTESÍAS) y 20 (Ingredientes). El día es en hora CR.
- **Turno:** mañana = mediodía. La hora de corte está en `rondas/r1-r2-…md`.
- **Prom/pax reconstruido:**
  - Antes de sep-2025 muchas mesas no tienen pax.
  - Se estima con un modelo (error de unos 0,5 pax por mesa, sesgo de −2 % a −3 %). Ver r4/r5.
- **Precio de lista:** la moda del precio unitario del producto en el mes.
- **Ratio de descuento por mesa:** neta ÷ valor a lista.
- **Clases de mesa:**

  | Clase | Regla |
  |---|---|
  | LC | Artículo 856 en la mesa, o ratio 0,80–0,87 |
  | Tarjeta 10 % | Ratio 0,88–0,93 |
  | Sin descuento | Ratio ≥ 0,97 |
  | Otro | El resto |

  Artículo 857 = invitado.
- **Costo:**
  - Por producto: el CoGS 2026; si no hay, el `CostoUnitario` del PoS; si no hay, un % por familia (ver `scripts/costlib.py`).
  - Atajo para mesas: 24 % del valor a lista en carta y 32 % en mesas con menú.
  - Margen = neta − costo (sin mano de obra ni gastos fijos).
- **Temporada:** baja = mayo a mediados de diciembre; alta = mediados de diciembre a abril.

### Historia de descuentos (confirmada por Ismael)

| Período | Programa |
|---|---|
| Primero | Tarjetas de hoteles y tiendas: 10 % al cliente; quien lo envía recibe ₡2.000 de consumo (no efectivo) por tarjeta |
| Antes de abr-2025 | VIP card: un tiempo 10 % y otro 15 % |
| Desde 23-abr-2025 | Local Club 15 % (mayo 2025: promo de lanzamiento 20 %) |
| Siempre | 30 % = personal consumiendo fuera de servicio |
| Siempre | El LC no aplica al menú de mediodía |

## 3. Glosario PoS (SQL Server `ndf`) — lo que aprendimos

- **Descuento:**
  - Es por línea: `FAC_PedidosDet.Descuento` (%) con `TipoDescuento='P'`.
  - `FAC_FacturasDet.Descuento` es un monto en ₡.
  - Los campos de cabecera `FAC_Pedidos.Descuento/TipoDescuento/MontoDescuento` vienen vacíos.
- **Join** `FAC_PedidosDet` ↔ `FAC_Pedidos`: por `Periodo + Mes + Dia + NumeroPedido`. Si se hace solo por `NumeroPedido`, multiplica filas.
- **Campos de `FAC_Facturas`:** `CuentaCobrar` (cerrada «a crédito»), `MotivoRegalia`, `Efectivo`, `Tarjeta`, `Deposito`, `MontoElectronico`, `Cheque`, `NombreCliente`.
- **Campos de `FAC_FacturasDet`:** `IV`, `ImpS` (servicio), `CostoTotal`, `MontoTotal`.
- **Créditos de tarjetas:**
  - Son las facturas con `NombreCliente` LIKE '%CREDITO%'.
  - Según el período, se cierran «a crédito» (`CuentaCobrar>0`) o como regalía.
  - Query: D12 en `rondas/r7-…md`.
- **Familias:**

  | Código | Familia |
  |---|---|
  | 6 | PERSONAL |
  | 17 | X CORTESÍAS |
  | 19 | A PAX |
  | 20 | Ingredientes |
  | 25 | PROMOCIONES |
  | 28 | XX DUEÑOS |
  | 29 | GREENSEASON (menú mediodía) |

- **Supabase:**
  - `pos_ndf_tickets` / `pos_ndf_ticket_lines` replican el PoS.
  - `clase_ingreso` (mig. 063) puede ser `cobrada`, `cortesia`, `duenos`, `sin_cobro` o null.
  - El SQL Editor corta en 100 filas: siempre poner `limit` explícito.

## 4. Huecos de datos (pendientes de ingesta)

Ver `specs/SPEC-analisis-ventas-integrado.md` §6. Principales:
- Ingerir el % de descuento por línea (`FAC_PedidosDet`).
- Ingerir `FAC_Facturas.CuentaCobrar`.
- Revisar `regalia_crc` en tickets `cortesia`.

## 5. Contenido de esta carpeta

| Carpeta | Qué tiene |
|---|---|
| `rondas/` | Cada ronda de queries (Q0–Q26, D1–D13) con resultados e interpretación, en orden. r7 = descuentos, Local Club, créditos e IVA |
| `sql/` | Queries sueltas. `base.sql` = CTE base de clasificación de mesas (Q22–Q25) |
| `specs/` | SPEC del análisis de ventas integrado (fase futura en la app), reporte de mediodía y prom/pax |
| `scripts/` | Python (pandas) de costos y agregados. Correr desde esta carpeta: `python scripts/an_r7.py` |
| `datos/` | CSV exportados de las queries (agregados, sin datos personales de clientes) y planillas de costos |

### Cómo reproducir

1. Correr la query en DBeaver (PoS, solo lectura) o en el SQL Editor de Supabase PROD, con `limit` explícito.
2. Exportar a CSV en `datos/`.
3. Correr el script correspondiente.

Para un análisis nuevo, crear `docs/analisis/<fecha>-<tema>/` con esta misma estructura.

**Regla:** no guardar teléfono, dirección, cédula ni nombres de clientes en CSV.
