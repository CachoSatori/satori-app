# Prompt para Claude Code — Etapa 2 · Paso 2: ruteo (sacar piso de /propinas + Bandeja fuera del menú)

> Solo **código** (rutas + Home). Cero esquema, cero plata, **sin firma**. Todo en **staging**. Sagrados intactos.

## Objetivo
1. El empleado de piso **ya no entra al módulo de REGISTRAR propinas** (`/propinas` = gerencia/cajero). Sus
   **estadísticas** de propina siguen intactas en `/mi-rendimiento?tab=propinas`.
2. La **Bandeja deja de ser un ítem de menú** (ya vive dentro de Caja Diaria).

## ⚠️ Hallazgo crítico (verificado — respetar)
`/inbox` **NO se puede eliminar del todo.** `/inbox/share` es el **share target de la PWA**: al compartir una foto,
`public/sw-share.js` la cachea y **redirige a `inbox?shared=1`** (L22), y `InboxModule` (en `/inbox`) la lee para
procesarla (`vite.config.ts:67` `share_target.action = ${BASE}inbox/share`). Borrar la ruta rompería el flujo
"compartir foto de factura → app". **Por eso el alcance es sacar la Bandeja del MENÚ, dejando la ruta y el share vivos.**

## Contexto verificado (líneas)
- `/propinas`: `App.tsx:146` (roles con los 5 de piso) · Home card `'tips'` en `HomePage.tsx:67-69` (mismos 5 de piso).
- Card `/inbox`: `HomePage.tsx:92-94`. Plumbing del conteo: `:125` (campo `inboxCount`), `:148` (`inboxRes` en el
  `Promise.allSettled`), `:183` (cómputo), `:288` (`inboxCount` en el return), `:410-411` (case `'inbox'` del badge).
- Ruta/redirect/import de `/inbox`: `App.tsx:156` (ruta), `:157` (`/inbox/share`), `:26` (import lazy `InboxModule`) → **SE DEJAN**.
- Los empleados de piso conservan su card `'mis-propinas'` (`HomePage.tsx:47-49` → `/mis-propinas` → redirect a
  `/mi-rendimiento?tab=propinas`). **No tocar.**

## Alcance (hacer exactamente esto)

1. **`/propinas` — cerrar a piso.**
   - `App.tsx:146` → `roles={['owner','manager','cajero','contador']}` (fuera salonero/barman/barback/runner/cocina; +contador).
   - Home card `'tips'` (`HomePage.tsx:69`) → mismos roles `['owner','manager','cajero','contador']`.

2. **Bandeja fuera del menú (SIN tocar ruta ni share).**
   - Quitar la card `'inbox'` de `HomePage` (`:92-94`).
   - Limpiar el plumbing que queda huérfano: campo `inboxCount` del tipo (`:125`), el `inboxRes` del
     `Promise.allSettled` (`:148`), su cómputo (`:183`), el `inboxCount` del return (`:288`), y el `case 'inbox'`
     del badge (`:410-411`). Sacar el import/consulta de conteo de inbox si queda sin uso.
   - **NO tocar:** `App.tsx:156` (ruta `/inbox`), `:157` (`/inbox/share`), `:26` (import `InboxModule`),
     `vite.config.ts` (`share_target`), `public/sw-share.js`, `src/modules/inbox/InboxModule.tsx`.

## Guardrails
- **STAGING.** Solo rutas + Home. Cero esquema/plata. Sagrados byte-idénticos (`7603ba5a` · `b597c697` · `a3fd445f`).
- **No romper el share target** ni la Bandeja dentro de Caja Diaria (el cajero la sigue usando ahí).
- Rama nueva desde `staging`.

## Criterios de aceptación
- Un `salonero/barman/barback/runner/cocina` **no ve** la card "Propinas" ni puede entrar a `/propinas` (el guard redirige);
  **sí** ve "Mi Rendimiento" y sus propinas en la pestaña.
- `owner/manager/cajero/contador` ven y entran a `/propinas`.
- La card "Bandeja" **desaparece** del Home; **no quedan referencias colgadas** a `inboxCount` (compila sin vars sin uso).
- **Compartir una foto** desde el teléfono sigue cayendo en `/inbox` y se procesa (share target intacto).
- `VITE_APP_ENV=production npm run build` → EXIT 0. Suite verde. ESLint de archivos tocados limpio. Sagrados diff VACÍO.

## Nota
Eliminar del **todo** la Bandeja standalone (incluida la ruta) requiere **primero re-apuntar el share target** a la
Bandeja dentro de Caja — tarea aparte, con su propio análisis. Este paso 2 no lo hace.
