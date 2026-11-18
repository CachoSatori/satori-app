# ⛔ firma — PASE clave FE por consecutivo y tipo · el puente no le pega a un tiquete 04 la clave de una factura 01

> Repo público: sin montos, nombres, claves, rutas reales de datos, hosts ni secretos. Las verificaciones son conteos y
> huellas (md5). **Reutiliza los bloques del [PASE salonero](PASE-salonero-lineas.md)** (preámbulo, A0–A7 y B1) con los
> cambios de §5. Si algo no coincide con lo que dice este archivo, **se para y se avisa**.

## 0. Qué pasa y qué no
- **Pasa:** el agente del PoS (`pos-bridge/`) pasa de `89c5aa42` (el del pase salonero, en `C:\satori\agente-sal`) a la
  cabeza firmada de este PR, en `C:\satori\agente-fe`. La `clave_fe` viaja **solo si es la de su comprobante**: la
  clave de Hacienda CR lleva adentro el consecutivo entero (posiciones 22–41: sucursal, terminal, **tipo** y número).
  Si no coincide con `consecutivo_fe`, la clave es de otro documento y viaja en **null**. Sin consecutivo, pasa como antes.
- **Después**, re-backfill de **`2026-03-01` → ayer** (primer mes con colisión hasta ayer).
- **No pasa:** sin migraciones, sin Edge, sin `main`, sin sagrados. **No es plata:** ningún monto, línea, salonero,
  `consecutivo_fe` ni otra columna cambia. Solo `clave_fe` de las facturas afectadas (→ null).

## 1. Diagnóstico (18-nov, prod, solo lectura)
- El puente **no arma ni busca** la clave: la lee tal cual de `FAC_Facturas.ClaveElectronica` de la misma fila
  (`pos-bridge/consulta.ts:177`) y la pasa con solo control de forma (`pos-bridge/consultaAgente.ts:143`, en `89c5aa4`).
- La clave ajena **ya viene así del PoS**: las series 01 y 04 de la terminal `00200001` se solapan en el número
  (01 va por ~11.892; los 04 de mar–abr-2026 iban por 10.957–11.980) y en esas filas `ClaveElectronica` del 04 es la
  clave de la 01 del mismo número (en 669 de 675 la misma clave está también en su 01). El `consecutivo_fe` del 04 está
  bien. Crece con cada 01 nueva (después alcanza a los 04 de mayo): el cruce sin tipo pasa **en el PoS**.

| Mes | Tiquetes 04 con clave de una 01 |
|---|---|
| 2026-03 | 44 |
| 2026-04 | 631 |
| Resto (2024-01 → 2026-11) | 0 |
| **Total** | **675** (todas `estado = 'C'`) |

## 2. SHA y huellas
- Rama `claude/puente-clave-fe-tipo`, base `claude/puente-salonero-lineas` @ `89c5aa42ba7692d3bca421cdc352333946b9e017`.
- La firma va sobre el **SHA de la cabeza del PR** (§7). Árboles a la fecha de este archivo (se recalculan si el PR
  cambia): ver el cuerpo del PR (`git rev-parse HEAD:pos-bridge` y `HEAD:src/shared/ndf`). `src/shared/ndf` no cambia.
- Contra `89c5aa4` cambian solo 4 archivos de código: `pos-bridge/{backfill.ts, backfill.test.ts, consultaAgente.ts,
  consultaAgente.test.ts}` (más este PASE y `scripts/sql/clave_fe_tipo_humo.sql`, que no corren en la PC).

## 3. Responsables, prerrequisitos y ventana
Iguales al PASE salonero §3, §4 y §7: ejecuta el dueño en la PC del PoS; controla otra persona o Claude con
[`scripts/sql/clave_fe_tipo_humo.sql`](../../scripts/sql/clave_fe_tipo_humo.sql). Ventana **00:00–13:50 CR**.
Prerrequisito extra: el pase salonero cerrado (la tarea corre `C:\satori\agente-sal` en `89c5aa42`).

## 4. Humo antes y después (`clave_fe_tipo_humo.sql`, mismo `CORTE_HUMO` = pase − 2 días, 00:00 −06:00)
| Campo | Antes | Después esperado |
|---|---|---|
| `facturas` · `lineas` | _(se anota)_ | **=** |
| `h_facturas_sin_clave` (todo salvo `id`, `ingested_at`, `clave_fe`) | _(se anota)_ | **=** |
| `h_consecutivo` · `h_lineas` | _(se anota)_ | **=** |
| `colisiones` · `tipo_distinto` | ~675 | **0** |
| `clave_null` | _(se anota, hoy 0)_ | **sube exactamente** lo que valía `colisiones` antes |
| Bloque 2 (por mes) | 2026-03 / 2026-04 | **sin filas** |

**Cambios esperados:** `clave_fe` (→ null en las colisiones), `ingested_at` y los `id` de las líneas. Cualquier otra
diferencia es parada.

## 5. Bloques: los del PASE salonero, con estos cambios
**Preámbulo** — cambiar solo estos valores (el resto, idéntico):
```powershell
$SHA = 'PEGAR-ACA-EL-SHA-FIRMADO'; $SHA_PROD = '89c5aa42ba7692d3bca421cdc352333946b9e017'
$ARBOL = 'PEGAR-ARBOL-pos-bridge-DEL-PR'; $ARBOL_NDF = 'PEGAR-ARBOL-src/shared/ndf-DEL-PR'
$RAMA = 'claude/puente-clave-fe-tipo'; $PRUEBAS = 499
$NUEVA = 'C:\satori\agente-fe'; $CMD_NUEVO = 'C:\satori\pos-agente-prod-fe.cmd'; $VUELTA = 'C:\satori\fe-vuelta'
```
- **A0:** el mensaje de error dice `89c5aa4…` en vez de `578f38c…` (el chequeo usa `$SHA_PROD`, no cambia el código).
- **A1:** `git -C $N fetch origin $RAMA claude/puente-salonero-lineas` y
  `$esp = 'pos-bridge/backfill.test.ts,pos-bridge/backfill.ts,pos-bridge/consultaAgente.test.ts,pos-bridge/consultaAgente.ts'`
  (el mensaje final dice «4 archivos»).
- **A2, A3, A5, A6:** idénticos (A3 espera `$PRUEBAS` = 499).
- **A4 (en seco, nada se envía) — dos corridas en vez de una**, mirando `fe_sin_clave=` de cada día (el backfill lo
  imprime al final de la línea; el `Resumen-DryRun` del salonero sigue funcionando):
  1. **Últimos 7 días:** `fe_sin_clave = 0` todos los días (no se descarta ninguna clave buena). **Parada** si > 0.
  2. **`--desde 2026-04-10 --hasta 2026-04-16`:** Σ `fe_sin_clave` **≥ 194** (lo que hoy tiene prod en esos días;
     puede ser más si el PoS pisó más). **Parada** si da 0.
- **A7 (vuelta atrás):** idéntico; vuelve a `C:\satori\agente-sal` (`89c5aa42`). Renombra `fe-vuelta-usada-…`.
- **B1:** idéntico salvo `$DESDE_MIN = '2026-03-01'` y, en el conteo por mes, la regex
  `'(\d{4}-\d{2}-\d{2})\s+tickets=\d+\s+guardados=\d+.*?fe_sin_clave=(\d+)'` (N = Σ `fe_sin_clave` de los días
  anteriores a `CORTE_HUMO`). Son ~9 meses: entra en una ventana.

## 6. Parada, riesgos y vuelta atrás
- **Parar** si cambia `facturas`, `lineas`, `h_facturas_sin_clave`, `h_consecutivo` o `h_lineas`; si `colisiones` no
  queda en 0; si `clave_null` no sube exactamente lo que valían las colisiones (y N de B1); o si el agente deja de latir.
- **Riesgo · se pierde la clave del 04:** el PoS no tiene la clave buena de esos tiquetes en `ClaveElectronica` (la
  pisó). Queda null en vez de equivocada. Recuperarla pide leer el XML de Hacienda del PoS (hoy fuera del puente por
  privacidad): decisión aparte.
- **Riesgo · el PoS:** el cruce sin tipo sigue en el PoS. Conviene avisar al proveedor del PoS (decisión del dueño).
- **Vuelta atrás del agente:** A7. **De los datos:** re-backfill del mismo rango desde `C:\satori\agente-sal`
  (`89c5aa42`): vuelven las claves ajenas. Sin SQL a mano.

## 7. Firma y bitácora
- Firma del dueño: _pendiente_ (SHA: ______, fecha y hora −06:00).

| Paso | Esperado | Obtenido |
|---|---|---|
| A0 · agente de hoy · latido | `89c5aa4…` limpio · Running · late sin error | |
| A1 · clon | SHA firmado · árboles del PR · 4 archivos | |
| A2 · `.env` | idénticos · ninguna clave falta · candado ok | |
| A3 · pruebas | `mssql` carga · typecheck ok · 499 en verde | |
| A4 · en seco | 7 días: `fe_sin_clave` 0 · 10–16 abr: ≥ 194 · nada enviado | |
| A5 · A6 | `HORA_CAMBIO` −06:00 · late sin error | |
| B · humo antes | se anotan facturas, líneas, huellas, `colisiones`, `clave_null` | |
| B1 · meses | 2026-03 → ayer · errores 0 · N | |
| B · humo después | huellas iguales · `colisiones` 0 · `clave_null` sube N | |
