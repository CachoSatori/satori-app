# Cola · Línea B (shell y estética)

## B1 · Colores en un solo lugar, sin cambio visual · `hecha` (#102, mergeada a staging el 11-nov 08:20)
- **Qué hay hoy:** `src/index.css` tiene varios bloques de variables (`--t-*` aparece repetido en tres lugares) y colores sueltos.
- **Qué se hace:**
  - consolidar todo en un único `:root` con nombres semánticos: `--c-tinta`, `--c-gris`, `--c-linea`, `--c-panel`, `--c-oro`, `--c-oro-texto`, `--c-laca`, `--c-musgo`, más sus fondos;
  - **mantener los valores actuales**, para que nada cambie de aspecto;
  - las variables viejas quedan como alias de las nuevas.
- **Aceptación:**
  - el build y los tests están verdes;
  - el diff es solo CSS;
  - el reporte lista cuántos colores sueltos quedaron sin pasar a variable.

## B2 · Valores del diseño C · `hecha` (#112, mergeada a staging el 11-nov 11:45, validada por Ismael en la vista previa)
- **Qué se hace:**
  - cambiar los valores de las variables por los del `PLAN.md`;
  - fondo blanco;
  - filetes de oro;
  - Cormorant Garamond para títulos y números.
- **No se toca:** ningún componente; solo CSS.
- **Reporte:** capturas de la pantalla de login y de la build local en 390 px y 1280 px.

## B3 · Shell: menú lateral y barra inferior · `hecha` (#114, validada por Ismael y mergeada el 11-nov 12:55) · validación visual
- **Componentes:** `src/shared/layout/AppShell.tsx` (nuevo) envuelve las rutas privadas.
- **El menú:**
  - sale de `MODULES`, con un campo `grupo` agregado;
  - aplica el mismo filtro `roles` de hoy;
  - va lateral desde 1024 px y como barra inferior en pantallas más chicas (máximo 5 botones, el quinto es «Más»);
  - no se muestra al personal con 3 módulos o menos.
- **Ventas:** sus entradas llevan a `/ventas?tab=…`.
- **Daruma:** copiar `club-web/public/marca/daruma.png` de la rama `origin/claude/club-integracion` a `public/marca/daruma.png`.
- **Las rutas, `PrivateRoute` y el aterrizaje del cajero no cambian.**
- **Aceptación:** un test por rol confirma que el menú muestra exactamente los módulos que hoy muestra la grilla del Inicio.

## B4 · Inicio con pendientes · `hecha` (#115, validada por Ismael y mergeada el 11-nov 14:25) · validación visual
- **Qué muestra la grilla de Inicio:**
  1. una frase de estado;
  2. «Para hacer hoy», con los mismos datos que hoy alimentan los badges, más los días sin cierre de `diasSinCierre`;
  3. 3 números del día para owner, manager y contador;
  4. el estado «todo en orden» con el Daruma.
- **Sin consultas nuevas de escritura.** Si hace falta una lectura nueva, se hace bajo la RLS actual y se anota en el reporte.
- **Aceptación:**
  - tests de qué pendientes salen según los datos;
  - guía 6.1 actualizada.

---
### Tanda 2 · Auditoría y estilo en los módulos (decidido por Ismael el 11-nov 15:15)

## B5 · Inicio que nunca dice «Todo en orden» sin comprobar · `hecha` (merge #119 a `staging` el 11-nov 16:02)
- **Auditoría 196:** en `src/pages/HomePage.tsx`, primero escribí en el reporte qué pasa en pantalla cuando falla cada lectura de la alerta y de `fetchHomeStatus`. Después:
  - estado de error: si alguna señal falló, la frase es «No se pudo comprobar todo — revisá Caja», con una píldora oro «sin comprobar» que abre `/caja`. **Nunca** «Todo en orden» ni el Daruma si algo falló;
  - en `fetchHomeStatus`, las lecturas rechazadas se marcan como «sin comprobar» en vez de quedar en 0;
  - si `fetchHomeStatus` falla entero: «No se pudo cargar el día», no «Revisando el día…» para siempre.
- **Auditoría 197:** va aparte, en B5b (la línea B ya arrancó B5 antes de la decisión).
- No cambiar qué se consulta. Tests de render para cada falla.
- **Aceptación:** tests verdes; guía 6.1; link de vista previa.

## B5b · Alerta del Inicio una vez por sesión · `hecha` (entró en el mismo PR que B5, #119, commit `457e58f`)
- **Auditoría 197 (aprobada por Ismael el 11-nov 15:55, excepción a «no cambiar consultas» solo en *cuándo*):** la alerta de días sin cierre se lee **una vez por sesión** (en memoria del módulo o `sessionStorage`; se reusa hasta cerrar la app o recargar) y los otros pendientes se pintan sin esperarla. Mismas funciones con los mismos argumentos; no cambiar qué se consulta ni cómo se calcula. Si la lectura falló, no se guarda: se reintenta en la próxima visita (y vale el estado «sin comprobar» de 196).
- Tests: segunda visita al Inicio no vuelve a llamar las tres funciones de la alerta; una lectura fallida sí se reintenta.
- **Aceptación:** tests verdes; guía 6.1; link de vista previa.

## B6 · Cáscara y clases de módulo con estilo carta · `hecha` (#122, validada y mergeada el 11-nov 22:55)
- **Mayúsculas:** sacar `text-transform: uppercase` del menú (`AppShell.css`), del Inicio y de las clases de módulo de `index.css` (`.vt-nav-tab`, `.shell-grupo-titulo`, `.login-btn` y las 93 de `index.css`), con letra de 44 px de alto donde sea pestaña o botón (auditoría 201).
- **Barras y paneles oscuros:** `.vt-module`, `.vt-module-header`, `.vt-nav-tabs`, `.module-header` y las clases de Caja, Propinas e Inventario pasan a fondo blanco con filete de oro, texto en tinta; pestaña activa en `--c-oro-texto`.
- **Botones secundarios** (`--gray-pale`, auditoría 204): borde `var(--c-linea)`, fondo transparente, texto tinta (`App.tsx`, `src/pages/auth/CambiarPasswordInicial.tsx`, `src/shared/ErrorBoundary.tsx`).
- **Hoja «Más»** (auditoría 202): `aria-modal="true"`, foco al cerrar al abrir y de vuelta a «Más» al cerrar, Escape la cierra.
- **OfflineBanner** (204): que no tape la barra inferior.
- **Fuentes sin internet** (206): Cormorant Garamond (500, 600, 500 itálica) y DM Sans (400, 500, 600) en `public/fonts/` con `@font-face`; sacar el `@import` de Google para esas dos (Noto Serif JP puede quedar como respaldo de los kanji).
- No tocar componentes de `src/modules/` (eso es de la línea A).
- **Aceptación:** build y tests verdes; capturas 390 y 1280 de login, Inicio, Ventas, Caja y Propinas; guía 6.1 e `INVENTARIO.md` si cambia algo.


## B7 · Resumen, Admin e Inventario con estilo carta (ex A10) · `hecha` (#124, validada y mergeada el 11-nov 23:40)
- **Archivos habilitados solo para esta tarea:** `src/modules/resumen/**`, `src/modules/admin/**`, `src/modules/inventario/**`, `src/modules/ventas/MiRendimiento.tsx`, guías 6.5, 6.6 y la de Resumen. (La línea A no los toca mientras B7 esté abierta.)
- Estilos en línea como en A7: colores fijos → `var(--c-*)`; `monospace`/`'DM Mono'` → `var(--font-sans)` + `tabular-nums`; sin `textTransform: 'uppercase'`; fondos oscuros → blanco o panel; números grandes en `var(--font-serif)`; oro de texto `--c-oro-texto`.
- Cambiar las copias locales de `fi` con el formato viejo en `inventario/*` por el `fi()` compartido.
- **Nunca** un cálculo, una condición, un `onClick` ni una consulta. Diff solo de estilo y texto.
- **Aceptación:** tests verdes; gates del PROTOCOLO; guías si cambia algo visible; link de vista previa.

---
### Tanda 3 · pedido de Ismael del 12-nov

## B8 · Daruma en el login, en las cargas y en cada encabezado · `hecha` (#130, validada y mergeada el 12-nov 03:15; pase a main en PR #131)
- **Login** (`src/pages/auth/LoginPage.tsx`): el `login-mark` («祭») pasa a ser la imagen del Daruma (`${import.meta.env.BASE_URL}marca/daruma.png`), con `alt=""`; mismo lugar y tamaño parecido (~56–64 px).
- **Cuando las pantallas cargan** (`.loading-mark`, hoy un kanji en 13 módulos y en el `Suspense` de `App.tsx`): que se vea el Daruma en vez de la letra, con una animación suave (respirar o balancearse lento; sin girar rápido) y respetando `prefers-reduced-motion`.
  - **Preferido:** hacerlo desde `src/index.css` (por ejemplo, ocultando el texto de `.loading-mark` y poniendo el Daruma de fondo), para **no tocar los módulos**.
- **Encabezado de cada pantalla, arriba a la izquierda, al lado de la letra (kanji):** un Daruma chico (~20–24 px) en `.module-header-left`, `.tips-header-left`, `.vt-module-header` y los demás encabezados de módulo, y en el encabezado del Inicio en computadora (hoy B3 lo oculta desde 1024 px: mostrarlo también ahí).
  - **Preferido:** también desde `src/index.css` (`::before` con el Daruma de fondo). Si en algún módulo no se puede sin tocar su JSX, anotarlo en el reporte y no tocarlo.
- La URL del Daruma en CSS tiene que funcionar con la base de producción (`/satori-app/`): verificar en el build que queda reescrita.
- No tocar lógica, consultas ni permisos. Nunca en tablas ni botones.
- **Aceptación:** gates del PROTOCOLO; capturas 390 y 1280 de login, una carga, Inicio, Caja y Ventas; guía 6.1 si cambia lo que se ve al entrar.


---
### Tanda 3 · pedida por Ismael el 12-nov 06:40 («hagamos tanda 3», todo)

## B9 · Hoja «Más» con foco atrapado, monospace del CSS y un solo Daruma en el Inicio · `hecha` (#134, mergeada a staging el 12-nov 07:25, `b3b3134`; validada por Ismael 07:35)
- **Auditoría 202:** en la hoja «Más» de `src/shared/layout/AppShell.tsx`, el Tab y Shift+Tab quedan dentro de la hoja mientras está abierta (último → primero y al revés). Se mantiene lo de B6: `aria-modal`, foco al abrir, Escape cierra y el foco vuelve a «Más». Test de render del ciclo de foco.
- **Auditoría 205 (parte de B):** las 4 `font-family: var(--font-mono, …monospace)` de `src/index.css` (líneas ~4592, 5343, 5359, 5410 en `staging`) → `var(--font-sans)` + `font-variant-numeric: tabular-nums`. Si alguna es de un bloque que solo existe en `staging` (`.cm-*`, `.sal-*`, `.fx-*`), igual se cambia, pero anotarlo en el reporte para el pase.
- **Un solo Daruma en el Inicio en computadora** (duda de B8, decidido por Ismael): desde 1024 px se vuelve a ocultar `.header-daruma` de la barra de arriba; queda el de la marca del menú. En celular no cambia.
- No tocar `src/modules/**`.
- **Aceptación:** gates; capturas 390 y 1280 del Inicio y de la hoja «Más» abierta; guía 6.1 si cambia lo que se ve.

## B10 · Kanji sin internet (auditoría 206) · `en revisión #137`
- Hoy `src/index.css` trae Noto Serif JP desde Google (`@import`); sin internet los kanji caen en la serif del sistema.
- Servirla desde `public/fonts/` con `@font-face`, **recortada a los caracteres que usa la app**: juntar los kanji de `src/shared/layout/modulos.ts`, de los `loading-mark` y encabezados de `src/**` y de `LoginPage`/`CambiarPasswordInicial`, y generar un `woff2` con solo esos (por ejemplo con `pyftsubset`). Pesos: los que hoy se piden a Google.
- Sacar el `@import` de Google de Noto Serif JP. Incluir la licencia OFL de la fuente en `public/fonts/`.
- En el reporte: lista de caracteres incluidos, peso del archivo (tiene que quedar chico, decenas de KB) y cómo regenerarlo si se agrega un kanji.
- No tocar `vite.config.ts` ni el service worker (si el precache no toma el archivo nuevo solo, anotarlo, no arreglarlo).
- **Aceptación:** gates; con la red cortada en la vista previa (DevTools offline después de la primera carga) los kanji del menú se ven con Noto Serif JP; guía 6.1 si cambia algo.
