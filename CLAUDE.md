# Convenciones del repo — Satori App

Estado, reglas y punteros: [ESTADO.md](ESTADO.md). Backlog: [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md). Errores que pasaron a regla:
[docs/REGLAS-POR-INCIDENTE.md](docs/REGLAS-POR-INCIDENTE.md). Lo podado, tal cual: [ESTADO-HISTORICO](docs/historico/ESTADO-HISTORICO.md) y
[PROMPT-CONTINUACION-HISTORICO](docs/historico/PROMPT-CONTINUACION-HISTORICO.md). Poda al pasar 15 KB (`satori-estandar-pr` §10).

## Guías de uso de la app (`docs/sop-app/`)

Todo PR que cambie pantallas, botones, roles o reglas de un módulo actualiza su guía **en el mismo PR** (incluido `verificado_en_commit`);
si no, lo dice en la descripción con el motivo. Ver [PLANTILLA](docs/sop-app/PLANTILLA.md) e [INVENTARIO](docs/sop-app/INVENTARIO.md).

## Skills del repo (`.claude/skills/`)

`satori-estandar-pr` (todo cambio que termina en PR; fuente única de rama, gate, pruebas, privacidad, reporte) · `satori-revision-pr` ·
`satori-migraciones-y-prod` · `satori-verificar` · `satori-merge-y-deploy` (ventana D1 del 20-nov en ESTADO regla 3: libre 23:30–15:00 · 15:00–19:00 con OK del dueño · 19:00–23:30 solo urgente con OK).
Si una skill y `ESTADO.md` no coinciden, gana `ESTADO.md` y se corrige la skill.

## Repo público

Nunca al repo: nombres de personas, clientes o proveedores, teléfonos, correos, cédulas, contraseñas, llaves o
montos reales. Los ejemplos usan datos ficticios.

**Excepciones (solo estas dos):**

1. **Decisión del dueño, 09-nov:** el correo público del negocio, `satorisushibar@gmail.com`, que es el
   contacto del aviso de privacidad del Club (Ley 8968). Puede aparecer **solo** en el texto del aviso
   (`club-web/src/i18n.ts`) y en sus pruebas (`club-web/src/aviso.test.ts`).
2. **Decisión del dueño, 18-nov:** el remitente propio de los correos automáticos, la cuenta `no-responder` del
   dominio `satoricostarica.com` (verificado en Resend). Puede aparecer **solo** en el código `.ts` de las Edge de
   correo (`supabase/functions/{cierre-email,monthly-report,pago-notificar,ventas-dia-contador}/`) y en sus pruebas.

Ningún otro correo, y estos dos en ningún otro lugar. Lo cuida `src/privacidadRepo.test.ts`.
