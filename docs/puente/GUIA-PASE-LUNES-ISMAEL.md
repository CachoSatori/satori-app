# Guía del pase del lunes 09-nov (9:00 CR) — para Ismael, en una página

> Versión simple del paquete [`PASE-PROD-2026-11-09.md`](PASE-PROD-2026-11-09.md). Si algo de acá no coincide con el
> paquete, **vale el paquete** y se para. Ningún secreto va en un chat, ni en WhatsApp, ni en este documento.

**Qué pasa:** se agregan columnas nuevas a las ventas (081), una función que guarda cada envío del PoS de una sola vez
(082) y se cambia el receptor de ventas (Edge `ingest-ndf`). **Qué no pasa:** el agente de la PC del PoS no se toca, y
nada del Club. **Duración total:** ~1 h 45 min (45 min de pasos + 1 h mirando).

**Regla de oro:** desde las 9:00 **nadie mergea nada a `main`** hasta que Claude diga «Branching al día» (paso 9).

| # | Paso | Qué hace Ismael | Qué hace Claude | Tarda |
|---|---|---|---|---|
| 0 | Arranque | Firma el §11 del paquete. Dice quién mira el PoS. Abre AnyDesk a la PC del PoS. | Confirma que la rama y el código son los fijados (`e4678b3`) y que las huellas de los dos archivos coinciden. Avisa a las otras sesiones: `main` congelado. | 10 min |
| 1 | Mirar antes de tocar | En la PC: corre el comando que mide el **largo** del secreto del agente (no lo muestra) y dice el número. Prepara la carpeta de vuelta atrás (`4d3513a`). | En prod, solo lectura: ledger en 080, la función no existe, el agente late sin error, foto de las últimas facturas, versión del receptor (v1). Descarga la copia del receptor de hoy. | 10 min |
| 2 | Columnas nuevas (081) | Mira. | Corre la 081 y su registro en una sola tanda; verifica la huella y las 7 columnas. Mira que el agente siga entrando. | 5 min |
| 3 | Función nueva (082) | Mira. | Corre la 082 y su registro en una sola tanda; verifica huella, permisos y una llamada en vacío. | 5 min |
| 4 | Secretos por local | Genera en la PC el secreto de Nosara, arma el mapa (Santa Teresa = el secreto de hoy), lo **valida** con el comando del paquete (dice `True`/`True`, sin mostrar nada) y lo pega en el panel. | Le dicta los pasos y espera el `True`/`True`. No ve ningún secreto. | 10 min |
| 5 | Receptor nuevo | En la PC (o donde tenga la CLI): corre el `deploy` con `--no-verify-jwt`. | Verifica en el panel: versión v2, «Enforce JWT verification» apagado. Anota la hora exacta. | 5 min |
| 6 | Prueba de humo | Mira el PoS: cuando entre la primera venta, dice el número de factura y su total. | Prueba la puerta (debe responder «No autorizado» del receptor), mira que el agente entre 3 ciclos, que lo releído no se duplique, que la factura nueva llegue una vez con sus líneas. | 10–30 min |
| 7 | Primera hora | Cada 15 min, elige 2 facturas del PoS y le pasa número y total. | Cada 15 min (4 veces): latido, ventas que entran, duplicados, cuadre con esas 2 facturas, mesas abiertas, logs. | 60 min |
| 8 | Cierre | Dice «pasa» o «paramos». Firma la bitácora. | Completa la bitácora del §11. | 5 min |
| 9 | Branching al día | Da el OK para mergear el #71. | Mergea el #71 (solo los dos archivos), espera que Branching diga «All migrations are up to date» y recién ahí levanta el congelamiento de `main`. | 10 min |

## Cuándo paramos (criterios de aborto, en palabras)
Si pasa cualquiera de estas, **paramos sin discutir** y volvemos al receptor de antes (vuelta atrás, abajo):
1. **«No autorizado» en el log del agente** después del cambio → el agente no puede entrar.
2. **El agente no late:** error dos ciclos seguidos, o más de 5 minutos sin señal con el local abierto.
3. **Una factura con líneas repetidas** que no se explica mirando el PoS (por ejemplo, el mismo plato dos veces sin que
   lo hayan pedido dos veces).
4. **Una factura cerrada en el PoS que no llega** en ~4 minutos, o llega con otro total o con otra cantidad de líneas.
5. **El receptor muestra errores** en su log («excepción» o «no se pudo guardar el lote»).
6. **La puerta quedó con «JWT» prendido** y no se arregla volviendo a desplegar.
7. **La prueba de humo no pasa en 30 minutos** desde la primera venta.
8. **El receptor falla o tarda demasiado (error 5xx o timeout) dos ciclos seguidos**, aunque después se recupere.

## Vuelta atrás (si paramos)
1. **Primero el receptor de antes** (Ismael, desde la carpeta de `4d3513a`, con el mismo `--no-verify-jwt`). Claude
   verifica que el agente vuelva a entrar. ~10 min.
2. **Después**, solo si hace falta, se saca la función 082 (Claude). Nunca al revés: sin la función y con el receptor
   nuevo no entra ninguna venta.
3. Las columnas de la 081 pueden quedar: no molestan.
4. Las ventas no se pierden: el agente vuelve a leer desde donde quedó.

## Qué NO hace nadie el lunes
Cambiar el agente de la PC, tocar el Club, aplicar la 085, mergear cualquier otra cosa a `main`, o mostrar un secreto.
