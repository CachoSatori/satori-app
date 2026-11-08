-- Borra todo lo sintético de las carreras (nombres «Carrera …», facturas 99095x). Como postgres.
begin;
set local club.libro_mantenimiento = 'pruebas';   -- el libro es de solo inserción: borrar lo sintético se declara
delete from club_codigos_canje where miembro_id in (select id from club_miembros where nombre like 'Carrera %');
delete from club_alertas where miembro_id in (select id from club_miembros where nombre like 'Carrera %');
delete from club_canje_intentos where miembro_id in (select id from club_miembros where nombre like 'Carrera %');
delete from club_auditoria where objeto_id in (select id from club_miembros where nombre like 'Carrera %');
delete from club_miembro_roles where miembro_id in (select id from club_miembros where nombre like 'Carrera %');
delete from club_pase_eventos where miembro_id in (select id from club_miembros where nombre like 'Carrera %');
delete from club_movimientos where miembro_id in (select id from club_miembros where nombre like 'Carrera %');
delete from club_cupones where referente_id in (select id from club_miembros where nombre like 'Carrera %');
delete from club_miembros where nombre like 'Carrera %';
delete from club_pase_cursor where nombre = 'apple' and ultimo_id in (400, 900);   -- carrera 17 (B todavía no usa «apple»)
delete from pos_ndf_tickets where local = 'santa-teresa' and numero_factura like '99095_' and length(numero_factura) = 6;
commit;
