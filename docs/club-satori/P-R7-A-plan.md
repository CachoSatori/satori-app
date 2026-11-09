# P-R7-A (CLUB-AUD-71 residual) · socio → anfitrión solo por `club_rol_activar_anfitrion` — diagnóstico y plan

> Grok r7, 09-nov. **Solo diagnóstico y plan: no se cambió nada.** Se espera el OK del dueño para implementarlo.

## 1. Diagnóstico: por dónde puede hoy un socio pasar a ser anfitrión

| # | Vía | Quién | Con nota y rastro propio | Estado |
|---|---|---|---|---|
| 1 | `club_rol_activar_anfitrion(miembro, rol, nota)` (075, ~4252) | owner, manager | **Sí**: nota de 5 a 300 caracteres, `alta_por = 'gerencia'`, `validado_por/en`, `club_auditar('activar_anfitrion', …, {rol, nota})`; exige la cuenta activa y que no sea ya anfitrión | La vía buena |
| 2 | **`club_miembro_guardar(p_id = <socio>, p_tipo = 'referente' \| 'concierge_pm' \| 'equipo', …)`** (075, ~1974; pantalla Miembros → editar) | owner, manager | **No**: hace `update club_miembros set tipo = p_tipo` y el trigger `club_roles_desde_miembro` (cambio de `tipo` sin anfitrión viejo) **inserta el rol de anfitrión activo** con `alta_por = 'app'`, sin nota. Solo queda el rastro genérico de edición del miembro | **El residuo** |
| 3 | Un `update club_miembros set tipo = …` directo (SQL con service_role o postgres: scripts, migrador, consola) | quien tenga la base | No: el mismo trigger crea el rol | La app no puede (`authenticated` no tiene `UPDATE`); quedan las herramientas |
| 4 | `insert` de una persona NUEVA con tipo de anfitrión (`club_miembro_guardar` sin `p_id`, migrador) | owner, manager, migrador | El alta queda en la auditoría | No convierte a un socio: crea otra persona. El cruce por teléfono es otro tema (una persona, un pase) |
| 5 | Cambio entre tipos de anfitrión (referente ↔ concierge_pm ↔ equipo) por `club_miembro_guardar` | owner, manager | No | No es socio → anfitrión: fuera de este punto |

No hay más caminos. Una búsqueda en la 075 de `insert into public.club_miembro_roles` y `set tipo` da solo el trigger, la
función de la vía 1, el alta de socios y la vía 2. `authenticated` tiene `SELECT` en `club_miembro_roles` y ningún
permiso de escritura en `club_miembros` ni en `club_miembro_roles`.

## 2. Plan (propuesto; espera el OK)
1. **En la base, un candado único** en `club_roles_desde_miembro`: si un `UPDATE` cambia `tipo` de algo que no es
   anfitrión a un tipo de anfitrión y el rol de anfitrión **todavía no existe**, `raise` («Para hacerlo anfitrión usá
   "Activar como anfitrión", con la nota»).
   - `club_rol_activar_anfitrion` ya inserta el rol **antes** de cambiar el `tipo`: con el rol ya puesto, el trigger no
     hace nada y pasa.
   - Cierra las vías 2 y 3 juntas, también para cualquier función futura, sin depender de cada una.
   - El cambio entre tipos de anfitrión (vía 5) y el alta de una persona nueva (vía 4) no cambian.
2. **En `club_miembro_guardar`**: con `p_id` de una persona sin rol de anfitrión, error claro antes de tocar nada. Así la
   pantalla muestra el motivo y no el error del trigger.
3. **En la app (Miembros)**: el selector de tipo no ofrece tipos de anfitrión para un socio. La acción visible es
   «Activar como anfitrión», que ya existe.
4. **Pruebas** (batería, nuevas), cada una con su mutación «falla sin el arreglo» en `mutaciones_r7.json`:
   - socio → `club_miembro_guardar(p_tipo = 'referente')` → rechazado; roles y `tipo` sin cambios;
   - socio → `update club_miembros set tipo = 'referente'` como dueño de la tabla → rechazado por el trigger;
   - socio → `club_rol_activar_anfitrion` con nota → anfitrión, con `alta_por = 'gerencia'` y el rastro
     `activar_anfitrion` con la nota;
   - control: referente → equipo por `club_miembro_guardar` sigue andando;
   - control: alta de un anfitrión nuevo sigue andando.
5. **Docs:** la guía 6.13 (Miembros: cómo se activa un anfitrión) en el mismo PR. Esta tabla pasa a IDS-AUDITOR.md
   con el SHA.

**Riesgo:** algún script de staging o el ensayo del migrador que cambie el `tipo` de un socio existente. La primera carga
corre sobre una base vacía, así que no lo hace. Se corre todo (batería, migrador, papel) con el candado puesto antes de
cerrar.

## 3. Aparte (hallazgo propio, sin tocar): CLAUDE-HALL-05
`authenticated` tiene el privilegio **MAINTAIN** en 75 tablas de `public`; 10 son del Club (`club_miembros`,
`club_movimientos`, `club_config`, …). Es el default de Supabase con PostgreSQL 17. MAINTAIN permite `VACUUM`,
`ANALYZE`, `REINDEX`, `CLUSTER`, `REFRESH` y `LOCK TABLE`. Por PostgREST no se puede usar: la app no corre SQL suelto, y
ninguna función del Club ejecuta SQL dinámico con datos del usuario. Propuesta, aparte y con su OK:
`revoke maintain on all tables in schema public from authenticated, anon` y una prueba que lo controle, como la 82.
