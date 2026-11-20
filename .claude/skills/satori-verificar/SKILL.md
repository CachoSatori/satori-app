---
name: satori-verificar
description: Usala cuando un cambio lo ve el personal o un cliente y hay que recorrer las pantallas en staging, por rol y con capturas, ANTES de pedirle la validación física al dueño — usuarios de prueba, tabla «pantalla · rol · qué se ve · OK/no», proxy bloqueado y privacidad.
---

# Verificar pantallas en staging — Satori App

Prueba técnica de los agentes antes de la validación física del dueño (no la reemplaza). Solo staging: **nunca prod ni usuarios reales**. Si esta skill y `ESTADO.md` no coinciden, gana `ESTADO.md`.

**Cuándo:** el PR cambia algo que ve el personal o un cliente (pantallas, textos, roles visibles, Club, pase de Wallet, correos con vista). No hace falta en docs, scripts, migraciones sin pantalla ni refactors sin cambio visible.

## 1. Levantar
- [ ] Preview de Cloudflare Pages del PR (URL en los checks) o `satori-staging.pages.dev`; confirmá por contenido que trae tu cambio (R19) y que apunta a la base de **staging** antes de escribir nada.
- [ ] Si falta una migración o Edge en staging: fila «NO PROBADO»; no se aplica sin firma.

## 2. Entrar con usuarios de prueba
- [ ] Uno por rol, `prueba-<rol>@staging-satori.test` (plan: [docs/seguridad/PLAN-usuarios-prueba-staging.md](../../../docs/seguridad/PLAN-usuarios-prueba-staging.md)). Sesión: `scripts/staging-usuarios-prueba/sesion.sh <rol> <archivo>` (archivo **fuera del repo**, 1 h; el JSON va a `localStorage` con la clave del encabezado del script). Borrá el archivo al terminar. Si no puede correr, lo hace el coordinador.
- [ ] Nunca una sesión, token o llave en chat, PR o commit. «Ver como» no prueba permisos (regla 4): entrá con el usuario de cada rol.
- [ ] Locales: owner y contador ven todos; los demás, `santa-teresa` salvo fila en `profile_locations`.

## 3. Recorrer y capturar
- [ ] Cada pantalla que toca el diff, por cada rol que la ve **y cada rol que no debe verla** (rutas: `src/App.tsx` y el plan de usuarios §3).
- [ ] Estados vacío, con datos, error y carga; móvil (el personal usa teléfono y PWA) y escritorio si es de layout; el camino de «no» y que lo existente sigue andando.
- [ ] Una captura por fila (viewport).

## 4. Privacidad (repo público)
- [ ] Staging tiene copias de personas reales: si aparece nombre, correo, teléfono, cédula o monto real, **no se sube**: recortá, tapá o usá otro dato. Sin URL con tokens ni consola o `localStorage` abiertos. Adjuntá solo las capturas que prueban algo.

## 5. Proxy bloqueado
- [ ] Si `pages.dev` o el navegador no cargan (403/407, reset, TLS): no desactives TLS ni busques otro camino (`~/.ccr/README.md`). Anotá dominio, error y hora, marcá **NO PROBADO (proxy)** y dale al coordinador la tabla vacía con rol y pasos. Lo que sí podés (vitest, build, revisión de código) lo decís sin darlo por verde.

## 6. Tabla en el PR
Con el SHA verificado y fecha CR; un push nuevo la invalida.

| Pantalla | Rol | Qué se ve | OK / no |
|---|---|---|---|
| Caja → Cierre | cajero | Botón nuevo visible, total correcto | OK |
| Caja → Cierre | salonero | Sin acceso (redirige) | OK |

- [ ] Cada «no» lleva detalle y qué falta; el PR no queda listo con un «no» abierto ni con NO PROBADO sin dueño. Cierre en una línea: qué se verificó, en qué entorno, qué quedó sin probar y qué debe mirar el dueño en persona.
