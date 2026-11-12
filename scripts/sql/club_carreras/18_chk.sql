select json_build_object('caso', '18 diez intentos equivocados a la vez → no más de 5 anotados (CLUB-AUD-38)',
  'intentos', (select count(*) from club_canje_intentos where miembro_id = '00000000-0000-4000-8000-0000000c0016'),
  'ok', (select count(*) between 1 and 5 from club_canje_intentos where miembro_id = '00000000-0000-4000-8000-0000000c0016'));
