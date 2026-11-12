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

## A5 · Ventas carga a pedido · `hecha` (merge #116 a `staging` el 11-nov 15:52, OK de Ismael por chat) (reporte `2026-11-11-1451-A-A5.md`) · aprobada por Ismael el 11-nov 14:10 (cambia *cuándo* se consulta; excepción autorizada a «no cambiar consultas»)
- Sale de A4 (arreglos 1–3). No cambia qué se consulta ni cómo se calcula; cambia **cuándo**:
  1. la historia completa del PoS (`cargarDeFondo`) se pide solo al entrar a una vista que la usa (Análisis, Histórico, Calendario, Mix, Ventas, Metas, Ing. Menú, Evaluación, ICP);
  2. En vivo, Paridad y Por línea se pintan sin esperar la carga de 90 días;
  3. En vivo: las 4 jornadas comparables y los nombres se piden una vez por jornada; cada 30 s solo se relee lo de hoy.
- Archivos: `VentasModule.tsx`, `VentasEnVivo.tsx`, `ventasEnVivoDatos.ts` (línea A). **No** `src/shared/api/posNdf.ts` ni migraciones.
- **Aceptación:** test de que cada vista muestra los mismos números que antes con los mismos datos; medición antes/después de llamadas en el reporte.

---
### Tanda 2 · Auditoría y estilo en los módulos (decidido por Ismael el 11-nov 15:15)

## A6 · Admin legible y colones al estándar · `hecha` (#120, mergeada el 11-nov 22:05)
- **Auditoría 198:** `src/modules/admin/EmployeeList.tsx:207`, el selector de rol tiene `background:'#111'` y `color:'var(--white)'` (ahora tinta): queda ilegible. Pasarlo a `background: var(--c-fondo)`, `color: var(--c-tinta)` y borde `var(--c-linea)`. Buscar con `rg "var\(--(white|black)\)"` otros casos sobre fondos fijos en archivos de la línea A.
- **Colones:** `fi()` en `src/shared/utils/index.ts` pasa de «₡ 1 460 000» a «₡1.460.000» (₡ pegado, punto de miles, sin decimales). Revisar `fd()` y otros formateadores de la misma carpeta solo si muestran colones.
  - Antes de cambiar: listar dónde se usa `fi()` y confirmar que **ningún resultado se guarda en la base ni se vuelve a leer como número** (si alguno se guarda o se parsea, frenar y anotarlo).
  - Ajustar los tests que fijan el formato viejo; no cambiar ningún otro valor esperado.
- **Aceptación:** diff de `fi()` solo de formato; tests verdes; guía 6.6 si cambia algo visible en Admin.

## A7 · Ventas con estilo carta · `hecha` (#121, validada y mergeada el 11-nov 22:55)
- **Auditoría 201/202/203:**
  - sub-pestaña activa en `var(--c-oro-texto)` en vez de `ENTRADA_COLOR` (`VentasModule.tsx`); sacar los oros viejos `#c8a050`/`#c8a96e`;
  - `aria-controls` en cada pestaña y `role="tabpanel"` en el contenido; flechas izquierda/derecha para moverse;
  - un `?tab=` inválido o ajeno se limpia de la URL.
  - auditoría 203: cambiar de pestaña agrega una entrada al historial (no `replace`), así el botón Atrás vuelve a la pestaña anterior; abrir Ventas sin `?tab=` sigue con `replace`.
- **Estilos en línea de `src/modules/ventas/**`:** colores fijos → `var(--c-*)`; `monospace`/`'DM Mono'` → `var(--font-sans)` + `tabular-nums`; sin mayúsculas; fondos oscuros → blanco o panel; números grandes en `var(--font-serif)`.
- Cambiar las copias locales de `fi` con el formato viejo (`ventasUtils.ts`) por el `fi()` compartido.
- No tocar `ventasTabs.ts`, roles, cálculos ni consultas (A5 ya está).
- **Aceptación:** diff solo de estilo y ARIA; tests de Ventas verdes; capturas o link de vista previa; guía 6.4 si cambia algo que el encargado nombra.

## A8 · Caja con estilo carta · `hecha` (#123, firmada y validada; mergeada el 11-nov 23:40) · **FIRMA**
- Estilos en línea de `src/modules/cash/**` como en A7. `CashCierre.tsx` tiene 13 `monospace`.
- **Prohibido:** `cashUtils.ts`, `cierrePozo`, `diasSinCierre.ts`, cualquier función, condición, cálculo o consulta. Solo `style`, `className` y textos.
- Lleva firma porque toca archivos de cierre: la descripción del PR dice qué va a ver el encargado, pantalla por pantalla.
- **Aceptación:** diff solo de estilo; todos los tests de `cash` verdes; guía 6.2.

## A9 · Propinas con estilo carta · `hecha` (#127, validada y mergeada el 12-nov 00:05; diff solo de estilo, sin `tipCalculations.ts`)
- Estilos en línea de `src/modules/tips/**` como en A7 (24 mayúsculas, paneles oscuros en `TipQuincenal`, `TipStats`). **Nunca** `tipCalculations.ts`.
- **Aceptación:** diff solo de estilo; tests de `tips` verdes; guía 6.3.

## A10 · Resumen, Admin e Inventario con estilo carta · **movida a la línea B como B7** (11-nov 22:50, para trabajar en paralelo)
- Estilos en línea de `src/modules/resumen/**`, `src/modules/admin/**`, `src/modules/inventario/**` y `MiRendimiento.tsx` (11 `monospace`) como en A7.
- **Aceptación:** diff solo de estilo; tests verdes; guías 6.6 y la de Resumen si cambia algo visible.


---
### Tanda 3 · pedida por Ismael el 12-nov 06:40 («hagamos tanda 3», todo)

## A11 · Daruma en Semana y Reporte mensual · `hecha` (#135, mergeada a staging el 12-nov 07:25, `2e1f73c`; validada por Ismael 07:35; pase a main en PR #139)
- `src/modules/resumen/ResumenSemanal.tsx` y `src/modules/resumen/ReporteMensual.tsx` no tienen clase de encabezado que el CSS de B8 pueda tomar.
- Agregar en el encabezado de cada una, a la izquierda del título, un `<img src={`${import.meta.env.BASE_URL}marca/daruma.png`} alt="" width={22} height={24} />` (como el login de B8), con el mismo tamaño y separación que el `::before` de los otros módulos (22×24 px, ver `.module-header-left::before` en `src/index.css`).
- En Reporte mensual, solo en la barra `no-print`: el Daruma **no** sale al imprimir.
- Nada más: ni cálculos, ni condiciones, ni `onClick`, ni consultas.
- **Aceptación:** gates del PROTOCOLO; capturas 390 y 1280 de las dos pantallas; guía de Resumen si cambia lo que se ve.

## A12 · Monospace que queda en los módulos (auditoría 205) · `hecha` (#136, mergeada a staging el 12-nov 10:35, `41cde89`; pase a main en PR #139)
- **Archivos habilitados solo para esta tarea** (además de los de la línea A): `src/modules/inbox/InboxModule.tsx` y `src/modules/crm/ClientesModule.tsx`, **solo** la línea con `DM Mono` de cada uno.
- Casos (en `staging` al 12-nov):
  - `src/modules/prueba/CierreSimulator.tsx` 25–26: `num` e `inputStyle` → `var(--font-sans)` + `tabular-nums`; el input oscuro (`#111`, `#2a2a2a`) → fondo `var(--c-fondo)`, borde `var(--c-linea)`, texto `var(--c-tinta)`, como en A7;
  - `src/modules/ventas/ventasEnVivo.css` 46: `--apos-mono` → `var(--font-sans)` (y `font-variant-numeric: tabular-nums` donde se use);
  - `src/modules/inbox/InboxModule.tsx` 212 y `src/modules/crm/ClientesModule.tsx` 506: `fontFamily` → `var(--font-sans)` + `tabular-nums`. **No** cambiar cómo se formatea el monto (si el formato no es el de `fi()`, anotarlo en el reporte, no arreglarlo).
- No tocar `src/modules/salarios/**` (no está en `main`) ni `src/index.css` (es de B9).
- **Aceptación:** diff solo de estilo; gates; `git grep -niE "monospace|DM Mono" -- src/modules ':!src/modules/salarios'` vacío salvo comentarios; guías 6.4 / Bandeja / Clientes solo si cambia algo que el encargado nombra (si no, decirlo en el PR).

---
### Tanda 4 · pedida por Ismael el 12-nov («hacer todo»)

## A13 · Montos de la Bandeja con `fi()` y Salarios sin Google Fonts · `hecha` (#142, mergeada a staging el 12-nov 11:19, `5cc6402`; pase a main en PR #143, solo la Bandeja)
- Hecha por la revisión (las líneas están pausadas). Bandeja: total de cada factura con `fi()`/`fd()`. Salarios (solo `staging`): fuentes de la app en vez del `@import` de Google, `tabular-nums` en vez de monoespaciada.
