# Guía del pase del lunes 09-nov (9:00 CR) — para el dueño, en una página

> Versión simple del paquete [`PASE-PROD-2026-11-09.md`](PASE-PROD-2026-11-09.md). Si algo de acá no coincide con el
> paquete, **vale el paquete** y se para. Ningún secreto va en un chat, ni en WhatsApp, ni en este documento.

**Qué pasa:** se agregan columnas nuevas a las ventas (081), una función que guarda cada envío del PoS de una sola vez
(082) y se cambia el receptor de ventas (Edge `ingest-ndf`). **Del agente de la PC del PoS:** su **código no se toca**
(nada de checkout ni de pull en `C:\satori\satori-app-prod`: sigue en `4d3513a`). Lo único que se le puede tocar es,
**solo si su secreto mide menos de 32** (paso 1), la línea `INGEST_SECRET=` del archivo `.env` que manda y el reinicio de
su tarea (paquete §4.3); y, si el cursor quedara por encima de una factura en curso, detener e iniciar su tarea
alrededor de la corrección del cursor (paquete 1.10). **Nada del Club.** **Duración total:** ~1 h 45 min (45 min de pasos + 1 h mirando).

**Dos carpetas en la PC, que no se confunden:** `C:\satori\satori-app-prod` (el agente: solo se mira) y
`C:\satori\pase-e4678b3` (un clon aparte para el pase: ahí se hace todo lo del receptor). Todo en **PowerShell**.

**Regla de oro:** desde las 9:00 **nadie mergea nada a `main`** hasta que Claude diga «Branching al día» (paso 9).

| # | Paso | Qué hace el dueño | Qué hace Claude | Tarda |
|---|---|---|---|---|
| 0 | Arranque | Firma el §11 del paquete. Dice quién mira el PoS. Abre AnyDesk a la PC del PoS. Clona el repo en `C:\satori\pase-e4678b3` (**nunca** en `satori-app-prod`), deja ese clon en `e4678b3` y saca los dos `.sql` con el bloque 0.5 del paquete. Muestra que el agente sigue en `4d3513a` y sin cambios. | Confirma que el clon está en `e4678b3` y que las huellas (md5) de los dos archivos coinciden. Avisa a las otras sesiones: `main` congelado. | 15 min |
| 1 | Mirar antes de tocar | En la PC: corre el comando 1.9, que dice **qué archivo `.env` manda** y el **largo** del secreto del agente (no lo muestra); dice las dos cosas. Prepara la carpeta de vuelta atrás (`C:\satori\ingest-ndf-v1`, en `4d3513a`). | En prod, solo lectura: ledger en 080, la función no existe, el agente late sin error, **ninguna factura en curso por debajo del cursor** (1.4b: da 0), foto de las últimas facturas, versión del receptor (v1). Descarga la copia del receptor de hoy. | 10 min |
| 2 | Columnas nuevas (081) | Mira. | Corre la 081 y su registro en una sola tanda; verifica la huella y las 7 columnas. Mira que el agente siga entrando. | 5 min |
| 3 | Función nueva (082) | Mira. | Corre la 082 y su registro en una sola tanda; verifica huella, permisos y una llamada en vacío. | 5 min |
| 4 | Secretos por local | Genera en la PC el secreto de Nosara, arma el mapa (Santa Teresa = el secreto de hoy del agente), lo **valida** con el comando 4.0 del paquete (dice `True` tres veces y «santa-teresa = agente: True», sin mostrar nada) y lo pega en el panel. **Si en el paso 1 el largo dio menos de 32:** Santa Teresa lleva uno nuevo, y justo después del paso 5 se cambia en el `.env` que manda y se reinicia la tarea del agente (§4.3). | Le dicta los pasos y espera los `True`. No ve ningún secreto. | 10 min |
| 5 | Receptor nuevo | En la PC, **desde `C:\satori\pase-e4678b3`** (nunca desde `satori-app-prod`): corre el `deploy` con `--no-verify-jwt`. | Verifica en el panel: versión v2, «Enforce JWT verification» apagado. Anota la hora exacta **con su zona** (`-06:00`). | 5 min |
| 6 | Prueba de humo | Mira el PoS: cuando entre la primera venta, dice el número de factura y su total. | Prueba la puerta (debe responder «No autorizado» del receptor), mira que el agente entre 3 ciclos, que lo releído no se duplique, que la factura nueva llegue una vez con sus líneas. | 10–30 min |
| 7 | Primera hora | Cada 15 min, elige 2 facturas del PoS y le pasa número y total. | Cada 15 min (4 veces): latido, ventas que entran, duplicados, cuadre con esas 2 facturas, mesas abiertas, logs, y que no quede ninguna factura en curso por debajo del cursor (1.4b). | 60 min |
| 8 | Cierre | Dice «pasa» o «paramos». Firma la bitácora. | Completa la bitácora del §11. | 5 min |
| 9 | Branching al día | Da el OK para mergear el #71. | Mergea el #71 (solo los dos archivos), espera que Branching diga «All migrations are up to date» y recién ahí levanta el congelamiento de `main`. | 10 min |

## Cuándo paramos (criterios de aborto, en palabras)
Si pasa cualquiera de estas, **paramos sin discutir** y volvemos al receptor de antes (vuelta atrás, abajo):
1. **«No autorizado» en el log del agente** después del cambio → el agente no puede entrar. **Salvo** en el caso del
   secreto corto (paso 4): ahí el «No autorizado» es esperable entre el deploy y el cambio del `.env`; cuenta como aborto
   si sigue después de cambiarlo y reiniciar la tarea.
2. **El agente no late:** error dos ciclos seguidos, o más de 5 minutos sin señal con el local abierto.
3. **Una factura con líneas repetidas** que no se explica mirando el PoS (por ejemplo, el mismo plato dos veces sin que
   lo hayan pedido dos veces).
4. **Una factura cerrada en el PoS que no llega** en ~4 minutos, o llega con otro total o con otra cantidad de líneas.
5. **El receptor muestra errores** en su log («excepción» o «no se pudo guardar el lote»).
6. **La puerta quedó con «JWT» prendido** y no se arregla volviendo a desplegar.
7. **La prueba de humo no pasa en 30 minutos** desde la primera venta.
8. **El receptor falla o tarda demasiado (error 5xx o timeout) dos ciclos seguidos**, aunque después se recupere.

**No es aborto (se corrige y se sigue):** una factura **en curso** por debajo del cursor (1.4b da más de 0). Con el
receptor nuevo el cursor solo avanza (cambio aceptado y firmado por el dueño el 08-nov), así que se corrige con el paso
1.10 del paquete: el dueño detiene la tarea del agente, Claude baja el cursor en la base, el dueño la vuelve a iniciar y
el agente relee desde ahí, sin duplicar.

## Vuelta atrás (si paramos)
1. **Primero el receptor de antes** (el dueño, desde `C:\satori\ingest-ndf-v1`, la carpeta de `4d3513a`, con el mismo
   `--no-verify-jwt`). Claude verifica que el agente vuelva a entrar. ~10 min.
2. **Después**, solo si hace falta, se saca la función 082 (Claude). Nunca al revés: sin la función y con el receptor
   nuevo no entra ninguna venta.
3. Las columnas de la 081 pueden quedar: no molestan.
4. Las ventas no se pierden: el agente vuelve a leer desde donde quedó.
5. **`main` se descongela** según lo que haya quedado aplicado (paquete §9.6): si quedaron la 081 y la 082, se mergea igual
   el #71 y Branching al día; si se sacó la 082, un PR solo con la 081; si no quedó nada, se descongela enseguida.

## Qué NO hace nadie el lunes
Cambiar el **código** del agente de la PC (ni checkout, ni pull, ni deploy en `C:\satori\satori-app-prod`; el único
cambio posible es el `.env` del caso del secreto corto), tocar el Club, aplicar la 085, mergear cualquier otra cosa a
`main`, o mostrar un secreto.
