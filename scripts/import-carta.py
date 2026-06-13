#!/usr/bin/env python3
"""
Importa la carta real (import/productos.csv) a STAGING (product_map + pos_prices).
Idempotente: re-correr NO duplica ni pisa el estado activo de productos ya revisados.

Reglas (sprint carta-real):
  - Match por nombre case-insensitive + trim contra product_map.
  - Match  → actualiza precio_final + costo + categoría/subcategoría; conserva is_active.
  - No-match → inserta el producto como INACTIVO (is_active=false) para revisión en el Gestor.
  - Impuesto: IVA 13% para todos. Servicio 10%: flag = (sugerencia_servicio_10 == 'SI').
  - precio_final_iva_incl == 0 (cortesías/dueños/personal) → SIN precio (null) e inactivo.
  - precio_final_iva_incl YA es el precio FINAL con IVA incluido — NO se vuelve a multiplicar.

Método: una sola transacción vía Management API (sb.q) con tabla TEMP + operaciones
set-based. No es DDL de esquema → no se registra en schema_migrations (es carga de datos).

Uso:  python3 scripts/import-carta.py
"""
import csv, os, sys

sys.path.insert(0, '/tmp')
from sb import q  # helper Management API (STAGING)

STAGING = 'hwiatgicyyqyezqwldia'
LOC = 'santa-teresa'
CSV = os.path.join(os.path.dirname(__file__), '..', 'import', 'productos.csv')

def esc(s: str) -> str:
    return (s or '').replace("'", "''").strip()

def main():
    rows = list(csv.DictReader(open(CSV)))
    # Construye los VALUES de la tabla temporal
    vals = []
    for r in rows:
        nombre = esc(r['nombre'])
        if not nombre:
            continue
        cat = esc(r['categoria'])
        sub = esc(r['subcategoria'])
        try:
            costo = float(r['costo']) if r['costo'].strip() not in ('', '0') else 0
        except ValueError:
            costo = 0
        try:
            pf = float(r['precio_final_iva_incl']) if r['precio_final_iva_incl'].strip() else 0
        except ValueError:
            pf = 0
        precio = 'null' if pf <= 0 else str(round(pf, 2))
        servicio = 'true' if r['sugerencia_servicio_10'].strip().upper() == 'SI' else 'false'
        vals.append(f"('{nombre}','{cat}','{sub}',{round(costo,2)},{precio},{servicio})")

    values_sql = ',\n'.join(vals)
    sql = f"""
do $$ begin end $$;  -- placeholder
create temp table _carta (nombre text, categoria text, subcategoria text, costo numeric, precio_final numeric, servicio boolean) on commit drop;
insert into _carta (nombre, categoria, subcategoria, costo, precio_final, servicio) values
{values_sql};

-- 1) MATCH: actualizar ficha (conserva is_active del producto existente)
update public.product_map pm set
  tipo = c.categoria,
  subclasificacion = c.subcategoria,
  costo_unitario = c.costo,
  aplica_servicio = c.servicio,
  updated_at = now()
from _carta c
where upper(trim(pm.nombre)) = upper(trim(c.nombre));

-- 2) NO-MATCH: insertar como INACTIVO para revisión
insert into public.product_map (nombre, tipo, clasificacion, subclasificacion, costo_unitario, aplica_servicio, is_active)
select c.nombre, c.categoria, '', c.subcategoria, c.costo, c.servicio, false
from _carta c
where not exists (select 1 from public.product_map pm where upper(trim(pm.nombre)) = upper(trim(c.nombre)));

-- 3) PRECIOS: upsert en pos_prices (IVA 13%); precio null cuando precio_final es null
insert into public.pos_prices (product_name, location_id, price_final_crc, tax_type, is_demo)
select pm.nombre, '{LOC}', c.precio_final, 'iva13', false
from _carta c
join public.product_map pm on upper(trim(pm.nombre)) = upper(trim(c.nombre))
on conflict (product_name, location_id) do update
  set price_final_crc = excluded.price_final_crc, tax_type = 'iva13', is_demo = false, updated_at = now();
"""
    print(f"Importando {len(vals)} productos a STAGING…")
    res = q(STAGING, sql)
    print('resultado SQL:', res)

    # Reporte
    print('\n— Verificación —')
    print('product_map total:', q(STAGING, "select count(*) from product_map"))
    print('pos_prices santa-teresa:', q(STAGING, f"select count(*) from pos_prices where location_id='{LOC}'"))
    for n, exp in [('COCA COLA', 1900), ('PILSEN', 2800), ('MOJITO', 5800), ('COPA MERLOT', 4000)]:
        got = q(STAGING, f"select price_final_crc from pos_prices p join product_map m on m.nombre=p.product_name where upper(trim(m.nombre))='{n}' and p.location_id='{LOC}'")
        print(f"  spot-check {n}: {got}  (esperado {exp})")

if __name__ == '__main__':
    main()
