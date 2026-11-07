# Plan · actualizar el agente del PoS (ítem 11) — paso a paso por AnyDesk

> **Para Ismael.** Solo el agente de **STAGING**. **Prod no se toca** (va aparte y con firma).
> Duración: unos 30 minutos más el backfill, que corre solo. **Fuera del servicio (no de 19 a 22 h).**
> Si algo no coincide con lo que dice este plan, **parar y avisar** antes de seguir.

## Qué cambia
El agente empieza a mandar, por cada factura: la **mesa de la factura** (`NumeroMesa`), el **consecutivo
electrónico** (20 dígitos), la **clave electrónica** (50 dígitos) y la **hora de apertura del pedido**.
En las mesas abiertas manda también la apertura del pedido. Nada de nombres ni teléfonos. No cambia
ningún monto.

## Lo que ya está hecho en staging (Claude Code, 07-nov)
1. Migración **081** aplicada en staging. Agrega columnas que aceptan vacío; no cambia nada de lo que ya hay.
2. Edge `ingest-ndf` **v11** en staging. Con el agente de hoy sigue funcionando: los campos nuevos
   quedan vacíos. Se verificó un ciclo real sin error a las 05:35 UTC.
3. El código del agente está en la rama **`claude/puente-item11`**. **Falta el OK para subirla a GitHub.**
   Hasta entonces existe solo como parche en `docs/puente/item11-puente.patch`.

## Paso 0 · Mirar antes de tocar (solo lectura)
1. Conectarse por AnyDesk a la PC del PoS.
2. Abrir el **Programador de tareas** y buscar las tareas del agente del PoS. Por cada una, anotar:
   - el nombre;
   - la carpeta de **«Iniciar en»** (por ejemplo `C:\satori\satori-app`).
3. En cada carpeta, abrir `pos-bridge\.env` con el Bloc de notas y mirar **solo** dos líneas:
   `ENV=` y `INGEST_URL=`. **No copiar ni mandar la clave.**
   - Staging: `ENV=staging` y la URL que empieza con `https://hwiatgicyyqyezqwldia`.
   - Prod: la otra.
4. **Si staging y prod usan la MISMA carpeta → PARAR y avisar.** Hay que separar primero la carpeta
   de staging, porque actualizar el código cambiaría también el agente de prod.

## Paso 1 · Punto de vuelta atrás
En una consola (`cmd`) dentro de la carpeta del agente de **staging**:
```
git rev-parse HEAD
git status
```
- Anotar el hash que sale (es el punto de rollback).
- `git status` no tiene que mostrar archivos modificados. Si muestra alguno, parar y avisar.

## Paso 2 · Parar el agente de staging
En el Programador de tareas, sobre la tarea de **staging**: clic derecho → **Finalizar** y después
**Deshabilitar**. La de prod no se toca.

## Paso 3 · Traer el código nuevo
En la misma carpeta:
```
git fetch origin claude/puente-item11
git checkout claude/puente-item11
npm install
cd pos-bridge
npm install
```
(Los `npm install` no deberían cambiar nada: el ítem 11 no agrega dependencias.)

## Paso 4 · Prueba en seco (no envía nada)
Desde `pos-bridge`:
```
npm run backfill -- --desde 2026-11-05 --hasta 2026-11-05 --dry-run
```
- **Bien:** lista el día con sus facturas y termina sin error.
- **Mal:** cualquier error. Ir al **Rollback** y avisar.
- Ojo: si una de las columnas nuevas se llamara distinto en esta PC, el agente **no falla**, la
  manda vacía. Por eso lo que confirma de verdad es la verificación de Claude Code. Si hiciera falta,
  se fuerza en el `.env` (`POS_COL_FACTURAS_NUMEROMESA=…`, `POS_COL_FACTURAS_CONSECUTIVOFE=…`,
  `POS_COL_FACTURAS_CLAVEFE=…`), pero solo después de avisar.

## Paso 5 · Agente a mano, mirando el log
Desde la carpeta del repo:
```
npm run pos:agente
```
- Dejarlo **2 o 3 ciclos** (unos 3 minutos). Cada ciclo tiene que terminar **sin error**.
- Cortarlo con **Ctrl+C**.
- **Avisarle a Claude Code:** él confirma en staging que las facturas nuevas llegan con la mesa y el
  consecutivo. Si no hubo ventas en esos minutos, lo confirma con el backfill del paso 7.

## Paso 6 · Volver a dejarlo como tarea
En el Programador de tareas: **Habilitar** la tarea de staging y después clic derecho → **Ejecutar**.

## Paso 7 · Backfill desde el 1 de septiembre
Desde la carpeta del repo, con el agente corriendo (no hace falta pararlo):
```
npm run pos:backfill -- --desde 2026-09-01 --hasta <AYER, AAAA-MM-DD>
```
- Va del día más reciente al más viejo, con pausa entre días: tarda unos minutos.
- Si se corta, se vuelve a correr el mismo comando; no duplica nada.
- Al terminar, **avisarle a Claude Code**, que verifica (ver abajo).

## Rollback (si algo sale mal en cualquier paso)
1. Programador de tareas: **Finalizar** la tarea de staging.
2. En la carpeta de staging: `git checkout <el hash del Paso 1>`.
3. **Habilitar** y **Ejecutar** la tarea.
4. Avisar. El Edge de staging funciona con el agente viejo, y las columnas nuevas quedan vacías: no
   hace falta tocar nada más.
   - Solo si hiciera falta volver todo atrás: Claude Code vuelve a subir el Edge anterior y después
     corre `scripts/sql/081_rollback.sql`. **En ese orden.**

## Verificación (la hace Claude Code en staging, solo lectura)
```sql
-- Cobertura desde el 1-sep (salón): mesa de la factura, consecutivo y apertura del pedido
select count(*) as facturas,
       count(mesa_factura) as con_mesa, count(consecutivo_fe) as con_consecutivo,
       count(pedido_abierto_en) as con_apertura,
       count(*) filter (where numero_pedido is null and mesa_factura is null) as sin_mesa_ni_pedido
  from pos_ndf_tickets
 where local = 'santa-teresa' and canal = 'salon' and estado = 'C'
   and fecha_registra >= '2026-09-01 00:00-06';
-- Esperado (conteo de Ismael): ~1.363 facturas, 5 sin mesa ni pedido.

-- Los dos ejemplos
select numero_factura, mesa_factura, numero_pedido, consecutivo_fe, pedido_abierto_en
  from pos_ndf_tickets
 where local = 'santa-teresa' and numero_factura in ('112430', '112310', '112311', '112313');
-- 112430 → consecutivo …16197, apertura 2026-11-05 18:39:48 (CR). 112310 / 112311 → mesa 19, sin pedido.
```
Después: volver a correr `scripts/sql/075_pruebas_staging.sql`. Los casos «real» (pedido 14 del
05-nov y mesa 19 del 31-oct) quedan con los datos que trae el backfill y no con los simulados.

## Prod (más adelante, con firma aparte)
Mismo orden:
1. Migración 081 en prod.
2. Edge `ingest-ndf` en prod.
3. Agente de prod.
4. Backfill.

Con el Edge nuevo y sin la 081, no entra ninguna venta: la migración va **siempre primero**.
