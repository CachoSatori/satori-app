# extract-document sin datos reales (D15 = A, 13-nov-2026)

**Rama:** `claude/extract-document-sin-datos` (parte de `claude/extract-document-fechas-dm` @ `02a7a67`, que trae el
prompt con fechas DÍA/MES de `8a8dfb6`, la fuente viva de prod). **No va en un PR a `main`** (regla 2: nada bajo
`supabase/functions/` hasta cerrar el ítem 11). Se despliega a mano, con firma.

## Qué cambia y qué no
- La identidad del cliente (nombre comercial, razón social, cédula jurídica) deja de estar escrita en el código: la
  función la lee de 3 secretos de la Edge y arma el prompt con ellos (`supabase/functions/extract-document/prompt.ts`).
- Los ejemplos de proveedores y de transferencias pasan a genéricos y ficticios. Las reglas de extracción no cambian
  (fechas D/M, clave FE, IVA 1/13 %, ítems en dos líneas, proformas, comprobantes, propinas, manuscritos, etc.).
- Si falta algún secreto, la función **sigue andando**: usa «el restaurante cliente» en lugar de lo que falte y deja
  un aviso en el log al arrancar la instancia (solo los **nombres** de los secretos que faltan, nunca valores).
- El historial de git no se reescribe: lo ya publicado queda en commits viejos (decisión del dueño).
- Lo cuida `supabase/extractDocumentSinDatos.test.ts` (corre en el `vitest` del gate): falla si algún `.ts` de la
  función tiene una cédula jurídica (`3-1XX-XXXXXX` o `31XXXXXXXX`) o un nombre vigilado (guardados solo como sha256).

## Los 3 secretos
| Secreto | Qué lleva |
|---|---|
| `NEGOCIO_NOMBRE` | Nombre comercial del restaurante |
| `NEGOCIO_RAZON_SOCIAL` | Razón social de la sociedad |
| `NEGOCIO_CEDULA` | Cédula jurídica, con guiones (formato `3-1XX-XXXXXX`) |

Los valores están en el registro privado del dueño. **Nunca** al repo, al chat, a un PR ni a la línea de comandos
(quedaría en el historial de la terminal).

Cómo cargarlos (una de las dos):
1. **Panel de Supabase** → proyecto → Edge Functions → Secrets → agregar los 3 nombres con sus valores.
2. **CLI con un archivo fuera del repo** (p. ej. `~/negocio.env`, con permisos `600`), con una línea `NOMBRE=valor`
   por secreto:
   ```bash
   supabase secrets set --env-file ~/negocio.env --project-ref <ref>
   rm ~/negocio.env
   ```

Verificación: `supabase secrets list --project-ref <ref>` muestra **solo nombre y digest**; anotar los 3 digests en la
bitácora. Ojo: cambiar un secreto sube la versión de **todas** las funciones del proyecto sin cambiar su código (mirar el
hash, no la versión).

## Pasos de despliegue
Lecturas antes y después (Management API o CLI, solo lectura): versión, `verify_jwt`, `ezbr_sha256` y fecha de
`extract-document`; nombres y digests de secretos. `verify_jwt` = **on** (sin `--no-verify-jwt`).

**1. Staging (`hwiatgic…`) — el coordinador**
1. Leer el ref en pantalla. Lecturas «antes».
2. Cargar los 3 secretos (pueden ser valores de staging/ficticios) y anotar los digests.
3. `supabase functions deploy extract-document --project-ref <ref staging> --use-api` desde la cabeza de esta rama;
   anotar SHA, versión y hash.
4. Humo: subir en la Bandeja de staging una foto de factura con fecha ambigua (p. ej. 9/11) y un comprobante de
   transferencia → la fecha sale en ISO día/mes, el proveedor es el emisor/beneficiario y el cliente nunca aparece
   como proveedor.
5. Humo sin secretos (opcional): borrar uno en staging, llamar una vez, ver el aviso en el log (sin valor) y que la
   extracción sigue; volver a cargarlo.

**2. Prod (`yiczgdti…`) — con firma del dueño sobre el SHA exacto**
1. Firma anotada (fecha y hora `-06:00`). Ejecución y control, personas distintas.
2. Lecturas «antes» (versión, hash y digests: es la vuelta atrás).
3. Cargar los 3 secretos **antes** del deploy (así no hay ventana con el texto genérico). Anotar digests.
4. `supabase functions deploy extract-document --project-ref <ref prod> --use-api` desde el SHA firmado.
5. Lecturas «después» + el humo del paso 1.4 con un documento real del día. Actualizar la tabla de Edge de `ESTADO.md`.

**Criterios de parada:** `verify_jwt` distinto de on, un 401/500 en el humo, o la fecha/proveedor mal leídos → se para
y se vuelve atrás.

**Vuelta atrás:** volver a desplegar la fuente que estaba en prod (la de `claude/extract-document-fechas-dm`; su hash queda anotado en «antes»). Los 3 secretos pueden
quedar: el código viejo no los lee.
