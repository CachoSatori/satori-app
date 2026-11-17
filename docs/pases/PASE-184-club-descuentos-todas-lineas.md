# Pase a PROD de la mig 184 `club_descuentos_todas_lineas` (origen club 129)

> **⛔ Plata: firma SQL del dueño + verificador independiente.** Decisión firmada por el dueño por el chat, 17-nov-2026
> 02:13 -06:00, opción A: el reporte de descuentos del Club (`club_reporte_descuentos`, Club → Descuentos → «Reporte de
> descuentos sin artículo») tiene que sumar **todas** las líneas con descuento sin respaldo de cada factura, cada una con
> su clasificación, y no solo la «línea ejemplo». El merge necesita el OK del dueño sobre el SHA exacto. Si algo no
> coincide, **se para y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Orden obligatorio:** va **después de la 183** (PR #240). Exige el núcleo de la 183 (md5 `100caed16f137eda0888deec497f9103`)
>   y el reporte de la 170 (md5 `30bba89bd3642f54b9e8ad95b08e1a29`). Si no, aborta **sin tocar nada** (probado en local
>   sobre el núcleo de la 181, que es el de prod hoy).
> - **Regla del ledger:** exactamente 1 fila `184` con su `name`.
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§5 y §6).

## 1. El problema
- `club_reporte_descuentos__nucleo` sumaba `detalle.descuento_crc` de cada fila DESCUENTO_SIN_RESPALDO: **una línea por
  factura** (la de mayor %; desde la 183, a igual %, la de mayor monto) y la clasificaba con el % de esa línea.
- Cuando el descuento se aplica a toda la cuenta, todas las líneas cumplen la regla y el reporte veía una sola. El
  diagnóstico del PASE-183 §4 lo midió: el reporte veía ~1/3 del descuento sin respaldo.

## 2. Qué cambia y qué no
1. **Núcleo de excepciones** (`club_excepciones__nucleo`), 3 fragmentos exactos con guarda de md5 antes (`100caed1…`) y
   después (`0b7b956e…`), como la 181 y la 183:
   - la clasificación (tipo del local por % ±1,5 puntos) se calcula **por línea** dentro de la subconsulta de candidatas
     (misma expresión; la de la ejemplo sale de ahí);
   - el detalle de DESCUENTO_SIN_RESPALDO suma `lineas_sin_respaldo` (todas las líneas de la factura que cumplen la
     regla: artículo, nombre, precio, referencia, cantidad, %, `descuento_crc`, `clasificacion`) y `descuento_crc_lineas`
     (su suma), con una ventana por factura (`window w … rows between unbounded preceding and unbounded following`).
2. **`club_reporte_descuentos__nucleo`** (`30bba89b…` → `7a5e33e2…`): suma las líneas de `lineas_sin_respaldo`,
   agrupando por la clasificación **de cada línea**. «Facturas» = facturas con al menos una línea de esa clasificación
   en ese mes y turno (`count(distinct` de la fila de la excepción`)`): una factura con líneas de dos tipos cuenta en los
   dos. Mes y turno: los de la factura en hora CR, como antes.
3. **App:** Marcadores dice «Descuento sin respaldo: todas las líneas.» y la columna «Monto (todas las líneas)».
   Excepciones: la ficha de «Descuento sin respaldo» muestra «Monto estimado (esta línea)» y «Sin respaldo en la
   factura: ₡X en N líneas». Guía 6.13 al día.

**No cambia:** la regla de qué línea es «sin respaldo», qué facturas tienen la excepción, la línea ejemplo y su
`descuento_crc`, la lista de Excepciones, `club_excepciones_abiertas` (`3c3c963d…`), los envoltorios `club_excepciones`
(`7e0b7ae5…`) y `club_reporte_descuentos` (`a821af24…`), permisos (EXECUTE de `authenticated` en los envoltorios,
núcleos cerrados, `anon` afuera), SECURITY DEFINER, `search_path`, índices, datos y sagrados.

**Qué ve el owner / manager:** en «Reporte de descuentos sin artículo», montos más altos (todas las líneas) y, en algunas
facturas mixtas, una fila más por tipo. En Excepciones, una línea más en la ficha del descuento.

## 3. Antes y después (staging, datos reales de Santa Teresa, 17-nov 02:15–02:25 CR)
Montos reales fuera del repo (van en el reporte del chat); acá, proporciones y conteos.

| Medida (400 días) | Antes (183) | Después (184) |
|---|---|---|
| Total del reporte | 1× | **2,92×** |
| Filas DESCUENTO_SIN_RESPALDO (facturas) | 1.000 | 1.000 |
| Σ «Facturas» del reporte | 1.000 | 1.015 (14 facturas con líneas de más de un tipo) |
| Lista de Excepciones (2.557 filas, md5 sin las 2 claves nuevas) | `0b0ed084…` | `0b0ed084…` (idéntica) |
| `club_excepciones_abiertas(30)` | 74 | 74 |
| Σ reporte = Σ `descuento_crc_lineas` de la lista | — | sí |
| `club_excepciones_abiertas(30)`, 5 llamadas | ~175 ms (PASE-183) | 184–224 ms |
| Reporte a 120 días (lo que abre la pantalla), 3 llamadas | — | 298–358 ms |

Por clasificación (proporción después / antes): «Descuento 10 %» ×3,96 · «15 %» ×2,72 · «30 %» ×1,78 · «sin clasificar»
×4,44 (33 → 44 facturas: líneas sin tipo en facturas cuya ejemplo sí lo tenía).

## 4. Pruebas
- `scripts/sql/184_pruebas.sql` (runner `184_pruebas.py --local`), en una transacción descartada, sobre Postgres 16
  local con todas las migraciones + 183: **13/13**. Datos ficticios con fechas fijas: factura con 1 línea, varias líneas
  al mismo %, distintos %, mezcla tipificado / sin clasificar, anulada (X) afuera, dos locales, factura a las 23:30 CR del
  último día del mes con la sesión en UTC; lista y contador idénticos antes/después; permisos (cajero y manager fuera de su
  local 42501); rollback = antes.
- Mutaciones (`--mutar todas`), **6/6 muerden**: `solo_ejemplo`, `clase_de_la_ejemplo`, `facturas_cuenta_lineas`,
  `ventana_acumulada`, `mes_en_utc`, `clas_sin_tolerancia`.
- Guarda: sobre el núcleo de la 181 (prod hoy) la 184 aborta sin tocar nada.
- App: `Excepciones.descuento.test.tsx` y `Marcadores.reporte.test.tsx` (sin el cambio de la app caen 3 de 4).
- Staging: la herramienta de SQL cancela escrituras en tablas, así que la batería ficticia corre en local; en staging
  corrió la 184 en una transacción descartada con datos reales (§3) y después se aplicó.

## 5. Antes del merge (prod, solo lectura, `begin read only` … `rollback`)
- Ledger: última versión = **183** (la 183 ya entró). Si no, **no se mergea**.
- Núcleo md5 `100caed1…`; reporte md5 `30bba89b…`.
- Como owner (`set_config('request.jwt.claims', …)`), anotar a 30 y a 400 días para `'santa-teresa'`:
  `count(*)` de `club_excepciones(…, 'DESCUENTO_SIN_RESPALDO')`, `sum(descuento_crc)` de esas filas, el md5 de la lista
  completa (sin `lineas_sin_respaldo` ni `descuento_crc_lineas`) y `club_excepciones_abiertas(30, 'santa-teresa')`;
  del reporte, `sum(facturas)` y `sum(descuento_crc)` por `tipo`.

## 6. Después del merge (prod, solo lectura)
- Ledger: exactamente 1 fila `184` / `club_descuentos_todas_lineas`; check «Supabase Preview» en success.
- md5: núcleo `0b7b956e5670f617ace9ff9e6637f222`, reporte `7a5e33e2565a1dc493965c007fa76058`; envoltorios y contador sin
  cambio. Permisos como en §2.
- **Humo:** filas de la excepción, md5 de la lista y contador **iguales** a §5. `Σ reporte = Σ descuento_crc_lineas` de la
  lista. Total del reporte ≥ antes (en staging ×2,92). `sum(facturas)` ≥ antes (solo por facturas mixtas).
- Tiempo del contador < 0,5 s; del reporte a 120 días < 1 s.

## 7. Criterio de parada y vuelta atrás
- Si el ledger no está en 183 o los md5 de §5 no coinciden: **no se mergea** (la 184 abortaría igual sin tocar nada).
- Si después la lista o el contador no coinciden con §5: se para y se corre la vuelta atrás.
- **Vuelta atrás exacta:** `scripts/sql/184_rollback.sql`. Exige los md5 de la 184, deshace los 3 fragmentos (vuelve a
  `100caed1…`), vuelve el reporte a `30bba89b…` y borra la fila `184` del ledger. **En el mismo momento**, un PR que saca
  `supabase/migrations/184_club_descuentos_todas_lineas.sql` de `main` (regla 10) y revierte la app. No hay datos ni
  índices que volver. Si la 183 también se vuelve atrás: primero el rollback de la 184, después el de la 183.
- Probada en local (aplicar + rollback reales: md5 `100caed1…` y `30bba89b…`) y en la batería (caso 12).

## 8. Estado de staging
- 17-nov 02:22 CR: 184 aplicada (archivo exacto, guardas de md5 pasaron) con su fila `184` en el ledger. Lecturas de §3
  después de aplicar: iguales a las de la transacción descartada.

## 9. Firma y bitácora
| Cuándo (-06:00) | Quién | Qué |
|---|---|---|
| 2026-11-17 02:13 | dueño | Firma la decisión (opción A: el reporte suma todas las líneas, cada una con su clasificación) |
| 2026-11-17 02:22 | sesión | 184 aplicada en staging (ledger staging 184) |
| | verificador independiente | Revisión SQL + batería |
| | dueño | Firma SQL para prod sobre el SHA: ________ |
| | control | §5 antes / §6 después |
