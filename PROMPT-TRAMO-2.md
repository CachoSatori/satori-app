MODO AUTÓNOMO NOCTURNO — TRAMO 2 (5:00 AM CR). Mismos GUARDRAILS NOCTURNOS del tramo 1: nada a main, cero contacto con prod, ramas + staging solo con trabajo completo, DDL aditivo a staging, sagrados intactos, decisiones marcadas como DECISIÓN-NOCTURNA.

AUDITORÍA PRIMERO: leé REPORTE-NOCHE.md y el estado real de las ramas. Si el tramo 1 dejó algo a medias: completalo o revertilo antes de empezar nada nuevo. Builds y tests verdes como punto de partida obligatorio.
OBJETIVO: arranque de PoS F2 (comandero + KDS) en rama pos-f2, sobre lo construido en F1:

a. Migración: pos_orders (mesa, salonero, pax, estado, location_id, timestamps, transferencias de salonero) + pos_order_items (producto, modificadores elegidos como jsonb, asiento/cliente, curso bebida/entrada/principal, estado cocina, timestamps) + realtime habilitado en ambas.

b. Comandero (tablet): abrir mesa desde el plano del salón de F1 con pax OBLIGATORIO ≥1 — el 0 no existe (teclado numérico, botón deshabilitado sin pax válido), badge de pax visible y editable; tomar pedido del catálogo con modificadores (los obligatorios bloquean); curso por ítem con un tap (default por categoría); asignación de ítem a asiento/cliente; botones "Marchar bebidas/entradas/principales/todo".

c. KDS (pantalla web para las TVs): comandas en vivo por Realtime, ítems ordenados por categoría según orden configurable en admin, timer por comanda verde→rojo con umbral configurable por curso, vista salón/delivery separadas, bump (marcar listo) pensado para la tablet de barra de cocina.

d. Tests de lo testeable + seeds para demo (una mesa abierta de ejemplo).
Lo que quede completo y estable → merge a staging; lo incompleto queda en pos-f2 documentado.
REPORTE CONSOLIDADO DE LA NOCHE (actualizá REPORTE-NOCHE.md): todo lo construido en ambos tramos, decisiones nocturnas, migraciones, y el plan de prueba física completo para la dueña — de abrir el editor de salón a tomar un pedido de prueba y verlo aparecer en el KDS.
