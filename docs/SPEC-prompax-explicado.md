# SPEC v2.2 — «Prom/PAX explicado» (Análisis de ventas con causas) · 2026-10-30

> v1 (30/10 13:00) revisada por Grok y Auditor Satori; esta v2 incorpora los ajustes aceptados.
> **EN ESPERA:** la pantalla y el RPC esperan el arreglo de seguridad de roles (`get_my_role` sin `is_active`,
> `handle_new_user` con rol de metadata, `perfil_propio_update` sin restricción) — P0 abierto el 30/10.
> El **módulo de cálculo puro + tests** puede avanzar ya en rama aparte (no toca base ni UI).

## 0. Cambios contra v1
| # | Cambio | Motivo |
|---|---|---|
| 1 | Cuadre de ventas con todas las líneas: salón (volumen + gasto), venta de salón sin pax, barra, delivery, llevar/otros | v1 omitía barra y otros canales: no cerraba |
| 2 | «Venta sin pax» como término propio de la descomposición del prom/pax | Neta con pax = 0 rompía el cuadre |
| 3 | Texto: 1 frase volumen/gasto + 2 causas de **un solo corte** (el que más explica; empate: turno → día → salonero) | Mezclar cortes cuenta el mismo cambio varias veces |
| 4 | Pantalla simple por defecto; rendimiento/mezcla tras «Ver detalle» con leyenda; título «Qué explica el cambio» | Usabilidad para managers |
| 5 | Mínimo 30 pax de salón en **ambos** períodos; 30–100 = «tomalo como orientación»; 15 pax por grupo para ser causa | 50 dejaba sin análisis las semanas de mañana |
| 6 | Temporadas **fijas en código** en v1 (baja = 2 tramos); tabla editable en v2 | Evita migración + RLS nueva ahora |
| 7 | Datos agregados en SQL (RPC) con rol validado en la base (`role` + `is_active`) | Performance y seguridad |
| 8 | Calcular sin redondear; redondear al mostrar | Precisión del cuadre |
| 9 | Export CSV de las tablas; frases descriptivas, sin calificar personas | Bajo costo / uso por managers |
| 10 | Módulo puro en archivo nuevo `ventasPromPaxExplicado.ts` + test de propiedad (Σ aportes = Δ, tol. 1e-9) | Mantenibilidad |

## 1. Qué es
Modo nuevo en **Ventas → Análisis**: «Prom/PAX explicado». No reemplaza nada existente.
Roles: owner, manager, contador, **activos**. Solo lectura. No toca caja, propinas ni sagrados.

## 2. Preguntas que responde
Cuánto vendimos, cuántos pax, cuál fue el prom/pax, cuánto cambió contra la comparación, y **qué explica el cambio**.

## 3. Filtros
- **Local:** visible cuando hay más de un local con datos del PoS. Default: el del usuario.
- **Período:** rango libre · mes · semana ISO (lun-dom) · temporada (tramo de un año dado).
- **Comparar contra:** período anterior de igual largo · mismo período del año anterior · mismo tramo de temporada del año anterior.
- **Turno:** mañana · noche · ambos.

## 4. Temporadas (firmado Ismael 30/10; v1 fijas en código)
| Tramo (id) | Desde | Hasta |
|---|---|---|
| `alta` | 15-dic | 30-abr (cruza el año; pertenece al año en que termina) |
| `baja-may` | 1-may | 31-may |
| `media` | 1-jun | 31-ago |
| `baja-sepdic` | 1-sep | 14-dic |

- Un solo módulo es la fuente de verdad. Test: cada día de 2024-01-01 a 2030-12-31 cae en exactamente un tramo.
- El selector muestra siempre el rango real (ej. «Alta 2026: 15 dic 2025 – 30 abr 2026»).
- Las comparaciones son tramo contra tramo (la baja de mayo no se compara con la de sep–dic).
- v2: tabla editable por local (picos como Semana Santa o fin de año), después del arreglo de roles.

## 5. Métricas y definiciones (las mismas de toda la app)
- **Neta** = Σ líneas menos familias {6, 17, 20}; día = `fecha_registra` hora CR; solo `estado='C'`.
- **Prom/pax** = neta de salón ÷ pax de salón (`canal='salon'`), incluida la neta de facturas de salón sin pax.
- **Ventas totales** = neta de todos los canales.
- **Turno** = `pos_ndf_tickets.turno`. **Salonero** = nombre unificado (`personasNdf.ts`); `salonero_login` null →
  «Caja / sin mesero». Toda factura cae en algún grupo de cada corte (participaciones suman 1).
  Un login sin empleado vinculado se muestra como «login XXXX» (ej. un código reutilizado, fuera de la vigencia
  de su titular); nunca se descarta.

## 6. Cómo explica
### 6.1 Ventas totales (cuadre exacto)
Δ ventas = Δ salón + Δ barra + Δ delivery + Δ llevar/otros. El salón se abre en:
- **volumen** = (pax_n − pax_v) × P_v
- **gasto** = (P_n − P_v) × pax_n
(P = prom/pax de salón; la suma da Δ salón exacto). Si pax_v o pax_n = 0: sin descomposición del salón.

### 6.2 Prom/pax, por corte (salonero, día de semana, turno, semana)
Separar la neta de salón con pax (`N`) de la neta de salón **sin pax** (`N0`): P = (N + N0) / PAX.
Para cada grupo *i* con pax > 0: s_i = pax_i / PAX, p_i = neta_i / pax_i, P* = N / PAX.
- **Rendimiento_i** = s_i,n × (p_i,n − p_i,v)
- **Mezcla_i** = (s_i,n − s_i,v) × (p_i,v − P*_v)
- **Entra** (no estaba): mezcla = s_n × (p_n − P*_v), rendimiento 0. **Sale**: mezcla = −s_v × (p_v − P*_v), rendimiento 0.
- **Venta sin pax** = N0_n / PAX_n − N0_v / PAX_v (línea propia).
- Σ rendimiento + Σ mezcla + venta sin pax = P_n − P_v. **Test de propiedad a 1e-9.**

### 6.3 Texto «Qué explica el cambio»
- Frase 1: ventas — cuánto vino de más/menos gente y cuánto de más/menos gasto por persona (y delivery/barra si pesan).
- Frases 2–3: las 2 mayores contribuciones de **un solo corte**: el que más explica del Δ prom/pax con sus 2 mayores
  aportes (valor absoluto). Empate: turno → día → salonero. Se dice el corte («Por día: …»).
- Solo cuentan como causa grupos con ≥ 15 pax en el período más chico.
- Pax de salón < 30 en cualquiera de los dos períodos → «Pocos datos para sacar conclusiones», sin causas.
  Entre 30 y 100 → causas con la etiqueta «Pocos datos: tomalo como orientación».
- Lenguaje descriptivo («subió el gasto por persona en las mesas de X»), nunca calificativo.

## 7. Pantalla
1. Tarjetas: ventas · pax · prom/pax, con la comparación y Δ (₡ y %).
2. «Qué explica el cambio»: las frases de §6.3.
3. Tablas simples por defecto (pax · % pax · prom/pax · comparación · Δ) por turno, día, salonero y semana.
   La tabla por salonero suma **«vs promedio del turno (%)»** = prom/pax del salonero ÷ prom/pax de su turno en el
   período − 1, y con turno = «ambos» muestra una fila por salonero y turno. Es la comparación justa entre turnos
   (la mañana siempre da menos por pax que la noche). Agregado v2.1, análisis de la mañana del 30/10.
4. «Ver detalle»: columnas de rendimiento y mezcla, con leyenda fija: «Rendimiento = el grupo vendió más o menos por
   persona. Mezcla = cambió cuánta gente atendió ese grupo.» + línea «ajuste por redondeo» si hace falta.
5. Export CSV de cada tabla. Grupos con pax = 0: «sin pax», nunca −100%.

## 8. Datos y seguridad
- RPC de agregado (por local, día CR, turno, salonero, canal → tickets, pax, neta), solo owner/manager/contador
  **activos**. Usa `get_my_role()` ya corregido; si la feature saliera antes del arreglo, valida
  `profiles.role` + `profiles.is_active` directo.
- La regla de neta del RPC = `netaVenta.ts`: test de contrato con datos reales de oct-2026, 0 diferencias.
- Migración aplicada a mano en prod antes del merge, con firma. Nada en `supabase/functions/`.

## 9. Aceptación (números reales de prod, 30/10)
Santa Teresa, salón, `estado='C'`:
- Prom/pax total oct-2026 (1–29): **₡16.491**; noche **₡17.295**; mañana **₡13.092**.
- Ene-2026: mañana ₡10.753 · noche ₡17.391 · total ₡16.237.
- Noche oct por salonero: MAXO **₡17.743** (277 pax), FRANCISCO ₡17.910 (172), GONZA ₡16.954 (115), Caja ₡15.473 (72).
- Noche oct por día: Mar **₡19.421**, Mié ₡18.420, Sáb ₡15.359.
- Neta de salón oct = la de Ventas (₡13.274.982, ±₡3); diferencia de pax con Ventas = solo barra.
- Cuadres §6.1 y §6.2 exactos, incluido un caso real de grupo que sale (GUILLE: está en ago, no en sep).
- Prom/pax por turno, con rango libre (ojo: «ene–abr» NO es la alta completa, que arranca el 15-dic-2025):
  mañana ene–abr ₡10.984 · may ₡13.030 · jun–ago ₡12.065 · 1-sep–29-oct ₡13.264;
  noche ene–abr ₡17.062 · may ₡16.621 · jun–ago ₡16.327 · 1-sep–29-oct ₡16.595.
- «vs promedio del turno» (mismos rangos): MAXO mañana ene–abr **+4,4%** (731 pax) y noche −2,3% (704);
  FRANCISCO noche may +10,8% (327); Caja noche 1-sep–29-oct −17,9% (159).

## 10. Fuera de alcance (v1)
Mix de productos en el «por qué» · acceso de saloneros · Nosara hasta tener PoS · datos anteriores al PoS ·
tabla editable de temporadas.
