# Print-Bridge — puente de impresión LAN (PoS Satori)

Servicio Node mínimo (sin dependencias) que recibe trabajos de impresión por HTTP
desde las tablets/KDS y los manda a las térmicas **3nStar RPT004** por red, hablando
**ESC/POS** sobre TCP raw (puerto 9100). Es el **embrión del HUB LOCAL (F5)**: misma
mini-PC que mañana servirá el KDS sin internet — primero imprime, después sirve.

> Estado: **spike**. Funciona end-to-end en **modo simulación** (renderiza el ticket
> a texto y lo loguea). La prueba con impresora real queda para la dueña (abajo).

## Requisitos
- Node ≥ 18 (ya viene en la mini-PC con Windows/Linux; o instalá desde nodejs.org).
- Las impresoras y la mini-PC en la **misma red LAN**, con **IP fija** por impresora.

## Correr en simulación (sin hardware)
```bash
cd print-bridge
node server.js            # modo SIM por defecto — NO imprime, loguea el ticket
node smoke.js             # prueba automática: comanda + pre-cuenta
```
Salida esperada de `smoke.js`: `SMOKE OK` y los dos tickets renderizados en consola.

## Probar con impresora real (paso de la dueña)
1. Averiguá la **IP de cada impresora** (menú de red de la 3nStar, o el router). Fijala
   en el DHCP del router para que no cambie.
2. Confirmá que imprime por red cruda:
   ```bash
   # macOS/Linux — manda un texto y un corte a la impresora de CAJA:
   printf '\x1b@PRUEBA SATORI\n\n\n\x1dV\x00' | nc <IP-CAJA> 9100
   ```
   Si sale el papel, el puente va a funcionar.
3. Levantá el puente en **modo real** apuntando a las 3 estaciones:
   ```bash
   SIM=0 \
   PRINTER_CAJA=192.168.1.50:9100 \
   PRINTER_BARRA=192.168.1.51:9100 \
   PRINTER_SALON=192.168.1.52:9100 \
   node server.js
   ```
4. Probá una impresión real:
   ```bash
   curl -X POST http://127.0.0.1:7070/print -H 'Content-Type: application/json' \
     -d '{"type":"raw","station":"caja","body":"Puente OK"}'
   ```

## API
- `GET /health` → `{ ok, mode, printers }`
- `POST /print` → body JSON:
  - `type`: `comanda` | `precuenta` | `raw`
  - `station`: `caja` | `barra` | `salon` (las **previas** van a `salon`; ROADMAP F2)
  - `comanda`: `{ table, pax, salonero, items:[{qty,name,modifiers[],course,seat}] }`
  - `precuenta`: `{ table, channel, pax, salonero, items:[{qty,name,modifiers[],price}],
    totals:{consumo,neto,iva,servicio,total} }` (los totales salen de `computeTotals` en la app)
  - respuesta SIM: `{ ok, mode:'sim', preview }` con el ticket en texto.

## Config (variables de entorno)
| Var | Default | Qué hace |
|---|---|---|
| `PORT` | `7070` | puerto HTTP del puente |
| `SIM` | `1` | `1`=simulación (no imprime) · `0`=imprime de verdad |
| `PAPER_WIDTH` | `42` | columnas (80mm≈42/48 · 58mm≈32) |
| `PRINTER_CAJA/BARRA/SALON` | — | `ip:puerto` de cada térmica (puerto 9100 default) |

## Instalar como servicio en la mini-PC (para que arranque solo)
- **Linux (systemd)**: crear `/etc/systemd/system/satori-print-bridge.service` con
  `ExecStart=/usr/bin/node /ruta/print-bridge/server.js` y las `Environment=` de arriba;
  `systemctl enable --now satori-print-bridge`.
- **Windows**: usar [`nssm`](https://nssm.cc) → `nssm install SatoriPrintBridge "C:\Program Files\nodejs\node.exe" "C:\satori\print-bridge\server.js"`,
  y cargar las variables de entorno en la pestaña *Environment*.

## Modo contingencia (ROADMAP F2)
Si el KDS cae, la app puede mandar la **comanda en papel** por este mismo puente
(`type:comanda`, `station:salon`/`barra`) — el servicio no se detiene. La integración
desde el front (botón "imprimir comanda") queda para F2/F3; el puente ya la acepta.
