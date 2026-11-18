---
name: satori-verificar
description: Usala cuando un cambio lo ve el personal o un cliente y hay que recorrer las pantallas en staging, por rol y con capturas, ANTES de pedirle la validación física al dueño — usuarios de prueba, tabla «pantalla · rol · qué se ve · OK/no», proxy bloqueado y privacidad.
---

# Verificar pantallas en staging — Satori App

Es la prueba técnica que hacen los agentes (no el dueño) antes de la validación física. Si esta skill y `ESTADO.md` no
coinciden, gana `ESTADO.md` (y se corrige esta skill en un PR). Solo staging: **nunca prod, nunca usuarios reales**.

## 0. Cuándo usarla
- [ ] El PR cambia algo que ve el personal o un cliente: pantallas, botones, textos, roles/permisos visibles, el Club
      (club-web), el pase de Wallet, correos con vista.
- [ ] Un verificador independiente pide ver la pantalla, o el PR trae «qué va a ver el encargado» (`satori-estandar-pr` §6).
- [ ] **No hace falta** para: docs, scripts, migraciones sin pantalla, refactors sin cambio visible (alcanza el gate y las
      pruebas). **No reemplaza** la validación física del dueño: la prepara y le ahorra encontrar errores obvios.

## 1. Levantar la app
- [ ] Preferí el **preview de Cloudflare Pages del PR** (URL en los checks del PR). Si no hay, `satori-staging.pages.dev`
      (rama `staging`; confirmá por contenido que trae tu cambio, no por HTTP 200: regla R19).
- [ ] Confirmá que apunta a la base de **staging** y no a prod antes de escribir nada. Si tenés duda, parar y preguntar.
- [ ] Un cambio que necesita migración o Edge Function que no está en staging: anotá «NO PROBADO» en esa fila; no la
      apliques sin firma (`satori-migraciones-y-prod`).

## 2. Entrar con usuarios de prueba
- [ ] Usuarios: uno por rol, correo `prueba-<rol>@staging-satori.test` (plan en
      [docs/seguridad/PLAN-usuarios-prueba-staging.md](../../../docs/seguridad/PLAN-usuarios-prueba-staging.md)). Sin contraseña.
- [ ] Sesión: `scripts/staging-usuarios-prueba/sesion.sh <rol> <archivo>` (archivo **fuera del repo**, 1 h); el JSON va en
      `localStorage` con la clave que indica el encabezado del script, y se recarga. Borrá el archivo al terminar.
- [ ] Nunca pegues una sesión, token o llave en el chat, el PR ni un commit. Si el script no puede correr (sin acceso a
      staging), anotalo y pedí que lo haga el coordinador.
- [ ] «Ver como» no prueba permisos (regla 4): para cada rol, entrá **con el usuario de ese rol**.
- [ ] Locales: owner y contador ven todos; los demás, `santa-teresa` salvo que tengan fila en `profile_locations`.

## 3. Recorrer y capturar
- [ ] Por cada pantalla que el diff toca y por cada rol que la ve **y cada rol que no debe verla** (debe quedar sin acceso).
      Rutas por rol: ver `src/App.tsx` y el plan de usuarios §3.
- [ ] Estados: vacío, con datos, error y carga; móvil (el personal usa teléfono y PWA) y escritorio si el cambio es de layout.
- [ ] Una captura por fila de la tabla (viewport, no página entera si arrastra datos de más).
- [ ] Probá también el camino de «no» (permiso denegado, validación) y que lo ya existente sigue funcionando.

## 4. Privacidad de las capturas (repo público)
- [ ] Solo datos de **staging de prueba**. Staging tiene copias de personas reales: si en pantalla aparece un nombre,
      correo, teléfono, cédula o monto real, **no se sube**: recortá, tapá o usá otra vista/dato de prueba.
- [ ] No subas capturas con URL que lleve tokens, ni con la consola o `localStorage` abiertos.
- [ ] Preferí adjuntar al PR solo las capturas que prueban algo; el resto se describe en la tabla.

## 5. Si el proxy de la sesión bloquea el dominio
- [ ] Si `pages.dev`, el preview o el navegador del agente no cargan (403/407, reset, TLS): **no desactives TLS ni
      busques otro camino** (ver `~/.ccr/README.md` y el estado del proxy).
- [ ] Anotalo en el PR: dominio, error y hora. Marcá las filas **NO PROBADO (proxy)**.
- [ ] Pedí que el coordinador lo haga con su navegador, dándole la tabla vacía, el rol y los pasos de cada fila.
- [ ] Lo que sí podés: pruebas de componente (vitest), el build y la revisión de código; decilo, sin darlo por verde.

## 6. Tabla en el PR
Pegala en la descripción (o comentario) con el SHA verificado y la fecha CR; un push nuevo la invalida.

| Pantalla | Rol | Qué se ve | OK / no |
|---|---|---|---|
| Ejemplo: Caja → Cierre | cajero | Botón nuevo visible, total correcto | OK |
| Ejemplo: Caja → Cierre | salonero | Sin acceso (redirige) | OK |

- [ ] Cada «no» lleva el detalle y qué hace falta; el PR no se marca listo con un «no» abierto ni con NO PROBADO sin dueño.
- [ ] Cierre con una línea: qué se verificó, en qué entorno, qué quedó sin probar y qué debe mirar el dueño en persona.
