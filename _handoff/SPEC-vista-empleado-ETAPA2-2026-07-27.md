# SPEC — Vista del empleado · Etapa 2 (cambios confirmados por el dueño, 2026-07-27)

> **Read-only. NO construir aún.** Confirmado sobre el diagnóstico `_handoff/ANALISIS-vista-empleado-2026-07-27.md`.
> Estética/base: la de Etapa 1 (tema claro, mobile). Sagrados intactos.

## Principio rector
El empleado de piso (`salonero, barman, barback, runner, cocina`) entra a **una sola vista** (`/mi-rendimiento`)
y ve **solo lo suyo**. No puede cambiar de persona ni entrar a módulos de gestión.

---

## 1. ROLES / acceso (el cambio estructural)

- **Matar el selector "TU NOMBRE"** (dropdown) de Mi Rendimiento. Se elimina el match editable por nombre
  (`MiRendimiento.tsx:76-84`, `salName`/`setSalName`).
- **El vínculo perfil↔empleado se fija en Admin:** al asignar un perfil a un nombre de empleado se define qué datos ve.
  El empleado queda atado a ese vínculo y no lo puede cambiar.
- **El empleado NO accede a `/propinas`** (TipsModule = módulo para **registrar** propinas; es de gerencia/cajero).
  Solo ve las **estadísticas** de las propinas que recibió, dentro de su pestaña **¥ Propinas**.

### Ruteo nuevo (`src/App.tsx`)

| Ruta | Roles HOY | Roles NUEVOS |
|---|---|---|
| `/mi-rendimiento` (hub empleado) | salonero, barman, barback, runner, cocina | **igual** |
| `/propinas` (TipsModule) | owner, manager, cajero, salonero, barman, barback, runner, cocina | **owner, manager, cajero, contador** (fuera los 5 de piso) |
| `/caja` (CashModule) | owner, manager, cajero, contador | **igual** |
| `/ventas` (dashboard + admin metas/comps) | owner, manager, contador | **igual** |
| `/inbox` (bandeja) | owner, manager, contador, cajero | **ELIMINAR** (ya vive dentro de Caja Diaria) |

> Nota: el redirect viejo `/mis-propinas → /mi-rendimiento?tab=propinas` se mantiene (no rompe links).

---

## 2. Cambios por pestaña

**心 Resumen**
- **Ranking SIEMPRE** (hoy / esta semana / este mes / rango), no solo cuando el período es 1 día.
- **Quitar "Ventas totales"** del salonero (confunde con lo que gana el local).
- KPIs en **unidades y promedios**: Prom/PAX, cantidad de PAX, comida/PAX (uds), bebida/PAX (uds).
- **Ratio C/B: solo en unidades** (quitar la versión en ₡).
- **Prom/plato** y **Prom/bebida**: quedan.
- **Ticket/item: QUEDA**, siempre mostrado **comparado vs el resto** (delta vs general). *(Definición: ₡ promedio por ítem pedido = ventas ÷ cantidad de ítems.)*
- **Top productos del período**: queda.

**📅 Por día** — sin cambios.

**🍱 Productos**
- 3 bloques General / Comidas / Bebidas, **solo unidades**. Quitar el toggle ₡ (el monto por producto es dato del restaurante, confunde).

**🗓️ Semana**
- Foco en **Prom/PAX**, no en ventas. Mostrar: Prom/PAX · PAX atendidos · días trabajados · **prom PAX por día trabajado** · bebida/PAX · comida/PAX.
- Agregar **gráfico histórico visual filtrable por período** (que el empleado elija) para ver el desempeño más visual.

**¥ Propinas**
- Queda + agregar **promedio por turno** general, por **Q1 y Q2**.

**🏆 Competencias** — sin cambios.

---

## 3. Impacto y guardrails (para decidir la construcción, con firma)

- **Vínculo perfil↔empleado en Admin:** hoy existe `employees`/`getEmployeeByProfileId`, pero el match a las ventas es por
  **nombre del XLS**. Para matar el selector hay que **guardar qué nombre-de-ventas corresponde a cada perfil** →
  **probablemente campo nuevo (esquema) + UI en Admin. Toca esquema → firma del dueño.**
- **Ruteo `/propinas` y `/inbox`:** solo **código** (rutas + menú/Home). Cero plata, cero esquema.
- **KPIs / pestañas:** display sobre datos que ya existen. Sin esquema.
- **Metas personales self-serve (mig 050):** sigue pendiente **aparte**, no entra en esta tanda.

## 4. Orden sugerido de construcción (cuando se firme)
1. Vínculo perfil↔empleado en Admin + matar selector (base de todo lo demás).
2. Ruteo: sacar piso de `/propinas`, eliminar `/inbox`.
3. Ajustes de KPIs por pestaña (Resumen, Productos, Semana, Propinas).
4. Gráfico histórico de Semana.

> **STOP.** Spec confirmada, sin construir. La construcción se decide después con el asesor y tu firma (toca esquema en el paso 1).
