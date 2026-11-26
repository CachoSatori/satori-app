# SPEC — Caja al estándar de los SOP

Estado: **propuesta de diseño, sin construir**. La maqueta la aprueba el dueño antes de tocar código (decisión del 24-nov).
Maqueta: [maqueta-caja-estandar.html](maqueta-caja-estandar.html) (estática, datos ficticios; cada lámina se abre con su ancla:
`#caja-diaria`, `#cierre-en-curso`, `#cierre-cerrado`, `#movimientos`, `#piezas`).

## 1. Qué arregla

| Problema visto (Cierre del día, celular) | Cómo queda |
|---|---|
| Títulos con la misma letra que el texto | Títulos en Cormorant Garamond 600 (30 / 21 px); texto y cifras en DM Sans |
| Emojis como íconos | Fuera. Íconos de línea de Tabler (§3.6) solo donde ayudan: agregar, calendario, editar, borrar, deshacer |
| Bordes gruesos y cajas dentro de cajas | Bloques separados por aire y un filete de 1 px; única caja: los campos |
| El título «Caja» se corta arriba | **Causa encontrada en el PR 0 (Chrome a 390 px; falta verla en el teléfono del dueño):** cabecera y pestañas eran las dos `sticky; top:0` y las pestañas tapaban el título al bajar (§8). Arreglado en el PR 0 |
| «Diferencia ₡−1.951» en rojo, sin más | «Faltaron ₡1.951 · Fuera de tolerancia (₡500)» (§4) |
| «Fase 1 — Mediodía (pendiente)» con el día cerrado | La barra deriva del cierre `completo` (§3.2). Hoy `CashCierre.tsx` mira solo la fila `parcial_mediodia`, que en los cierres nuevos no existe |

## 2. Tokens

Los colores del kit ya están en `src/index.css`; casi todo es mapeo. Lo nuevo va **acotado a una clase `.est`** en la raíz del
módulo, en un archivo aparte (`src/styles/estandar.css`), para no cambiar de golpe los módulos que todavía no pasaron.

| Token | Valor | Hoy | Cambio |
|---|---|---|---|
| `--c-tinta` | `#1f2120` | igual | — |
| `--c-oro` / `--c-oro-texto` | `#b48e50` / `#8a6a33` | igual | oro solo en filetes y pestaña activa; como texto, siempre `-texto` |
| `--c-laca` / `--c-musgo` | `#a3392d` / `#3e6a4c` | igual | — |
| `--c-crema` | `#faf8f4` | no existe | **nuevo** |
| `--c-fondo` (dentro de `.est`) | `var(--c-crema)` | `#ffffff` | fondo del módulo en crema; `--c-papel` blanco queda para campos |
| `--c-linea` (dentro de `.est`) | `#e6e1d6` | `#e6e4de` | un punto más cálida, para que se vea sobre crema |
| `--c-panel` (dentro de `.est`) | `#f3efe7` | `#f6f5f2` | ídem |
| `--e-1…7` | 4 · 8 · 12 · 16 · 24 · 32 · 48 px | no existe | escala de espacios |
| `--toque` | 48 px | — | alto mínimo de botón principal y campo (secundarios 44) |
| `--radio` | 4 px | 2 px | — |

Tipografía (clases, no tamaños sueltos en `style=`):

| Uso | Letra |
|---|---|
| Título de módulo / de pantalla | Cormorant 600 · 28 / 30 px |
| Título de bloque | Cormorant 600 · 21 px |
| Cifra principal / secundaria | DM Sans 600 · 36 / 22 px, `tabular-nums` |
| Texto | DM Sans 400 · 15 px (campos 16 px: evita el zoom de iOS) |
| Etiqueta | DM Sans 500 · 13 px, gris, en minúsculas (sin mayúsculas sostenidas: se leen peor en el celular) |
| Nota | DM Sans 400 · 13 px, gris |

Las cifras van en DM Sans y no en Cormorant: los números de Cormorant son de altura desigual y un monto se lee peor.
Por lo mismo, los títulos evitan llevar números.

## 3. Componentes

1. **Cifra.** Etiqueta + valor + nota, sin caja. Un grupo lleva filete de oro arriba y una sola cifra principal (la que decide:
   «Disponible», «Diferencia», «Efectivo en caja»). En celular la principal ocupa el ancho y el resto va de a dos.
2. **Barra de fases.** Dos pasos con círculo: número (pendiente / en curso) o tilde (hecho). Regla de estado, solo presentación:
   - Mediodía: `completo || parcial` → «Sellado»; si no, «Pendiente».
   - Noche: `completo` → «Cerrado»; `parcial` → «En curso»; si no, «En espera».
3. **Aviso.** Filete de 2 px a la izquierda, sin fondo ni ícono. Primero qué pasa (en negrita), después qué hacer.
   Cuatro tonos: información (gris), atención (oro), error (laca), hecho (musgo).
4. **Botones.** Principal (tinta, uno por pantalla) · secundario (borde tinta) · de texto (oro-texto subrayado).
   **Peligrosos:** texto en laca sin caja, con una línea gris que dice qué borra, siempre al pie en un bloque «Correcciones»
   (hoy «Deshacer cierre» está pegado al selector de fecha). El relleno laca aparece solo en el botón que confirma, dentro del
   diálogo. Las confirmaciones, contraseñas y motivos de hoy no cambian.
5. **Campo de monto**, **píldora de estado** (Pagado / Pendiente / Rechazado / neutro), **fila de lista** y **cuenta**
   (renglones con total sobre filete de tinta): ver lámina `#piezas`.
6. **Íconos: Tabler Icons** (`@tabler/icons-react`, licencia MIT). Se importan por nombre y solo los usados, para que el
   empaquetado descarte el resto: `import { IconPlus, IconTrash } from '@tabler/icons-react'`. Un único archivo
   `src/shared/ui/iconos.ts` los reexporta, así la lista vive en un lugar. Tamaño 20, trazo 1,5, color heredado del texto,
   `aria-hidden` cuando acompañan un texto y `aria-label` en el botón cuando van solos. Los diez de Caja: `IconPlus`,
   `IconCheck`, `IconChevronRight`, `IconChevronDown`, `IconCalendar`, `IconDownload`, `IconPencil`, `IconTrash`,
   `IconArrowBackUp`, `IconSearch`. En la maqueta van como SVG en línea, transcriptos a mano: al instalar el paquete se
   comparan contra el original. El PR 1 mide el peso del build antes y después.
7. **Cajón inferior en celular (evaluación; no se construye todavía).** Hoy las confirmaciones y formularios cortos son un
   modal centrado (`.cd-modal`). En el teléfono conviene un cajón que sube desde abajo: los botones quedan al alcance del
   pulgar y el fondo sigue a la vista. La lámina `#piezas` a 390 px muestra cómo se vería.
   - **Dónde sí:** confirmaciones («Deshacer cierre», «Borrar todo el día», «El conteo no cuadra»), autorización de gerencia,
     motivo de borrado, «Nuevo movimiento» y la edición de una fila de Movimientos.
   - **Dónde no:** flujos largos o con cámara («Agregar factura / movimiento», el cierre mismo): siguen a pantalla completa.
     En escritorio (≥ 700 px) sigue el diálogo centrado.
   - **Opción A — CSS propio sobre el modal actual:** mismo DOM y mismas pruebas; en celular se ancla abajo con esquinas
     redondeadas arriba y `env(safe-area-inset-bottom)`. Sin dependencia nueva. No se cierra arrastrando (sí con «Volver»,
     tocando afuera y Escape).
   - **Opción B — Vaul:** componente de cajón sin estilos, se viste con nuestro CSS y variables. Suma arrastrar para cerrar,
     foco atrapado y bloqueo del scroll del fondo. Cuesta una dependencia (y la de diálogo de Radix que trae), y hay que
     comprobar antes: compatibilidad con React 19, estado de mantenimiento del paquete, y el teclado de iOS con campos de
     monto dentro del cajón (probar en el teléfono real del local).
   - **Recomendación:** empezar por A en el PR 3 (alcanza para confirmaciones) y hacer una prueba corta de B en staging antes
     de pasar formularios al cajón. Si B no pasa la prueba del teclado, queda A.

## 4. Reglas de texto

**Diferencia** (contado − debería). Nunca un número con signo y color como único mensaje.

| Caso | Titular | Nota | Color |
|---|---|---|---|
| 0 | Cuadra | Sin diferencia. | musgo |
| Menos de ₡500 | Cuadra | Faltan ₡300: dentro de la tolerancia (menos de ₡500). | musgo |
| Faltante de ₡500 o más | Faltan ₡1.951 | Fuera de tolerancia (₡500). + qué sigue | laca |
| Sobrante de ₡500 o más | Sobran ₡2.300 | Fuera de tolerancia (₡500). + qué sigue | oro-texto |

- En curso: «Faltan / Sobran». Día cerrado: «Faltaron / Sobraron», y fuera de tolerancia agrega «quedó registrada como ajuste de cierre».
- Dólares en línea aparte, misma regla con US$1: «Dólares: cuadra, sin diferencia» / «Dólares: faltan $ 2,00, fuera de tolerancia (US$1)» (dólares con `fd`, como el resto de Caja).
- La tolerancia sale de las constantes que ya existen (`OVER_SHORT_TOL`, ₡500 / US$1); el texto no la recalcula.
- El cierre de la Caja Diaria usa las mismas palabras (hoy dice «de más» / «faltante»).

**Montos.** Signo antes del símbolo y con menos tipográfico: `−₡11.500`. **Déficit** en Caja Diaria: la cifra «Disponible» en
laca con la nota «Déficit: se pagó ₡… más que el fondo» y un aviso con qué hacer.

**Resto.** Sin emojis ni signos como ícono en botones, pestañas y títulos («🔒 Cierre del día» → «Cierre del día»). Sin mayúsculas
sostenidas en botones. Voseo, sin saludos ni mascota; el Daruma queda chico en la cabecera, como marca.

## 5. Qué NO cambia

- Lógica, cálculos, RPC, esquema y datos. Ninguna migración.
- Sagrados: `cashUtils.ts`, `cierrePozo.ts`, `tipCalculations.ts`, `posFiscal.ts` no se tocan (hash en cada PR).
- Permisos por rol, autorizaciones de gerencia, confirmaciones, tolerancias, reconteo y motivo obligatorio.
- Orden de los pasos y nombres de los campos que usa el personal (salvo quitar emojis y lo de §4).
- Shell (menú lateral y barra inferior), offline, tiempo real y correos.

## 6. Plan de construcción (PRs chicos)

Todos: solo presentación, pruebas que buscan por texto ajustadas, guía `docs/sop-app/6.2 Caja.md` al día en el mismo PR,
recorrido con capturas (`satori-verificar`) y validación física del dueño antes del merge.

| PR | Contenido | Riesgo |
|---|---|---|
| 0 | Arreglo de la barra de fases (§3.2) con su prueba. Puede salir ya, sin esperar el rediseño | Bajo; toca `CashCierre.tsx` → verificador independiente |
| 1 | `estandar.css` con tokens y clases bajo `.est` + piezas (`Cifra`, `Aviso`, `Fases`, `Pildora`, botones) con pruebas + `@tabler/icons-react` e `iconos.ts`. Sin pantallas | Bajo: nada lo usa todavía; una dependencia nueva |
| 2 | Cabecera y pestañas de Caja (margen seguro, sin emoji, títulos) | Bajo |
| 3 | Cierre del día — día cerrado + helper puro `textoDiferencia()` con pruebas + confirmaciones como cajón en celular (opción A) | Bajo |
| 4 | Cierre del día — en curso (campos, conteo, verificación a la derecha en escritorio, «Correcciones») | Medio: pantalla larga |
| 5 | Caja Diaria | Medio |
| 6 | Movimientos | Medio |
| 7 | Proveedores, Pendientes, Resumen, modales; borrar las clases `cd-*` / `cierre-*` que queden sin uso | Bajo |

## 7. Cómo se extiende

Ventas, Propinas y Bandeja ya comparten el shell de Caja (`.tips-module`, `.cd-module-header`, `.cd-nav-tabs`). Cada módulo
pasa igual: clase `.est` en su raíz, cabecera y pestañas del PR 2, y sus tarjetas por `Cifra`, avisos por `Aviso`, estados por
`Pildora`. Sigue todo en CSS propio con variables: sin Tailwind ni librerías de componentes. Orden sugerido por uso: Propinas → Bandeja → Ventas (que ya está más cerca). Cuando no quede módulo sin `.est`, los
valores suben a `:root` y la clase se elimina.

## 8. Decisiones para el dueño

**Resueltas (24-nov ~01:55 CR, al aprobar la maqueta):**

| # | Decisión | Quién |
|---|---|---|
| 1 | Fondo **crema** `#faf8f4` | el dueño |
| 2 | Sobrante fuera de tolerancia en **oro** (verde = cuadra, laca = faltó) | el dueño |
| 3 | Cifras en **DM Sans** | el dueño |
| 4 | Movimientos: **lista de tarjetas en celular**, tabla en compu (PR aparte después del 6) | el dueño |
| 5 | «Por qué hubo diferencia» en el día cerrado: **solo si se lee del movimiento de ajuste que la pantalla ya carga**; si exige una consulta nueva, queda afuera | recomendación de la spec (el dueño no la mencionó) |
| 6 | `@tabler/icons-react` **sí**; Vaul se decide después de la prueba de §3.7 (empezar por la opción A) | recomendación de la spec (el dueño no la mencionó) |

**PR 0 (24-nov):** barra de fases, «Diferencia» en palabras (en curso y día cerrado; helper `textoDiferencia.ts`, que el
PR 3 iba a crear) y la causa real del título cortado: **no era el margen seguro** (la app no usa `viewport-fit=cover`,
así que `env(safe-area-inset-top)` vale 0) sino que cabecera y pestañas eran las dos `sticky; top: 0` y al bajar las
pestañas tapaban el título. La cabecera seguida de pestañas deja de ser sticky. La regla también alcanza a **Mi Rendimiento**
(su cabecera va seguida de `.cd-nav-tabs`): mismo arreglo, declarado en la guía 6.5. Ronda 2 (verificador): con dos
monedas el titular del día cerrado muestra el **peor** estado (un faltante en US$ no se lee «Cuadra»); la caja del ajuste
va en oro si solo sobra; fondo `--c-oro-fondo-texto` (#f8f5ee) para texto oro chico (4,6:1). Quedan para el PR 3/4: el modal «El conteo
no cuadra», el resumen antes de confirmar y el bloque del motivo, que siguen con el monto con signo.

**PR 1 (24-nov):** `src/styles/estandar.css` (tokens y clases `est-*`, todo bajo `.est`; redefine también los alias
`--t-border`, `--t-panel`, `--vt-border`, `--vt-panel`, que `:root` resuelve con los valores viejos), piezas en
`src/shared/ui/estandar.tsx` (`Cifra`, `Cifras`, `Aviso`, `Pildora`, `Fases`, `Boton`) con pruebas, `@tabler/icons-react`
3.52.0 fijo y `src/shared/ui/iconos.ts`. A diferencia del plan de §6 («sin pantallas»), por pedido del coordinador Caja ya
lleva `.est` (fondo crema) y el primer ícono (flecha de «Deshacer cierre»). Las tarjetas internas siguen blancas hasta los
PR 3–7. Las clases nuevas llevan prefijo `est-` para no chocar con las de `index.css` (`.pildora-*`, `.aviso`). Ronda 2 (verificador): foco
de botones en tinta (15:1 sobre crema; el oro daba 2,9:1), píldora «pendiente» sobre `--c-oro-fondo-texto` (4,6:1) y guardas
de prueba: contraste mínimo de los tokens, regla de foco, íconos solo por nombre y versión fija de Tabler.


**PR 3/4 (25-nov, signos):** el modal «El conteo no cuadra» y el resumen antes de confirmar usan `resumenDiferencia`
(palabras y color del hecho, `CLASE_TONO`), como el cartel en curso. El resumen suma «Ajuste de cierre en Caja Fuerte»
con signo por moneda (`lineasAjuste` / `montoConSigno`: `−₡1.951` laca · `+₡2.300` oro), con los mismos montos del
`ajuste` que se manda a la RPC, y el motivo. «Propinas pagadas en el cierre» pasa a `−₡…`. La caja aparte de dólares
del cierre en curso se quita: repetía «Dólares: …» (menor del verificador del #348). A 390 px: la apertura deja de
pisar la regla de `.cd-grid2` (fecha debajo) y `Row2` usa `minmax(0, 1fr)`. Ronda del verificador: en celular cada fila
del conteo es una grilla (etiqueta arriba a lo ancho, ₡ y $ a media fila; entra ₡9.999.999; `table-layout: fixed`
dejaba ~4 cifras); los dólares de Caja van con `fd` (`$ 2,00`, coma decimal) en el cartel, el modal, el resumen, la
tabla y la confirmación de «Borrar TODO el día»; con monedas en sentidos opuestos el título del ajuste va sin tipo
(`tituloAjuste`; el `ajuste_tipo` que se guarda no cambia); «Propinas pagadas en el cierre» en tinta (salida).
`CashCierre.payload.test.tsx` fija que el payload a `cerrarDiaCompleto` es idéntico al de main en seis casos.
La caja del motivo («Diferencia detectada») queda en palabras, sin montos con signo (regla del verificador del #348).
Sin cambios de cálculo ni de lo que se guarda.
Texto original de las opciones:

1. **Fondo crema** en vez del blanco actual (el blanco fue una decisión anterior del rediseño). Recomendado: crema, como los SOP.
2. **Sobrante fuera de tolerancia en oro**, no en verde como hoy: que sobre plata también es un error de caja. Recomendado: oro.
3. **Cifras en DM Sans** (hoy los números grandes van en Cormorant). Recomendado: DM Sans.
4. **Movimientos en celular como lista** (tocar la fila abre la edición) en vez de la tabla de 13 columnas. Cambia cómo se edita
   en el teléfono; en escritorio sigue la tabla. Recomendado: sí, en un PR aparte después del 6.
5. **Mostrar «Por qué hubo diferencia» en el día cerrado.** Hay que confirmar que el motivo se lee del movimiento de ajuste que
   la pantalla ya carga; si exige una consulta nueva, queda afuera.
6. **Dependencias nuevas:** `@tabler/icons-react` (íconos; recomendado: sí) y, más adelante, Vaul para el cajón
   (recomendado: decidir después de la prueba de §3.7).
