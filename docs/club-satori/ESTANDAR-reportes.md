# Estándar de reportes Satori (v1, 05-nov-2026)

Vale para todo reporte en PDF o en pantalla: el de créditos de Grok, los análisis para socios y los reportes que genere la app.

**Referencias:**
- `satori-creditos-oct26-v4.pdf` es el ejemplo terminado;
- `satori-creditos-oct26-v4.html` tiene el HTML y el CSS completos, para copiar.

Si hacen falta, pedíselos al dueño.

## 1. Idea
- **Un informe de Satori se tiene que leer como una carta del restaurante, no como un panel de control:** papel blanco, tipografía con carácter, oro solo como hilo y mucho aire.
- **Una sola cosa protagonista por página:** el número o la frase que importa. Todo lo demás, callado.
- **Nada se corta ni se trunca:** si no entra, se reescribe o se mueve al anexo.

## 2. Color
| Nombre | Hex | Uso |
|---|---|---|
| Tinta | `#1f2120` | Texto principal, títulos y números |
| Gris | `#6e706c` | Bajadas, notas, encabezados de tabla y datos secundarios |
| Gris claro | `#9a9b96` | Pie de página, ejes |
| Línea | `#e6e4de` | Separadores entre filas |
| Panel | `#f6f5f2` | Único fondo de recuadro (avisos de estado). Máximo uno por página |
| Oro Satori | `#b48e50` | Filetes bajo la cabecera y bajo los encabezados de tabla, barras destacadas del gráfico. **Nunca para texto chico** (no tiene contraste suficiente) |
| Oro texto | `#8a6a33` | Texto en oro: verbos de acción de plata, códigos DAT |
| Laca | `#a3392d` | Bajas, alertas y «llamar». Solo para malas noticias |
| Musgo | `#3e6a4c` | Subas, «agradecer» y estados cerrados |
| Temporada alta | `#f4f0e6` | Franja de fondo en gráficos |

- Fondo de página siempre blanco.
- Prohibido: fondos de color en tablas, encabezados azules llenos, más de un acento por elemento, sombras.

## 3. Tipografía
Dos familias, las de la marca. Se incrustan en el HTML (base64) para que el PDF salga igual en cualquier máquina. Fuente: Google Fonts o el paquete `@fontsource`.
- **Cormorant Garamond (500, 600 y 500 itálica):** títulos, números grandes y verbos de acción.
- **DM Sans (400, 500, 600):** todo el resto. Siempre con `font-variant-numeric: tabular-nums lining-nums`.

| Rol | Familia | Tamaño / interlínea | Peso | Notas |
|---|---|---|---|---|
| Marca en la cabecera | Cormorant | 17 pt | 600 | «Satori», con espaciado de letras de +0,02 em |
| Título de página | Cormorant | 26 pt / 1,05 | 500 | Una o dos palabras: «Octubre 2026», «Referentes», «Plata» |
| Bajada | DM Sans | 9,8 pt / 1,5 | 400, gris | Una o dos oraciones con la conclusión, ancho máximo 150 mm |
| Número grande | Cormorant | 28 pt / 1,0 | 500 | Cifras clave. Variación debajo en DM Sans 8,5 pt 600, en musgo o laca |
| Título de sección | Cormorant | 14 pt / 1,2 | 600 | En minúscula normal, **nunca en mayúsculas** |
| Nota de sección | DM Sans | 8,2 pt | 400, gris | Qué muestra la sección o su hallazgo, en una línea |
| Verbo de acción | Cormorant itálica | 13 pt | 500 | Color según el tipo: laca, musgo, oro texto o tinta |
| Cuerpo | DM Sans | 9,5 pt / 1,5 | 400 | |
| Tabla: celdas | DM Sans | 9 pt / 1,35 | 400; nombres en 600 | |
| Tabla: encabezado | DM Sans | 7,8 pt | 500, gris | En minúscula normal, alineado como su columna |
| Notas al pie de tabla | DM Sans | 8 pt | 400, gris | |
| Pie de página | DM Sans | 7,5 pt | 400, gris claro | |

**Mínimo absoluto:** 7,5 pt. Nada de monoespaciadas, nada de MAYÚSCULAS para etiquetas, nada de negrita para resaltar una palabra suelta dentro de una frase.

## 4. Página y grilla
- **A4 vertical.** Márgenes: 13 mm arriba, 17 mm a los lados, 14 mm abajo. El pie va a 8 mm del borde.
- **Una columna**, o dos columnas iguales con 8 mm de separación. Nada de tres columnas de texto.
- **Espacios verticales:**
  - cabecera → título: 5,5 mm;
  - título → bajada: 1,5 mm;
  - bajada → contenido: 5 mm;
  - entre secciones: 4,6 a 5,5 mm.
- **Alineación:** texto a la izquierda; números a la derecha. Nunca justificado ni centrado, salvo los ejes de gráficos.
- **Máximo 3 páginas** más un anexo CSV. Cada página tiene que terminar al menos 10 mm antes del pie. Si no entra, se recorta contenido (menos filas, una nota menos); no se achica la letra por debajo de la escala.

## 5. Componentes
- **Cabecera:**
  - «Satori» a la izquierda;
  - a la derecha, en gris, el nombre del reporte y el período en dos líneas;
  - filete de oro de 0,75 pt debajo.
- **Cifras:**
  - 4 columnas separadas por filetes verticales de 0,75 pt color línea;
  - número en Cormorant, etiqueta en gris y variación coloreada con «vs. valor anterior» en gris.
  - Sin cajas ni tarjetas.
- **Aviso de estado:** el único recuadro con fondo panel, con esquinas de 1,5 mm. Se usa para explicar datos provisorios.
- **Acciones:**
  - lista con un filete tinta de 0,75 pt arriba y líneas finas entre filas;
  - tres columnas: verbo (30 mm), quién + por qué (resto), cifra (30 mm, a la derecha, en 600);
  - máximo 5 acciones y una línea de motivo cada una.
- **Tablas:**
  - sin borde exterior ni fondo;
  - filete de oro bajo el encabezado y líneas de 0,5 pt entre filas;
  - primera y última columna pegadas al margen;
  - anchos fijos con `<colgroup>`;
  - el nombre en 600 y el negocio en gris (en la misma celda si hace falta);
  - **los textos largos pasan a una segunda línea, nunca «…»**.
  - Máximo 10 filas; el resto va al anexo.
- **Variaciones:**
  - ▲ y % en musgo si es > 130 %; ▼ y % en laca si es < 70 %; el resto en gris, sin flecha.
  - Base insuficiente: «nuevo ritmo» en itálica musgo, sin %.
- **Tarjetas de equipo o ranking corto:** número en Cormorant 19 pt, nombre en 600 y detalle en gris; separadas por filetes, sin cajas.
- **Calidad de datos:**
  - lista de tres columnas: código (oro texto, 600), estado (laca abierto / oro nuevo / musgo cerrado) y descripción;
  - los cerrados, agrupados en una línea.
- **Pie de página:** «Satori, [reporte], [período]» a la izquierda y «1 de 3» a la derecha.

## 6. Gráficos
- **Barras finas** (56 % del ancho de cada mes), sin bordes.
  - Período destacado: oro `#b48e50`.
  - Resto: `#cfcbc1`.
  - Dato incompleto: rayado gris con borde fino.
- **Franja de temporada alta** en `#f4f0e6` detrás.
- **Ejes:**
  - 3 líneas horizontales color línea, con valores a la izquierda en 8,5 px gris;
  - meses con una letra minúscula;
  - el año en una fila aparte, debajo, con una marquita en enero. **Nunca superpuesto.**
- **Título:** el título de sección dice qué es. La nota de debajo dice el hallazgo.
- **Leyenda** en una línea, debajo, con muestras de 3 mm.

## 7. Redacción
- Oraciones cortas, voseo, sin jerga. Los nombres de las secciones dicen qué hay: «A contactar», no «Alertas de churn».
- **Fechas:** «15 jun 26» en tablas, «15 de junio» en texto. Meses en minúscula.
- **Números:**
  - punto de miles y coma decimal;
  - créditos con un decimal solo si no es entero (4,5 / 4);
  - colones con ₡ pegado (₡226.375);
  - porcentajes con espacio (60 %).
- **Variaciones:** «+60 % vs. 131». Nunca «−100 %» sobre un dato provisorio.
- **Nombres de referentes:** tal como están en el sistema, limpiando solo el ruido técnico («(Grupo)», «PM» final y numeraciones como «11/»).
- **Cada página abre con su conclusión** en la bajada.

## 8. Cómo producirlo
- **Proceso:** HTML con CSS → Chromium (Playwright) → PDF A4, `printBackground: true`, márgenes 0 (los márgenes los pone la página).
  - **En la app (navegador):** misma hoja de estilos, con `@page { size: A4; margin: 0 }` e impresión del navegador; o generación del lado del servidor si CC lo justifica.
- **Fuentes en base64 dentro del HTML.** Sin dependencias de internet al renderizar.

**Antes de entregar:**
1. **Sin desborde:** ninguna página más alta que A4 (medir el `scrollHeight` de cada página).
2. **Captura:** sacar una captura de cada página y mirarla. Nada cortado, nada superpuesto, ninguna palabra partida en tablas.
3. **Cifras:** las de la página 1 coinciden con las de las páginas 2 y 3.
4. **Privacidad:** cero teléfonos, correos o cédulas.
