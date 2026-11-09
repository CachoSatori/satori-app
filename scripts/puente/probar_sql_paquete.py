#!/usr/bin/env python3
"""Prueba en STAGING el SQL que el paquete del pase tiene para pegar en PROD, SACADO DEL MISMO DOCUMENTO (no copias):
  1. la consulta C (§6.2) en solo lectura, con la base como está (antes de la 082: sin max_factura_vista);
  2. la consulta C con la 082 v2 de la rama aplicada y R de cada categoría (bajo, igual, no ordenable, fuera de
     ventana), en una transacción que termina en raise (no queda nada);
  3. los Anexos A.1–A.3 con su commit cambiado por rollback: en staging las tres precondiciones tienen que frenar.
Uso (desde la raíz): python3 -I scripts/puente/probar_sql_paquete.py   (token: el proxy)"""
import json, os, re, subprocess, sys
REF = 'hwiatgicyyqyezqwldia'
RAIZ = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()
DOC = open(os.path.join(RAIZ, 'docs/puente/PASE-PROD-2026-11-09.md'), encoding='utf-8').read()
F082 = open(os.path.join(RAIZ, 'supabase/migrations/082_pos_ndf_ingesta_transaccional.sql'), encoding='utf-8').read()

def sql(q, read_only=False):
    r = subprocess.run(['curl', '-sS', '-X', 'POST', f'https://api.supabase.com/v1/projects/{REF}/database/query',
                        '-H', f"Authorization: Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}", '-H', 'Content-Type: application/json',
                        '--data-binary', '@-'], input=json.dumps({'query': q, 'read_only': read_only}), capture_output=True, text=True)
    return json.loads(r.stdout)

bloques = re.findall(r"```sql\n(.*?)```", DOC, re.S)
C = next(b for b in bloques if b.startswith('-- consulta C'))
ok = mal = 0
def caso(nombre, cond, det=''):
    global ok, mal
    if cond: ok += 1; print('ok  ', nombre)
    else: mal += 1; print('MAL ', nombre, det)

r = sql(C, read_only=True)
caso('consulta C en solo lectura con la base actual (corre aunque falte max_factura_vista)', isinstance(r, list) and len(r) == 1, r)

T = ('{"numero_factura":"%s","fecha_registra":"%s","estado":"%s","canal":"salon","registrado_por":"cajero","con_servicio":true,'
     '"pax_nativo":2,"pax_articulo":2,"pax":2,"pax_alerta":"ok","total_crc":1000,"total_fuente":"provisorio","efectivo_crc":1000,'
     '"tarjeta_crc":0,"electronico_crc":0,"deposito_crc":0,"cheque_crc":0,"cxc_crc":0,"dolares_efectivo":0,"dolares_tarjeta":0,'
     '"vuelto_crc":0,"descuento_crc":0,"servicio_crc":0,"valor_servido_crc":0,"iva_crc":0,"regalia_crc":0}')
ahora = "now()"
lote = '[' + ','.join(T % (n, '%AHORA%', 'C') for n in ('101', '102', '104', '105')) + ',' + T % ('103', '%AHORA%', 'R') + ']'
viejas = '[' + ','.join([T % ('100', '%AHORA%', 'R'), T % ('99', '%VIEJO%', 'R'), T % ('A-1', '%AHORA%', 'R')]) + ']'
q = C.replace("'santa-teresa'", "'prueba-c'").rstrip().rstrip(';')
prueba = f"""begin;
{re.sub(r'(?im)^\s*(begin|commit)\s*;\s*$', '', F082)}
do $x$ declare o jsonb; a text := to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'); v text := to_char(now() - interval '4 days', 'YYYY-MM-DD"T"HH24:MI:SSOF'); begin
  set local role service_role;
  perform public.pos_ndf_ingestar('prueba-c', replace($j${lote}$j$, '%AHORA%', a)::jsonb, '[]', null, '{{}}');
  perform public.pos_ndf_ingestar('prueba-c', replace(replace($j${viejas}$j$, '%AHORA%', a), '%VIEJO%', v)::jsonb, '[]', null, null);
  update public.pos_ndf_tickets set estado = 'R' where local = 'prueba-c' and numero_factura = '102';
  reset role;
  select to_jsonb(z) into o from ({q}) z;
  raise exception 'RES:%', o;
end $x$;"""
m = re.search(r'RES:(\{.*?\})\\n', json.dumps(sql(prueba)))
res = json.loads(m.group(1).replace('\\"', '"')) if m else {}
caso('consulta C con la 082 v2 y R de cada categoría (bajo 2, igual 1, no ordenables 1, dentro 2, fuera 1, en orden numérico)',
     res.get('last_factura') == '102' and res.get('max_factura_vista') == '105' and res.get('r_bajo_corte') == 2
     and res.get('r_igual_corte') == 1 and res.get('r_no_ordenables') == 1 and res.get('bajo_dentro_ventana') == 2
     and res.get('bajo_fuera_ventana') == 1 and res.get('afectadas') == '99,100,102,A-1', res)

anexo = DOC[DOC.index('## Anexo A'):]
# Staging puede estar con la 082 original o con la v2 aplicada (ensayo del 08-nov: queda v2). Se mira cuál hay.
v2 = sql("select md5(statements[1]) m from supabase_migrations.schema_migrations where version = '082'", read_only=True)[0]['m'] == '292dd3aa8f7dfed676d10103870f5d21'
esperado = ['el md5 ya está bien', None if v2 else 'se esperaba UNA fila 082 con el md5 de la v2', 'la 082 sigue puesta']
for i, (b, e) in enumerate(zip(re.findall(r"```sql\n(.*?)```", anexo, re.S)[:3], esperado), 1):
    r = sql(b.replace('commit;', 'rollback;'))
    if e is None:   # con la v2 aplicada, A.2 pasa su precondición y hace su trabajo (todo termina en ROLLBACK)
        caso(f'Anexo A.{i}: con la v2 aplicada en staging, pasa la precondición y corre sin error (ROLLBACK)', r == [], r)
    else:
        caso(f'Anexo A.{i}: en staging la precondición frena («{e}»)', e in json.dumps(r, ensure_ascii=False), r)
# A.2 por el lado positivo: con la 082 v2 puesta y su fila con el md5 de la v2, saca la función y la fila (conteo 1)
a2 = re.findall(r"```sql\n(.*?)```", anexo, re.S)[1]
a2 = re.sub(r'(?im)^\s*(begin|commit|rollback)\s*;\s*$', '', a2)
pos = f"""begin;
{re.sub(r'(?im)^\s*(begin|commit)\s*;\s*$', '', F082)}
update supabase_migrations.schema_migrations set statements = array[$m${F082}$m$] where version = '082';
{a2}
do $x$ begin raise exception 'RES:%', jsonb_build_object(
  'fn', to_regprocedure('public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)') is not null,
  'fila', (select count(*) from supabase_migrations.schema_migrations where version = '082')); end $x$;"""
r = json.dumps(sql(pos))
caso('Anexo A.2 por el lado positivo (082 v2 + su fila): saca la función y la fila, y nada más', '\\"fn\\": false' in r and '\\"fila\\": 0' in r, r[:300])
r = sql("select (select count(*) from supabase_migrations.schema_migrations where version in ('081','082')) l, "
        "to_regprocedure('public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)') is not null fn, "
        "(select count(*) from information_schema.columns where table_name = 'pos_ndf_cursor' and column_name = 'max_factura_vista') col", read_only=True)
caso('staging quedó igual que antes de la prueba (081/082 en el ledger, la función, la columna según la 082 que haya)',
     r == [{'l': 2, 'fn': True, 'col': 1 if v2 else 0}], r)
print(f'pruebas: {ok} ok, {mal} mal'); sys.exit(1 if mal else 0)
