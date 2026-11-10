# 089 (anon sin permisos que ninguna política justifique) — prueba en staging, 08-nov 23:41 CR · ✅ 7/7, descartada

La 089 (`d59d3a9`) aplicada dentro de UNA transacción con ROLLBACK, con `scripts/sql/089_pruebas.sql` adentro
(sin el caso «ledger: la 089 registrada», que solo vale con la migración aplicada de verdad):
1. ✅ anon sin TRUNCATE/REFERENCES/TRIGGER en la lista.
2. ✅ anon sin SELECT/INSERT/UPDATE/DELETE que ninguna política justifique.
3. ✅ PUBLIC sin ningún permiso en la lista (anon no hereda nada).
4. ✅ Son 23 tablas.
5. ✅ authenticated conserva SELECT en todas.
6. ✅ service_role conserva todo.
7. ✅ RLS sigue prendida en todas.

Después de descartar: anon sigue con sus permisos de antes (verificado: TRUNCATE en `cash_movements` y SELECT en
`sops`), o sea que no quedó aplicada. Sigue sin firma; va después de la 085.

## ✅ Aplicada en staging — 09-nov, 08:27 CR (firmada por el dueño para staging)
- Previo: sin consultas ajenas en staging; último commit del Club hace 28 min. La sesión del Club no trabajó en
  staging durante la aplicación.
- `scripts/sql/089_pruebas.sql` ANTES: 3 fallas esperadas (anon con TRUNCATE/REFERENCES/TRIGGER y permisos sin
  política; la 089 no estaba en el ledger) y 5 OK.
- Aplicación: UNA transacción con la 089 (`d59d3a9`) y su fila del ledger (md5 `88ecdc81…` = el archivo).
- `089_pruebas.sql` DESPUÉS: **8/8 OK**. Ledger de staging 84 / 089.
- Después se aplicó la 090 y corrió la batería del Club: **580/580**, prueba 82 **4/4** («fuera del Club: … conocidas:
  0»). Ver `docs/pases/GATE-090-catalogo.md` (rama `claude/anon-default-privs`).
