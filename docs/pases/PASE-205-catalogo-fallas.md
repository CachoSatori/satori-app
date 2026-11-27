# Pase a PROD de la mig 205 `pos_catalogo_fallas` (hallazgo 256: el catálogo ya no falla en silencio) — EN ESPERA DE FIRMA

Corto: contexto en [PASE-198](PASE-198.md) y la SPEC [3.1 §4.4](../ventas/SPEC-3.1-catalogo.md). Formato de `PASE-089`.
Vía: **merge → Branching** (nada a mano; sin Edge). Responsables: ejecución = sesión coordinadora del día · control = el
dueño (firma por chat sobre el SHA de cabeza). No es urgente (impacto medido hoy: 0, ver §2).

## 1. Qué pasa y qué no

- Tabla nueva `pos_catalogo_fallas`: una fila abierta por (local, código SQLSTATE, mensaje), con `veces`, `facturas`,
  `primera_en`, `ultima_en`, `resuelta_en/por`. RLS: owner y contador leen todo; manager, solo sus locales. Nadie
  escribe por la API.
- `pos_catalogo_registrar()` (el disparador de la 198) con `create or replace`: si `pos_catalogo_absorber` falla, además
  del WARNING de siempre anota la falla. **La ingesta manda:** si anotar también falla, otro WARNING y la factura entra.
- `pos_catalogo_reparar(p_local)` (SECURITY DEFINER): owner (null = todos los locales) y manager de su local. Misma regla
  de la 198 sobre toda la historia; cierra las fallas abiertas del local. Idempotente. Si la regla sigue rota, da el
  error y no cierra nada.
- No toca: `pos_ndf_*` (ni políticas ni el disparador), `pos_catalogo_absorber`, `pos_catalogo_refrescar`, la Edge
  `ingest-ndf`, el agente del PoS, sagrados. Sin pantalla todavía (choca con #374, 3.1b): va en un PR después de #374.

## 2. Lecturas previas en prod (solo lectura)

```sql
begin read only;
select (select max(version) from supabase_migrations.schema_migrations) as ledger,          -- 203 o 204
       (select md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public.pos_catalogo_registrar()'::regprocedure)    as reg, -- 85609c26…
       (select md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public.pos_catalogo_absorber(uuid[])'::regprocedure) as abs, -- 75d33295…
       to_regclass('public.pos_catalogo_fallas') as ya_205;                                  -- null
rollback;
```
Lectura del 26-nov ~18:30 CR: ledger 203 · `reg` 85609c26 y `abs` 75d33295 (= archivo de la 198) · disparador
habilitado · 704 productos · **0 códigos vendidos sin fila de catálogo · 0 con nombre o familia atrasados · 0 líneas
fuera de `visto_desde/hasta`**: el disparador no falló hasta hoy. Distinto en `reg`/`abs` = la guarda para el merge
(Branching falla): no mergear, avisar.

## 3. Orden

1. Batería 205 en staging por la sesión de CC del dueño (regla 14): `python3 scripts/sql/205_pruebas.py --psql
   "<staging>" --mutar todas` (20 casos, 21 mutaciones; termina en ROLLBACK). Local (Postgres 16) ya corrió: PR.
2. Firma por chat sobre el SHA de cabeza (Gate verde) + lecturas del §2.
3. Merge en ventana D1 (código → con OK). Branching aplica la 205.
4. Después (solo lectura): ledger con **una** fila `205` / `pos_catalogo_fallas` · `reg` = `9d79f682…` · tabla con RLS
   y 0 filas · `pos_catalogo_reparar` `prosecdef`, `EXECUTE` solo `authenticated` · disparador sigue habilitado ·
   siguen entrando facturas (latido del PoS) y `pos_productos` se mueve con ellas.

**Parada:** guarda de la 205 (md5) · el ledger no queda con una fila 205 · deja de entrar una factura.

## 4. Vuelta atrás

`scripts/sql/205_rollback.sql` en una transacción (deja el disparador EXACTO a la 198; borra `pos_catalogo_reparar` y la
tabla: antes, guardar sus filas fuera del repo) + PR que saca el `.sql` de `main` solo si la 205 no está en el ledger
(regla 10). Si ya está: migración nueva con el mismo contenido.

## 5. Firma y bitácora

| Cuándo (-06:00) | Qué | Quién |
|---|---|---|
| | | |
