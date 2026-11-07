-- Borra todo lo sintético de las carreras (nombres «Carrera …», facturas 99095x). Como postgres.
begin;
delete from club_movimientos where miembro_id in (select id from club_miembros where nombre like 'Carrera %');
delete from club_cupones where referente_id in (select id from club_miembros where nombre like 'Carrera %');
delete from club_miembros where nombre like 'Carrera %';
delete from pos_ndf_tickets where local = 'santa-teresa' and numero_factura like '99095_' and length(numero_factura) = 6;
commit;
