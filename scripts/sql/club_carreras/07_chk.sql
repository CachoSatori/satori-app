select json_build_object('caso', '07 baja contra cupón', 'estado', (select estado from club_miembros where id = '00000000-0000-4000-8000-0000000c0007'),
  'saldo', s, 'ok', s = 0 and (select estado from club_miembros where id = '00000000-0000-4000-8000-0000000c0007') = 'baja')
  from (select coalesce(sum(personas), 0) s from club_movimientos where miembro_id = '00000000-0000-4000-8000-0000000c0007') x;
