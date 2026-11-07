select json_build_object('caso', '15 dos referentes, misma visita, otro camino', 'personas', s, 'ok', s = 3)
  from (select coalesce(sum(personas), 0) s from club_movimientos where miembro_id in ('00000000-0000-4000-8000-0000000c000a', '00000000-0000-4000-8000-0000000c000b')) x;
