# Pase a PROD de la mig 199 `fe_ingesta` + Edge `fe-ingesta` (compras F1) — EN ESPERA DE FIRMA

> **Qué es:** F1 de [SPEC-compras-stock-costos](../inventario/SPEC-compras-stock-costos.md) §4: cada XML de factura
> electrónica que llega al correo de proveedores queda guardado y leído, solo, en ≤ 15 min. Rama
> `feat/compras-f1-ingesta`, PR en borrador. **Nada de esto está en prod.** Entra por merge → Branching (regla 1 y
> regla 2 de ESTADO): el merge aplica la 199 **y despliega `fe-ingesta`**. Por eso: firma del dueño sobre el SHA.
> Origen 142 (bloque club; caja está lleno), renumerada a 199 del bloque de pase, como la 197 y la 198.

## 1. Qué pasa y qué no

| Pasa | No pasa |
|---|---|
| 6 tablas nuevas `fe_*` con RLS, bucket privado `fe-xml`, 6 funciones (4 solo `service_role`, 1 de lectura para owner y contador, 1 de disparador) | No cambia `documents`, `cash_movements`, la Bandeja, la Caja ni `extract-document` |
| Edge nueva `fe-ingesta` (`verify_jwt = false`, portón `x-fe-secret`) | Ningún archivo sagrado (hashes abajo) |
| Pestaña «📨 Facturas electrónicas» en Inventario, solo owner y contador, **solo lectura** | El personal no ve nada nuevo; el manager no ve la pestaña |
| Script de Apps Script en el repo (`scripts/apps-script/fe-correo/`), lo instala el dueño | Ningún correo, cédula, secreto ni dirección en el repo |

Sin el secreto `FE_INGESTA_SECRET` cargado la Edge responde **401 a todo** (fail-closed): mergear sin cargarlo deja
todo cerrado y sin efecto.

## 2. F1.0 — condiciones releídas (25-nov-2026) y diferencias con la spec

**Cuotas de Apps Script, cuenta de Gmail común** ([documentación oficial de cuotas](https://developers.google.com/apps-script/guides/services/quotas)):
90 min/día de ejecución de disparadores · 6 min por ejecución · 20.000 UrlFetch/día · 50 MB por POST · 20.000
lecturas/escrituras de Gmail/día · 20 disparadores por usuario y script · propiedades: 9 KB por valor, 500 KB en total.
Las cuotas son por usuario y se reinician 24 h después del primer pedido.

**Formato de Hacienda v4.4** (resumen de [KPMG Costa Rica, 8-may-2026](https://kpmg.com/cr/es/insights/2026/05/newsflash-may-8.html)
sobre la actualización del 22-abr-2026 de los «Anexos y Estructuras v4.4», obligatoria desde el 1-nov-2026): cédula
jurídica **alfanumérica** (formato nuevo del Registro Nacional, fecha de arranque todavía sin fijar; aplica a
sociedades nuevas o a las que pidan el cambio) · códigos de referencia 12 a 17 (el 17, pago, solo en el Recibo
Electrónico de Pago) · tipos de documento 19 (factura de exportación) y 20 (Recibo Electrónico de Pago). Según esa
fuente, la estructura de la clave no cambia.

**NO PROBADO / pendiente de F1.0:** el PDF oficial de «Anexos y Estructuras v4.4» no se pudo abrir desde la sesión. Los
nombres de elemento (`CodigoCABYS`, `CodigoTarifaIVA`, `TipoDocIR`, `MedioPago/TipoMedioPago` dentro de
`ResumenFactura`) salen de la spec §4.4 y **no se contrastaron contra el documento oficial**. Antes de la firma: el
dueño baja 3–5 XML reales del buzón (una factura, una nota de crédito, un `MensajeHacienda`) y se corren contra el
parser **en local, sin subirlos** (repo público). Lo que no calce va a «revisar», no se pierde (queda el XML original).

| # | Spec | Lo construido | Por qué |
|---|---|---|---|
| 1 | §4.2 disparador cada 10 min, tope 4 min por corrida | **Cada 15 min, tope 45 s y 20 mensajes** por corrida | 96 corridas × 4 min = 384 min > 90 min/día de la cuota de Gmail común. Con 45 s el peor día queda en ~72 min; una corrida sin correos dura 1–3 s |
| 2 | §4.3 control «clave de 50 dígitos numéricos» | Se aceptan 50 caracteres alfanuméricos; con letras va a **revisar** | Cédula jurídica alfanumérica (v4.4, nov-2026): no se descarta una factura válida |
| 3 | §4.3 tipos conocidos | Raíz nueva con `Clave` (p. ej. Recibo Electrónico de Pago, exportación) → tipo `otro`, a revisar | Tipos 19 y 20 de v4.4 |
| 4 | §4.3 «un secreto por local» y `NEGOCIO_CEDULA` | **El local lo decide la cédula del receptor** (`fe_receptores`, la carga el owner); un secreto por instalación | Decisión del dueño 25-nov (§12.1, pregunta 3): Nosara tiene otro correo y otra cédula |
| 5 | §4.6 `supplier_id` por cédula contra `suppliers` | Queda **null** en F1 | `suppliers` no tiene columna de cédula; se resuelve en F2 (sin crear proveedores solos) |
| 6 | §4.3 ruta `location/AAAA/MM/clave.xml` | `AAAA/MM/clave.xml` (año y mes de la clave) | El local se sabe recién en la base; el bucket es privado y solo lo usa el service role |
| 7 | §4.2 el script manda el identificador del mensaje | Manda un `lote` aleatorio | Menos datos fuera de Google; el mensaje no hace falta para nada |
| 8 | §4.2 etiquetas (por hilo con GmailApp) | Etiquetas **por mensaje** (servicio avanzado de Gmail) | Un hilo puede juntar facturas de días distintos: etiquetar el hilo dejaría afuera la nueva |
| 9 | §4.6 tablas | Se agrega `fe_ingesta_latido` (una fila por cuenta) | «Última ingesta hace N h» tiene que verse aunque no lleguen correos |
| 10 | — | En staging existe `fe_documentos` (comprobantes **emitidos** del PoS propio, rama `staging`) | No choca: las tablas de la 199 son de comprobantes **recibidos** |

## 3. Estado en staging (`hwiatgic…`, 25-nov-2026, hora CR)

| Qué | Resultado |
|---|---|
| Ledger antes | 198 (la aplicó la coordinadora) |
| 199 aplicada (~06:43) | una transacción: cuerpo de la migración + fila `('199', 'fe_ingesta')` · ledger **198 → 199** · 6 tablas con RLS · 6 funciones · bucket privado |
| Advisor de seguridad | solo `fe_ingesta_resumen` ejecutable por `authenticated` (esperado: `security definer` con guarda de rol adentro, mismo patrón que la 198) |
| Humo parser → base (`begin … rollback`) | XML ficticios pasados por el parser real (v4.4, nota de crédito v4.3, uno «revisar»): nuevo · nuevo · revisar · duplicado; líneas, NC con su referencia, moneda `XXX` y fecha nula en el dudoso |
| Edge `fe-ingesta` v1 (~06:48) | desplegada desde la rama, `verify_jwt = false`, `ezbr_sha256` `7fe37e10…`. Por `pg_net` desde la base: secreto equivocado → **401**, GET → **405** |
| Batería `199_pruebas.sql` | **Postgres 16 local: 37/37 y 13/13 mutaciones muerden.** En staging el conector canceló la confirmación (lleva `drop`/`delete`, regla 14): **la corre la sesión de CC del dueño**: `python3 scripts/sql/199_pruebas.py --armar --compacto` → pegar |
| Prueba de punta a punta con secreto | **NO PROBADO:** el proxy de la sesión bloquea `*.supabase.co` y ningún secreto se pega en un chat. La hace el dueño con su sesión (paso 6 del orden, en staging primero) |

## 4. Lecturas previas en prod (solo lectura, antes de la firma)

```sql
begin read only;
select (select max(version) from supabase_migrations.schema_migrations)                       as ledger,      -- 198 (si hay 199: no se mergea)
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname in ('fe_receptores','fe_comprobantes','fe_lineas','fe_respuestas',
                                                     'fe_ingesta_bitacora','fe_ingesta_latido'))  as fe_tablas,   -- 0
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname like 'fe\_%')                                  as fe_funciones, -- 0
       (select count(*) from storage.buckets where id = 'fe-xml')                                 as bucket;      -- 0
rollback;
```
Más: `list_edge_functions` de prod (8 funciones; versión, `verify_jwt` y `ezbr_sha256` de cada una) y latido del PoS.

## 5. Orden (el día del pase)

1. Firma del dueño por chat sobre el SHA de cabeza del PR (con Gate verde) y lecturas del §4 en prod.
2. Merge (ventana D1; código → con OK). Branching aplica la 199 y despliega `fe-ingesta`.
3. **Después (solo lectura):** ledger con **una** fila `199` / `fe_ingesta` · las 6 tablas con RLS · 6 funciones · bucket
   `fe-xml` privado · `fe-ingesta` con `verify_jwt = false` · las otras 8 Edge con la **misma** versión y hash que antes ·
   latido del PoS OK · check «Supabase Preview» en success. `fe-ingesta` sin secreto = 401 a todo (esperado).
4. El dueño carga el receptor de Santa Teresa (dato, con su firma; la cédula NO va al repo ni al chat):
   `insert into public.fe_receptores (cedula, location_id) values ('<cédula del negocio sin guiones>', 'santa-teresa');`
5. El dueño carga el secreto: `supabase secrets set FE_INGESTA_SECRET=<openssl rand -base64 48> --project-ref <ref de prod>`
   (después: confirmarlo por la lista de secretos, nombre y huella; cambiar un secreto puede no subir la versión).
6. Script en la cuenta de proveedores (ver §7), **primero contra staging** con un secreto de staging, después contra prod.
7. Humo: correr `correr` a mano una vez · la pestaña muestra «Última ingesta: hace N min» · las facturas del 30-nov
   en adelante aparecen por día · `fe-procesada` en los correos.

**Criterios de parada:** ledger distinto de 198 antes del merge · cualquier otra Edge cambia de hash · el PoS deja de
latir · `fe-ingesta` responde algo que no sea 401 sin secreto.

## 6. Vuelta atrás (escrita antes)

- **Apagar sin tocar esquema:** borrar el disparador del script (o quitar `FE_INGESTA_SECRET`: la Edge vuelve a 401).
  Es lo primero y alcanza en la mayoría de los casos.
- **Esquema, solo si no hay facturas reales:** vaciar el bucket `fe-xml` por la API de Storage → `scripts/sql/199_rollback.sql`
  (una transacción) y, en el mismo momento, un PR que saca el `.sql`, la carpeta de la Edge y su bloque de
  `config.toml` de `main`. Si la 199 ya está en el ledger de prod, el `.sql` **no se borra** (regla 10): la vuelta
  atrás es una migración nueva con ese cuerpo.
- Con facturas reales: no se borra; se apaga (punto 1) y se corrige con una migración nueva.

## 7. Guía para el dueño: instalar el script (una vez por cuenta de correo)

1. En la cuenta de Gmail de proveedores: script.google.com → Proyecto nuevo → nombre «fe-correo».
2. Pegar `Codigo.gs` del repo. En «Configuración del proyecto», marcar «Mostrar el archivo de manifiesto» y pegar
   `appsscript.json`.
3. «Servicios» → agregar **Gmail API**.
4. «Configuración del proyecto» → «Propiedades del script»: `FE_INGESTA_URL` (la URL de la función), `FE_INGESTA_SECRET`
   (el mismo valor del paso 5), `FE_FUENTE` = `santa-teresa`. `FE_DESDE` no hace falta (por defecto 2026/11/30).
5. Elegir la función `instalar` → «Ejecutar» → autorizar con la misma cuenta. Crea las etiquetas `fe-procesada`,
   `fe-sin-xml`, `fe-error` y el disparador cada 15 min.
6. Elegir `correr` → «Ejecutar» una vez. Ver la pestaña «📨 Facturas electrónicas» en la app.
7. Si Google avisa por correo que el disparador falló (clave cambiada, permiso revocado), repetir el paso 5.

## 8. Huellas

- Sagrados sin cambios: `tipCalculations.ts` `7603ba5a` · `cashUtils.ts` `b597c697` · `cierrePozo.ts` `bf22ee44`
  (`posFiscal.ts` solo vive en `staging`).
- SHA del PR, gate y firma: en el cuerpo del PR y en la bitácora de abajo.

## 9. Firma y bitácora

| Fecha (CR) | Quién | Qué |
|---|---|---|
| 2026-11-25 ~06:43 | agente (Opus 5.5) | 199 aplicada en staging con su fila del ledger (198 → 199) |
| 2026-11-25 ~06:48 | agente | `fe-ingesta` v1 en staging; 401 sin secreto, 405 GET |
| | sesión del dueño | batería en staging · prueba de punta a punta con secreto de staging · XML reales en local |
| | dueño | firma sobre el SHA · lecturas en prod · merge · secreto y receptor en prod |
