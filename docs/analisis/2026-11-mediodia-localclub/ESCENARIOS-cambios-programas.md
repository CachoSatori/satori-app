# Escenarios de cambios en los programas (nov 2026): supuesto contra realidad

Escrito el 04-nov-2026. Base: promedio por mes de nov-2025 a oct-2026, PoS Nube de Fuego, con los métodos de este análisis (README §0, r8 y r9).
Objetivo: dejar escrito **qué esperamos** de cada cambio, para comparar con lo que pase de verdad cuando se aplique.

## 1. Línea base (hoy, por mes)

| | Local Club (15 %) | Créditos (tarjetas de hotel y tienda) | Menú de mediodía |
|---|---|---|---|
| Personas por mes | 226 (noche) | 82 (noche) | ~160 (de ~310 al mediodía) |
| Costo por mes | ₡512k (descuento) | ₡300–360k (10 % ₡147k + créditos ₡55k + IVA y servicio hasta ₡60k + gestor ₡99k) | ₡410–565k (margen que se pierde con quien hubiera pedido carta) |
| Margen de esos clientes | ₡2,31M | ₡1,0M | ₡1,03M |
| Margen ÷ costo | 4,5× | 3× | 0,4–1,1× (ganancia por clientes extra ÷ costo) |
| Equilibrio: % que tiene que venir por el programa | 22 % | 33 % | 41–44 % |
| % que viene por el programa | 30–50 % (supuesto) | 40–70 % (supuesto) | 22–44 % (medido, Q27) |
| **Ganancia neta / mes** | **+₡180k a +₡640k** | **+₡70k a +₡370k** | **−₡340k a +₡45k** |
| Ganancia neta / año | +₡2,2 a 7,7M | +₡0,8 a 4,4M | −₡4,1M a +₡0,5M |

**Ranking de hoy:** 1. Local Club · 2. Créditos · 3. Menú.

**Método de la ganancia neta.**
- Local Club y Créditos: % que viene por el programa × margen de esos clientes − costo. Es una cuenta conservadora.
- Menú: margen de los clientes extra − margen que se pierde con quien hubiera pedido carta. Margen por persona: carta ₡10.888, menú ₡6.386.

## 2. Cambios propuestos y supuestos

| Programa | Cambio | Supuesto |
|---|---|---|
| Local Club | Del 15 % al 10 % + cortesía (~₡400 por persona) | Misma gente (226 por mes). El 5 % extra vale ₡820 por persona. |
| Créditos | 20 % más clientes entregan tarjeta. El crédito sigue en ₡18.000 cada 6 personas. | Pasan de 82 a ~98 personas por mes. El gestor es un costo fijo. |
| Menú | Solo Bento, ₡1.000 más caro (~₡885 neto). Salen Casado, Bowl Teriyaki, Sakura Poke, Sushi Duo, Ceviche Tico-Nikkei y Fish & Chips. | El Bento es el 39 % de los platos del menú (305 de 782, mar–oct 2026). Quien pedía los otros platos (61 %) **pasa a la carta** (optimista). Prudente: la mitad de la gente extra que pedía otros platos deja de venir. |

## 3. Resultado esperado (por mes, misma gente que en la proyección 2026)

| | 1. Local Club 10 % + cortesía | 2. Menú solo Bento +₡1.000 | 3. Créditos +20 % de clientes |
|---|---|---|---|
| Costo | ₡417k | ₡130–180k | ₡340–410k |
| Margen ÷ costo | 5,8× | — | 3,2× |
| Equilibrio | 17 % | 33 % | 31 % |
| **Ganancia neta / mes** | **+₡275k a +₡735k** | **+₡135k a +₡520k** | **+₡105k a +₡465k** |
| Ganancia neta / año | +₡3,3 a 8,8M | +₡1,6 a 6,3M | +₡1,3 a 5,6M |
| **Cambio contra hoy / año** | +₡1,1M | +₡5,7M (prudente: +₡1,7 a 3,7M) | +₡0,4 a 1,1M |

- **Total contra hoy:** +₡7,3 a 8,0M por año, entre 11 y 12 % de la utilidad neta presupuestada para 2026 (₡65,1M).
- **Escenario prudente del menú:** el total baja a unos +₡3–5M por año.
- **Ranking esperado:** 1. Local Club · 2. Menú · 3. Créditos. El 2 y el 3 quedan prácticamente empatados.

## 4. Qué medir para comparar (tablero mensual)

| Indicador | Línea base | Esperado | Alarma | Fuente |
|---|---|---|---|---|
| Visitas Local Club por mes (noche) | 226 | ≥ 217 | < 217: se perdió más del 4 % y el cambio deja de convenir | Clase por ratio (0,80–0,87 o art. 856) |
| Costo del descuento Local Club por mes | ₡512k | ~₡327k + cortesías ~₡90k | > ₡450k | Neta contra valor de lista |
| Margen por persona Local Club | ₡10.207 | ~₡10.630 | < ₡10.207 | Costo 24 % del valor de lista |
| Personas con tarjeta por mes | 82 | ~98 | < 82 | Clase tarjeta (0,88–0,93) + reporte de créditos |
| Créditos del sistema contra `CuentaCobrar` del PoS | 4 meses de 2026 sin cuadrar | Diferencia 0 cada mes | Cualquier diferencia | Reporte de créditos + PoS |
| Créditos sin usar | 172 (₡3,1M) | Bajan con el vencimiento a 12 meses | Suben | Sistema de créditos |
| Personas al mediodía por mes | ~310 | 294–310 | < 294 | Por **hora de la factura** (6–16 h), no por turno de caja |
| Margen total del mediodía por mes | ₡2,65M | ₡2,97M (prudente) a ₡3,15M (optimista) | < ₡2,65M | Q27 con margen |
| Bentos por mes | ~38 | ≥ 38 | < 30 | 1 box = 4 líneas |
| Noche (control) | Tendencia actual | Sin cambio atribuible | Cae más que el mediodía | Misma consulta, franja 17–23 h |

## 5. Reglas para comparar bien

1. **Un cambio por vez, si se puede.** Separados por al menos un mes. Si entran los tres juntos, no se sabe cuál movió qué.
2. **Mínimo 3 meses** antes de sacar conclusiones, comparando contra el mismo mes del año anterior y con la noche como control (método de Q27).
3. **El mediodía se clasifica por hora de la factura**, nunca por turno de caja.
4. **El menú conviene arrancarlo en baja**, cuando es más fácil medir si la gente pasa a la carta o deja de venir.
5. **Preguntar en mesa** «¿cómo nos conociste?» y «¿vendrías igual sin el descuento?». Es lo único que reemplaza los supuestos de Local Club y Créditos por datos.
6. Cada comparación se anota acá, con la fecha y el número real al lado del esperado.

## 6. Idea a evaluar: Local Club 3.0 (sin descuento fijo)

Propuesta del dueño (04-nov-2026):
- **Sin descuento permanente.** Promociones directas en momentos específicos, que van variando.
- **Tarjeta en el Wallet del teléfono** (Apple y Google), con un **QR único** por socio.
- **Los referidos suman puntos** al socio, que los usa para consumir o para descuentos.

**Lo que los datos dicen a favor:**
- Subir del 10 % al 15 % no trajo socios (217 → 204 por mes). Lo que trajo gente fue el **relanzamiento** (+73 % y +44 %). Pesa más la comunicación y la novedad que el tamaño del descuento.
- El descuento fijo es el costo más grande de los programas (₡512k por mes). Las promociones puntuales cuestan solo cuando se usan y se pueden apuntar a horarios flojos.
- El QR resuelve el hueco de datos más grande: hoy al socio se lo reconoce solo por el ratio del descuento. Con QR se sabe quién vino, cuándo y a quién trajo.
- El mecanismo de referidos ya existe en el programa de créditos (hoteles y tiendas). Se puede unificar en un solo sistema de referidos y puntos.

**Riesgos:**
- Sacar el descuento fijo de golpe puede leerse como un recorte. Mejor como paso siguiente al Local Club 2.0 y con transición.
- Los puntos sin usar son un pasivo, igual que los 172 créditos de hoy. Necesitan vencimiento desde el día uno.
- Datos personales (teléfono, correo): hace falta consentimiento y cumplir la Ley 8968. Nunca en el repo, que es público.
- Hay que escanear el QR en caja y registrarlo en la factura. Necesita integración con el PoS: toca ingesta y esquema, así que va **con firma**.

**Orden sugerido:**
1. Local Club 2.0 (10 % + cortesía) y medir 3 meses.
2. Spec de Local Club 3.0 unificado con el sistema de créditos.
3. Piloto con un grupo chico de socios.
4. Recién ahí, sacar el descuento fijo.

Puede reutilizar lo que se diseñe para el pase digital de la Cámara de Turismo (Wallet).
