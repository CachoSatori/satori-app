-- CLUB-AUD-70: s1 guarda el cursor en 900 y tarda en confirmar; s2 guarda 400 en el medio. Tiene que quedar 900.
begin; set local role service_role;
select public.club_pase_cursor_guardar('apple', 900);
select pg_sleep(3);
commit;
