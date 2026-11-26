# Pase a PROD de la mig 201 `fe_versiones_revisar` + Edge `fe-ingesta` (hallazgos 257/258) — EN ESPERA DE FIRMA

Corto: el contexto de F1 está en [PASE-199](PASE-199-fe-ingesta.md). Formato de `PASE-089`. Vía: **merge → Branching**
(la migración y la Edge entran juntas; nada a mano). Responsables: ejecución = sesión coordinadora del día · control =
el dueño (firma por chat sobre el SHA de cabeza).

## 1. Qué pasa y qué no

- **257:** misma clave con **otro** sha256 ya no se descarta como «duplicado»: se guarda la versión
  (`fe_comprobante_versiones`: sha, ruta, fuente, lote, hora) y el comprobante pasa a «revisar» con motivo. Mismo sha =
  duplicado de verdad (sin fila nueva). Igual para la respuesta de Hacienda (`fe_respuesta_versiones`, huella del
  contenido). Emisor que no está en `fe_emisores_conocidos` (o inactivo) → «revisar». Nada crea proveedores.
- **258:** el XML se guarda en `fe-xml/AAAA/MM/<clave>/<sha256>.xml`; `fe_ingestar` rechaza (P0001 → la Edge da 500 →
  el script reintenta) una ruta que no termina en su sha. «Ya existe» en Storage = ese mismo XML.
- No toca: la 199 (su `.sql`), la 200, Caja, Bandeja, F2/costos, sagrados. Los comprobantes de la 199 quedan con su
  ruta vieja; se rellenan como su primera versión.
- **Ojo operativo (30-nov):** con `fe_emisores_conocidos` vacío, **toda** factura entra a «revisar» («emisor no
  conocido»). Es a propósito (lista blanca). Cargar los emisores antes o después del primer día (§3, paso 4). Cargar un
  emisor NO saca de «revisar» lo que ya entró (se revisa a mano; re-evaluar en bloque queda para F2, decisión del dueño).

## 2. Lecturas previas en prod (solo lectura)

```sql
begin read only;
select (select max(version) from supabase_migrations.schema_migrations)                    as ledger,       -- 199 (si 200/201 en otro orden: parar y releer)
       (select count(*) from public.fe_comprobantes)                                        as comprobantes,
       (select count(*) from public.fe_respuestas)                                          as respuestas,
       (select count(*) from public.fe_ingesta_bitacora where motivo like 'misma clave con otro XML%') as perdidos_199, -- esperado 0
       to_regclass('public.fe_comprobante_versiones')                                       as ya_201;       -- null
rollback;
```
`perdidos_199 > 0` = con la 199 llegó otro XML con la misma clave y no se guardó (257): avisar al dueño antes de seguir
(el correo sigue en Gmail con «fe-procesada»; se puede reenviar después del pase). Con `comprobantes > 0`, el archivo
de cada uno puede no ser el de su sha (258, solo si hubo un 500 entre subir y guardar): anotarlo, no se corrige por SQL.
Más: `list_edge_functions` (versión, `verify_jwt`, `ezbr_sha256` de las 9) y latido del PoS.

## 3. Orden

1. Firma por chat sobre el SHA de cabeza (Gate verde) + lecturas del §2.
2. Merge en ventana D1 (código → con OK). Branching aplica la 201 y despliega `fe-ingesta`.
3. Después (solo lectura): ledger con **una** fila `201` / `fe_versiones_revisar` · 3 tablas nuevas con RLS ·
   `fe_respuestas` con `huella`/`estado`/`motivo` · versiones = comprobantes de antes (relleno) · `fe-ingesta` con
   `verify_jwt = false` y hash nuevo · las otras 8 Edge con la misma versión y hash · latido del PoS.
4. El dueño carga los emisores (dato, con su firma; las cédulas NO van al repo ni al chat), por ejemplo desde lo que
   ya entró: `insert into public.fe_emisores_conocidos (cedula) select distinct emisor_cedula from public.fe_comprobantes
   where emisor_cedula is not null and <los que reconoce> on conflict do nothing;`
5. Humo: correr `correr` del script una vez; la pestaña «📨 Facturas electrónicas» muestra la ingesta.

**Parada:** ledger ≠ 199 antes del merge · otra Edge cambia de hash · el PoS deja de latir · `fe-ingesta` responde
algo que no sea 401 sin secreto.

## 4. Pruebas

| Dónde | Resultado |
|---|---|
| Postgres 16 local (`HASTA=200 bash scripts/sql/local_armar_base.sh`, `201_pruebas.py --local`) | 30/30 · 18/18 mutaciones muerden |
| Staging | **NO PROBADO** (la corre la coordinadora con el dueño: `python3 scripts/sql/201_pruebas.py --armar --compacto`; lleva `drop`, regla 14) |
| Dos llegadas simultáneas de la misma clave (candado `pg_advisory_xact_lock`) | **NO PROBADO** (una sola sesión en la batería) |
| Edge real contra Storage | **NO PROBADO** (proxy; la prueba de punta a punta es la del PASE-199 §5.6) |

## 5. Vuelta atrás

- Apagar: quitar el disparador del script o `FE_INGESTA_SECRET` (401 a todo).
- Esquema, sin conflictos reales: `scripts/sql/201_rollback.sql` (una transacción; deja `fe_ingestar`,
  `fe_respuesta_registrar` y `fe_ingesta_resumen` idénticos a la 199 —lo mira el caso 90—). La Edge nueva sigue andando
  con la 199 (caso 91). Si la 201 ya está en el ledger, el `.sql` no se borra (regla 10): migración nueva con ese cuerpo.
- Con versiones en conflicto reales: no se borra; se corrige con migración nueva.

## 6. Firma y bitácora

| Fecha (CR) | Quién | Qué |
|---|---|---|
| 2026-11-26 | agente (Opus 5.5) | PR en borrador; batería local 30/30, mutaciones 18/18 |
| | coordinadora + dueño | batería en staging |
| | dueño | firma sobre el SHA · lecturas en prod · merge · emisores conocidos |
