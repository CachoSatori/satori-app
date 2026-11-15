# Pase a PROD de la mig 173 `club_cumple_caja_portal_beneficio` (origen club 119)

> **Estado: preparado, SIN ejecutar.** Formato del `PASE-089`. **Toca esquema, datos personales (cumpleaños) y
> cortesías: nada de este documento se ejecuta sin la firma del dueño (§9).** Si algo no coincide con lo que dice acá,
> **se para y se avisa**: no se improvisa en prod.
>
> - **Vía: merge → Branching** (la usada desde la 085). No se aplica nada a mano. Si el día del pase aparece una razón
>   para hacerlo a mano, se para y se rehace el paquete.
> - **Orden: el #202 (mig 172) entra ANTES que el #203 (mig 173).** Branching rechaza una versión menor que la última
>   aplicada: si la 173 entra primero, la 172 ya no puede entrar con ese número. La 173 no depende de la 172 (probada con y
>   sin ella), pero el ledger sí. Si el #202 no está listo, se espera o se renumera la 172 en su propio PR; no se mergea el
>   #203 delante.
> - **Necesita en prod:** la 159 (guardia del cumpleaños, `club_socio_alta_caja_v2`) y la 170 (`club_exigir_local`). La
>   migración aborta si faltan.
> - **Mismo merge con club-web y la app:** la 173 pasa los locales al aviso **v1.3**. club-web manda `acepto: 'v1.3'` y la
>   app llama a `club_socio_alta_caja_v3`: si la base entra sin el deploy (o al revés), las altas fallan. Merge con el local
>   sin altas en curso.
> - **Regla del ledger (Grok 122):** Branching guarda las migraciones partidas en statements. Verificación: **exactamente
>   1 fila 173 con su `name`** + el catálogo (§5). No se compara md5.
> - **Repo público:** en la bitácora (§9) solo conteos, nunca nombres, teléfonos ni fechas de cumpleaños.

## 1. Qué pasa y qué no
- **Pasa:** aviso de privacidad **v1.3** (fila en `club_avisos_privacidad`, default y locales de v1.2 → v1.3); columna
  `club_miembros_contacto.cumple_portal_en`; la guardia `club_contacto_cumple_guardia` rehecha (además de la autoalta, cargan
  el cumpleaños a quien no lo tiene solo el alta en caja v3 y el portal, una vez); `club_socio_alta_caja_v3`;
  `club_portal_cumple` / `_agregar` (club-web); tabla `club_cumple_config` (una fila por local, **apagada**, OpenTable
  rid 1347736) con `club_cumple_config_ver` / `_guardar`; tabla `club_cumple_envios` (marca «enviado»);
  `club_cumple_proximos` / `club_cumple_enviar` (Inicio); `club_cumple_en_caja` (Escanear: solo socios del local, sin la
  fecha) y las internas.
- **No pasa:** ningún beneficio encendido (nadie ve el bloque del Inicio ni el recuadro de caja hasta que owner o manager lo
  encienda con un artículo de CORTESÍA CLUB); no cambia `club_socio_visita`, movimientos, saldos, pase, cierres, pozo ni
  propinas; no cambia ningún cumpleaños ya cargado. Sin Edge Functions ni secretos (Wallet va en un PR aparte).

## 2. Prerrequisitos
- **#202 (172) ya mergeado y verificado** (ledger con la fila 172).
- PR #203 con revisión, verificador independiente y **firma del dueño sobre el SHA exacto** (esquema y cortesías).
- Batería en staging corrida (§4) o la decisión explícita del dueño de pasar sin ella.
- Ventana de merge (regla D1): libre de 23:30 a 15:50; nunca de 15:50 a 19:00; de 19:00 a 23:30 solo con OK del dueño.

## 3. Lecturas previas en prod (solo lectura, `begin read only` … `rollback`)
- Ledger: última versión = **172**, sin fila 173.
- `to_regprocedure('public.club_exigir_local(text)') is not null` y
  `to_regprocedure('public.club_socio_alta_caja_v2(text,text,text,boolean,boolean,text)') is not null`.
- `to_regclass('public.club_cumple_config') is null`.
- Conteos (anotar; tienen que seguir igual después): `select aviso_privacidad_version, count(*) from club_config group by 1`
  (esperado: todos v1.2) y `select count(*) from club_miembros_contacto where cumple_dia is not null`.

## 4. Prueba en staging (pendiente con el dueño)
`python3 scripts/sql/173_pruebas.py` (Management API, ref de staging fijo; transacción descartada: no deja nada).
Esperado: **20/20**. En Postgres 16 local ya corrió: 20/20 con y sin la 172 y `--mutar todas` → 24/24 muerden.

## 5. Humo después (solo lectura)
- Ledger: exactamente 1 fila `173` con `name = club_cumple_caja_portal_beneficio`; check «Supabase Preview» en success con
  «All migrations are up to date».
- `select aviso_privacidad_version, count(*) from club_config group by 1` → todos **v1.3**; existe la fila `v1.3` en
  `club_avisos_privacidad`.
- `select count(*) from club_cumple_config` = cantidad de locales y `count(*) filter (where activo)` = 0.
- `select count(*) from club_cumple_envios` = 0.
- Cumpleaños cargados: el mismo conteo que en §3.
- Permisos: `has_function_privilege('authenticated','public.club_socio_alta_caja_v3(text,text,text,boolean,boolean,int,int,boolean,text)','EXECUTE')`,
  `has_function_privilege('anon','public.club_portal_cumple_agregar(text,int,int,boolean)','EXECUTE')` y
  `has_function_privilege('authenticated','public.club_cumple_proximos(text)','EXECUTE')` = true;
  `has_table_privilege('authenticated','public.club_cumple_envios','SELECT')` = false.
- Funcional (en el local, con el deploy): un alta de prueba con nombre ficticio en caja **sin** cumpleaños pasa; la página
  `/alta` muestra el aviso v1.3 y una autoalta pasa.

## 6. Criterios de parada
Cualquier diferencia con §5, un error de Branching, altas que fallan («Datos no válidos» en `/alta`, error en «Dar de alta»)
→ se para, se avisa y se evalúa el §7.

## 7. Vuelta atrás
- `scripts/sql/173_rollback.sql` (**antes** que el de la 172 y el de la 170, si hicieran falta) y, **en el mismo momento**,
  el revert del código (app y club-web: vuelven a v1.2 y a la v2 de caja) y un PR que saca el `.sql` de `main` (skill §6).
- El rollback **conserva** los cumpleaños ya cargados (los cubre la guardia de la 159 y el aviso v1.2) y borra la
  configuración, las marcas «enviado» y `cumple_portal_en`. La fila `v1.3` de `club_avisos_privacidad` queda (inmutable).
- Con mucho uso real (marcas «enviado», cumpleaños del portal) pensarlo dos veces: se apaga el beneficio y se arregla con
  una migración nueva.

## 8. Responsables
- **Ejecución:** el dueño (firma y merge, o autoriza el merge).
- **Control:** el encargado del turno, que lee cada resultado esperado contra el obtenido. No es la misma persona.

## 9. Firma y bitácora
| Qué | Valor |
|---|---|
| SHA firmado | (pendiente) |
| Firma del dueño (fecha y hora −06:00) | (pendiente) |
| #202 (172) en prod antes | (pendiente) |
| Batería en staging | (pendiente con el dueño) |
| Merge (hora CR) | (pendiente) |
| Ledger antes → después | (pendiente) |
| Humo | (pendiente) |
