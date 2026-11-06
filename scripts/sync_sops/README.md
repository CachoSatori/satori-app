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
