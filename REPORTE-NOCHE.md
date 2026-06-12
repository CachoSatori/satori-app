# REPORTE NOCTURNO — TRAMO 1 (2026-06-12, madrugada)

> Guardrails respetados: **cero contacto con prod** (ni lectura) · **main intacto** ·
> trabajo en rama `pos-f1` → mergeado a `staging` solo completo y verde ·
> DDL aditivo únicamente · sagrados (cashUtils/tipCalculations/cierres) sin tocar.

## Tabla de ítems

| Ítem | Estado |
|---|---|
| Tarea B (transferencias visibles) | ✅ Ya estaba COMPLETA y en staging desde ayer (`0a6b853`) — verificado, nada que terminar |
| Migración multi-local (`locations`) | ✅ COMPLETO (mig 022, seeds Santa Teresa + Nosara) |
| Migración catálogo modificadores | ✅ COMPLETO (mig 022: `modifier_groups`/`modifiers`/`product_modifier_groups` sobre `product_map` sin alterarlo) |
| Migración salón (`salon_tables`) | ✅ COMPLETO (mig 022) |
| Admin → Catálogo PoS | ✅ COMPLETO (grupos, opciones con delta ₡, vínculo a productos, vista previa del salonero con precio en vivo) |
| Admin → Editor de Salón | ✅ COMPLETO (plano por local, mesas con +/- de posición — robusto en tablet —, capacidad/forma/nombre, quitar) |
| Admin → Locales | ✅ COMPLETO (alta/edición + selector de local activo) |
| RLS tablas nuevas | ✅ COMPLETO (patrón real: lectura autenticada, gestión owner/manager con `get_my_role()`) |
| Tests | ✅ 29/29 (20 previos + 9 nuevos de `posPricing`) |
| Seeds demo en staging | ✅ Licor (obligatorio: Flor de Caña +0 / Zacapa +3000 / Bacardí +500), Término, Extras · MOJITO y MOJITO ZACAPA 23 vinculados · 20 mesas ST (mezcla 2/4/6 pax) |
| P3c (estados vacíos) | ⏭ NO INICIADO (presupuesto a F1 sólida, como ordena el prompt) |
| PROMPT-TRAMO-2.md + job programado | ✅ archivo creado · job: ver sección "Tramo 2 programado" |

**Commits**: `01664eb` (F1 completa) sobre `staging` (que ya traía la Tarea B `0a6b853` y el SQL de prod `f06c6d3` en pausa).
**Migraciones aplicadas a staging**: `022_pos_f1_locales_catalogo_salon.sql` (aditiva, registrada).
**Smoke-test en navegador** (staging build, usuario de prueba): pestaña Admin → 🍣 PoS abre; salón muestra las 20 mesas; en Catálogo el grupo obligatorio **bloquea** sin selección y con Zacapa el total da **₡7.500** (4.500 base + 3.000) con "✓ se puede enviar".

## DECISIONES-NOCTURNAS (para revisión de la dueña)
1. **Una sola migración 022** (en vez de 3): mismas tablas, un solo archivo atómico e idempotente.
2. **Una pestaña "🍣 PoS" en Admin** con 3 secciones internas (Salón/Catálogo/Locales) en vez de 3 pestañas — menos invasivo en AdminModule.
3. **Vínculo producto↔grupo por NOMBRE** (`product_map.nombre` es la PK real de la tabla) — mismo patrón que ventas/recetas.
4. **`location_id` solo en tablas NUEVAS**; las existentes (caja/propinas/ventas) se adoptan en F4 con columnas nullable + backfill `santa-teresa` (documentado en la migración). F1 no toca producción.
5. **Posición de mesas con botones ↑↓←→ (pasos de 20px)**, no drag — confiable en tablet; el drag se puede sumar después sin migrar nada.
6. **`test-manager@staging.satori` quedó promovido a OWNER en staging** (para smoke-test de Admin y para que mañana puedas probar sin tus credenciales reales). `verify_manager` sigue aceptándolo para el override. Si lo querés de vuelta como manager: `update profiles set role='manager' where email='test-manager@staging.satori'`.
7. **Vista previa del catálogo usa base de ejemplo ₡4.500** — `product_map` no tiene precio de venta (solo costo); el precio de venta del PoS se definirá en F2/F3 (columna nueva o tabla `pos_prices`). Anotado como decisión de producto pendiente.

## Tramo 2 programado — ⚠️ requiere lanzamiento manual
- `PROMPT-TRAMO-2.md` en la raíz (contenido exacto de la dueña).
- Job `launchd` **cargado y verificado** (`com.satori.tramo2`, 05:00 hora local = hora CR; log en `/tmp/satori-tramo2.log`). **PERO**: esta Mac **no tiene el CLI `claude` instalado** (esta sesión corre dentro de la app de escritorio, que no expone el binario) → a las 05:00 el job va a dejar en el log el aviso "claude CLI no instalado" y nada más. **El TRAMO 2 hay que lanzarlo a mano al despertar**: abrí Claude Code (app) en este repo y pegale el contenido de `PROMPT-TRAMO-2.md`.
- Alternativa permanente: instalar el CLI (`npm install -g @anthropic-ai/claude-code`, requiere sesión iniciada con `claude login`) y el job de las 05:00 corre solo de ahí en más. Para quitar el job: `launchctl unload ~/Library/LaunchAgents/com.satori.tramo2.plist`.
- Nota de seguridad: el job usa `--dangerously-skip-permissions` (necesario para correr sin nadie frente a la pantalla). Los guardrails quedan a cargo del prompt — revisá el log a la mañana.

---

# ☀️ CHECKLIST DE LA MAÑANA (dueña)
1. **PROD**: correr `MIGRACIONES-PROD-OFFLINE.sql` en el SQL Editor de PROD → confirmar **3 filas ok=true**.
2. **Confirmar A.3**: el merge a `main` va **solo hasta `f06c6d3`** (offline + SQL; el fix de transferencias y la F1 quedan en staging para su propio ciclo). Decímelo y lo ejecuto.
3. **Tarea B en staging** (7 pasos): anotar el Restante → pago por **Transferencia** → aparece en la lista con "pendiente · no descuenta efectivo" → el Restante NO cambia → línea "Pagos por transferencia (pendientes): N por ₡X" → sigue en Pendientes → un pago en Efectivo sí baja el Restante.
4. **F1 nocturna en staging** (login `test-manager@staging.satori` / `staging-test-2026`): Admin → 🍣 PoS →
   (a) **Editor de Salón**: ves TUS 20 mesas; tocá una, movela con las flechas, cambiale pax;
   (b) **Catálogo PoS**: grupo "Licor" → vista previa: sin licor te bloquea, con Zacapa suma ₡3.000;
   (c) **Locales**: cambiá el selector a Nosara → salón vacío (correcto, sin mesas aún).
