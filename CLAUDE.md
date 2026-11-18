# Convenciones del repo — Satori App

Estado vivo, reglas operativas y punteros: [ESTADO.md](ESTADO.md). Backlog abierto: [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).
Errores que pasaron a regla: [docs/REGLAS-POR-INCIDENTE.md](docs/REGLAS-POR-INCIDENTE.md). Lo cerrado y el detalle viejo (tal cual, no se pierde):
[docs/historico/ESTADO-HISTORICO.md](docs/historico/ESTADO-HISTORICO.md) y [docs/historico/PROMPT-CONTINUACION-HISTORICO.md](docs/historico/PROMPT-CONTINUACION-HISTORICO.md).
ESTADO y PROMPT-CONTINUACION se podan al pasar los 15 KB (ver `satori-estandar-pr` §13).

## Guías de uso de la app (`docs/sop-app/`)

- **Regla permanente:** todo PR que cambie pantallas, botones, roles o reglas de un módulo actualiza su guía en
  `docs/sop-app/` **en el mismo PR**, incluido el campo `verificado_en_commit` del front matter.
- Si un PR no la actualiza (porque no hace falta o porque queda para después), lo dice en la descripción del PR,
  con el motivo.
- Las guías siguen [docs/sop-app/PLANTILLA.md](docs/sop-app/PLANTILLA.md) y el mapa de módulos está en
  [docs/sop-app/INVENTARIO.md](docs/sop-app/INVENTARIO.md).

## Skills del repo (`.claude/skills/`)

- `satori-estandar-pr`: al arrancar cualquier cambio que termina en un PR (rama, sagrados, gate, pruebas, guía, privacidad, reporte).
- `satori-revision-pr`: para revisar un PR que hizo otra sesión: checklist por disparador (solo las filas que el diff toca), hallazgos Importante / Menor / Preexistente y veredicto (listo / cambios / bloquea).
- `satori-migraciones-y-prod`: antes de crear una migración, tocar una base, una Edge Function o un secreto.
- `satori-verificar`: para verificar en staging, por rol y con capturas, un cambio que ve el personal o un cliente, antes de pedir la validación física al dueño (tabla «pantalla · rol · qué se ve · OK/no»).
- `satori-merge-y-deploy`: con el OK del dueño para mergear a `main`: ventana horaria (regla D1: libre de 23:30 a 15:50, bloqueado de 15:50 a 19:00, de 19:00 a 23:30 solo con OK explícito del dueño), merge y verificación del deploy.

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
