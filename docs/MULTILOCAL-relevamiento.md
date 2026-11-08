# Relevamiento multilocal · qué está atado a un local por nombre (08-nov-2026)

> **Regla (Ismael, 08-nov):** nada atado a Santa Teresa o Nosara por nombre; los locales salen de datos y abrir uno nuevo
> no requiere código. **Este documento solo lista; no se cambió nada fuera del Club.** Referencias contra `main` @
> `1e28444` (y la rama del puente donde se indica). Lo arregla cada frente cuando toque ese código.

## 0. El Club (hecho, rama `claude/epic-tesla-pyo77m`)
- Cumple la regla: los locales salen de `club_config` (`club_activo`, `nombre`, `direccion`, `mapa_url`). Encender
  Nosara es un dato (RUNBOOK del Club, paso 11). La prueba 70 de la batería verifica que **ninguna función `club_*`** tenga
  un local escrito.
- **Queda:** el `default 'santa-teresa'` de `location_id` en las tablas `club_*`. Ninguna función lo usa (todas pasan el
  local); solo lo usan las inserciones directas del migrador de Firestore (historia de Santa Teresa) y de la batería.
  Sacarlo es una limpieza aparte.

## 1. Estructural: los datos no tienen local (abrir Nosara acá SÍ requiere migración)
| Dónde | Qué | Efecto |
|---|---|---|
| Caja: `cash_sessions`, `cash_movements` (mig 001) | sin columna de local | las dos cajas se mezclarían |
| Caja: `cash_cierres_dia` (mig 071) | `unique (session_date)` | un solo cierre por día para todos los locales (la mig 071 ya lo anota: pasa a `(local, session_date)`) |
| Propinas: `tip_sessions`, `tip_entries`, `role_tip_points` (mig 001) | sin local | un solo pozo y una sola tabla de puntos |
| Personal: `employees` (mig 001) | sin local | un empleado no se asigna a un local; los reportes por local no pueden filtrar |
| `suppliers`, `exchange_rates` | sin local | probablemente correcto (globales); confirmar |

## 2. Defaults con un local
| Dónde | Qué |
|---|---|
| `supabase/migrations/062_pos_ndf_ingesta.sql:59` | `pos_ndf_tickets.local default 'santa-teresa'` (el Edge siempre lo manda; el default sobra) |
| `src/modules/ventas/ventasDiasDesdePos.ts:33` | `LOCAL_POR_DEFECTO = 'santa-teresa'` |
| `src/modules/ventas/VentasEnVivo.tsx:151` | `useState<LocalId>('santa-teresa')` |

## 3. Listas cerradas de locales en el código (un tercer local = código + deploy)
| Dónde | Qué |
|---|---|
| `src/modules/ventas/ventasEnVivoTypes.ts:32-36` | `type LocalId = 'santa-teresa' \| 'nosara'` y la lista con sus etiquetas |
| `src/shared/ndf/ingestNdf.ts:31` (Edge `ingest-ndf`) | `LOCALES = new Set(['santa-teresa', 'nosara'])` |
| `pos-bridge/configAgente.ts:11` (rama `claude/puente-item11-prod`) | `LOCALES = ['santa-teresa', 'nosara']` |
| `supabase/functions/ingest-ndf/index.ts:117` (rama del puente) | `localLegado: 'santa-teresa'` para el secreto único de antes (desaparece cuando se borre `POS_INGEST_SECRET`, 7 días después del pase) |

**No se toca antes del pase del lunes:** el Edge del puente se despliega en el SHA fijo `e4678b3`.

## 4. Reglas de negocio de un local escritas en el código
| Dónde | Qué |
|---|---|
| `src/modules/ventas/temporadas.ts:1` | «Temporadas de Santa Teresa — la ÚNICA fuente de verdad»: Nosara puede tener otras temporadas → deberían ser datos por local |
| `scripts/contrato-prompax/descargar.sh:42,56,60` | `'santa-teresa'` fijo en las consultas |

## 5. Textos y marca con el nombre del local
`src/modules/cash/CashModule.tsx:152` · `src/modules/cash/comprobante.ts:118` · `src/modules/resumen/ReporteMensual.tsx:291` ·
`src/modules/resumen/ResumenDiario.tsx:178,251` · `src/modules/resumen/ResumenSemanal.tsx:161` ·
`src/modules/ventas/ReporteMensual.tsx:122` · `src/modules/ventas/VentasHoy.tsx:257` · `src/pages/HomePage.tsx:402` ·
`src/pages/RegistroCliente.tsx:63` · `src/pages/auth/LoginPage.tsx:32` · Edge `cierre-email/index.ts:123` ·
Edge `monthly-report/index.ts:58`.
Con un local en datos, estos textos salen del local de la sesión o del reporte («Satori · <nombre del local>»).

## 6. Mocks (no aplica)
`src/modules/ventas/ventasEnVivoMock.ts:106-112`: datos de ejemplo por local; no corren en producción.

## Propuesta (para decidir, no hecha)
Una tabla `locales` (id, nombre, dirección, mapa, zona horaria, activo por módulo) como única fuente, que usen la caja,
las propinas, las ventas, el puente y el Club (hoy el Club usa `club_config`, que podría referenciarla). El orden lo decide
Ismael; lo estructural de la §1 es lo que de verdad frena abrir Nosara fuera del Club.
