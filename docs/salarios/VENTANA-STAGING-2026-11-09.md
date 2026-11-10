# 084 · ventana de staging del 09-nov (23:35 CR) — `084_pruebas.sh` CON y SIN

Solo staging (`hwiatgicyyqyezqwldia`). Cada caso en una transacción descartada; en SIN, el rollback de la 084 se aplica
**adentro** de cada transacción. Nada quedó aplicado ni deshecho. Sin datos personales ni detalles de error.

Antes de empezar (23:35): sin consultas ajenas activas en staging y sin commits del Club de menos de 5 minutos.

## 1. Primera corrida CON (script @ `4c938d2`): 8 OK · 2 FALLA — falla del SCRIPT, no de la 084
- Fallaron «owner activo» y «contador activo»: `guarda_tarifa` dio 42501 en vez de `ok`.
- **Causa:** el caso hacía el UPDATE con `EXECUTE` y después miraba `FOUND`. En PL/pgSQL, `EXECUTE` **no actualiza**
  `FOUND`, que quedaba en false, y el script tiraba su propio 42501 («sin filas») aunque el UPDATE sí había pasado.
- **Verificado a mano** (transacción descartada, como owner, la misma secuencia del script): el UPDATE toca **1 fila**.
  Los permisos de `authenticated` en `employee_payroll` y `employee_bank_info` están completos y las policies son las
  de la 084.
- **El mismo error daba un verde por la razón equivocada** en «manager activo: no guarda»: el 42501 salía del script,
  no de la RLS.
- **Arreglo del script:** `GET DIAGNOSTICS n = ROW_COUNT` después del `EXECUTE`; 0 filas = la RLS no lo dejó.

## 2. CON con el arreglo: 10 OK · 0 FALLA · VERDE
owner y contador ven y guardan tarifa y banco · manager ve la tarifa, no ve el banco y no guarda ninguno (ahora el 42501
lo pone la RLS: 0 filas) · manager inactivo, cajero y salonero nada · tarifa escrita en `employees` → 23514 (CHECK) ·
anon 42501 en las dos tablas · al terminar, la 084 sigue puesta y no quedó el sintético.

## 3. SIN (sin la 084, dentro de cada transacción): 3 OK · 0 FALLA · VERDE
- sin la 084, el manager **ve el banco** → la prueba «manager no lee banco» falla, como se espera;
- sin la 084, el cajero **ve la tarifa** → la prueba «cajero no lee tarifas» falla, como se espera;
- al terminar, la 084 sigue puesta y no quedó el sintético.

## Estado de staging al cerrar
0 empleados sintéticos (`00000000-0000-4000-8000-*`), la 084 puesta (las dos tablas), ledger sin cambios (85 filas,
última 090), sin consultas ajenas.
