# Guía del pase del puente (v2) — para el dueño, en una página

> Versión simple del paquete [`PASE-PROD-2026-11-09.md`](PASE-PROD-2026-11-09.md), el **único vigente** (el nombre de
> los archivos queda por historia; la fecha es cuando Grok dé GO). Si algo de acá no coincide con el paquete, **vale el
> paquete** y se para. **Ningún secreto se copia, se pega ni se muestra**: ni en un chat, ni en WhatsApp, ni en el
> portapapeles, ni en la pantalla.

**Qué pasa:** columnas nuevas en las ventas (081); una función que guarda cada envío del PoS de una sola vez y que
**calcula el cursor con un «corte seguro»** (082 v2: si hay una factura en curso por debajo, el cursor la espera); y el
receptor de ventas nuevo (Edge `ingest-ndf`, el mismo código de `e4678b3`). Código del pase:
`705b830f1759e39112b761bf7d77f15d6cc70368`.

**Del agente de la PC del PoS:**
- Su **código no se toca**: sigue en `4d3513a6df8e838dd5c0442b05a580e06ce9db9d`; nada de checkout, pull ni deploy en
  `C:\satori\satori-app-prod`.
- Lo único que se le hace: **detener su tarea** antes de cambiar la base y el receptor, y **volver a iniciarla** después,
  para que nadie escriba durante el cambio (detenida 15 minutos como mucho).
- **Solo si su secreto mide menos de 32:** con la tarea detenida, el script cambia la línea `INGEST_SECRET=` del `.env`
  que manda.

**Nada del Club.**

**Quiénes (dos, por rol):** el **dueño** ejecuta y firma. El **encargado del turno** controla y firma también: mira el PoS
y la app, elige las facturas del cuadre y lee cada resultado contra el esperado. No pueden ser la misma persona. Claude
dicta y revisa; no ve ningún secreto.

**Regla de oro:** desde que empieza el pase **nadie mergea nada a `main`** hasta que Claude diga «Branching al día».
**Todo en PowerShell.** Cada consola arranca con el bloque fail-stop del paquete: si un comando falla, se corta y **no se
sigue**.

| # | Paso (sección del paquete) | Qué hace el dueño | Qué hace el encargado | Qué hace Claude | Tarda |
|---|---|---|---|---|---|
| 0 | Arranque (§0) | Firma. Clona el repo en `C:\satori\pase-v2` (**nunca** en `satori-app-prod`) en el SHA del pase. Corre los bloques 0.4, 0.5 y 0.8: comparan SHA y huellas y cortan si algo no da. | Confirma que está y que mira el PoS. | Revisa que cada bloque termine en «ok». Avisa que `main` queda congelado. | 15 min |
| 1 | Mirar antes de tocar (§1) | Corre 1.9, que dice **qué `.env` manda** y el **largo** del secreto (nunca el valor), y el día según el PoS (1.10). | Anota facturas por estado y venta del PoS. | En prod, solo lectura: ledger, función y columna, latido, **corte y pendientes por local** (consulta C), versión del receptor. Copia del receptor de hoy. | 15 min |
| 2 | Columnas nuevas (§2) | Genera los dos bloques (el script compara las huellas antes) y corre `bloque_081.sql`. | Mira. | Verifica huella y columnas; el agente sigue entrando. | 5 min |
| 3 | Secretos por local (§3) | Corre el script 3.2. Arma el mapa con el secreto que el agente usa de verdad (lo lee con el parser del propio agente) y uno nuevo para Nosara, lo valida (si algo no da, corta), lo carga con el CLI y borra el archivo. | Mira que no aparezca ningún valor en pantalla. | Compara la **huella** del panel con la del mapa (el script corta si no coinciden). | 10 min |
| 4 | El cambio (§4) | **Detiene la tarea del agente** y espera que suelte. Corre `bloque_082.sql`. Despliega el receptor desde `C:\satori\pase-v2`. **Vuelve a iniciar la tarea.** | Toma el tiempo con la tarea detenida (15 min como mucho). | Confirma que nadie escribe (2 minutos sin latido) y anota el corte por local. Verifica la 082, la versión v2 y «JWT» apagado. Anota la hora **con `-06:00`**. | 15 min |
| 5 | Prueba de humo (§5) | Cuando entra la primera venta, dice número y total. | Compara con el PoS. | Puerta («No autorizado» del receptor), 3 ciclos, sin duplicados, **sin descartes**, la factura nueva una vez con sus líneas. | 10 a 30 min |
| 6 | Primera hora (§6) | — | Cada 15 min elige 2 facturas del PoS y lee número y total. | Cada 15 min: latido, ventas, duplicados, cuadre, descartes, consulta C. Al final, **conciliación** con el PoS. Si quedó alguna factura «en curso» vieja, **replay** del día y control en dos ciclos. | 70 min |
| 7 | Cierre | Dice «pasa» o «paramos». Firma. Muestra otra vez que el agente sigue en `4d3513a6…`. | Firma. | Completa la bitácora. | 5 min |
| 8 | Branching al día (§9) | Da el OK para mergear el #71. | — | Mergea el #71, espera «All migrations are up to date» y recién ahí levanta el congelamiento. | 10 min |

**Total: 2 h 35 a 2 h 55.**

## Cuándo paramos (los mismos 11 del paquete, §7)
Si pasa cualquiera de estas, **paramos sin discutir** y volvemos al receptor de antes (§8):
1. **«No autorizado» en el log del agente** después de volver a iniciarlo.
2. **El agente no late:** error dos ciclos seguidos, o más de 5 minutos sin señal con el local abierto.
3. **Una factura con líneas repetidas** que no se explica mirando el PoS.
4. **Una factura cerrada en el PoS que no llega** en 3 ciclos (unos 4 minutos), o llega con otro total o con otra
   cantidad de líneas.
5. **El receptor muestra errores** («excepción» o «no se pudo guardar el lote»).
6. **La puerta quedó con «JWT» prendido** y no se arregla volviendo a desplegar.
7. **La prueba de humo no pasa en 30 minutos** desde la primera venta.
8. **El receptor falla o tarda demasiado (5xx o timeout) dos ciclos seguidos**, aunque después se recupere.
9. **El receptor contesta «bien» pero descarta ventas** (un 200 con descartes).
10. Cualquiera de estas tres:
    - un **desfase con el PoS** en la conciliación que no se explica;
    - el corte por encima del máximo;
    - facturas «en curso» viejas que el replay no lleva a cerradas cuadrando con el PoS en dos ciclos.
11. **El agente no vuelve a arrancar**, o queda detenido más de 20 minutos.

El conteo de facturas «en curso» por debajo del cursor **no es la defensa**: la defensa es la 082 v2, probada contra la
función real en staging. El conteo queda como **control extra**. Nunca se da por bueno un 0 justo después de un replay:
cada factura afectada tiene que pasar a cerrada y cuadrar con el PoS en dos ciclos.

## Vuelta atrás (si paramos)
1. Se detiene la tarea del agente (como en el paso 4).
2. El dueño vuelve al receptor de antes, desde `C:\satori\ingest-ndf-v1` (`4d3513a6…`), con el mismo `--no-verify-jwt`.
3. Se vuelve a iniciar la tarea, y Claude verifica que el agente entra.
4. **Después**, solo si hace falta, se saca la función 082, con su precondición (nunca al revés).
5. Las columnas de la 081 y la del cursor pueden quedar: no molestan.
6. Lo que no haya entrado se busca con la **conciliación** contra el PoS y se recupera con el **replay** del día. Se
   verifica factura por factura; no se da nada por recuperado sin verlo.
7. **`main` se descongela** según lo que haya quedado aplicado (paquete §8.6).

## Qué NO hace nadie
- Cambiar el **código** del agente.
- Copiar, pegar o mostrar un secreto.
- Pegar en prod un UPDATE o un DELETE que no sea uno del Anexo A del paquete (con su precondición).
- Tocar el Club.
- Aplicar la 085.
- Mergear otra cosa a `main`.
