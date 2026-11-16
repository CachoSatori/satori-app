# Pase a PROD de la mig 175 `club_cumple_uso_anual` (origen club 121)

> **Estado: preparado, SIN ejecutar.** Formato del `PASE-089`. **Toca esquema y cortesías: nada de este documento se
> ejecuta sin la firma del dueño (§9).** Si algo no coincide con lo que dice acá, **se para y se avisa**: no se improvisa
> en prod.
>
> - **Vía: merge → Branching** (la usada desde la 085). No se aplica nada a mano. Si el día del pase aparece una razón
>   para hacerlo a mano, se para y se rehace el paquete.
> - **Orden: la 173 (#203) y la 174 entran ANTES que la 175.** Branching rechaza una versión menor que la última
>   aplicada. La 175 necesita la 173 (aborta si falta); no depende de la 174, pero el ledger sí: no se mergea delante.
>   La 176 y la 177 (otros PRs de esta noche) van después.
> - **Mismo merge con la app:** sin el deploy, la base ya frena el segundo uso, pero la caja no muestra el botón ni el
>   «Ya usó…». Con la app nueva y sin la base, los resúmenes de Tablero /
>   Excepciones se ocultan, pero el botón «Usó el beneficio…» aparece y da error al tocarlo. Van juntos.
> - **Regla del ledger (Grok 122):** verificación con **exactamente 1 fila 175 con su `name`** + el catálogo (§5). No se
>   compara md5.
> - **Repo público:** en la bitácora (§9) solo conteos, nunca nombres, teléfonos ni fechas de cumpleaños.

## 1. Qué pasa y qué no
- **Pasa:** tabla `club_cumple_usos` (marca de uso por socio y **año del cumpleaños**, vinculada a la visita del socio y su
  pedido/factura, con quién, local y artículo; índice único parcial por socio y año y por visita entre las vigentes;
  guardia: la fila no se edita, solo se deshace una vez). `club_cumple_en_caja_dia` (173) suma `ya_uso` (sin fecha ni año).
  Funciones nuevas: `club_cumple_usar` (caja; núcleo `club_cumple_usar_dia` sin EXECUTE), `club_cumple_uso_deshacer`
  (solo owner, con nota, auditado), `club_cumple_usos_listar` (owner y manager de su local) y `club_cumple_usos_resumen`
  (owner, manager de su local y contador; solo totales; núcleo `club_cumple_usos_resumen_rango` sin EXECUTE).
- **No pasa:** plata nueva ni movimientos (es una marca; la cortesía sigue siendo el artículo de «CORTESÍA CLUB» a ₡0 en
  el PoS). No cambia `club_socio_visita`, `club_tablero_mes`, `club_excepciones`, la configuración del beneficio, saldos,
  cierres, pozo ni propinas. Sin Edge Functions ni secretos.

## 2. Prerrequisitos
- **#203 (173) y la 174 ya mergeados y verificados** (ledger con las filas 173 y 174).
- PR con revisión, verificador independiente y **firma del dueño sobre el SHA exacto** (esquema y cortesías).
- Batería en staging corrida (§4) o la decisión explícita del dueño de pasar sin ella.
- Ventana de merge (regla D1): libre de 23:30 a 15:50; nunca de 15:50 a 19:00; de 19:00 a 23:30 solo con OK del dueño.

## 3. Lecturas previas en prod (solo lectura, `begin read only` … `rollback`)
- Ledger: última versión = **174**, sin fila 175.
- `to_regprocedure('public.club_cumple_en_caja_dia(uuid,text,date)') is not null` y
  `to_regprocedure('public.club_exigir_local(text)') is not null`.
- `to_regclass('public.club_cumple_usos') is null`.
- Anotar: `select count(*) filter (where activo) from club_cumple_config` (locales con el beneficio encendido).

## 4. Prueba en staging (pendiente con el dueño)
`python3 scripts/sql/175_pruebas.py` (Management API, ref de staging fijo; transacción descartada: no deja nada). Necesita
la 173 en staging. Esperado: **14/14**. En Postgres 16 local ya corrió: 14/14 y `--mutar todas` → 19/19 muerden.

## 5. Humo después (solo lectura)
- Ledger: exactamente 1 fila `175` con `name = club_cumple_uso_anual`; check «Supabase Preview» en success con «All
  migrations are up to date».
- `select count(*) from club_cumple_usos` = 0.
- `select indexname from pg_indexes where tablename = 'club_cumple_usos'` trae `club_cumple_usos_anio_uq` y
  `club_cumple_usos_visita_uq`.
- Permisos: `has_function_privilege('authenticated','public.club_cumple_usar(uuid,text)','EXECUTE')` = true;
  `has_function_privilege('authenticated','public.club_cumple_usar_dia(uuid,text,date)','EXECUTE')` = false;
  `has_table_privilege('authenticated','public.club_cumple_usos','SELECT')` = false; `anon` sin EXECUTE en las nuevas.
- Lo encendido en §3 sigue igual.
- Funcional (en el local, con el deploy y el beneficio encendido): con un socio de prueba ficticio con cumpleaños dentro
  de la ventana, registrar la visita, tocar «Usó el beneficio de cumpleaños», ver el recuadro pasar a «Ya usó su beneficio
  de cumpleaños este año»; el owner lo deshace con nota en Promociones → «Usos del beneficio de cumpleaños».

## 6. Criterios de parada
Cualquier diferencia con §5, un error de Branching, o la caja con error al registrar la visita del socio → se para, se
avisa y se evalúa el §7.

## 7. Vuelta atrás
- `scripts/sql/175_rollback.sql` (**antes** que el de la 173, si hiciera falta) y, **en el mismo momento**, el revert del
  código de la app y un PR que saca el `.sql` de `main` (skill §6).
- El rollback **aborta si ya hay marcas** (uso real): con actividad no se borra; se apaga el beneficio en Promociones y se
  arregla con una migración nueva. Sin marcas, deja `club_cumple_en_caja_dia` exacta a la 173.

## 8. Responsables
- **Ejecución:** el dueño (firma y merge, o autoriza el merge).
- **Control:** el encargado del turno, que lee cada resultado esperado contra el obtenido. No es la misma persona.

## 9. Firma y bitácora
| Qué | Valor |
|---|---|
| SHA firmado | (pendiente) |
| Firma del dueño (fecha y hora −06:00) | (pendiente) |
| 173 y 174 en prod antes | (pendiente) |
| Batería en staging | (pendiente con el dueño) |
| Merge (hora CR) | (pendiente) |
| Ledger antes → después | (pendiente) |
| Humo | (pendiente) |
