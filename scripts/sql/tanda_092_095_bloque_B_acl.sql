-- BLOQUE B · respaldo del ACL de las 20 tablas (lo pide la 094; es la consulta 1.2b del PASE-089). SOLO LECTURA.
-- Correr (a) y (b) por separado: el editor muestra el resultado de la última sentencia. Guardar las 20 filas de (a) fuera
-- del repo y anotar los dos sha256 de (b).
-- (a) el ACL tal cual, tabla por tabla
select c.relname, c.relacl::text as relacl
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relname in ('accounting_entries','cash_movements','cash_sessions','credit_applications','movement_deletions',
     'movement_edits','pos_ndf_cursor','pos_ndf_open','pos_ndf_ticket_lines','pos_ndf_tickets','product_map','sops',
     'supplier_credits','suppliers','tip_entries','tip_sessions','ventas_comps','ventas_dias','ventas_hist','ventas_metas')
 order by 1;
-- (b) sus dos huellas: la del texto tal cual y la normalizada (permiso por permiso, ordenada)
with lista(t) as (values ('accounting_entries'),('cash_movements'),('cash_sessions'),('credit_applications'),
  ('movement_deletions'),('movement_edits'),('pos_ndf_cursor'),('pos_ndf_open'),('pos_ndf_ticket_lines'),('pos_ndf_tickets'),
  ('product_map'),('sops'),('supplier_credits'),('suppliers'),('tip_entries'),('tip_sessions'),('ventas_comps'),
  ('ventas_dias'),('ventas_hist'),('ventas_metas')),
acl as (
  select c.relname, c.relacl::text as relacl,
         (select string_agg(coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type || ':' || a.is_grantable,
                            ',' order by 1) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a) as normalizado
    from lista join pg_class c on c.oid = to_regclass('public.' || lista.t))
select count(*) as tablas,
       encode(sha256(convert_to(string_agg(relname || '|' || coalesce(relacl, '(null)'), E'\n' order by relname), 'UTF8')), 'hex') as sha256_relacl,
       encode(sha256(convert_to(string_agg(relname || '|' || normalizado, E'\n' order by relname), 'UTF8')), 'hex') as sha256_normalizado
  from acl;
