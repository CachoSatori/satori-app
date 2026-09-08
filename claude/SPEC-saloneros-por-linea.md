# SPEC — Saloneros por línea: dos lentes (venta propia + mesa propia)

**FIRMADA 2026-09-07 · Ismael**

Atribución de salonero a nivel **línea** (`FAC_FacturasDet.UsuarioRegistra`), no un mesero por
ticket. Permite **facturas partidas**. Bridge + Edge ✅ hechos. Sigue la app (Parte B).

Aditivo, staging, **NO toca IVA / total / sagrados**. Delivery (`Tipo='D'`) y neta −0,4% **NO**
entran acá.

---

## ✅ PARTE A CERRADA (2026-09-07)

El mesero por línea vive en `FAC_FacturasDet.UsuarioRegistra` (confirmado en vivo: 110607 =
5×`032` + 4×`026`, los dos 677 en `026`). El bridge (`1778d0a`) ya lo persiste.

El bug del **100% null** fue la Edge Function `ingest-ndf` **desactualizada** (corría
`normalizarLinea` sin el campo); se redeployó desde `feat/pos-desglose`, se re-corrió el backfill
`--todo`, y quedó **221.496/221.506 líneas con `usuario_registra` = 100,0%** (10 null = bucket
"otro").

Detalle completo en [`REPORTE-saloneros-parteA-edge-2026-09-07.md`](./REPORTE-saloneros-parteA-edge-2026-09-07.md).

> **Lección clave:** tocar `src/shared/**` que la Edge importa **exige redeploy de la Edge** — el
> bridge solo no alcanza. (Nota agregada a `docs/DEPLOY-pos-bridge-staging.md`.)

---

## Estado (2026-09-07)

- ✅ **Bridge** (`1778d0a`): `sqlDetalle` + pipeline mandan `usuario_registra`. Verificado en código.
- ✅ **Edge `ingest-ndf`**: redeployada desde `feat/pos-desglose` (ahora `normalizarLinea` carga el campo).
- ✅ **Backfill `--todo`**: 976 días · 39.445 tickets · 221.506 líneas · 0 errores.
- ✅ **Cobertura**: 221.496/221.506 = 100,0% no-null (10 null = "otro", ₡40k). Spot-check 110607 = 5×`032` + 4×`026` (677 en `026`), ≠ null.
- ✅ **Mapa de códigos / personas / turnos** válido.
- ⏭️ **Parte B** (app `feat/analitica`): las dos lentes + vista por persona × turno. **LISTA PARA ARRANCAR.**

---

## Firma (2026-09-07) — Ismael

1. **Titular del ranking: venta propia** (línea / `UsuarioRegistra`).
2. **Mesa propia:** dueño = quien registró el 677. Sin PAX, desempate por mayoría de neta. Ticket
   promedio y prom/pax usan la neta **ENTERA** de esa factura (incluye lo que comandó el otro mesero).
3. **Nunca sumar las dos columnas** (venta propia y mesa propia).
4. **Clasificar por el mapa de códigos** (abajo), no adivinar; **no se tira la plata de ningún
   código**. Cargar `FAC_Empleados` **también inactivos**.
5. El `salonero_login` del pedido queda **de respaldo** solo si la línea viene sin usuario.

---

## Mapa de códigos — FIRMADO 2026-09-07 (contra data 2024–2026)

Cobertura global por línea: **~78% mesero · ~18% caja · ~3% genérico (02) · ~0,1% bar (388)** ·
resto null.

> El **100%** de cobertura del dato crudo es **no-null**; el **~78%** es el subconjunto **MESERO**
> tras clasificar por este mapa.

El modelo por línea funciona en **TODA** la historia (2024 incluido, donde el modelo viejo daba 0%).

### Roles (solo códigos que alguna vez registraron una línea)

- **MESEROS** (van al ranking): `0909` Rocío · `333` Emma · `999` Jazmín (I) · `266` NACHO ·
  `444` MAXI · `026` MAXO · `028` FRANCISCO · `03` Alan · `027` GUILLE · `025` Dolores ·
  `032` GONZA · `029` Ignacio · `034` INE · `024` Juancho · `04` Wesley (I) · `030` Jota ·
  `033` FEDERICO · **ROSAURA** (`01`+`235`) · **ESTEBAN** (`023`+`555`).

- **CAJA**: `111` (mañana) · `222` (noche) · `388` (bar/evento nocturno).

- **GENÉRICO / no-mesero**: `02` "xx" — login compartido de **ventas REALES** (1.126/1.132
  facturas con plata, ₡44,9M; solo 6 en ₡0 → **NO** es comida de personal). Bucket genérico:
  cuenta en el total del día, **no** en el ranking.

- **SIN CÓDIGO (null)**: 10 líneas, ₡40k → bucket **"otro"**. Insignificante. (Confirmado: son
  exactamente las 10 líneas null del backfill.)

### Personas (unificación código → persona, many-to-one, curado a mano)

- **ROSAURA** = {`01`, `235`} (`01` salonera · `235` manager "M").
- **ESTEBAN** = {`023`, `555`} (`555` inactivo · `023` activo).
- El resto: un código = una persona. Si aparecen nuevos duplicados, se agregan al mapa a mano.

### Turno (`FAC_Facturas.Login`)

`111` = mañana · `222` = noche · `388` = bar/evento nocturno (tercer turno).

> **Nota:** los "misterios" `266` y `333` resultaron meseros reales (NACHO, Emma). Y `01` **NO**
> es caja: es ROSAURA (mesera) — el supuesto viejo del esquema (`01`/`02` = sistema) **estaba
> mal**. Clasificar SIEMPRE por este mapa, **no por la forma del código**.

---

## Por qué (confirmado en la base)

- El mesero **no** está en `FAC_Facturas.UsuarioAtiende` (vacío). La fuente por línea es
  `FAC_FacturasDet.UsuarioRegistra` (confirmado en vivo). El `FAC_Pedidos.UsuarioRegistra` es el
  registrante del **PEDIDO** (uno por factura) y alimenta el `salonero_login` de respaldo — **NO**
  reemplaza al de la línea.

- Una factura puede tener **dos meseros**. Ejemplo real: factura **110607** — líneas 1–5 comandó
  GONZA (`032`), líneas 6–9 MAXO (`026`), y los dos PAX (677) son de MAXO.

- Cobertura por línea: **~92%** con mesero en 2026, y **~73%** aún en un día 2024 "sin pedido". El
  modelo viejo (del pedido) daba **0%** en 2024.

---

## Dos lentes sobre el MISMO día — NUNCA se suman

Cada lente parte el total del día **completo**, por un eje distinto. **Sumarlas cuenta doble las
mesas partidas.**

### Lente A — VENTA PROPIA (por línea · lo que comandó) → PRINCIPAL / titular

- Cada línea → su `UsuarioRegistra` (mapeado a persona). **Σ de todas las líneas = neta del día**,
  partida por quién comandó.
- Campos: neta / IVA / servicio propios (Σ `MontoTotal` / `IV` / `ImpS`).
- **PAX propio** = Σ unidades de 677 (+2×678) que esa persona registró.
- **prom/pax propio** = neta propia ÷ pax propio.
- Única **exactamente aditiva** y accionable: premia el upsell en mesa ajena, no castiga al dueño.

### Lente B — MESA PROPIA (por factura · quién corrió la mesa) → contexto

- Cada factura → un **dueño** = registrante del 677. Sin 677, desempate = quien tiene más neta en
  esa factura.
- Campos: mesas · tickets · **ticket promedio** = neta **ENTERA** de sus mesas ÷ sus mesas ·
  prom/pax de mesa.
- El dueño se lleva la mesa **ENTERA** (incluidas líneas de otro mesero). La plata del ayudante
  igual está en su venta propia (Lente A).

---

## Una fila por persona, por turno (mañana / noche / bar / día)

```
venta propia (neta) | IVA | servicio | pax propio | prom/pax | mesas | tickets | ticket prom | prom/pax mesa
```

### Turno y nombres

- **Turno** = `FAC_Facturas.Login`: `111` = mañana · `222` = noche · `388` = bar/evento. **NO** el
  reloj/BioTime. Consistente con `jornada.ts`.
- **Nombres y unificación** desde `FAC_Empleados` (Login → Nombre), roster completo **incl.
  INACTIVOS**. No hardcodear.

---

## Reglas confirmadas

1. Elimina **"acreditar al menor"**: con dos meseros se reparte real por línea.
2. Reemplaza el `salonero_login` del pedido; queda **de respaldo** solo si la línea viene sin usuario.
3. **Caja / genérico / sistema NO son meseros**: caja = `111`/`222`/`388`; genérico = `02`;
   sin-código = "otro". Van a sus buckets, **fuera del ranking**, pero su venta **cuenta en el
   total del día**. Clasificar por el mapa, nunca por la forma del código.
4. **`Σ(venta propia meseros) + caja + genérico + otro = neta del día`.** Ni se pierde ni se duplica.

---

## Cambios a construir

- **Bridge** (`feat/pos-desglose`): ✅ **HECHO** (`1778d0a`). `usuario_registra` por línea de
  `FAC_FacturasDet.UsuarioRegistra`.
- **Edge `ingest-ndf`**: ✅ **REDEPLOYADA** desde `feat/pos-desglose`. Backfill `--todo` re-corrido
  (100% cobertura).
- **App** (`feat/analitica`): mapa de códigos + dos lentes + vista una fila por persona × turno;
  nombres de `FAC_Empleados`. **Falta agregar `usuario_registra` al SELECT de lectura de líneas en
  la app.**

---

## Guardrails

- Aditivo, staging. **NO** toca `iva_crc` / `total_crc` / medios. **NO** sagrados, no realtime, no
  prod, no main.
- Delivery (`Tipo='D'`) y neta −0,4% son **OTRO** pase.

---

## Criterios de aceptación

- ✅ Spot-check 110607 tras redeploy+backfill: 5 líneas `032` + 4 líneas `026` (los dos 677 en
  `026`), `usuario_registra` ≠ null.
- ✅ Cobertura global 100% no-null (10 null = "otro").
- ⏭️ ROSAURA (`01`+`235`) y ESTEBAN (`023`+`555`) unificados, una fila cada uno. **[Parte B]**
- ⏭️ Las dos lentes **NO** se presentan como un total sumable. **[Parte B]**
- ⏭️ Saloneros: una fila por persona × turno (mañana/noche/bar), con nombres. **[Parte B]**

---

## Orden

1. ✅ IVA histórico (`--todo`) cerrado.
2. ✅ Agente en vivo reiniciado en `d2bd232`.
3. ✅ Mapa de códigos firmado.
4. ✅ Bridge Parte A (`1778d0a`) — SELECT/pipeline correctos.
5. ✅ Edge `ingest-ndf` redeployada + backfill `--todo` re-corrido → 100% cobertura, spot-check
   110607 verde. **PARTE A CERRADA.**
6. ⏭️ **Parte B** (app, `feat/analitica`): mapa de códigos + dos lentes + vista una fila por
   persona × turno.

---

## Mejora diferida (post-P2)

El feedback sobre la pestaña que salió de esta SPEC —«toda la información pero súper
desordenada»— quedó anotado como una reorganización de UI en
[`SPEC-ui-ventas-por-turno-y-saloneros.md`](./SPEC-ui-ventas-por-turno-y-saloneros.md):
«Ventas por turno» (la unidad es el turno) + «Saloneros» por empleado (la unidad es la persona).

**No arranca hasta que P2 esté cerrado**, y hereda sin cambios las reglas firmadas de acá: PAX solo
`677`, turnos mañana/noche/día sin fila Bar, ranking por venta propia, y las dos lentes que nunca
se suman.
