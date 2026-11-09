# 087 (auditoría de employees) — prueba en staging, 08-nov 23:41 CR · ✅ 5/5, descartada

En UNA transacción con ROLLBACK (no quedó nada: ni la tabla, ni el trigger, ni el login de prueba):
1. ✅ Un owner (sesión simulada) cambia `pos_login` → 1 fila en `employee_edits` con `edited_by` = ese owner y solo
   `pos_login` en `changed`; un `update` que no cambia nada (`role = role`) no registra.
2. ✅ Canal admin (sin JWT): cambiar `is_active` deja traza con `edited_by` NULL.
3. ✅ anon no lee la tabla.
4. ✅ Nadie inserta a mano: no hay policy de INSERT/ALL.
5. ✅ Rollback: sin tabla, sin trigger y sin función.

Nota del test: después de `reset role` los claims del JWT siguen cargados en la transacción; para simular el canal
admin hay que limpiarlos (`set_config('request.jwt.claims', '', true)`). Sigue sin firma: no está aplicada.
