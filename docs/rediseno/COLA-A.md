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

## A3 · «Borrar TODO el día» a «Más acciones» · `en revisión #113` · **FIRMA** (archivo de cierre)
- En `CashCierre.tsx`, sacar el botón de la barra superior, donde está pegado a la fecha. Pasa a un bloque «Más acciones» al pie del cierre, con estilo de peligro.
- **Misma función, misma vista previa y mismos permisos.** Solo se mueve el JSX: no se toca ninguna función.
- **Aceptación:** el diff de `CashCierre.tsx` es solo de JSX; los tests de CashCierre (borrarDia, recontar, etc.) pasan.
- El PR lleva en la descripción qué va a ver el encargado.

## A4 · Medir Ventas · `lista` (después de A3 en el orden)
- **Medición sin login:** tamaño de los chunks por vista y consultas que dispara cada vista al abrir.
- **Reporte:** si alguna vista hace más de 3 consultas pesadas al abrir, proponer el arreglo en el reporte, sin aplicarlo.
