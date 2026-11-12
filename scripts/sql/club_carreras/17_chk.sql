select json_build_object('caso', '17 cursor del pase: dos sincronizaciones a la vez → queda el máximo',
  'ultimo_id', (select ultimo_id from club_pase_cursor where nombre = 'apple'),
  'ok', (select ultimo_id = 900 from club_pase_cursor where nombre = 'apple'));
