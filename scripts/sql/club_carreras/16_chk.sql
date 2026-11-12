select json_build_object('caso', '16 mismo código de canje en paralelo (R-01)', 'canjes', n, 'ok', n = 1)
  from (select count(*) n from club_movimientos where miembro_id = '00000000-0000-4000-8000-0000000c0016' and tipo = 'canje') x;
