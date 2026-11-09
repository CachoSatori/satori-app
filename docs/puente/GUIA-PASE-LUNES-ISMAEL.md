# Guía del pase del puente (v2 con la 082 v3) — para el dueño, en una página

> Versión simple del paquete [`PASE-PROD-2026-11-09.md`](PASE-PROD-2026-11-09.md), el **único vigente** (el nombre de
> los archivos queda por historia; la fecha es cuando Grok dé GO). Si algo de acá no coincide con el paquete, **vale el
> paquete** y se para. **Ningún secreto se copia, se pega ni se muestra**: ni en un chat, ni en WhatsApp, ni en el
> portapapeles, ni en la pantalla.

**Qué pasa:** columnas nuevas en las ventas (081); una función que guarda cada envío del PoS de una sola vez y que
**calcula el cursor con un «corte seguro»** (082 v3: si hay una factura en curso por debajo, el cursor la espera, aunque
ese ciclo no venga; y un aviso de error del PoS ya no mueve el corte); y el receptor de ventas nuevo (Edge `ingest-ndf`:
el de `e4678b3` con una línea de log más). Código del pase: `5da233a516d1a6c4c2c95eb165be448be5416697`.

**Del agente de la PC del PoS:**
- Su **código no se toca**: sigue en `4d3513a6df8e838dd5c0442b05a580e06ce9db9d`; nada de checkout, pull ni deploy en
  `C:\satori\satori-app-prod`.
- Lo único que se le hace: **detener su tarea** antes de cambiar la base y el receptor, y **volver a iniciarla** después,
  para que nadie escriba durante el cambio (detenida 15 minutos como mucho).
- **Solo si su secreto mide menos de 32** (lo dice 1.9; no es parada): con la tarea detenida (paso 4.3b), el script cambia
  la línea `INGEST_SECRET=` del `.env` que manda y deja una copia `.antes-pase`, que se borra al cerrar.

**Nada del Club.**

**Quiénes (dos, por rol):** el **dueño** ejecuta y firma. El **encargado del turno** controla y firma también: mira el PoS
y la app, elige las facturas del cuadre y lee cada resultado contra el esperado. No pueden ser la misma persona.
**Claude no corre nada en prod** (ni consultas, ni deploys, ni el merge del #71): dicta, revisa lo que le leen y no ve
ningún secreto.

**Regla de oro:** desde que empieza el pase **nadie mergea nada a `main`** hasta que Branching diga «All migrations are
up to date» después del merge del #71, que firma y hace el dueño.
**Todo en PowerShell**, el **Windows PowerShell 5.1** de la PC del PoS (o la 7, si está, pero una sola para todo el pase).
Antes de empezar, en cada consola, `$PSVersionTable.PSVersion` tiene que decir 5.1 (o 7.x); si dice otra cosa, se para.
Los 19 bloques del paquete pasaron el ensayo en seco en las dos versiones (35/35 cada una, 09-nov). Cada consola arranca con el bloque fail-stop:
si un comando falla, se corta y **no se sigue**.

| # | Paso (sección del paquete) | Qué hace el dueño | Qué hace el encargado | Qué hace Claude | Tarda |
|---|---|---|---|---|---|
| 0 | Arranque (§0) | Firma. Clona el repo en `C:\satori\pase-v2` (**nunca** en `satori-app-prod`) en el SHA del pase. Corre los bloques 0.4, 0.5 y 0.8: comparan SHA y huellas y cortan si algo no da. | Confirma que está y que mira el PoS. | Revisa que cada bloque termine en «ok». Avisa que `main` queda congelado. | 15 min |
| 1 | Mirar antes de tocar (§1) | Corre las lecturas de prod que dicta Claude (ledger, función y columna, latido, **corte y pendientes por local**, **formato de las facturas** 1.11) y la copia del receptor de hoy. Corre 1.9: primero mira que la cuenta de la tarea no tenga variables que pisen el `.env`; después dice **qué `.env` manda**, el **largo** del secreto (nunca el valor) y si cumple 32. Y el día según el PoS (1.10). | Anota facturas por estado y venta del PoS. | Dicta y revisa lo que le leen. Si 1.11 da folios no numéricos, se para. | 15 min |
| 2 | Columnas nuevas (§2) | Genera los dos bloques (el script compara las huellas antes) y corre `bloque_081.sql`. | Mira. | Verifica huella y columnas; el agente sigue entrando. | 5 min |
| 3 | Secretos por local (§3) | **Si 1.9 dijo que cumple 32:** corre el script 3.2. Arma el mapa con el secreto que el agente usa de verdad (lo lee con el parser del propio agente) y uno nuevo para Nosara, lo valida (si algo no da, corta), lo carga con el CLI y borra el archivo. **Si no cumple:** se salta; va en 4.3b. | Mira que no aparezca ningún valor en pantalla (de la huella, solo 12 caracteres). | Revisa que el script dijo que la **huella** del panel es la del mapa (si no coinciden, corta solo). | 10 min |
| 4 | El cambio (§4) | **Detiene la tarea del agente** y espera que suelte. Corre `bloque_082.sql`. **Solo si el secreto era corto:** 4.3b (secreto nuevo y mapa). Despliega el receptor desde `C:\satori\pase-v2`. **Vuelve a iniciar la tarea.** | Toma el tiempo con la tarea detenida (15 min como mucho). | Con lo que le leen: nadie escribe (2 minutos sin latido), el corte por local, la 082 v3 (md5 del ledger y de la función), la versión nueva y «JWT» apagado. Anota la hora **con `-06:00`**. | 15 min |
| 5 | Prueba de humo (§5) | Cuando entra la primera venta, dice número y total. | Compara con el PoS. | Puerta («No autorizado» del receptor), 3 ciclos, sin duplicados, **sin descartes**, la factura nueva una vez con sus líneas. | 10 a 30 min |
| 6 | Primera hora (§6) | — | Cada 15 min elige 2 facturas del PoS y lee número y total. | Cada 15 min: latido, ventas, duplicados, cuadre, descartes, consulta C. Al final, **conciliación** con el PoS. Si quedó alguna factura «en curso» vieja, **replay** del día y control en dos ciclos. | 70 min |
| 7 | Cierre | Dice «pasa» o «paramos». Borra la copia `.antes-pase`, si quedó (9.0). Firma. Muestra otra vez que el agente sigue en `4d3513a6…`. | Firma. | Completa la bitácora. | 5 min |
| 8 | Branching al día (§9) | **Firma y mergea el #71** (botón de GitHub). | — | Revisa el diff antes. Después lee con el dueño el resultado de Branching: con «All migrations are up to date», avisa que se levanta el congelamiento. **No mergea.** | 10 min |

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
3. Se vuelve a iniciar la tarea, y el dueño lee el latido para que Claude confirme que el agente entra.
4. **Después**, solo si hace falta, se saca la función 082, con su precondición (nunca al revés).
5. Las columnas de la 081 y la del cursor pueden quedar: no molestan.
6. Lo que no haya entrado se busca con la **conciliación** contra el PoS y se recupera con el **replay** del día. Se
   verifica factura por factura; no se da nada por recuperado sin verlo.
7. **`main` se descongela** según lo que haya quedado aplicado (paquete §8.6).

## Qué NO hace nadie
- Claude: correr **cualquier cosa** en prod (consultas, deploys, secretos, el merge del #71). Lo corre el dueño.
- Cambiar el **código** del agente.
- Copiar, pegar o mostrar un secreto.
- Pegar en prod un UPDATE o un DELETE que no sea uno del Anexo A del paquete (con su precondición).
- Tocar el Club.
- Aplicar la 085.
- Mergear otra cosa a `main`.
