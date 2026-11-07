select json_build_object('caso', '03 vencer contra canje', 'saldo', s, 'ok', s = 6) from (select sum(personas) s from club_movimientos where miembro_id = '00000000-0000-4000-8000-0000000c0003') x;
