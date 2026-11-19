# Pase a PROD de la mig 186 `club_cumple_deshacer_envio` (origen club 130)

> **⛔ Esquema: firma del dueño sobre el SHA exacto.** Backlog del Club firmado el 16-nov (arreglo 1 de 4): el owner
> puede deshacer la marca «enviado» del saludo de cumpleaños, con nota. Si algo no coincide, **se para y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Orden obligatorio:** **186 → 187 → 188**, un merge por vez, cada uno con su §5 en verde antes del siguiente. La 186
>   va primero: Branching rechaza una versión menor que la última aplicada (R16).
> - **Ledger:** exactamente 1 fila `186` con su `name`.
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§4 y §5).

## 1. Qué pasa y qué no
**Pasa:** tres funciones **nuevas** (no reemplaza ninguna; R13 no aplica):
- `club_cumple_enviados_lista(text, date)` (interna, sin EXECUTE para la API): los socios del local con la marca del año
  dentro de la ventana; complemento exacto de la lista del Inicio.
- `club_cumple_enviados(text)` (API, solo owner): «Ya saludados» en el Inicio.
- `club_cumple_deshacer_envio(uuid, text, text)` (API, solo owner): nota de 3 a 500 letras; borra la marca del año bajo
  el candado del socio y audita `cumple_deshacer_envio` (fila borrada + nota). Manager, cajero, contador, anon: 42501.
- App: «Ya saludados» con «Deshacer» en el Inicio (owner); guías 6.13 y 6.1 al día.

**No pasa:** `club_cumple_marcar` / `club_cumple_enviar`, la lista del Inicio, el beneficio de cumpleaños (175), RLS,
datos, sagrados. La fecha del pase de Wallet (`club_pases.actualizado_en`) queda como está (decisión del dueño 17-nov).

## 2. Prerrequisitos
- Prod el 17-nov (solo lectura): ledger **185**; existen `club_cumple_proximo`, `club_cumple_cfg`, `club_exigir_local`,
  `club_auditar`; no existe ninguna de las tres funciones; `club_cumple_envios` con 0 filas.

## 3. Pruebas (antes de aplicar, R15)
- `scripts/sql/186_pruebas.py --local … --semilla-local` sobre Postgres 16 local (sin la 186): **11/11** en transacción
  descartada. `--mutar todas`: **6/6 muerden** (`sin_owner`, `sin_nota`, `sin_auditoria`, `sin_local`,
  `lista_sin_marca`, `lista_otro_local`).

## 4. Antes del merge (prod, solo lectura, `begin read only` … `rollback`)
- Ledger: última = **185**. Si no, **no se mergea**.
- `to_regprocedure` de las tres funciones = null; las cuatro de §2 presentes.
- Anotar `count(*)` de `club_cumple_envios` y de `club_auditoria where accion = 'cumple_deshacer_envio'`.

## 5. Después del merge (prod, solo lectura)
- Ledger: 1 fila `186` / `club_cumple_deshacer_envio`; check «Supabase Preview» en success.
- Las tres funciones existen; EXECUTE de `authenticated` solo en `club_cumple_enviados` y `club_cumple_deshacer_envio`;
  `anon` sin EXECUTE en ninguna; la interna cerrada.
- **Humo:** los dos conteos de §4 **iguales** (la migración no toca datos). `club_cumple_enviados('<local>')` como owner
  responde sin error.

## 6. Criterios de parada
- Ledger distinto de 185 o alguna función ya existe: **no se mergea** (la 186 abortaría sin tocar nada).
- Branching en rojo o §5 distinto: se para, se avisa y se decide la vuelta atrás. No se arregla a mano.

## 7. Vuelta atrás
`scripts/sql/186_rollback.sql` (borra las tres funciones y la fila `186`; no toca datos: las marcas deshechas quedan en
`club_auditoria`). **En el mismo momento**, un PR que saca el `.sql` de `main` (regla 10) y revierte la app. Si ya
entraron la 187 o la 188, primero sus rollback (188 → 187 → 186).

## 8. Firma y bitácora
| Cuándo (-06:00) | Quién | Qué |
|---|---|---|
| 2026-11-16 | dueño | Firma el backlog del Club (arreglo 1 de 4) |
| | dueño | Firma de esquema sobre el SHA exacto (OK de merge) |
| | control | §4 y §5 |
