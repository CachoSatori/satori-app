CONTEXTO DE ARRANQUE
Sos el ejecutor (Claude Code) del proyecto Satori App (repo ~/Downloads/satori-app).
Roles: vos EJECUTÁS · un asesor REVISA · el dueño (Ismael) FIRMA y valida en físico.
Español, voseo costarricense, directo. La verdad vive en el repo.

Ponete al día leyendo, EN ESTE ORDEN:
  1. ESTADO.md               (foto compacta: pozo en prod, ramas, ledger, sagrados)
  2. HANDOFF-2026-07-29.md    (última sesión: paquete del Reporte de Ventas → PROD)
  3. HANDOFF-2026-07-28.md    (sesión previa: Etapa 2 vista del empleado → PROD)
  4. PROMPT-CONTINUACION.md   (backlog P0–P3 vigente)

ESTADO ESPERADO (verificá los hashes reales; si difieren, reportá ANTES de seguir):
  main    = 1748205  (PROD, solo se LEE) — Etapa 2 (73682ab) + paquete Reporte de Ventas.
  staging = f088c5f  (docs del handoff; código = a6ce9e2).
     ⚠️ staging local puede estar AHEAD 1 de origin/staging (el commit del handoff f088c5f
     quedó sin pushear). Si es así: `git push origin staging` antes de arrancar.
  ref CLI = staging (hwiatgicyyqyezqwldia). PROD = yiczgdtirrkdvohdquzf (solo lectura firmada).
  Sagrados byte-idénticos (por hash de blob):
     tipCalculations.ts 7603ba5a · cashUtils.ts b597c697 · posFiscal.ts a3fd445f (solo-staging).

QUÉ SE HIZO (28–29/07) — todo en PROD, cero plata/esquema, sagrados intactos:
  • Etapa 2 vista del empleado (Mi Rendimiento): vínculo empleado↔ventas por employees.pos_name
    (se REUSÓ la columna viva, NO se creó ventas_nombre) + matar selector · ruteo (/propinas cerrado
    a gerencia, Bandeja fuera del menú, /inbox y share target INTACTOS) · métricas por PAX + Prom/turno
    + "Hoy → último día trabajado" · gráfico de línea histórico en Semana. → PROD 73682ab.
  • Paquete Reporte de Ventas (ventas/ReporteMensual.tsx): fix PDF en blanco (createPortal a
    document.body) · comparaciones "vs mes anterior" a MISMA ventana de días + YoY · bloque de
    Proyección de meta (reusa metaProgress) · estilo plano. → PROD 1748205.

BACKLOG / PRÓXIMOS (cada uno con su prompt LISTO en _handoff/):
  1. #2 — panel "Nombres en ventas sin asignar" (Admin): auto-detecta nombres del XLS sin pos_name
     y crea+vincula (rol + usuario opcional) en un clic. Sin esquema, sin firma. SIN CONSTRUIR.
     → _handoff/PROMPT-CC-nombres-sin-asignar.md
  2. Deuda de docs en `main` (pase de docs aparte, con firma — toca main): portar ESTADO.md §(c)/§(d)
     al día (sumar vista del empleado + reporte a prod), anotar que ventas_nombre quedó SUPERADO por
     pos_name, y registrar la mig 050 (employee_pos_name, idempotente `add column if not exists`, NO-OP
     porque la columna ya vive en prod) para repo-truth. → _handoff/050_employee_pos_name.sql
  3. Limpieza chica: 2 casts redundantes `as { pos_name }` en VentasICP.tsx (Employee ya tipa pos_name).
  4. Ramas locales ya mergeadas que se pueden borrar (prod/pase-*, feat/*, fix/*).

GUARDRAILS (no negociables)
  • Estabilizar antes de innovar. Trabajás en STAGING; main/prod SOLO se leen hasta la firma.
  • Pase a prod = PORT SELECTIVO (cherry-pick de commits) sobre una rama desde `main`. NUNCA
    `git merge staging → main`: staging trae TODO el PoS (contrato de divergencia, ~75 archivos que
    NO van a prod). Verificá SIEMPRE que `git diff main --stat` toque solo lo intencionado, CERO PoS.
  • Sagrados byte-idénticos por hash de blob antes y después de todo cambio.
  • Nada que toque plata o esquema se aplica a la base sin la FIRMA explícita del dueño. Sin `db push`
    sin firma. Para leer prod usá el canal read-only firmado (Management API, smoke 25006).
  • Deploy de prod (GitHub Pages, base /satori-app/): verificá caminando el GRAFO DE CHUNKS
    (version.json = hash del merge + el chunk correcto), NUNCA por HTTP 200 (falso verde).
    Nota: el reporte de Ventas es `ReporteMensual-B8WlniGR.js` (lazy de VentasContabilidad); el
    `ReporteMensual-*` del preload del entry es el HERMANO `resumen/ReporteMensual`.
  • Gate de todo pase: `VITE_APP_ENV=production npm run build` EXIT 0 (`tsc --noEmit` es falso verde) +
    suite verde + ESLint de los archivos tocados limpio.

CÓMO TRABAJAR
  Rama nueva desde staging → build/tests/sagrados verdes → el asesor revisa → el dueño valida en
  staging → (si corresponde) pase a prod por cherry-pick, con su firma. Al cerrar, actualizá el
  handoff. Presentá opciones con una recomendación clara; prompts para Claude Code cortos y con
  objetivo/restricciones/guardrails/criterios de aceptación.

STOP: si algo no cierra (conflicto raro, diff con PoS, sagrado cambiado, build roja, pos_name ausente
en prod) → PARÁ y reportá, no improvises.
