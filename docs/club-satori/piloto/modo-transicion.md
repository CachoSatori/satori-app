# Modo transición · tarjetas viejas de papel (decisión del dueño, 11-nov)

> **Qué es.** Hay muchas tarjetas de papel de las de antes repartidas (una por comercio o anfitrión, sin QR) y la
> incorporación al sistema nuevo va a ser gradual. Mientras dure, la caja registra a mano la visita de un cliente que llega
> con una de esas tarjetas, **solo para anfitriones ya inscriptos**. Es una prueba interna extendida «hasta que todos estén
> en el sistema digital».

## 1. Las reglas (firmadas por el dueño el 11-nov)
| Regla | Valor |
|---|---|
| Cuándo se enciende | El jueves del pase, **después de la carga única** (los anfitriones ya tienen que estar cargados) |
| Dónde | `club_config.tarjeta_manual_activa = true` en el local, con `tarjeta_manual_tope_dia = 12` |
| Quién carga | owner, manager y cajero |
| Tope | **12 personas por anfitrión por día** (2 créditos) |
| Quién revisa | owner o manager, **nunca quien la cargó** (ni siquiera el owner), **todos los días**, en Excepciones → «Tarjeta vieja» |
| Cuándo se apaga | Cuando las tarjetas viejas sean **menos del 15 % de las visitas de anfitriones dos semanas completas seguidas**. Sin fecha fija; se revisa **cada 2 semanas** |
| Lista desplegable con todos los anfitriones | **No.** Se busca por nombre, negocio o los últimos 4 del teléfono (la búsqueda de siempre, auditada y con tope) |
| Cambios en la base (bloque 152+) | Más adelante |

Lo que **no** cambia: una tarjeta por anfitrión por visita; las personas no pueden superar las del pedido; el cliente con
tarjeta vieja puede llevar el 10 % (la tarjeta respalda la promo: no salta «Promo sin cupón»); la caja no ve el código del
anfitrión (CLUB-AUD-30) ni le muestra ningún QR al cliente.

## 2. Cómo lo hace la caja
- **Desde la apertura (con lo que hay en la 150):** Escanear → «Buscar referente (plan B)» → elegir → «Tarjeta física» →
  personas y pedido → Continuar → Confirmar. Paso a paso en la guía rápida de caja.
  **Ojo (hasta que entre este PR):** después de «Confirmar», la pantalla vuelve al inicio con el aviso rojo «Código no
  reconocido. Probá de nuevo o buscá por nombre.» **El registro SÍ quedó guardado**: no se carga de nuevo (la base igual
  rechaza una segunda tarjeta del mismo anfitrión en la misma visita). Se confirma en Excepciones → «Tarjeta física».
- **Con este PR:** botón **«Tarjeta vieja (sin QR)»** arriba en Escanear (o el **QR de caja**,
  `cartel-caja-tarjeta-vieja.pdf`), la lista aparece mientras se escribe, y al confirmar dice «Tarjeta vieja: +N personas
  a …». Guía 6.13, Tarea 4b.

## 3. El jueves, en prod: encender y fijar el tope
Lo corre el dueño en el editor SQL de **prod** (leer el ref en pantalla), **después de la carga única** (§6.5 del PASE) y
antes de la prueba interna. Es un cambio de **datos** (no es una migración): queda en `club_config_historial`.
Probado el 11-nov en staging dentro de una transacción descartada.

**A. Antes (solo lectura)**
```sql
begin read only;
select location_id, club_activo, tarjeta_manual_activa, tarjeta_manual_tope_dia
  from public.club_config order by location_id;
-- esperado: nosara · false · false · 30   y   santa-teresa · (true si ya se encendió el local, §6.6) · false · 30
select count(*) as anfitriones_activos
  from public.club_miembros
 where location_id = 'santa-teresa' and estado = 'activo' and tipo in ('referente', 'concierge_pm', 'equipo');
-- esperado: más de 0 (los de la carga única). Con 0, PARAR: la carga única no entró y no hay a quién cargarle una tarjeta.
rollback;
```

**B. El cambio (una transacción; primero el tope, después encender)**
```sql
begin;
-- 1) el tope diario: 12 personas por anfitrión
update public.club_config set tarjeta_manual_tope_dia = 12
 where location_id = 'santa-teresa' and tarjeta_manual_tope_dia = 30
returning location_id, tarjeta_manual_tope_dia;
-- esperado: 1 fila · santa-teresa · 12
-- 2) encender la tarjeta vieja
update public.club_config set tarjeta_manual_activa = true
 where location_id = 'santa-teresa' and tarjeta_manual_activa = false
returning location_id, tarjeta_manual_activa, tarjeta_manual_tope_dia;
-- esperado: 1 fila · santa-teresa · true · 12
commit;
```
El editor muestra el resultado de la **última** sentencia: tiene que ser `santa-teresa · true · 12`. Si dice «0 filas» en
cualquiera de las dos (el valor de partida no era el esperado), correr `rollback;` en lugar de `commit;` y avisar.

**C. Después (solo lectura)**
```sql
begin read only;
select location_id, club_activo, tarjeta_manual_activa, tarjeta_manual_tope_dia
  from public.club_config order by location_id;
-- esperado: nosara · false · false · 30   y   santa-teresa · … · true · 12
select campo, valor_anterior, valor_nuevo, cambiado_en
  from public.club_config_historial
 where location_id = 'santa-teresa' and campo in ('tarjeta_manual_activa', 'tarjeta_manual_tope_dia')
 order by cambiado_en desc, campo limit 2;
-- esperado: tarjeta_manual_activa · false → true   y   tarjeta_manual_tope_dia · 30 → 12
rollback;
```
Y en la app: Club → Escanear → buscar a un anfitrión → en su tarjeta aparece «Tarjeta física».

**Volver atrás (inmediato y reversible):**
`update public.club_config set tarjeta_manual_activa = false where location_id = 'santa-teresa';`

## 4. Qué se anota en el PASE-150-151 (después del merge del #59; no antes: su cabeza está firmada)
**§6.4, la fila «Tarjeta física» queda así:**
```
| Tarjeta física (modo transición) | `club_config.tarjeta_manual_activa` y `tarjeta_manual_tope_dia` | **Encendida, con tope de 12 personas por anfitrión por día** (decisión del dueño, 11-nov): se enciende **después de la carga única** (§6.5), con los SQL de `docs/club-satori/piloto/modo-transicion.md` §3. Carga owner, manager o cajero; la revisa owner o manager (nunca quien la cargó), todos los días. Se apaga cuando las tarjetas viejas sean menos del 15 % de las visitas de anfitriones dos semanas seguidas (revisión cada 2 semanas) | false · 30 |
```
**§6.4, la línea de verificación** (cambia el antepenúltimo valor, de `false` a `true`, **después** de encender):
```
-- antes de encender la tarjeta vieja: … · v1.1 · false · 2026-11-12 · false
-- después de encenderla (modo transición): … · v1.1 · true · 2026-11-12 · (club_activo)
```
**§9, un renglón nuevo:**
```
- **Modo transición (decisión del dueño, 11-nov):** la tarjeta vieja (de papel, sin QR) queda encendida en Santa Teresa con tope de 12 personas por anfitrión por día, desde el jueves 12-nov después de la carga única. Reglas, medición y criterio de apagado: `docs/club-satori/piloto/modo-transicion.md`. No es una migración: es un dato de `club_config`, con su rastro en `club_config_historial`.
```
**§10 (bitácora), una fila nueva después de la 6.5:**
```
| 6.5b modo transición: tope 12 y `tarjeta_manual_activa` encendida en Santa Teresa (después de la carga única) | antes: false · 30 → después: true · 12 · 2 filas en `club_config_historial` | (hora, quién ejecutó y quién controló) |
```

## 5. Cómo se mide y cuándo se apaga
- **En la app** (con este PR): Excepciones → **«Transición · tarjetas viejas»**: por semana (lunes a domingo, hora de Costa
  Rica), visitas de anfitriones, con cupón, con tarjeta vieja, **% de viejas**, anfitriones que ya usan su QR o link y
  anfitriones que solo llegaron con tarjeta vieja. Abajo dice si se cumple el criterio (la semana en curso no cuenta).
- **Hasta que entre el PR** (solo lectura, en prod, una vez por semana):
```sql
begin read only;
select (date_trunc('week', fecha_visita at time zone 'America/Costa_Rica'))::date as semana_del,
       count(*)                                                    as visitas,
       count(*) filter (where cupon_id is not null)                as con_cupon,
       count(*) filter (where cupon_id is null)                    as tarjeta_vieja,
       round(100.0 * count(*) filter (where cupon_id is null) / count(*), 1) as pct_viejas,
       count(distinct miembro_id) filter (where cupon_id is not null) as anfitriones_con_qr_o_link
  from public.club_movimientos
 where tipo = 'tarjeta' and origen = 'app' and location_id = 'santa-teresa'
 group by 1 order by 1 desc limit 6;
rollback;
```
- **Apagar:** cuando `pct_viejas` sea menor que 15 en dos semanas completas seguidas, el dueño avisa a los anfitriones y
  corre el SQL de «Volver atrás» (§3). El botón «Tarjeta vieja (sin QR)» desaparece solo y el QR de caja avisa «La tarjeta
  vieja está desactivada en este local».

## 6. Lo que queda para más adelante (bloque 152+, con pase y firma)
- El tope mensual del anfitrión nuevo hoy solo frena al cupón: la tarjeta vieja entra directo y aparece después como
  excepción «Anfitrión sobre el tope».
- Un motivo propio («tarjeta vieja») en el movimiento y la transición dentro del reporte del mes.
- La búsqueda filtrada por local (hoy busca en todos; con un solo local encendido no cambia nada).
