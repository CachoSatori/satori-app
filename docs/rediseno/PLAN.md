# Rediseño de la app · plan (aprobado por el dueño, 10-nov-2026)

## Qué es
- **Pasar toda la app al estilo de los SOP y los reportes («estilo carta»)** y ordenar la navegación con un menú global.
- **Solo pantalla.** No cambian:
  - los cálculos;
  - las consultas a la base;
  - los permisos;
  - las rutas.
- **Referencia visual:** el lienzo de diseño «Satori App · previews de rediseño», fila C. Manda la descripción de abajo.

## Estética (diseño C)
- **Fondo:** blanco. Texto en tinta `#1f2120`; secundario en gris `#6e706c`; gris claro `#9a9b96`.
- **Líneas y fondos:** líneas `#e6e4de`; panel `#f6f5f2`, que es el único fondo de recuadro.
- **Oro `#b48e50`:** solo para filetes y para la barra destacada de los gráficos. El oro para texto es `#8a6a33`.
- **Estados:** laca `#a3392d` para lo malo, sobre `#f6e4e1`. Musgo `#3e6a4c` para lo bueno, sobre `#e6efe8`. Oro sobre `#f4f0e6` para lo pendiente.
- **Tipografía:**
  - Cormorant Garamond (500 y 600) para títulos y números grandes;
  - DM Sans (400, 500 y 600) para todo lo demás, con `tabular-nums`;
  - nada de monoespaciadas en la interfaz.
- **Jerarquía de pantalla:** arriba, una frase con la conclusión. Después, cifras grandes separadas por filetes, sin tarjetas ni sombras. Las listas van con líneas finas. Un solo botón principal por pantalla, en tinta.
- **Etiquetas de estado:** con color, en forma de píldora: «Abierta», «2 por revisar», «sin foto».
- **Botones principales:** en celular, fijos abajo.
- **Botones táctiles:** de 44 px como mínimo.
- **Daruma** (`public/marca/daruma.png`) — **ampliado por Ismael el 12-nov (B8):** también en el login, en las pantallas de carga y arriba a la izquierda de cada pantalla. Antes aparecía en solo tres lugares:
  - en la marca del menú;
  - en el encabezado del celular;
  - en el estado «todo en orden».

  Nunca en tablas ni en botones.

## Estructura
- **Menú desde una sola fuente.** El menú global sale del arreglo `MODULES` que ya existe, con un campo `grupo` agregado. Se aplica el mismo filtro por rol de hoy.
  - En computadora (desde 1024 px) va como menú lateral.
  - En celular va como barra inferior de hasta 5 botones; el quinto es «Más».
  - El personal que tiene 3 módulos o menos no lleva barra.
- **Grupos:**
  - Inicio;
  - **Operación:** Caja, Bandeja de facturas y Propinas;
  - **Ventas:** Hoy, En vivo, Saloneros, Análisis, Histórico, Ingeniería de menú y Metas;
  - **Equipo:** Mi rendimiento y Procedimientos (y Empleados donde exista);
  - **Gestión:** Reportes, Finanzas, Inventario y Clientes;
  - **Ajustes:** Admin, Prueba y lo de soporte, para quien ya lo ve hoy.
- **Ventas: agrupar, no borrar.**
  - **Saloneros** reúne Saloneros, Saloneros por línea, Evaluación, ICP y Competencias, como sub-pestañas.
  - **Histórico** reúne Histórico, Calendario, Mix, Ventas y Cajeros.
  - **Ajustes de Ventas:** Paridad, Cargar XLS y Productos.
  - La pestaña de arranque de cada rol no cambia.
- **Inicio:** muestra los pendientes con su estado (se reusan las consultas actuales de los badges y `diasSinCierre`), 3 números del día y la acción principal del rol.
- **Se descartó:** el interruptor a la grilla vieja, el selector de rol, los alias de rutas, la fusión de los reportes en una pantalla, el KDS y el Comandero.

## Cuándo
- **Temporada alta:** arranca a mediados de diciembre.
- **Pase a `main`:** lo de navegación (B3 y B4) pasa solo si Ismael lo valida en staging antes del ~10-dic. Si no, queda para después de Semana Santa.

## Notas de la auditoría externa (11-nov, hallazgo 207)
- **B4 sí agrega lecturas** al Inicio (las mismas que Caja usa para «días sin cierre»), permitidas por COLA-B bajo la RLS actual. El resto del rediseño no cambia consultas; A5 cambia *cuándo* se consulta, con aprobación de Ismael.
- **«Se descartó el KDS y el Comandero»** quiere decir que no se rediseñan; siguen en el menú de `staging` para los roles que ya los veían. En el pase a `main` salen del menú porque ahí no tienen ruta (junto con Mi Turno y Salarios).
- **Alcance ampliado el 11-nov:** el estilo carta se lleva también a los módulos (tanda 2 de las colas) antes del pase a `main`.

## Condiciones del pase a `main` (auditoría externa del 11-nov, 195, 199 y 200)
Detalle completo en `docs/rediseno/auditorias/2026-11-11-preprod.md`. La revisión que arme la rama `claude/rediseno-prod-…` las cumple todas:
1. **Autorización** de Ismael en `DECISIONES.md`, con la lista de tareas que entran.
2. **Rama desde `main`** (con el Club ya en `main` si entró). Cherry-pick `-m 1` de cada merge del rediseño, en orden, uno por uno con build y tests entre cada uno.
3. **`modulos.ts` de prod (195):** la lista de `main`, sin `mi-turno`, `comandero`, `kds` ni `salarios` (no tienen ruta en `main`); `roles` del resto byte a byte iguales; `ROLE_LANDING` igual al de `main`; tests de grilla con la lista de `main` y un test nuevo «cada `path` de `MODULES` tiene `<Route>` en `App.tsx`».
4. **Club (200):** si #59 ya está en `main`, `club` en `modulos.ts` con `roles: ['owner','manager','cajero']` idénticos y sus excepciones como un pendiente de `pendientes.ts` (solo owner y manager). Si no, la señal se pierde.
5. **Conflictos previstos (199):** `ProductosAdmin.tsx` no existe en `main` (`git rm`); descartar los hunks de `index.css` que caen en el bloque que solo existe en `staging` (clases `.cm-*`, `.sal-*`, `.fx-*`); `HomePage.tsx` sin el `MODULES` de 17.
6. **Verificar el diff de la rama contra `main`:** nada en `supabase/`, sagrados, escrituras nuevas, `ProductosAdmin.tsx`, `pos/`, `salarios/` ni rutas nuevas; `App.tsx` solo con import, `conMenu` y el wrapper; `vite.config.ts` sin tocar.
7. **Gates del PROTOCOLO** en la rama y **validación visual** en su vista previa con owner, manager, contador, cajero, salonero y cocina.
8. **Rollback:** tag `pre-rediseno` sobre `main` antes del merge; si falla, volver al deploy anterior en Cloudflare y después `git revert -m 1`. No hay datos que revertir.
9. PR a `main` sin mergear; lo mergea una sesión con el OK explícito de Ismael, fuera de 19–22 h.
