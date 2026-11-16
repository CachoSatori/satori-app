# Pase a PROD de la mig 174 `club_facturas_dia_busqueda` (origen 120)

> **Estado: preparado, SIN ejecutar.** Formato del `PASE-089`. **Toca el esquema (lleva firma: esquema): nada de este
> documento se ejecuta sin la firma del dueño (§9).** Si algo no coincide con lo que dice acá, **se para y se avisa**: no
> se improvisa en prod.
>
> - **Vía: merge → Branching** (la usada desde la 085). No se aplica nada a mano. Si el día del pase aparece una razón
>   para hacerlo a mano, se para y se rehace el paquete.
> - **Orden:** **después de la 172 (#202) y la 173 (#203)**, que todavía no están mergeadas (Branching rechaza una versión
>   menor que la última aplicada). La 174 no toca nada de ellas: probada en base local con y sin la 172/173. Si alguna de
>   las dos se cae, la 174 entra igual después de la 171 (sin renumerar: el número ya es mayor).
> - **Regla del ledger (Grok 122):** Branching guarda las migraciones partidas en statements. Verificación: **exactamente
>   1 fila 174 con su `name`** + el catálogo (§5). No se compara md5.
> - **Repo público:** en la bitácora (§9) solo conteos, nunca montos, números de tiquete reales ni nombres.

## 1. Qué pasa y qué no
- **Pasa:** en Club → Escanear, «Factura (plan B)» muestra las facturas **cobradas hoy** (día CR) y se busca por los
  últimos dígitos del tiquete hasta **3 días CR** atrás. Funciones nuevas: `club_facturas_buscar` (envoltorio con
  `club_exigir_local`, EXECUTE para `authenticated`) y su `club_facturas_buscar__nucleo`; internas (sin EXECUTE para la
  API): `club_facturas_lista`, `club_factura_usada`, `club_visita_con_tarjeta`, `club_facturas_desde`,
  `club_facturas_dias_busqueda`. Cambian de cuerpo: `club_facturas_recientes__nucleo` (hoy en vez de 2 h; misma firma),
  `club_pos_ref` (acepta la factura de hasta 3 días CR; antes 2 h 15 min) y `club_visita_control` (con la factura del plan
  B, si ya tiene tarjeta o cupón, corta).
- **No pasa:** ni tablas, ni datos, ni plata (los movimientos se guardan igual; `fecha_visita` sigue siendo la hora del
  registro). No cambia el envoltorio de `club_facturas_recientes`, ni el cruce, ni sagrados, ni Edge Functions ni
  secretos. Con el pedido abierto sigue CLUB-AUD-02.
- **El código de la app va en el mismo merge** (Escanear llama a `club_facturas_buscar`). Una PWA en caché vieja sigue
  llamando a `club_facturas_recientes`: ve la lista de hoy, sin búsqueda ni marca de usada (la base igual frena la
  factura usada).

## 2. Prerrequisitos
- La 172 (#202) y la 173 (#203) mergeadas y verificadas (o decisión del dueño de pasar la 174 antes, sin ellas).
- PR con revisión, verificador independiente (esquema) y **firma del dueño sobre el SHA exacto**.
- Ventana de merge (regla D1): libre de 23:30 a 15:50; nunca de 15:50 a 19:00; de 19:00 a 23:30 solo con OK del dueño.

## 3. Lecturas previas en prod (solo lectura, `begin read only` … `rollback`)
- Ledger: última versión = 173 (o 171/172 si alguna no entró) y **sin** fila 174.
- `to_regprocedure('public.club_facturas_buscar(text,text)') is null`.
- `md5(prosrc)` de `club_facturas_recientes`, `club_facturas_recientes__nucleo`, `club_pos_ref` y `club_visita_control`
  (anotar: el envoltorio de recientes tiene que quedar igual; los otros tres cambian).

## 4. Prueba en staging (pendiente con el dueño)
`python3 scripts/sql/174_pruebas.py --armar` y correr el SQL en staging (ref `hwiatgic…`, nunca prod): transacción
descartada, no deja nada. Esperado: 26/26. En Postgres 16 local (15-nov): 26/26 con y sin la 172/173; 12/12 mutaciones
muerden.

## 5. Humo después (solo lectura)
- Ledger: exactamente 1 fila `174` con `name = club_facturas_dia_busqueda`; check «Supabase Preview» en success con «All
  migrations are up to date».
- `has_function_privilege('authenticated','public.club_facturas_buscar(text,text)','EXECUTE')` = true y `= false` para
  `anon`; `= false` para `authenticated` en `club_facturas_buscar__nucleo(text,text)` y `club_facturas_lista(text,text,timestamptz)`.
- `md5(prosrc)` del envoltorio `club_facturas_recientes` = el de §3.
- En el local (validación física): «Factura (plan B)» muestra las cobradas hoy; buscar un tiquete de ayer lo trae con la
  fecha; una factura con tarjeta ya cargada aparece marcada y no se puede elegir.

## 6. Criterios de parada
Cualquier diferencia con §5, un error de Branching o una caja que no puede registrar un cupón o una tarjeta con el pedido
abierto después del merge → se para, se avisa y se evalúa el §7.

## 7. Vuelta atrás
- Primero el revert del código de la app (Escanear vuelve a `club_facturas_recientes`), después
  `scripts/sql/174_rollback.sql` y, **en el mismo momento**, un PR que saca el `.sql` de `main` (skill §6). Vuelve la
  regla de 2 h. No toca datos: las tarjetas cargadas con facturas de más de 2 h quedan.
- Orden: antes de revertir la 172, la 173 o la 170.

## 8. Responsables
- **Ejecución:** el dueño (firma y merge, o autoriza el merge).
- **Control:** el encargado del turno, que lee cada resultado esperado contra el obtenido. No es la misma persona.

## 9. Firma y bitácora
| Qué | Valor |
|---|---|
| SHA firmado | (pendiente) |
| Firma del dueño (fecha y hora −06:00) | (pendiente) |
| Merge (hora CR) | (pendiente) |
| Ledger antes → después | (pendiente) |
| Humo | (pendiente) |
