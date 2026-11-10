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
- **Daruma** (`public/marca/daruma.png`): aparece en solo tres lugares:
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
