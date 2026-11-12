# Convenciones del repo — Satori App

Estado vivo, reglas operativas y punteros: [ESTADO.md](ESTADO.md). Backlog: [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).

## Guías de uso de la app (`docs/sop-app/`)

- **Regla permanente:** todo PR que cambie pantallas, botones, roles o reglas de un módulo actualiza su guía en
  `docs/sop-app/` **en el mismo PR**, incluido el campo `verificado_en_commit` del front matter.
- Si un PR no la actualiza (porque no hace falta o porque queda para después), lo dice en la descripción del PR,
  con el motivo.
- Las guías siguen [docs/sop-app/PLANTILLA.md](docs/sop-app/PLANTILLA.md) y el mapa de módulos está en
  [docs/sop-app/INVENTARIO.md](docs/sop-app/INVENTARIO.md).

## Repo público

Nunca al repo: nombres de personas, clientes o proveedores, teléfonos, correos, cédulas, contraseñas, llaves o
montos reales. Los ejemplos usan datos ficticios.

**Única excepción (decisión del dueño, 09-nov):** el correo público del negocio, `satorisushibar@gmail.com`, que es el
contacto del aviso de privacidad del Club (Ley 8968). Puede aparecer **solo** en el texto del aviso
(`club-web/src/i18n.ts`) y en sus pruebas (`club-web/src/aviso.test.ts`). Ningún otro correo, y este en ningún otro lugar.
