# Cola · Línea A (módulos)

## A1 · Textos y etiquetas · `hecha` (#101, mergeada a staging el 11-nov 08:20)
- **Resumen semanal:**
  - durante la semana en curso, la variación contra la semana anterior muestra «En curso» en vez de ▼ con un %;
  - revisar que ningún conteo de PAX lleve ₡ (Prom/PAX sí lleva).
- **Textos técnicos a la vista** (nombres de campos o tablas, como `saldoCajaFuerte`, `caja_origen`, «no hay tabla») en Prueba y Admin:
  - se pasan a lenguaje de restaurante, o
  - se muestran solo al owner bajo «Info técnica».
- **Menú de pestañas de Ventas** (`VentasModule.tsx`):
  - los `div` clicables pasan a `button type="button"` con `aria-selected`;
  - mismo aspecto.
- **Aceptación:** el diff es solo de JSX y textos; ningún cálculo cambia; los tests de ResumenSemanal y Ventas están verdes.

## A2 · Ventas agrupado y con pestaña en la URL · `hecha` (#111, mergeada a staging el 11-nov 11:40)
- Pestaña activa en la URL: `/ventas?tab=<id>`. Entrar sin `tab` abre la misma pestaña de hoy para cada rol.
- Agrupar según `PLAN.md`:
  - 7 entradas;
  - sub-pestañas dentro de Saloneros e Histórico;
  - Paridad, Cargar XLS y Productos al grupo «Ajustes», con los mismos roles de hoy.
- No se borra ninguna vista.
- **Aceptación:**
  - cada una de las 18 vistas se puede abrir;
  - un test cubre la pestaña por defecto de cada rol y el `?tab=`;
  - guía 6.4 actualizada.

## A3 · «Borrar TODO el día» a «Más acciones» · `hecha` (#113, firmada por Ismael y mergeada el 11-nov 12:55) · **FIRMA** (archivo de cierre)
- En `CashCierre.tsx`, sacar el botón de la barra superior, donde está pegado a la fecha. Pasa a un bloque «Más acciones» al pie del cierre, con estilo de peligro.
- **Misma función, misma vista previa y mismos permisos.** Solo se mueve el JSX: no se toca ninguna función.
- **Aceptación:** el diff de `CashCierre.tsx` es solo de JSX; los tests de CashCierre (borrarDia, recontar, etc.) pasan.
- El PR lleva en la descripción qué va a ver el encargado.

## A4 · Medir Ventas · `hecha` (reporte `2026-11-11-1311-A-A4.md`, sin PR; revisado 11-nov 14:05)
- **Medición sin login:** tamaño de los chunks por vista y consultas que dispara cada vista al abrir.
- **Reporte:** si alguna vista hace más de 3 consultas pesadas al abrir, proponer el arreglo en el reporte, sin aplicarlo.

## A5 · Ventas carga a pedido · `lista` · aprobada por Ismael el 11-nov 14:10 (cambia *cuándo* se consulta; excepción autorizada a «no cambiar consultas»)
- Sale de A4 (arreglos 1–3). No cambia qué se consulta ni cómo se calcula; cambia **cuándo**:
  1. la historia completa del PoS (`cargarDeFondo`) se pide solo al entrar a una vista que la usa (Análisis, Histórico, Calendario, Mix, Ventas, Metas, Ing. Menú, Evaluación, ICP);
  2. En vivo, Paridad y Por línea se pintan sin esperar la carga de 90 días;
  3. En vivo: las 4 jornadas comparables y los nombres se piden una vez por jornada; cada 30 s solo se relee lo de hoy.
- Archivos: `VentasModule.tsx`, `VentasEnVivo.tsx`, `ventasEnVivoDatos.ts` (línea A). **No** `src/shared/api/posNdf.ts` ni migraciones.
- **Aceptación:** test de que cada vista muestra los mismos números que antes con los mismos datos; medición antes/después de llamadas en el reporte.
