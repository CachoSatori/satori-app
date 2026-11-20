# SPEC — Anonimizar la base de staging (20-nov-2026)

> **Propuesta, nada construido ni aplicado.** Es la D4 de [SPEC-staging-agentes](SPEC-staging-agentes.md): sin esto
> el entorno de agentes no se habilita. Lleva firma del dueño.

## 0. Qué se verificó (solo catálogo y conteos de `hwiatgicyyqyezqwldia`; ninguna fila leída)
- Auth: 21 usuarios, **11 con correo fuera de `.test`**. El clonado ya sanea Auth, pero la copia de hoy es anterior
  y [STAGING.md](../../STAGING.md) todavía dice «logins = prod».
- Storage: `documents` tiene 170 objetos (29 bajo `sops/`), `facturas` 1 y `productos` 1, aunque «no se clona».
- El clonado guarda en `.staging-backups/` (disco de quien lo corre) perfiles y correos **antes** de sanear.
- Los logins del PoS son códigos, y la 194 los tiene escritos: **no se tocan**.

## 1. Inventario y estrategia por columna
**Alias** = ficticio numerado (`Empleado NN`, `Proveedor NN`, `Socio NN`, `Cliente NN`) desde una tabla temporal por
tipo, armada con la **unión** de todas las columnas que guardan ese nombre: la misma persona queda igual en todas y
los cruces por nombre (p. ej. `employees.full_name` en la 194) siguen cuadrando. La tabla se descarta al terminar.

| Dato | Tablas · columnas | Estrategia |
|---|---|---|
| Auth | `auth.users`, `auth.identities` | Reaplicar el saneo del clonado (correo `.test`; sin hash, tokens, teléfono, metadatos ni sesiones) |
| Personal | `profiles.full_name/email` · `employees.full_name/pos_name` · `employee_bajas` · `cajero_name`, `manager`, `employee_name`, `salonero_name` (caja y PoS) | Alias `Empleado NN`; correo = el de Auth |
| Banco y sueldos | `employee_bank_info` · `employee_payments` · `employee_payroll`, `employee_wage_rates`, `salary_lines` | Banco: borrar. Sueldos: ver D5 |
| Proveedores | `suppliers` · `cash_movements.supplier_name` · `ingredients.supplier` | Alias `Proveedor NN`; `aliases` = `{alias}`; IBAN y contacto a `null`; correo `.test` (`pago-notificar` de staging ya no puede escribirle a un proveedor real) |
| Clientes y socios | `customers`, `club_miembros.nombre`, `club_miembros_contacto`, `club_cupones_contactos`, `club_negocios.nombre`, `fe_documentos.receptor_*` | Alias; correo `.test`; teléfono ficticio; cédula del receptor a `null`. Día y mes de cumpleaños se mantienen |
| Llaves del Club | `token_portal`, `token_pase`, `baja_token`, `codigo`, `codigo_socio`, `club_codigos_canje`, `club_web_clave`, `club_pases` | Nuevos al azar (respetan `check` y `unique`); `club_pases` se vacía (apunta a pases reales de Wallet) |
| Texto libre | `cash_cierres_dia.notas` («Resumen del día») y `ajuste_motivo` · `notes` de caja y propinas · `cash_movements.description` · demás notas | Texto fijo (`Nota de prueba`); en `description` se conserva el sufijo «· fact AAAA-MM-DD» (regla 11) |
| JSON | `documents.raw_json` · `movement_deletions`, `movement_edits` · `club_auditoria` · `club_reportes_cerrados` · `time_punches` · `ventas_dias/hist` | Ver D4 |
| Factura electrónica | `pos_ndf_tickets.clave_fe/consecutivo_fe` · `documents.clave_fe` · `fe_documentos.clave` | Ver §2 |
| Viejas | `*_pre_migracion_2026_07` | `truncate` (no `drop`: no agregar drift) |
| Fuera de `public` | `pg_stat_statements` · `net._http_response` · `cron.job` | Reiniciar · vaciar · ningún job nombra el host de prod |
| **Se mantiene** | Montos, tipo de cambio, fechas, productos y precios, logins del PoS, roles, locales, configuración, `bitacora_permisos`, SOP | — |

**Montos — recomendación: dejarlos.** Un factor rompe céntimos y redondeos (el reparto deja de sumar el pozo; el
total deja de ser neto + IVA + servicio) y **no protege**: los precios de la carta son públicos y una división
devuelve el factor. Lo sensible es el vínculo monto ↔ persona, y eso lo corta el alias. Queda real el volumen de
ventas por día.

## 2. Que no se rompa
- **FKs:** no se toca ninguna llave ni `id`; solo columnas de texto.
- **Sagrados (caja y propinas):** ningún monto, punto, hora ni estado cambia. Control: suma por día de
  `cash_movements`, de `tip_entries.payout_crc` por sesión y de `cash_cierres_dia`, **idénticas antes y después**.
- **RLS y permisos:** `role`, `is_active` y `profile_locations` no cambian (huella md5 antes = después).
- **Triggers y regla 12:** corre con `session_replication_role = replica`, como el clonado: no dispara bitácora ni
  las guardias de inmutabilidad (`club_auditoria`, `club_movimientos`, `club_reportes_cerrados`). Vale porque **no
  cambia roles ni activaciones**; `bitacora_permisos` termina con el mismo conteo. Sin `disable trigger`.
- **Clave FE (50 dígitos):** se reemplazan solo las posiciones 10–21 (cédula del emisor) por una ficticia fija;
  fecha, consecutivo (22–41) y código de seguridad quedan. Control: largo 50, consecutivo igual al de la fila y
  misma cantidad de claves distintas.
- **A futuro:** el script lista **todas** las columnas `text`/`jsonb` de `public` con su clase; la prueba **falla
  si aparece una sin clasificar**.

## 3. Cuándo corre y cómo se prueba
- **Ahora, una vez,** y **después de cada re-clonado:** clonado → `crear.sh` → `neutralizar-copias.sql` →
  **`anonimizar.sql`** → **`storage.sh`** → **`verificar.sql`** → `inventario.sql` → prueba de barreras. El
  respaldo local del clonado pasa a tomarse ya saneado.
- **`anonimizar.sql`:** idempotente, una transacción; aborta si el ref o `club_entorno` no son de staging o faltan
  los usuarios de prueba. Devuelve solo conteos.
- **`verificar.sql` (solo lectura, solo conteos) exige 0 en:** correos fuera de `@staging-satori.test` y
  `@example.com` · teléfonos fuera del bloque ficticio de la lista blanca de la guarda de privacidad (los de ocho dígitos que empiezan con 800000: cien números, sembrados todos; si cien no alcanzan para los socios, ampliar la lista blanca es un cambio aparte, en un check protegido (`src/privacidadRepo.test.ts`), con firma del dueño, y no parte de esta spec) ·
  nombres que no sean alias ni de prueba · datos de banco · tokens iguales a los de antes · objetos de Storage
  fuera de `sops/` y de la imagen ficticia · columnas sin clasificar. Más los controles del §2.
- **Mutación:** en una transacción descartada se siembran un correo, un teléfono y un nombre inventados con forma
  de reales: la prueba cae tres veces.

## 4. Storage
**A (recomendada):** borrar todo lo que no sea `sops/` y apuntar `documents.image_path` a una imagen ficticia única
(la Bandeja sigue mostrando una foto). **B:** solo borrar (imágenes rotas). **C:** dejar (no cumple la D4). Se borra
por la API de Storage con la llave de servicio de staging (`lib.sh`), no por SQL.

## 5. Riesgos y vuelta atrás
- **Re-identificar por rol o fecha** (equipo chico): se acepta; sin nombre, contacto ni banco.
- **Texto libre nuevo sin cubrir:** lo frena la prueba de columnas sin clasificar.
- **Correr contra prod:** ref fijo + `club_entorno` + usuarios de prueba (en prod no existen) + hooks del repo.
- **Vuelta atrás:** si falla, la transacción se descarta sola. Si el resultado no sirve: re-clonar desde prod (solo
  lectura) y correr la cadena de nuevo. El borrado de Storage no se deshace ni hace falta: prod no se toca.

## 6. Esfuerzo y quién
- **Construye** (Opus, 1 sesión): `scripts/staging-anonimizar/{anonimizar.sql, verificar.sql, storage.sh}` y
  STAGING.md al día. Sin migración ni sagrados; nada en prod. **Verifica** un agente que no vio el trabajo.
- **Corre** el coordinador en staging, **con OK del dueño por chat** (escritura persistente). ~10 minutos.

## 7. Decisiones (firmadas 20-nov)
| # | Decisión | Resuelto | ¿Firma? |
|---|---|---|---|
| D1 | Montos | Dejarlos | Firmada |
| D2 | Alias | Numerado, se rearma en cada clonado | No lleva |
| D3 | Storage | Borrar todo lo que no sea `sops/` y poner una imagen ficticia; los PDF de SOP se quedan | Firmada |
| D4 | JSON con datos | Lista blanca de campos; vaciar `ventas_dias` | Firmada |
| D5 | Sueldos | Valor ficticio por tipo | Firmada |
| D6 | PDF de SOP y libros de franquicia | Dejarlos | No lleva |
| D7 | Cédula del emisor en la clave FE | Reemplazarla (§2) | No lleva |

Con las firmas de D1, D3, D4 y D5 queda resuelta la spec; construirla sigue siendo un PR aparte.
