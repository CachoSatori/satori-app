# SPEC v2.3 — «Prom/PAX explicado» (Análisis de ventas con causas) · 2026-11-06

> v1 (30/10 13:00) revisada por Grok y Auditor Satori; v2 incorporó los ajustes aceptados.
> **v2.3 (06/11, decisiones de Ismael):** el turno sale de la HORA de la factura, la madrugada es noche del
> mismo día, el §9 se recalculó con eso y el RPC es la **mig 080**. El arreglo de roles que bloqueaba la
> pantalla ya está en prod (SEC-01 y SEC-01b, migs 068 y 069).

## 0.b Cambios v2.2 → v2.3
| # | Cambio | Motivo |
|---|---|---|
| 1 | **Turno = hora CR de la factura** (`fecha_registra`): 06:00–16:59 mañana · 17:00–23:59 noche · 00:00–05:59 madrugada. Ya **no** se usa `pos_ndf_tickets.turno` | El turno de caja está mal anotado en los dos sentidos (r8, Q27) |
| 2 | **Madrugada = noche del MISMO día calendario** (opción B). Vive en un solo lugar: `turnoDeFranja` de `ventasPromPaxExplicado.ts`. El día (§5) **no cambia** | Día y mes siguen idénticos a los de Ventas. Volumen chico: 12 facturas / ₡424.084 en el último año (ene y feb 2026) |
| 3 | §9 recalculado con datos reales de prod (06/11); es la nueva referencia de aceptación | Cambia el turno |
| 4 | RPC = **mig 080** `pos_prompax_agregado`, devuelve `jsonb` (en staging se aplicó primero como 078 y se renumeró el 07/11: PROD ya tenía la 079 y una versión menor que la última remota puede ser rechazada por Branching) | 076/077/079 = SoP. El tope de filas de PostgREST es distinto en prod (10.000) y staging (1.000) |
| 5 | Aclaraciones de §6.3 (ver ahí): peso del corte, causa con ≥ 15 pax en el período con menos pax del grupo, la semana no compite por el texto, «pesan» = ≥ 15 % | Hacía falta una regla exacta para el código |
| 6 | La tabla de saloneros con turno = «ambos» usa un corte «salonero × turno» (también cuadra a 1e-9) | Que rendimiento/mezcla de esa tabla salgan de sus mismas filas |
| 7 | Sin selector de local por ahora: hay un solo local con datos del PoS (Santa Teresa) | §3: «visible cuando hay más de un local» |

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
- **Turno:** mañana · noche · ambos — por la **hora de la factura** (§5).

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
- **Turno** = por la **hora CR de la factura** (v2.3): 06–16 h mañana, 17–23 h noche, 00–05 h madrugada = noche del
  mismo día calendario. `pos_ndf_tickets.turno` (turno de caja) no se usa. **Salonero** = nombre unificado (`personasNdf.ts`); `salonero_login` null →
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
- Solo cuentan como causa grupos con ≥ 15 pax en el período en que el grupo tiene **menos** pax (un grupo que
  entra o sale tiene 0 en uno de los dos: nunca es causa, pero queda en la tabla).
- «El que más explica» = mayor Σ |aporte| de sus 2 mayores causas. Compiten turno (solo con «ambos»), día y
  salonero; la semana es solo tabla.
- Frase 1: delivery/barra/llevar «pesan» si su Δ es ≥ 15 % de Σ |Δ| por línea.
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
- **Mig 080 · `pos_prompax_agregado(p_local text, p_desde date, p_hasta date) returns jsonb`**: una fila por
  (día CR, franja horaria CR, `salonero_login`, canal) → facturas, pax, neta, neta de facturas sin pax y cuántas.
  `security definer`, `stable`, `search_path` fijo, sin EXECUTE para `anon`/`public`. Solo owner/manager/contador
  **activos** (`get_my_role()` de la 069); el resto → 42501. Rango ≤ 731 días. Sin medios de pago,
  `clase_ingreso`, mesas ni turno de caja. El nombre del salonero se resuelve en el cliente con `personasNdf.ts`
  (vigencias y alias).
- Rendimiento medido en prod: 1 año (12.477 facturas) ≈ 375 ms con los índices existentes.
- **Contrato con `netaVenta.ts`** (`ventasPromPaxContrato.test.ts` + `scripts/contrato-prompax/descargar.sh`):
  oct-2026 → 637 facturas, 153 filas, **0 diferencias** en staging (RPC real) y en prod (mismo cuerpo como SELECT de
  solo lectura); ene–oct 2026 de prod → 10.355 facturas, 0 diferencias.
- En staging desde el 06/11 (ledger 77). **Prod: con firma aparte**, a mano antes del merge, como siempre.
  Rollback: `scripts/sql/080_rollback.sql`. Nada en `supabase/functions/`.

## 9. Aceptación v2.3 (números reales de prod, 06/11; turno por hora, madrugada = noche del mismo día)
Santa Teresa, salón, `estado='C'`. Entre paréntesis, pax. En la columna v2.2, el turno de caja.

| Métrica | v2.3 | v2.2 |
|---|---|---|
| Prom/pax oct-2026 (1–29) total | **₡16.491** (805) | ₡16.491 |
| — mañana / noche | **₡13.299** (177) / **₡17.390** (628) | ₡13.092 / ₡17.295 |
| Ene-2026 total / mañana / noche | **₡16.237** / **₡10.541** (436) / **₡17.456** (2.037) | ₡16.237 / ₡10.753 / ₡17.391 |
| Noche oct: MAXO · FRANCISCO · GONZA · Caja | **₡17.934** (271) · **₡18.105** (162) · **₡16.954** (115) · **₡15.080** (66) | ₡17.743 · ₡17.910 · ₡16.954 · ₡15.473 |
| Noche oct: Mar · Mié · Sáb | **₡19.421** · **₡18.547** · **₡15.529** | ₡19.421 · ₡18.420 · ₡15.359 |
| Neta de salón oct (1–29) | **₡13.274.984,71** = la de Ventas | igual |
| Mañana: ene–abr · may · jun–ago · 1-sep–29-oct | **₡11.195** · **₡13.079** · **₡11.992** · **₡13.242** | ₡10.984 · ₡13.030 · ₡12.065 · ₡13.264 |
| Noche: ene–abr · may · jun–ago · 1-sep–29-oct | **₡17.083** · **₡16.658** · **₡16.407** · **₡16.703** | ₡17.062 · ₡16.621 · ₡16.327 · ₡16.595 |
| vs promedio del turno: MAXO mañana ene–abr | **+3,4 %** (747) | +4,4 % (731) |
| — MAXO noche ene–abr | **−2,4 %** (688) | −2,3 % (704) |
| — FRANCISCO noche may | **+11,1 %** (324) | +10,8 % (327) |
| — Caja noche 1-sep–29-oct | **−19,5 %** (152) | −17,9 % (159) |

- Cuadres §6.1 y §6.2 exactos (1e-9), incluido el caso real de un grupo que sale (GUILLE: está en ago, no en sep).
- Reproducidos por `ventasPromPaxAceptacion.test.ts` con las filas del RPC (prod y staging) y en pantalla por
  `VentasPromPaxExplicado.render.test.tsx` (filas reales del RPC de staging).
- Ojo: «ene–abr» NO es la alta completa, que arranca el 15-dic-2025.

## 10. Fuera de alcance (v1)
Mix de productos en el «por qué» · acceso de saloneros · Nosara hasta tener PoS · datos anteriores al PoS ·
tabla editable de temporadas.
