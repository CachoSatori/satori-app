# `ingest-ndf` — receptor del día del PoS "Nube de Fuego" (A2)

Recibe el día ya mapeado por el extractor de la Fase 1a (`pos-bridge/`) y lo persiste en las
tablas `pos_ndf_*` de la **migración 062**. No calcula ventas, no reparte propinas, no toca la
caja: valida, normaliza y guarda.

> ⛔ **No desplegada** y la migración 062 **no está aplicada**. El orden es: aplicar la 062 →
> cargar el secreto → recién ahí `functions deploy`. Al revés, la función escribe contra tablas
> que no existen.

## Quién la llama

El agente de la PC del PoS (**A3**, todavía no existe). No hay CORS a propósito: el que llama es
un proceso headless, no un navegador.

```
POST /functions/v1/ingest-ndf
headers: x-ingest-secret: <POS_INGEST_SECRET>
         content-type: application/json
```

El portón es un **secreto compartido**, no un JWT (no hay usuario detrás). Si
`POS_INGEST_SECRET` no está cargado, responde **401 a todo** (fail-closed).

```bash
supabase secrets set POS_INGEST_SECRET=$(openssl rand -base64 48) --project-ref hwiatgicyyqyezqwldia
supabase functions deploy ingest-ndf --project-ref hwiatgicyyqyezqwldia   # ← después de la 062
```

Es un secreto **distinto** del `INGEST_SECRET` de BioTime.

## Tipos del payload

Están en `src/shared/ndf/ingestNdf.ts` y **derivan** de `src/shared/ndf/mapTicket.ts` — acá no se
redefine ni un canal ni una alerta de pax:

```ts
interface PayloadIngest {
  local:   'santa-teresa' | 'nosara'
  tickets: TicketIngest[]      // TicketMapeado (Fase 1a) + fecha_registra, mesa, numero_pedido…
  open?:   OpenIngest[]        // snapshot de mesas abiertas — ausente ≠ []
  cursor?: CursorIngest        // last_factura, last_fecha_registra, last_poll_at, last_error
}

interface TicketIngest extends TicketMapeado {
  fecha_registra: string       // CON zona explícita: conOffsetCR('2026-09-01 19:42:07')
  fecha_cierra?:  string | null
  tipo?:          string | null   // Pedidos.Tipo crudo (el canal ya viene mapeado)
  mesa?:          string | null
  numero_pedido?: string | null
  descuento?:     number | null
}

interface LineaIngest extends ItemMapeado { precio?: number | null }
```

Las líneas viajan dentro del ticket, en `items` (es el `TicketMapeado` tal cual): la función las
separa a `pos_ndf_ticket_lines`.

## Reglas que aplica

| | |
|---|---|
| **Idempotencia** | `tickets` upsert por `(local, numero_factura)`. Reenviar el mismo día no duplica; si el PoS corrigió un monto, gana lo último leído. |
| **Detalle** | Las líneas se **reemplazan enteras** (borrar + insertar): no tienen clave natural y lo que se guarda tiene que ser exactamente el detalle del PoS. Una línea anulada desaparece. |
| **Mesas abiertas** | `open` es un **snapshot**: se upsertean las que vienen y se **borran las que no vinieron** (mesa cerrada = desaparece). `open` ausente → no se toca nada. `open: []` → "no hay nada abierto", se borran todas. |
| **Cursor** | Se escribe **al final** y solo si todo lo anterior salió bien: un cursor que avanza con el lote a medio guardar deja al agente creyendo que sincronizó. |
| **Zona horaria** | Todo instante tiene que llegar **con zona explícita**. Un naive lo interpretaría el runtime en UTC y la venta de las 19:42 quedaría a las 13:42 — otro día operativo, cuadre roto, y nada falla. Es el desfase de 1 hora de BioTime. |
| **Total** | Se **recalcula** con `mapTotalProvisorio` (la misma función del extractor) a partir de los medios que vienen en el payload: `Σ medios − vuelto`. Si no coincide con el `total` declarado, gana el recalculado y el ticket se cuenta en `recalculados`. Es el único punto donde se ve que las dos puntas quedaron en versiones distintas de la regla. |
| **Ticket corrupto** | Se descarta, se cuenta en `invalid` y se loguea — **no** tumba el lote. Un 400 por una fila rara haría que el agente reintente para siempre y el local deje de sincronizar. |
| **Plata** | No llama ninguna RPC de dinero. No toca `cash_movements`, propinas ni el 10% de servicio. |

## Respuesta

```json
{ "ok": true, "local": "santa-teresa", "tickets_recibidos": 42, "tickets_guardados": 42,
  "lineas_guardadas": 173, "open_guardadas": 3, "open_borradas": 1,
  "invalid": 0, "recalculados": 0, "problemas": [] }
```

`401` sin secreto · `400` sobre inválido (local desconocido, `tickets` que no es array, lote
demasiado grande) · `500` si falló una escritura — y en ese caso el motivo queda también en
`pos_ndf_cursor.last_error`, para que el problema se vea en la base y no solo en la consola de la
PC del PoS.

## Payload de ejemplo

Generado con `mapTicket` real (una factura de salón con vuelto y pax por artículo):

```json
{
  "local": "santa-teresa",
  "tickets": [
    {
      "numero_factura": "5001",
      "fecha": "2026-09-01",
      "hora": "19:42:07",
      "estado": "C",
      "canal": "salon",
      "area": "SALON 1",
      "usuario_registra": "026",
      "salonero_login": "026",
      "salonero_nombre": "MAXO",
      "salonero": "MAXO",
      "registrado_por": "salonero",
      "login_cajero": "222",
      "turno": "noche",
      "con_servicio": true,
      "imp_servicio": 1200,
      "pedidos": 0,
      "saloneros_varios": false,
      "pax": 2,
      "pax_nativo": 0,
      "pax_articulo": 2,
      "pax_alerta": "falta_nativo",
      "total": 12000,
      "total_fuente": "provisorio",
      "medios": {
        "efectivo": 15000,
        "tarjeta": 0,
        "monto_electronico": 0,
        "deposito": 0,
        "cheque": 0,
        "cuenta_cobrar": 0,
        "dolares_efectivo": 20,
        "dolares_tarjeta": 0,
        "vuelto": 3000
      },
      "comida": 12000,
      "bebida": 0,
      "unidades_comida": 2,
      "unidades_bebida": 0,
      "cortesias": 0,
      "duenos": 0,
      "items": [
        {
          "codigo": "100",
          "nombre": "ROLL SATORI",
          "cantidad": 2,
          "monto": 12000,
          "imp_servicio": 1200,
          "familia": 2,
          "familia_nombre": "SUSHI",
          "categoria": "comida",
          "es_pax": false,
          "es_extra": false,
          "es_cortesia": false
        },
        {
          "codigo": "677",
          "nombre": "A PAX",
          "cantidad": 2,
          "monto": 0,
          "imp_servicio": 0,
          "familia": 19,
          "familia_nombre": "A PAX",
          "categoria": "pax",
          "es_pax": true,
          "es_extra": false,
          "es_cortesia": false
        }
      ],
      "fecha_registra": "2026-09-01T19:42:07-06:00",
      "mesa": "12",
      "numero_pedido": "4477",
      "descuento": 0
    }
  ],
  "open": [
    {
      "clave": "mesa-14",
      "mesa": "14",
      "salonero_login": "027",
      "canal": "salon",
      "pax": 4,
      "pax_alerta": "falta_nativo",
      "updated_at": "2026-09-01T20:05:00-06:00"
    }
  ],
  "cursor": {
    "last_factura": "5001",
    "last_fecha_registra": "2026-09-01T19:42:07-06:00",
    "last_poll_at": "2026-09-01T20:06:00-06:00"
  }
}
```

Lo que queda guardado de ese ticket: `total_crc = 12000` (15.000 de efectivo **menos** 3.000 de
vuelto; los $20 no se suman), `con_servicio = true`, `servicio_crc = 1200`, `pax = 2` con
`pax_alerta = falta_nativo` (el mesero no cargó *Personas*: el pax salió del artículo 677), y dos
filas en `pos_ndf_ticket_lines` — una de comida y la de *A PAX*, que no es ingreso.

## Tests

El contrato entero (validación, normalización, zona horaria, idempotencia, recálculo del total) se
prueba con vitest **sin base de datos ni Deno**, porque vive en el módulo puro:

```bash
npx vitest run src/shared/ndf
```

Lo que esta función agrega sobre ese módulo son únicamente las llamadas a Supabase.

## Nota de deploy

`index.ts` importa `../../../src/shared/ndf/ingestNdf.ts` a propósito: el contrato y la lógica de
dominio no se duplican. Si al desplegar el bundler del CLI no siguiera un import fuera de
`supabase/functions/`, la salida lo dice explícitamente — la solución es actualizar el CLI (el
bundler eszip camina el grafo completo), **no** copiar el módulo acá: dos copias de la regla del
vuelto es exactamente el bug que la Fase 1a acaba de cerrar.
