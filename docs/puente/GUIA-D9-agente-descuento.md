# Guía D9 · el agente del PoS empieza a leer el descuento — para el dueño, en una página

> Versión simple de [`PASE-D9-AGENTE-bloques.md`](PASE-D9-AGENTE-bloques.md) (los bloques que se pegan) y del
> [PASE D9](../pases/PASE-D9-descuento-linea-pos.md). Si algo de acá no coincide con los bloques, **valen los bloques** y
> se para. **El `.env` no se abre, no se copia al portapapeles, no se muestra y no se manda por chat**: los bloques lo
> copian solos y dicen solo nombres.

**Qué pasa:** el agente de la PC del PoS pasa a una carpeta nueva (`C:\satori\agente-d9`) con el código que lee el
descuento de cada línea (`578f38c`). Hoy las ventas entran con descuento 0 desde 2024; desde el cambio entran con el
descuento real. Esta noche se rellena el histórico. **No cambia** ningún total, ni la base, ni el receptor, ni el
secreto. La carpeta de hoy queda intacta: es la vuelta atrás.

**Quiénes:** el **dueño** pega los bloques y lee la última línea. **Control:** la encargada o Claude por chat: compara
esa línea con «Ve» y corre las consultas de solo lectura. No es la misma persona.

**Cómo:** en la PC del PoS, abrir **Windows PowerShell como administrador** (no el ISE). Por escritorio remoto,
pegar con clic derecho desordena los bloques largos y Ctrl+C / Ctrl+V no llegan, así que **el método por defecto es por
archivo** (con el preámbulo y con cada bloque):
1. Pegar el bloque en el **Bloc de notas** y guardarlo como `C:\satori\paso.ps1` (*Tipo*: «Todos los archivos»;
   *Codificación*: **UTF-8 con BOM**).
2. Una sola vez por consola: `Set-ExecutionPolicy -Scope Process Bypass -Force`.
3. Cargarlo con punto y espacio: `. C:\satori\paso.ps1` (así el preámbulo queda cargado para los bloques que siguen).

Primero el **preámbulo** (se vuelve a cargar si abre otra consola); después cada bloque **entero**. Si un bloque termina en
rojo, **no se sigue**: se le pasa el mensaje a Claude. Ningún bloque lleva secretos, así que `paso.ps1` tampoco.

## Parte A · HOY (nunca entre 15:50 y 19:00) · 25–35 min
| # | Bloque | Tarda | Qué ve el dueño | Se para si… |
|---|---|---|---|---|
| 0 | A0 · comprobaciones (solo mira) | 2 min | `A0 ok · … agente de hoy 5da233a… limpio · tarea Running …`. Claude confirma que el agente late sin error | la tarea no corre, el agente de hoy no está en `5da233a`, o no late |
| 1 | A1 · clon nuevo | 3–5 min | `A1 ok · … en 578f38c… · solo cambian los 5 archivos de pos-bridge` | otro SHA, otro contenido o la carpeta ya existe |
| 2 | A2 · copia del `.env` (se puede repetir: si ya está idéntica, sigue) | 1 min | `A2 ok · copiados idénticos … ninguna falta … largo 64 · candado ok` (nunca un valor) | falta una clave (dice solo el nombre) o no manda lo mismo |
| 3 | A3 · dependencias y pruebas | 6–10 min | mucho texto de npm y al final `A3 ok · … 478 pruebas en verde` | una prueba falla o `mssql` no carga |
| 4 | A4 · prueba en seco (7 días, **no envía nada**) | 2–3 min | una línea por día y `A4 ok · … con_descuento N (P %) · nada enviado` | **P = 0 o más de 50 %**. Entre 1–14 % o 31–50 %: sigue solo si Claude dice que sí |
| 5 | A5 · cambio de la tarea | 2 min (agente detenido ~30 s) | `A5 ok · tarea → …pos-agente-prod-d9.cmd · detenida N s · HORA_CAMBIO …` → **pasársela a Claude** | el agente nuevo no arranca → **A7 ya** |
| 6 | A6 · verificación | 5–10 min | `A6 ok · Running …`. Claude lee el latido 2 veces y le pasa al dueño **un conteo**: facturas nuevas y cuántas con descuento | no late en 3 min, late con error, descuento negativo, o la primera factura cobrada no coincide con el tiquete → **A7** |
| — | A7 · vuelta atrás (solo si hace falta) | 2 min | `A7 ok · tarea → …(5da233a…)` y Claude confirma el latido | — |

Al **cierre de caja** de la noche, Claude repite el conteo de A6: tiene que haber facturas con descuento.

## Parte B · ESTA NOCHE (00:00–06:00) · lo que estimó A4 (≈ 1 h a 1 h 30)
| # | Quién | Qué | Qué se ve | Se para si… |
|---|---|---|---|---|
| 1 | Claude | **Humo antes** en prod, solo lectura (`descuento_pos_humo.sql`, corte `2026-11-17 00:00 -06:00`) | conteos y huellas (sin montos) | no coinciden con el PASE D9 §6 «Antes» y no se explica |
| 2 | Dueño | Preámbulo y **B1**. Corre mes por mes, de noviembre 2026 hacia enero 2024, con pausa de 0,8 s entre días | por mes: `── 2026-10 ok en N min`; al final `HISTÓRICO COMPLETO` o `falta … (sigue la noche siguiente)` | un mes con error o el agente en vivo que deja de correr (el bloque para solo y dice dónde quedó). A ojo: `inválidos=` o `guardados` menor que `tickets` → **cerrar la ventana de PowerShell con la X** (corta el backfill; reenviar no duplica) |
| 3 | Claude | **Humo después**, mismo corte | huellas **iguales**; `con_descuento` sube; `descuento_negativo` 0 | cualquier huella distinta: se para y se mira mes por mes |

**Se corta solo:** no empieza un mes que no termine antes de las **05:50**. La noche siguiente: humo antes, **el mismo
B1** (retoma desde donde quedó) y humo después. Reenviar un mes no duplica nada.

## Qué NO hace nadie
- Abrir, copiar o mostrar el `.env` (ni con el bloc de notas, ni con `Start-Transcript`).
- Tocar la carpeta del agente de hoy, `main`, la base o el receptor.
- Correr el backfill sin `--dry-run` de día, o B1 fuera de 00:00–06:00.
- Borrar las carpetas o los `.cmd` viejos: se quedan 7 días como vuelta atrás.

## Para Claude (control)
- Consultas: [`scripts/sql/descuento_pos_agente_d9.sql`](../../scripts/sql/descuento_pos_agente_d9.sql) (A0 y A6: latido y
  conteo desde `HORA_CAMBIO`) y [`scripts/sql/descuento_pos_humo.sql`](../../scripts/sql/descuento_pos_humo.sql) (parte B).
  Prod `yiczgdti…`, siempre en `begin read only … rollback`.
- Bitácora: tabla final de los bloques y §10 del PASE D9.
