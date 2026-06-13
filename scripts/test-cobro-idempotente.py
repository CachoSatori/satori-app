#!/usr/bin/env python3
"""
Test de concurrencia/idempotencia del cobro (mig 033) contra STAGING.
Reproduce los escenarios que el unit-test (puro) no puede cubrir porque tocan la DB.
Asevera y limpia sus datos de prueba. Uso:  python3 scripts/test-cobro-idempotente.py

Escenarios:
  1) Cobro normal de orden entera → 1 fila de pago, mesa cerrada.
  2) Doble-tap (mismo client_op_id) → idempotente, SIGUE habiendo 1 fila.
  3) Otra caja (otro client_op_id) sobre cuenta ya cobrada → ERROR claro, sin fila nueva.
  4) Split: 2 checks → 2 pagos legítimos (uno por check); doble-tap de un check colapsa;
     otra caja sobre check pagado → ERROR; la mesa cierra al pagar el último.
"""
import sys
sys.path.insert(0, '/tmp')
from sb import q

R = 'hwiatgicyyqyezqwldia'
fails = []

def check(name, cond):
    print(('  ✓ ' if cond else '  ✗ ') + name)
    if not cond:
        fails.append(name)

def is_err(res):
    return isinstance(res, dict) and 'message' in res

def main():
    owner = q(R, "select id from profiles where role='owner' and is_active limit 1")[0]['id']
    jwt = "select set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, true);" % owner

    def fresh(name):
        tid = q(R, f"select id from salon_tables where location_id='santa-teresa' and name='{name}' limit 1")[0]['id']
        for o in q(R, f"select id from pos_orders where table_name='{name}' and status in ('open','closed','merged')"):
            q(R, f"delete from pos_payments where order_id='{o['id']}'"); q(R, f"delete from pos_checks where order_id='{o['id']}'")
            q(R, f"update pos_orders set status='cancelled' where id='{o['id']}'")
        return q(R, f"insert into pos_orders (location_id,table_id,table_name,opened_by,salonero_name,current_salonero_id,pax,channel,status) values ('santa-teresa','{tid}','{name}','{owner}','Test','{owner}',2,'salon','open') returning id")[0]['id']

    # ── Escenario orden entera ──
    print('Orden entera:')
    oid = fresh('Mesa 17'); cop = 'd0000000-0000-0000-0000-000000000001'
    r1 = q(R, jwt + f" select public.pos_cobrar_orden('{oid}','{cop}','efectivo',10000,'CRC',null,10000,0,0,0,'CRC','','{owner}')")
    check('cobro normal no es error', not is_err(r1))
    r2 = q(R, jwt + f" select public.pos_cobrar_orden('{oid}','{cop}','efectivo',10000,'CRC',null,10000,0,0,0,'CRC','','{owner}')")
    check('doble-tap (mismo cop) es idempotente', (not is_err(r2)) and r2[0]['pos_cobrar_orden']['idempotent'] is True)
    r3 = q(R, jwt + f" select public.pos_cobrar_orden('{oid}','d0000000-0000-0000-0000-000000000002','tarjeta',10000,'CRC',null,0,0,0,0,'CRC','','{owner}')")
    check('otra caja sobre cuenta cobrada → ERROR', is_err(r3) and 'ya fue cobrada' in r3['message'])
    n = q(R, f"select count(*) c from pos_payments where order_id='{oid}'")[0]['c']
    check('queda UNA sola fila de pago', int(n) == 1)
    check('mesa cerrada una vez', q(R, f"select status from pos_orders where id='{oid}'")[0]['status'] == 'closed')

    # ── Escenario split (2 checks) ──
    print('Split (2 checks):')
    oid = fresh('Mesa 18')
    c1 = q(R, f"insert into pos_checks (order_id,idx,label,kind,amount_crc) values ('{oid}',1,'C1','even',5000) returning id")[0]['id']
    c2 = q(R, f"insert into pos_checks (order_id,idx,label,kind,amount_crc) values ('{oid}',2,'C2','even',5000) returning id")[0]['id']
    a1 = q(R, jwt + f" select public.pos_cobrar_check('{c1}','{oid}','e0000000-0000-0000-0000-000000000001','efectivo',5000,'CRC',null,5000,0,0,0,'CRC','','{owner}')")
    check('check1 cobrado, mesa NO cierra aún', (not is_err(a1)) and a1[0]['pos_cobrar_check']['order_closed'] is False)
    a1b = q(R, jwt + f" select public.pos_cobrar_check('{c1}','{oid}','e0000000-0000-0000-0000-000000000001','efectivo',5000,'CRC',null,5000,0,0,0,'CRC','','{owner}')")
    check('doble-tap check1 idempotente', (not is_err(a1b)) and a1b[0]['pos_cobrar_check']['idempotent'] is True)
    a1c = q(R, jwt + f" select public.pos_cobrar_check('{c1}','{oid}','e0000000-0000-0000-0000-000000000099','tarjeta',5000,'CRC',null,0,0,0,0,'CRC','','{owner}')")
    check('otra caja sobre check pagado → ERROR', is_err(a1c) and 'ya fue cobrada' in a1c['message'])
    a2 = q(R, jwt + f" select public.pos_cobrar_check('{c2}','{oid}','e0000000-0000-0000-0000-000000000002','tarjeta',5000,'CRC',null,0,0,0,0,'CRC','','{owner}')")
    check('check2 cobrado → mesa cierra', (not is_err(a2)) and a2[0]['pos_cobrar_check']['order_closed'] is True)
    n = q(R, f"select count(*) c from pos_payments where order_id='{oid}'")[0]['c']
    check('split legítimo = DOS filas de pago', int(n) == 2)

    # ── limpieza ──
    for nm in ['Mesa 17', 'Mesa 18']:
        for o in q(R, f"select id from pos_orders where table_name='{nm}' and created_at > now() - interval '1 hour'"):
            q(R, f"delete from pos_payments where order_id='{o['id']}'"); q(R, f"delete from pos_checks where order_id='{o['id']}'")
            q(R, f"update pos_orders set status='cancelled' where id='{o['id']}'")

    print('\n' + ('❌ FALLARON: ' + ', '.join(fails) if fails else '✅ TODOS LOS ESCENARIOS PASARON'))
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
