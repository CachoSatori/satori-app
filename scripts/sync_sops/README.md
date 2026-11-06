# sync_sops — sincronizar `public.sops` con el paquete de SoP

Lee `indice.json` y `sops/*.md` del paquete ("paquete app SoP") y deja la tabla alineada:

- **Upsert por `code`** (mig 076). Solo actualiza si algo cambió, así que se puede correr varias veces.
- **Filas viejas reemplazadas** (las de `mapeo.json → reemplazadas`) pasan a `is_active = false`. No se borra nada.
- **Filas que solo están en la app** (`mapeo.json → solo_app`) siguen activas, con un `area` provisional.
- Quita el front matter de cada markdown. `category` se completa para compatibilidad.
- **Aborta sin escribir** si algún documento tiene correos, teléfonos, cédulas o contraseñas escritas. Los nombres de clientes no se pueden detectar con un patrón: se revisan a mano.
- Antes de escribir guarda **todas** las filas en `<paquete>/respaldo/sops_<entorno>_<fecha>.json`.
- Escribe todo en **una transacción**: se aplica completo o no se aplica nada.

## Uso

```bash
export SUPABASE_ACCESS_TOKEN=...   # token de la Management API; nunca en un archivo del repo

# Ensayo (no escribe nada)
node scripts/sync_sops/sync.ts --paquete "~/Downloads/SoP Satori Claude/claude/paquete app SoP"

# Aplicar en STAGING
node scripts/sync_sops/sync.ts --paquete "<carpeta>" --aplicar

# PROD: solo con OK explícito
node scripts/sync_sops/sync.ts --paquete "<carpeta>" --entorno prod --aplicar --confirmo-prod
```

Requisitos: Node 22.18 o más nuevo, que corre TypeScript directo, y la migración `076_sops_code_area.sql` aplicada en el entorno. Detrás de un proxy, agregá `NODE_USE_ENV_PROXY=1`.

## PDF y libros (`subir_pdfs.ts`)

Sube al bucket privado `documents`:

- el PDF de cada SoP a `sops/<versión>/<código>.pdf` (por ejemplo `sops/2026-11/2.5.pdf`), y guarda esa ruta en `sops.pdf_path`;
- el Libro del empleado a `sops/libros/libro-empleado.pdf`, que pueden leer todos los usuarios logueados;
- el Libro de franquicia a `sops/libros/franquicia/libro-franquicia.pdf`, que solo pueden leer owner y manager (migración 077).

Necesita la llave `service_role` del entorno: en Supabase, Project Settings → API. Va en una variable de entorno y nunca en un archivo del repo. El script sube con upsert, así que se puede repetir. Si falta algún PDF, aborta sin subir nada.

```bash
export SUPABASE_SERVICE_ROLE_KEY=...   # la de STAGING

# Ensayo (no sube nada)
node scripts/sync_sops/subir_pdfs.ts \
  --paquete "~/Downloads/SoP Satori Claude/claude/paquete app SoP" \
  --pdfs "~/Downloads/SoP Satori Claude/claude/Satori - Documentos noviembre 2026"

# Subir a STAGING
node scripts/sync_sops/subir_pdfs.ts --paquete "<carpeta>" --pdfs "<carpeta>" --aplicar
```

En `--pdfs` va la carpeta descomprimida del zip: las subcarpetas de cada área y los dos libros en la raíz.
