# SPEC — Competidores PoS (Toast, Square, TouchBistro) · comanda y operación

> Análisis paso a paso de los PoS de referencia en el módulo de **comanda** y **operación**, para
> profundizar antes de decidir. NADA implementado por este documento.
>
> Por feature: **descripción paso a paso** · **¿Satori lo tiene?** · **encaje** (🟢 ya / 🟡 valioso
> y razonable / 🔵 futuro o depende de decisión) · **fuente**.

---

## A. Toast

### A.1 Firing por servidor — Hold / Stay / Send  🟡
- **Paso a paso**: el mesero arma la comanda; **Send** dispara a cocina; **Hold** retiene un ítem
  hasta soltarlo (no sale aunque se envíe el resto); **Stay** mantiene la pantalla para seguir
  agregando. El control lo tiene el servidor, no solo reglas de backend.
- **Satori**: tiene "Marchar" (=Send) por curso/total + deshacer 20s. NO tiene Hold real (retener un
  ítem mientras se manda el resto).
- **Encaje**: 🟡 — Hold real por ítem complementa los cursos.
- **Fuente**: [Toast — Ordering Screens](https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens), [Course Firing](https://support.toasttab.com/en/article/Course-Firing-Options).

### A.2 Coursing required / optional / off  🟢🟡
- **Paso a paso**: por modo (Quick/Table) se define si el curso es obligatorio, opcional o apagado.
- **Satani**: cursos bebida/entrada/principal + curso activo global; no hay modo "required/off"
  configurable por local.
- **Encaje**: 🟡 — toggle de coursing por local.
- **Fuente**: Toast Course Firing (arriba).

### A.3 Disparo por tiempo de prep (escalonar para salida simultánea)  🟡 → ver GAPS
- **Paso a paso**: cada ítem tiene tiempo de prep; el sistema retrasa el disparo de los rápidos para
  que todo salga junto (fire-by-prep-time).
- **Satori**: el campo `prep_time_min` **ya existe** en la ficha; el KDS NO lo usa para escalonar.
- **Encaje**: 🟡 alto valor, dato ya presente → ver `SPEC-COMANDA-GAPS.md` §2.
- **Fuente**: Toast kitchen timing / prep stations.

### A.4 Expediter / pase de dos niveles  🟡
- **Paso a paso**: pantalla expo que ve la comanda completa; estaciones bumpean su parte, el expo
  coordina y bumpea el pase final.
- **Satori**: KDS por estación con bump; sin pantalla expo. (También en `SPEC-LAVU-OPERACION.md` §4.2.)
- **Encaje**: 🟡.

### A.5 Prep stations  🟢
- **Satori**: ruteo por estación implementado (cocina/barra). 🟢

### A.6 86 (sold-out) vía Quick Edit  🟡
- **Paso a paso**: marcar un ítem como agotado en 2 toques desde la comanda; desaparece/!se bloquea.
- **Satori**: se desactiva el producto en el Gestor (no es "86 rápido" desde la comanda en vivo).
- **Encaje**: 🟡 — botón "86" temporal del día desde el comandero/KDS.
- **Fuente**: Toast 86 / Quick Edit.

### A.7 Captura de datos de invitado  🔵
- **Paso a paso**: nombre/teléfono del invitado en la cuenta para CRM.
- **Satori**: CRM de clientes existe aparte; no se captura en la comanda.
- **Encaje**: 🔵 (depende de querer atar comanda↔CRM).

### A.8 Revenue centers  🟡 → ver GAPS
- **Paso a paso**: cada venta se atribuye a un "centro de ingreso" (salón/barra/terraza) para
  reportes por área.
- **Satori**: hay `channel` (salon/barra/delivery) en la orden, pero no un revenue center
  configurable por mesa/área para reportería.
- **Encaje**: 🟡 → ver `SPEC-COMANDA-GAPS.md` §3.
- **Fuente**: Toast revenue centers.

---

## B. Square for Restaurants

### B.1 Coursing drag-and-drop  🔵
- **Paso a paso**: arrastrar ítems entre cursos en la pantalla de comanda.
- **Satori**: el curso se elige por ítem (chip/selector) y curso activo; no hay drag entre cursos.
- **Encaje**: 🔵 (nuestro selector ya resuelve el caso; drag es lujo).
- **Fuente**: [Square for Restaurants](https://squareup.com/us/en/point-of-sale/restaurants).

### B.2 Asiento → KDS ("Asiento 3: plato")  🟢
- **Satori**: asiento por ítem + asiento activo; el KDS muestra `as.N`. 🟢
- **Fuente**: [Square — order by seat / KDS].

### B.3 Acciones de cuenta: Move / Assign / Comp / Void  🟡 → ver GAPS
- **Paso a paso**: mover ítems entre cuentas/mesas; asignar a invitado; **Comp** (regalo intencional)
  y **Void** (anulación por error) como acciones SEPARADAS.
- **Satori**: transferir mesa ✅, combinar/separar ✅, anular enviado (void con motivo) ✅. **NO hay
  Comp** como concepto separado del Void.
- **Encaje**: 🟡 — Comp vs Void → ver `SPEC-COMANDA-GAPS.md` §1.
- **Fuente**: [Square — comps and voids].

### B.4 Comp vs Void como conceptos separados  🟡 → ver GAPS
- **Paso a paso**: **Void** = el ítem no se hizo / error → no cuenta, no impacta COGS de venta.
  **Comp** = se hizo y se regaló (cortesía) → impacta inventario/COGS pero no ingreso; va a un
  reporte de cortesías para P&L.
- **Satori**: solo Void (anulado). No distingue el regalo intencional.
- **Encaje**: 🟡 importante para P&L → `SPEC-COMANDA-GAPS.md` §1.

### B.5 Split check vs split payment  🟢🟡
- **Paso a paso**: dividir la CUENTA (en varias cuentas) ≠ dividir el PAGO (varios métodos sobre una
  cuenta).
- **Satori**: split de cuenta en 3 modos ✅; el pago por check es único (no varios métodos sobre un
  mismo check). 
- **Encaje**: 🟡 — pago partido (mitad tarjeta/mitad efectivo) sobre una cuenta.

### B.6 Menús por daypart con swap  🔵
- **Paso a paso**: el menú cambia por franja horaria (desayuno/almuerzo/cena) automáticamente.
- **Satori**: un menú; familias/categorías estáticas.
- **Encaje**: 🔵 (Satori es cena/bar; menos crítico).

### B.7 Reabrir cuentas  🟢
- **Satori**: F20 reabrir/recerrar con permiso ✅.

### B.8 Sold-out en tiempo real  🟡
- Igual que A.6 (86). 🟡.

### B.9 Plano color-coded con covers  🟡
- **Paso a paso**: el plano colorea mesas por estado (abierta/por cobrar/tiempo) y muestra covers.
- **Satori**: plano con mesas abiertas (color rojo abierta / teal libre) + pax; sin gradiente por
  tiempo/estado de cobro.
- **Encaje**: 🟡 — color por antigüedad/estado de la mesa.

---

## C. TouchBistro

### C.1 Coursing  🟢
- **Satori**: cursos implementados. 🟢. Fuente: [TouchBistro — Processing Orders](https://cdn.touchbistro.com/help/articles/processing-orders/).

### C.2 Menús programados  🔵
- Igual que B.6 daypart. 🔵.

### C.3 Prompts de upsell  🔵
- **Paso a paso**: al agregar X, sugiere Y ("¿agregar guarnición?").
- **Satori**: no.
- **Encaje**: 🔵.

### C.4 Fotos / descripciones / alérgenos / maridajes por ítem  🟢🟡
- **Satori**: foto por producto ✅ (mig 030), alérgenos ✅ (campo en ficha), prep_time ✅; descripción
  para carta y maridajes NO.
- **Encaje**: 🟡 — descripción/maridaje por ítem (útil para el comandero y futura carta QR).
- **Fuente**: TouchBistro item details.

### C.5 Arquitectura híbrida offline  🟢
- **Paso a paso**: opera local-first y sincroniza; no depende de la nube en vivo.
- **Satori**: offline-first (caché de lectura + outbox idempotente) ✅ en Caja/Propinas. El PoS aún
  no tiene outbox propio (sus escrituras requieren red).
- **Encaje**: 🟡 — extender el outbox al PoS (comandar offline). Importante para el piloto con LTE.

---

## Síntesis — qué está más maduro y qué falta
- **Satori ya cubre**: ruteo por estación, asiento→KDS, split de cuenta, reabrir, foto/alérgenos,
  offline en caja, transferir/combinar/anular.
- **Gaps priorizados** (detalle en `SPEC-COMANDA-GAPS.md`): **Comp vs Void**, **fire-by-prep-time**,
  **revenue centers**.
- **Otros 🟡 a evaluar**: Hold real, expo/pase, 86 rápido, pago partido, color del plano por estado,
  outbox para el PoS (comandar offline), descripción/maridaje por ítem.
- Todo **⏳ pendiente de profundizar/decidir** — no implementar sin acuerdo.
