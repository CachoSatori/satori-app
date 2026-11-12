# Plan · cerrar el CRM viejo (CLUB-AUD-64 / LC-DES-09)

> **Solo el plan. Toca RLS de prod: no se ejecuta nada sin la firma de Ismael.** Diagnóstico hecho en STAGING (solo
> lectura, 08-nov). Antes de firmar, se repite la misma lectura en prod (consulta del paso 0).

## Diagnóstico (staging)
| Tabla | RLS | `anon` | `authenticated` | Policies |
|---|---|---|---|---|
| `customers` | sí | **SELECT** con grant (hoy 0 filas: la policy es `to public` con `get_my_role()`, que para anon da null) | SELECT, INSERT, UPDATE, DELETE | `crm_gestionan_clientes` (ALL, **owner, manager y cajero**, **sin WITH CHECK**) · `crm_ver_clientes` (SELECT, + contador) |
| `customer_interactions` | sí | **SELECT** con grant | todo | `crm_gestionan_interacciones` (ALL, owner, manager y cajero, sin WITH CHECK) · `crm_ver_interacciones` (SELECT, + contador) |
| `loyalty_config`, `loyalty_rewards` | sí | **SELECT** con grant | todo | lectura del staff, edición owner y manager |

Riesgos:
- El cajero y el contador ven teléfono, email y fecha de nacimiento de los clientes. La regla del Club es que eso lo ve
  solo gerencia.
- El cajero edita y borra clientes.
- Las policies `ALL` no tienen `WITH CHECK` explícito: en un UPDATE vale la misma condición `USING`. Para un
  INSERT o UPDATE no hay control propio.
- `anon` conserva el grant de lectura: depende de que `get_my_role()` siga devolviendo null, en vez de no tener permiso.

Datos: 2 clientes, 1 interacción, 1 config, 4 premios (staging). El módulo CRM está pausado (`REGISTRO_PUBLICO_ACTIVO=false`).

## Plan (una migración aparte, NO la 075; número a reservar cuando se firme)
0. **Lectura en prod** (sin escribir): el mismo cuadro de arriba, más `count(*)` de cada tabla.
1. **Export de respaldo** de las 4 tablas (CSV) a un lugar fuera de Supabase.
2. `revoke all on public.customers, public.customer_interactions, public.loyalty_config, public.loyalty_rewards from anon;`
3. **`customers` y `customer_interactions`: solo owner y manager.**
   - Borrar `crm_gestionan_*` y `crm_ver_*`.
   - Crear:
     - `crm_clientes_gerencia` (SELECT, INSERT, UPDATE y DELETE **to authenticated**), con
       `USING (get_my_role() in ('owner','manager'))` y el **mismo `WITH CHECK`**;
     - lo mismo para `customer_interactions`.
   - Cajero y contador: sin acceso.
4. `loyalty_*`: lectura y escritura solo owner y manager (o borrarlas, si el Local Club las reemplaza; lo decide Ismael).
5. **Front:** `src/shared/api/crm.ts` y `ClientesModule` dejan de mostrarse a cajero y contador (ya está pausado; se
   esconde la tarjeta para esos roles).
6. **Verificación:**
   - como cajero: `select count(*) from customers` → 0 o permiso denegado;
   - como anon: permiso denegado;
   - como owner: igual que antes.
7. **Rollback:** recrear las 4 policies viejas y los grants (el script queda junto a la migración).
8. **Después del piloto del Local Club:** decidir si se borran las 4 tablas (export firmado antes).
