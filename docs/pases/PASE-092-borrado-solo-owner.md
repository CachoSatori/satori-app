# Paquete de firma · 092 — solo el owner borra un empleado con login del PoS

> **Estado: espera la firma del dueño. No se aplica en prod sin ella.**
> Rama `claude/employees-borrado-owner`. Migración `supabase/migrations/092_employees_borrado_solo_owner.sql`.

## 1. Qué cambia, en simple

- **Hoy:** un manager puede borrar la ficha de un empleado. Si esa ficha tiene el login del PoS y todavía no tiene
  propinas, se borra sin dejar rastro. Con eso se pierde el vínculo entre el login y la persona (ventas, ranking).
  Al 09-nov, eso puede pasar con 2 de los 15 empleados que tienen login.
- **Con la 092:**
  1. Solo el owner puede borrar un empleado que tiene login del PoS. Si lo intenta otro, la base responde «Solo el
     owner borra un empleado con login del PoS. Para sacarlo, desactivalo.» y no borra nada.
  2. Cada borrado que sí pasa deja una copia de la ficha en una tabla nueva, `employee_bajas`, con quién y cuándo.
     Solo el owner la puede leer. Nadie puede escribirla a mano.
- **Qué no cambia:**
  - Desactivar sigue igual. Es el camino normal para sacar a alguien.
  - La app no tiene botón de borrar empleados, así que nadie ve un cambio en pantalla.
  - No se tocan las columnas de `employees`, ni su política, ni las propinas.
  - No toca dinero ni archivos sagrados.

## 2. La prueba en staging

Script `scripts/sql/092_pruebas.sh`. Corre solo en staging, y cada caso va en una transacción que se descarta, así
que la 092 **no** queda aplicada.

| Caso | Esperado |
|---|---|
| manager borra un empleado **con** login | rechazado (42501), 0 borrados, 0 en el registro |
| manager borra un empleado **sin** login | se borra, 1 en el registro, con autor |
| owner borra un empleado con login | se borra, 1 en el registro, con autor |
| owner **inactivo** | no puede (0 borrados) |
| cajero | no puede (0 borrados) |
| canal admin (sin usuario) | se borra, 1 en el registro, sin autor |
| anónimo lee el registro | sin permiso |
| la consulta de verificación (§4) con la 092 puesta | todo en orden, sin fila del ledger (es una prueba) |
| la consulta de verificación sin la 092 | todo vacío |
| la vuelta atrás | sin tabla, sin trigger, sin función |

**Resultado:** corre en la ventana de staging del 09-nov a las 23:35 CR. Se anota acá, en el §6.

## 3. Cómo se aplica (con la firma)

1. **Orden:** la 092 entra **después** de la 085 y de cualquier otra migración de número menor que vaya a prod antes.
   Branching puede negarse a aplicar una migración con número menor que la última ya aplicada. Hoy el ledger de prod
   llega hasta la 082.
2. Correr en prod la consulta de verificación (§4), que es de solo lectura. Antes de aplicar tiene que dar todo
   `false`, `politicas: []` y `bajas: null`. Si algo ya existe, se frena.
3. Mergear la rama a `main`, con el OK del dueño y fuera de 17:00–23:00 CR. Branching aplica la 092 en prod y escribe
   su fila del ledger.
4. Volver a correr la consulta de verificación (§4). Tiene que dar:
   - `ledger_092: true`, `tabla: true`, `rls_tabla: true`;
   - `politicas: ["employee_bajas_select_owner:SELECT"]`;
   - `anon_sin_permisos: true`, `funcion_definer: true`, `funcion_no_publica: true`, `trigger_activo: true`;
   - `bajas: 0`.
5. Comprobar que el run de Branching dio «All migrations are up to date» o que aplicó la 092 sin error.

## 4. La consulta de verificación

Archivo `scripts/sql/092_verificacion.sql`. Es de solo lectura: lee el catálogo y un conteo, sin datos de personas.
Sirve igual antes y después de aplicar. La prueba de staging la corre en los dos estados.

## 5. Vuelta atrás

Al volver atrás se pierde el registro de bajas. Si tiene filas, el owner las exporta primero.

1. Correr en prod `scripts/sql/092_rollback.sql`, con firma. Quita el trigger, la función y la tabla, y borra la fila
   092 del ledger.
2. **Enseguida**, sin otro merge en el medio, mergear un PR que saque el archivo de la 092 de `main`. Si el archivo
   sigue en `main` sin su fila en el ledger, el próximo Branching la vuelve a aplicar.
3. Correr la consulta de verificación. Tiene que dar el estado de «antes» (§3 paso 2).

## 6. Resultados

- **Staging (ventana 09-nov 23:35 CR, `092_pruebas.sh` @ `26ecde5`, todo en transacciones descartadas): 10 OK · 0 FALLA ·
  VERDE.**
  - manager con login → 42501 y nada borrado; manager sin login, owner y canal admin → se borra con rastro (el canal
    admin sin autor); owner inactivo y cajero → 0 filas; anon no lee el registro (42501);
  - la consulta de verificación (§4) da lo esperado con la 092 puesta y sin ella; la vuelta atrás deja sin tabla, sin
    trigger y sin función.
- **Falla sin el arreglo (misma ventana, transacción descartada, sin la 092):** un manager borra un empleado con login
  del PoS → `ok`, 1 fila. Es el hueco que cierra la 092.
- **Estado de staging al terminar:** 0 empleados sintéticos, sin `employee_bajas` ni el trigger (la 092 **no** quedó
  aplicada), ledger sin cambios (85 filas, última 090), sin consultas ajenas.

## 7. Firma

- [ ] El dueño leyó el §1 y está de acuerdo con la regla.
- [ ] La prueba de staging está en verde (§6).
- [ ] La 085 ya está en prod (§3 paso 1).
- [ ] Fecha y hora del merge (fuera de 17:00–23:00 CR): ____
- [ ] Firma del dueño: ____
