# Pase a PROD de la mig 169 `club_retos` (origen 115)

> **Estado: preparado, SIN ejecutar.** Formato del `PASE-089`. **Toca plata (una cortesía de premio) y el esquema: nada
> de este documento se ejecuta sin la firma del dueño (§9).** Si algo no coincide con lo que dice acá, **se para y se
> avisa**: no se improvisa en prod.
>
> - **Vía: merge → Branching** (la usada desde la 085). No se aplica nada a mano. Si el día del pase aparece una razón
>   para hacerlo a mano, se para y se rehace el paquete.
> - **Orden:** después de la **155** (último del ledger en `main`). **Con la 168 (#187) da igual el orden**: la 169 no
>   toca `club_socio_visita`, `club_socio_visita_base`, `club_pase_datos` ni `club_portal` (que son lo que la 168
>   envuelve); gana con un trigger en `club_visitas_socio` y ofrece en una función aparte. Probado en base local con la
>   168 antes y sin ella; el verificador del #188 la probó en los dos órdenes. Si las dos van el mismo día, cada una con su
>   merge y su verificación de ledger; no hace falta ninguna en particular primero.
> - **Regla del ledger (Grok 122):** Branching guarda las migraciones partidas en statements. Verificación: **exactamente
>   1 fila 169 con su `name`** + el catálogo (§5). No se compara md5.
> - **Repo público:** en la bitácora (§9) solo conteos, nunca montos ni nombres.

## 1. Qué pasa y qué no
- **Pasa:** tablas `club_retos` y `club_retos_ganados`; columna `club_config_global.retos_exige_factura` (true); triggers
  `club_retos_reglas_trg` (tope 3 armados por año, sin superposición de vigentes por local, armado inmutable, local sin PoS
  con la exigencia prendida) y `club_retos_visita_trg` (AFTER INSERT en `club_visitas_socio`: gana); funciones
  `club_reto_en_visita` (caja), `club_portal_retos` (club-web), `club_retos_listar`, `club_reto_guardar/_armar/_terminar/_borrar`
  y las internas.
- **No pasa:** ningún reto armado (nadie gana nada hasta que el owner arma uno); no cambia `club_socio_visita`, el pase,
  cierres, pozo ni propinas. Sin Edge Functions ni secretos.

## 2. Prerrequisitos
- PR #188 con revisión, verificador independiente y **firma del dueño sobre el SHA exacto**.
- Decisiones del dueño anotadas en el PR: opción B (exigir factura), una cortesía de premio por factura, Nosara sin retos
  mientras se exija factura.
- Ventana de merge (regla D1): libre de 23:30 a 15:50; nunca de 15:50 a 19:00.

## 3. Lecturas previas en prod (solo lectura, `begin read only` … `rollback`)
- Ledger: última versión = 155 (o la que haya entrado después: 166/167/168, en cualquier orden) y **sin** fila 169.
- `to_regclass('public.club_retos') is null` y `to_regclass('public.club_retos_ganados') is null`.
- `select count(*) from club_visitas_socio` (anotar; tiene que seguir igual después).

## 4. Prueba en staging (pendiente con el dueño)
`python3 scripts/sql/169_pruebas.py` (transacción descartada: no deja nada). Esperado: 24/24.

## 5. Humo después (solo lectura)
- Ledger: exactamente 1 fila `169` con `name = club_retos`; check «Supabase Preview» en success con «All migrations are up
  to date».
- `select count(*) from club_retos` = 0; `select retos_exige_factura from club_config_global` = true.
- Triggers presentes (`pg_trigger`): `club_retos_visita_trg` y `club_retos_reglas_trg`.
- `has_function_privilege('authenticated','public.club_reto_en_visita(uuid,text)','EXECUTE')` = true;
  `has_function_privilege('anon','public.club_portal_retos(text)','EXECUTE')` = true.
- `club_visitas_socio`: mismo conteo que antes (más las visitas reales del rato).

## 6. Criterios de parada
Cualquier diferencia con §5, un error de Branching o una visita que no se registra en caja después del merge → se para,
se avisa y se evalúa el §7.

## 7. Vuelta atrás
- Sin premios ganados: `scripts/sql/169_rollback.sql` y, **en el mismo momento**, un PR que saca el `.sql` de `main`
  (skill §6). Antes, el revert del código (caja y club-web); la caja sigue igual sin la 169 (el paso del reto es opcional).
- Con premios ganados: no se borra. Se **terminan** los retos y se arregla con una migración nueva.

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
