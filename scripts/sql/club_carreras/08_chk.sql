select json_build_object('caso', '08 mismo p_op en paralelo', 'canjes', n, 'ok', n = 1)
  from (select count(*) n from club_movimientos where client_op_id = '00000000-0000-4000-8000-0000000c00aa') x;
