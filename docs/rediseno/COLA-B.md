# Cola · Línea B (shell y estética)

## B1 · Colores en un solo lugar, sin cambio visual · `en revisión #102` (aprobada por las revisiones del 11-nov 00:29, 03:25 y 05:40; merge a staging bloqueado por permiso de la sesión automática, espera a Ismael)
- **Qué hay hoy:** `src/index.css` tiene varios bloques de variables (`--t-*` aparece repetido en tres lugares) y colores sueltos.
- **Qué se hace:**
  - consolidar todo en un único `:root` con nombres semánticos: `--c-tinta`, `--c-gris`, `--c-linea`, `--c-panel`, `--c-oro`, `--c-oro-texto`, `--c-laca`, `--c-musgo`, más sus fondos;
  - **mantener los valores actuales**, para que nada cambie de aspecto;
  - las variables viejas quedan como alias de las nuevas.
- **Aceptación:**
  - el build y los tests están verdes;
  - el diff es solo CSS;
  - el reporte lista cuántos colores sueltos quedaron sin pasar a variable.

## B2 · Valores del diseño C · `pendiente` (después de B1) · validación visual
- **Qué se hace:**
  - cambiar los valores de las variables por los del `PLAN.md`;
  - fondo blanco;
  - filetes de oro;
  - Cormorant Garamond para títulos y números.
- **No se toca:** ningún componente; solo CSS.
- **Reporte:** capturas de la pantalla de login y de la build local en 390 px y 1280 px.

## B3 · Shell: menú lateral y barra inferior · `pendiente` (después de B1, y A2 hecha) · validación visual
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

## B4 · Inicio con pendientes · `pendiente` (después de B3) · validación visual
- **Qué muestra la grilla de Inicio:**
  1. una frase de estado;
  2. «Para hacer hoy», con los mismos datos que hoy alimentan los badges, más los días sin cierre de `diasSinCierre`;
  3. 3 números del día para owner, manager y contador;
  4. el estado «todo en orden» con el Daruma.
- **Sin consultas nuevas de escritura.** Si hace falta una lectura nueva, se hace bajo la RLS actual y se anota en el reporte.
- **Aceptación:**
  - tests de qué pendientes salen según los datos;
  - guía 6.1 actualizada.
