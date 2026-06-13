# SPEC — Operación Lavu vs Satori (caja, proveedores, cierres, KDS, inventario)

> Fuente de verdad para **profundizar antes de ejecutar**. Investigación de Lavu en los módulos de
> OPERACIÓN (no la comanda de mesa — eso está en `SPEC-LAVU-FLUJO-MESA.md`). NADA acá está
> implementado por este documento; **cada ítem está marcado "⏳ pendiente de profundizar / decidir"**.
>
> Formato por punto: **Cómo lo hace Lavu** / **Qué tiene Satori** / **Oportunidad**.
> Fuentes: [Lavu KB](https://support.lavu.com) · reviews de PoS · documentación pública.

---

## 1. Caja diaria (Till management)

### 1.1 Till-In / fondo inicial firmado  ⏳
- **Lavu**: apertura de cajón con "Starting Bank" / Till-In; el cajero declara el fondo y queda
  firmado (quién, cuándo, monto). Conteo por denominación opcional.
- **Satori**: la Caja Diaria abre con un fondo (`initial_*`, carryover del cierre anterior) y cajero
  asignado; no hay conteo por denominación ni firma explícita por billete.
- **Oportunidad**: conteo por denominación al abrir (₡ y $) + firma del cajero. Bajo riesgo (aditivo).

### 1.2 Till-Out / cierre de cajón con varianza  ⏳
- **Lavu**: Till-Out cuenta el efectivo final, compara contra esperado y calcula **varianza**
  (sobrante/faltante) por cajón.
- **Satori**: el cierre compara efectivo real vs "debería quedar" y muestra diferencia (cuadra/no
  cuadra) — ya existe a nivel turno.
- **Oportunidad**: varianza por **denominación** y registro histórico de varianzas por cajero
  (control de mermas). 🔴 toca lógica de cierre (sagrado) → solo análisis.

### 1.3 Hora de corte del día configurable  ⏳
- **Lavu**: "Business day cutoff" configurable (ej. 04:00) para que la madrugada cuente al día
  anterior.
- **Satori**: el día es por fecha calendario (`session_date`); `todayCR()`.
- **Oportunidad**: corte configurable por local — relevante para el bar nocturno. Afecta reportes y
  cierres → 🔴 análisis cuidadoso.

---

## 2. Pago de proveedores y caja chica

### 2.1 Paid-Out del cajón  ⏳
- **Lavu**: "Paid Out" registra salidas de efectivo del cajón (proveedor, propina, gasto) con motivo
  y afecta el conteo esperado.
- **Satori**: pagos a proveedor en Efectivo salen de "Caja Proveedores"; Transferencia/SINPE del
  Banco. Foto de factura adjunta (mig 026). Categorías únicas Delivery/Propinas/Operativo.
- **Oportunidad**: ya bastante cubierto. Falta vincular cada Paid-Out a su impacto en el conteo
  esperado del cierre de forma explícita (hoy se deriva). 🟡

### 2.2 Depósito a banco / Vault con trazabilidad  ⏳
- **Lavu**: movimiento cajón→Vault/banco con esperado-vs-real y firma; trazabilidad quién/cuándo.
- **Satori**: existe Banco→Caja Fuerte / Caja Fuerte→Banco como traspasos; `saldoCajaFuerte`.
- **Oportunidad**: depósito con monto esperado vs confirmado por el banco + responsable. 🟡

### 2.3 Puente factura → inventario → costo de receta → margen  ⏳
- **Lavu**: integra compras con inventario y costeo de recetas (módulo de inventario).
- **Satori**: la foto de factura queda adjunta al pago; el módulo Inventario tiene recetas/COGS
  (Fase 1 del ROADMAP) pero NO conectado automáticamente con la factura del pago.
- **Oportunidad**: OCR/lectura de factura → alta de compra → entrada de inventario → recálculo de
  costo de ingrediente → margen del producto. **Gran valor, gran alcance.** 🔴 fase mayor.

---

## 3. Cierres y reconciliación

### 3.1 Modelo "Expected vs Actual vs Reconciliation=0"  ⏳
- **Lavu**: el cierre cuadra cuando **Expected Take In − Actual Take In − ajustes = 0**; deja la
  reconciliación explícita.
- **Satori**: el cierre del día tiene 2 fases y compara esperado vs real; el resultado es "cuadra /
  diferencia ₡X".
- **Oportunidad**: exponer el modelo como una identidad reconciliable a cero, con renglones de ajuste
  nombrados. 🔴 toca cierres (sagrado) → solo análisis.

### 3.2 Cajón vs banco de salonero por separado  ⏳
- **Lavu / industria**: separa la reconciliación del **cajón de efectivo** de la del **banco del
  salonero** (su fondo de vuelto y sus ventas atribuidas).
- **Satori**: hoy la caja es única por día; las métricas por salonero existen (`my_turno_stats`,
  atribución por `current_salonero_id`) pero la **reconciliación de efectivo por salonero** no está.
- **Oportunidad**: si se adopta el modelo de "banco por salonero" (cada uno responde por su efectivo),
  reconciliar por separado. Decisión operativa de la dueña primero. 🔵

---

## 4. KDS (cocina/barra)

### 4.1 Ruteo por estación  ⏳ → 🟢 YA
- **Lavu**: cada ítem rutea a su prep station.
- **Satori**: `station` por producto (cocina/barra/ninguna), snapshot en el ítem; KDS filtra por
  estación. **Implementado.**
- **Oportunidad**: más estaciones (fríos/calientes/postres) si el volumen lo pide. 🟡

### 4.2 Expo / pase de dos niveles  ⏳
- **Lavu**: pantalla de **expediter** que ve toda la comanda y coordina la salida; las estaciones
  bumpean su parte, el expo bumpea el pase final.
- **Satori**: KDS por estación con bump por ítem y por comanda; NO hay pantalla expo separada.
- **Oportunidad**: vista expo (agrega todas las estaciones de una mesa, marca "todo listo → servir").
  🟡 valor alto en servicio coordinado.

### 4.3 Conteos agregados / coordinación de salida  ⏳
- **Lavu**: conteos por ítem ("12 California Roll en cola") para batch cooking.
- **Satori**: no agrega por ítem entre comandas.
- **Oportunidad**: panel de conteos por producto en cola (la cocina cocina en lote). 🟡

### 4.4 Bump bar  ⏳
- **Lavu**: soporte de bump bar físico (teclado dedicado).
- **Satori**: bump táctil en pantalla.
- **Oportunidad**: atajos de teclado / bump bar para cocinas con guantes. 🔵

---

## 5. Inventario

### 5.1 Deducción por venta a nivel ingrediente  ⏳
- **Lavu**: vender un ítem descuenta sus ingredientes según la receta (depletion).
- **Satori**: módulo Inventario con recetas (BOM) existe en el ROADMAP F1; el PoS aún NO descuenta
  ingredientes al marchar/cobrar.
- **Oportunidad**: conectar `pos_order_items` → recetas → depletion. 🔴 fase mayor (toca inventario).

### 5.2 Órdenes de compra + alertas de bajo stock  ⏳
- **Lavu**: PO automáticas y alertas por umbral.
- **Satori**: alertas de bajo stock existen en Inventario; PO no.
- **Oportunidad**: generar PO desde bajo stock + recepción contra factura (ver 2.3). 🟡/🔴

### 5.3 FIFO / caducidad y costo teórico vs real  ⏳
- **Lavu**: control de caducidad y comparación costo teórico (receta) vs real (compras).
- **Satori**: costo unitario por producto y margen; sin FIFO ni teórico-vs-real.
- **Oportunidad**: lotes con caducidad + variance de costo (merma/robo). 🔴 fase mayor.

---

## Cómo seguir
Cada ítem ⏳ debe **profundizarse y decidirse con la dueña/asesor** antes de cualquier sprint. Orden
sugerido por valor/riesgo: 4.2 expo, 1.1 conteo por denominación, 2.3 puente factura→inventario
(la más grande), 5.1 depletion. NADA se implementa desde este documento.
