# Guía del pase del puente (v2) — para el dueño, en una página

> Versión simple del paquete [`PASE-PROD-2026-11-09.md`](PASE-PROD-2026-11-09.md) (el nombre queda por historia: el pase
> se movió y la fecha nueva es cuando Grok dé GO). Si algo de acá no coincide con el paquete, **vale el paquete** y se
> para. **Ningún secreto se copia, se pega ni se muestra**: ni en un chat, ni en WhatsApp, ni en el portapapeles, ni en
> la pantalla.

**Qué pasa:** se agregan columnas nuevas a las ventas (081), una función que guarda cada envío del PoS de una sola vez y
que **calcula el cursor con un «corte seguro»** (082 v2: si hay una factura en curso por debajo, el cursor la espera) y
se cambia el receptor de ventas (Edge `ingest-ndf`).

**Del agente de la PC del PoS:** su **código no se toca** (sigue en `4d3513a6df8e838dd5c0442b05a580e06ce9db9d`; nada de
checkout, pull ni deploy en `C:\satori\satori-app-prod`). Lo único que se le hace: **detener su tarea** antes del cambio
de receptor y **volver a iniciarla** después (para que nadie escriba durante el cambio); y, **solo si su secreto mide
menos de 32**, cambiar la línea `INGEST_SECRET=` del `.env` que manda, con la tarea detenida. **Nada del Club.**

**Quiénes (dos, por rol):** el **dueño** ejecuta y firma; el **encargado del turno** controla (mira el PoS y la app, elige
las facturas del cuadre, lee cada resultado contra el esperado) y firma también. No es la misma persona. Claude dicta y
revisa; no ve ningún secreto.

**Regla de oro:** desde que empieza el pase **nadie mergea nada a `main`** hasta que Claude diga «Branching al día».
**Todo en PowerShell**, y cada consola arranca con `Stop` y la función `Ok` del paquete: si un comando falla, se corta.

| # | Paso | Qué hace el dueño | Qué hace el encargado | Qué hace Claude | Tarda |
|---|---|---|---|---|---|
| 0 | Arranque | Firma. Clona el repo en `C:\satori\pase-v2` (**nunca** en `satori-app-prod`) en el SHA completo del paquete; saca los dos `.sql` con el bloque 0.5 (el script compara las huellas y corta si no dan). Muestra que el agente sigue en `4d3513a6…`. | Confirma que está y que mira el PoS. | Revisa SHA y huellas. Avisa: `main` congelado. | 15 min |
| 1 | Mirar antes de tocar | Corre 1.9 (qué `.env` manda y el **largo** del secreto, nunca el valor) y el día según el PoS (1.10). Prepara la carpeta de vuelta atrás. | Anota facturas y venta del PoS. | En prod, solo lectura: ledger, la función y la columna no existen, el agente late, **corte y pendientes por local**, versión del receptor. Descarga la copia del receptor de hoy. | 15 min |
| 2 | Columnas nuevas (081) | Corre el bloque generado por el script. | Mira. | Verifica huella y columnas; el agente sigue entrando. | 5 min |
| 3 | Función nueva (082 v2) | Corre el bloque generado por el script. | Mira. | Verifica huella, columna nueva, permisos, llamada en vacío. | 5 min |
| 4 | Secretos por local | Corre el script 4.2: arma el mapa (Santa Teresa = el secreto del agente; Nosara, uno aleatorio de un solo uso), lo **valida** (exactamente los dos locales, texto de 32 o más, sin repetidos: si no, corta) y lo carga con el CLI desde un archivo temporal que se borra. | Mira que no aparezca ningún valor en pantalla. | Compara la **huella** del panel con la del mapa (el script corta si no coinciden). | 10 min |
| 5 | Cambio del receptor | **Detiene la tarea del agente** (5.0), espera que suelte; deploy desde `C:\satori\pase-v2`; **vuelve a iniciar la tarea** (5.2). | Toma el tiempo con la tarea detenida (menos de 5 min). | Confirma que nadie escribe, anota el «corte al cambiar» por local; verifica versión v2 y «JWT» apagado; anota la hora **con `-06:00`**. | 10 min |
| 6 | Prueba de humo | Cuando entre la primera venta, dice número y total. | Compara con el PoS. | Puerta («No autorizado» del receptor), 3 ciclos, sin duplicados, **sin descartes**, la factura nueva una vez con sus líneas. | 10–30 min |
| 7 | Primera hora | — | Cada 15 min elige 2 facturas del PoS y lee número y total. | Cada 15 min: latido, ventas, duplicados, cuadre, descartes, corte seguro. Al final, **conciliación** con el PoS (facturas por estado y venta total); si falta algo, **replay** del día desde el PoS. | 60 min |
| 8 | Cierre | Dice «pasa» o «paramos». Firma. Muestra otra vez que el agente sigue en `4d3513a6…`. | Firma la bitácora. | Completa la bitácora. | 5 min |
| 9 | Branching al día | Da el OK para mergear el #71. | — | Mergea el #71, espera «All migrations are up to date» y recién ahí levanta el congelamiento. | 10 min |

## Cuándo paramos (en palabras)
Si pasa cualquiera de estas, **paramos sin discutir** y volvemos al receptor de antes:
1. **«No autorizado» en el log del agente** después de volver a iniciarlo.
2. **El agente no late:** error dos ciclos seguidos, o más de 5 minutos sin señal con el local abierto; o la tarea no
   vuelve a arrancar.
3. **Una factura con líneas repetidas** que no se explica mirando el PoS.
4. **Una factura cerrada en el PoS que no llega** en ~4 minutos, o llega con otro total o con otra cantidad de líneas.
5. **El receptor muestra errores** («excepción» o «no se pudo guardar el lote»).
6. **La puerta quedó con «JWT» prendido** y no se arregla volviendo a desplegar.
7. **La prueba de humo no pasa en 30 minutos** desde la primera venta.
8. **El receptor falla o tarda demasiado (5xx o timeout) dos ciclos seguidos**, aunque después se recupere.
9. **El receptor contesta «bien» pero descarta ventas** (un 200 con descartes).
10. **Desfase con el PoS** en la conciliación que no se explica, o una factura «en curso» vieja que el replay no arregla.

El conteo de facturas «en curso» por debajo del cursor ya **no es la defensa**: la defensa es la 082 v2 (probada contra
la función real en staging). El conteo queda como **control extra**; si da algo, se corrige con el replay del día.

## Vuelta atrás (si paramos)
1. **Primero el receptor de antes** (el dueño, desde `C:\satori\ingest-ndf-v1`, con el mismo `--no-verify-jwt`). Claude
   verifica que el agente vuelva a entrar. ~10 min.
2. **Después**, solo si hace falta, se saca la función 082 (nunca al revés).
3. Las columnas de la 081 y la columna nueva del cursor pueden quedar: no molestan.
4. Las ventas no se pierden: el agente vuelve a leer desde su corte, y si falta algo, replay del día desde el PoS.
5. **`main` se descongela** según lo que haya quedado aplicado (paquete §9.6).

## Qué NO hace nadie
Cambiar el **código** del agente; copiar, pegar o mostrar un secreto; tocar el Club; aplicar la 085; mergear otra cosa a
`main`.
