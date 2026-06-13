# ESTADO — PROMPT 1: Integración Propina PoS → Pool del turno 🔒 SAGRADO

> Rama: **`propina-pool`** (desde `staging`). **NO MERGEADA** — espera validación de la dueña.
> `main` intacto · cero PROD · DDL aditivo · la matemática del reparto **NO se tocó**.
> Tests: **101/101 verdes** · tsc verde · build verde.
> (Nota: el `ESTADO.md` grande es el estado maestro del proyecto — no lo piso; este es el reporte
> dedicado de este prompt.)

---

## 🔒 Regla sagrada respetada
**`tipCalculations` y la lógica de reparto NO se reimplementaron ni se tocaron.** Lo único que
cambió es el **total de efectivo que el reparto recibe**: ahora es `manual (frasco) + propinas del
PoS`. Cómo se reparte ese total (puntos por rol, horas, pool de barra, payouts) sigue **idéntico**.
El diff de `tipCalculations.ts` es **vacío**.

---

## 1) Diagnóstico (antes de tocar nada)
- **La propina ya se captura** en el cobro: `pos_payments.tip_crc` (+ `tip_currency`), desde la
  tanda de "propina en el cobro". No había que volver a capturarla.
- **El pool del turno vive en `tip_sessions`**: `pool_efectivo_crc/usd` (frasco, ingresado a mano
  en Propinas) y `pool_barra_crc`. Estos campos se **auto-guardan cada 800 ms** mientras el cajero
  escribe (`updateSessionPools`).
- **Riesgo detectado:** si escribía las propinas del PoS *dentro de* `pool_efectivo_crc`, el
  auto-guardado del cajero las **pisaría** y re-sincronizar las **duplicaría**. → Por eso usé un
  **campo separado**.
- **Atribución:** el pedido guarda `current_salonero_id` → se atribuye cada propina al salonero que
  tenía la mesa al cobrar (para auditar; el reparto sigue siendo por pool, eso no cambia).

## 2) Qué se conecta (lo nuevo)
- **Migración 035** (aditiva, ya aplicada y registrada en staging): 2 columnas en `tip_sessions`
  → `pool_pos_crc`, `pool_pos_usd` (separadas del manual), default 0.
- **RPC `sync_pos_tips_to_pool(session_id, fecha)`** (SECURITY DEFINER, solo owner/manager):
  suma `tip_crc` de los pagos de pedidos **cerrados** de esa fecha y lo escribe con **SET (no ADD)**
  → **idempotente**: re-correr da el mismo número, **nunca duplica**. Devuelve el desglose por
  salonero. (`supabase/migrations/035_propina_pos_pool.sql`.)
- **Funciones puras** `sumPosTips` / `efectivoPoolConPos` (`src/shared/utils/posTips.ts`):
  suma/atribución y `pool_efectivo = manual + pos`. No tocan el reparto.
- **API** `syncPosTipsToPool(sessionId, date)` (`src/shared/api/tips.ts`) que llama a la RPC.
- **UI en Propinas** (`TipsModule.tsx`): línea **"📲 Propinas PoS ₡X"** con botón **"↻ Traer del
  PoS"** y desglose por salonero. El total del PoS se **suma al efectivo** que alimenta el reparto
  (vía `efectivoPoolConPos`) y se incluye en el "Pool total" al cerrar. El campo manual del cajero
  **no se toca** (su auto-guardado sigue escribiendo solo `pool_efectivo/usd/barra`).

## 3) Tests dedicados (obligatorios — verdes)
`src/shared/utils/posTips.test.ts` (5 casos):
- **3 pagos con propina → pool = suma exacta + atribución** (`4500`, `{ana:2500, beto:2000}`).
- Ignora propinas en 0 y "sin-asignar".
- **Idempotente** (re-llamar = mismo total, no acumula).
- `efectivoPoolConPos` = manual + PoS (y manual solo = igual que hoy).

**Verificación end-to-end en la DB de staging** (sesión + pedido cerrado con 2 pagos):
`sync` #1 → `pool_pos_crc = 25 450` con atribución por salonero; `sync` #2 → **sigue 25 450**
(no duplica). ✅

---

## ⚠️ DECISIÓN-PRODUCTO pendiente (NO la resuelvo sola — la dejo planteada)
**¿La propina de tarjeta/SINPE va al MISMO pool que la de efectivo, o separada?**

- **Implementé la opción conservadora:** **todo al mismo pool** (`pool_pos_crc`), con la **etiqueta
  de origen** disponible (`pool_pos_usd` marca cuánto entró en $, y el desglose por salonero queda
  registrado). Es lo que menos sorpresas da: el equipo ve un solo pool, como hoy con el frasco.
- **Switch documentado para cambiarlo:** si preferís separar tarjeta/SINPE del efectivo (p. ej.
  porque la tarjeta paga comisión o se liquida distinto), el cambio es chico: la RPC ya separa por
  moneda; agregar un `filter (where p.method = 'efectivo')` para un pool y otro para tarjeta/SINPE
  + una segunda columna. **No lo hago sin tu OK** porque cambia cómo el equipo ve su plata.

**Ambigüedad menor a confirmar:** los pagos del PoS no tienen "turno AM/PM", así que la
sincronización es **por fecha**. Si un día tiene turno AM **y** PM, ambos verían la misma suma del
día. Hoy lo normal es un turno por día; si hay días con dos turnos, habría que mapear por hora de
cierre del pedido vs. hora del turno (anotado, no implementado).

---

## 🧪 Plan de prueba física (staging) para la dueña
1. **Cobrá 2-3 mesas con propina** en el comandero (efectivo y tarjeta), cerralas.
2. Entrá a **Propinas**, abrí/encontrá el turno del día.
3. Tocá **"↻ Traer del PoS"** → aparece **"📲 Propinas PoS ₡X"** = la suma exacta de lo cobrado,
   con el desglose por salonero.
4. **Tocalo otra vez** → el número **no cambia** (no duplica).
5. Mirá los **payouts**: el pool efectivo ahora incluye esas propinas; el reparto entre el equipo
   es el de siempre, solo que sobre un total mayor.
6. **Cerrá el turno** → el "Pool total" del confirm incluye las propinas del PoS.

---

## Estado
- `propina-pool`: **pusheada, sin merge**. Esperando tu validación + tu decisión de producto.
- `main`: intacto. PROD: sin tocar.
- Siguiente (PROMPT 2 y 3): FE estructura e Inventario activo — esas **sí** se mergean a staging
  cuando estén completas con tests verdes.
