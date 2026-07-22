// T1-B · Render del reporte de la corrida anclada contra PRODUCCIÓN.
// Determinista: no se estampa la hora de ejecución, sino el watermark de los datos.

import { TOLERANCIA_CRC, type Watermark } from './analisis.ts'
import type { ParAnclado } from './anclado.ts'
import type { DescomposicionPeriodo, DiaFondo, FlujoFondo, ReplayCierre } from './preguntas.ts'
import { fi } from './reporte.ts'

const esc = (v: unknown): string => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim() || '—'

function tabla(headers: string[], filas: string[][]): string {
  if (!filas.length) return '_(sin filas)_'
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...filas.map(f => `| ${f.join(' | ')} |`),
  ].join('\n')
}

export type DatosT1B = {
  ref: string
  watermark: Watermark
  conteos: { antes: Record<string, number>; despues: Record<string, number>; iguales: boolean }
  smoke: string
  pares: ParAnclado[]
  replay: ReplayCierre
  /** Período abierto del par que contiene el día del sobrante, movimiento por movimiento. */
  periodoSobrante: DescomposicionPeriodo | null
  fondo: DiaFondo[]
  flujo: FlujoFondo[]
}

export function renderT1B(d: DatosT1B): string {
  const L: string[] = []
  const p = (...xs: string[]) => L.push(...xs)

  p(
    '# REPORTE T1-B — Corrida anclada contra PRODUCCIÓN',
    '',
    '> **READ-ONLY sobre PRODUCCIÓN.** Doble opt-in: el ref va clavado en el código **y** exige',
    '> `T0_PROD_FIRMADO`. Antes de leer un solo dato, el canal rechazó a propósito una escritura de',
    '> prueba. Valida el núcleo `saldoPozoEfectivo` (`src/modules/cash/pozo.ts`) contra el histórico',
    '> real de prod y responde las dos preguntas obligatorias de la adenda.',
    '',
    tabla(
      ['Campo', 'Valor'],
      [
        ['Proyecto Supabase', `\`${d.ref}\` (PRODUCCIÓN)`],
        ['`cash_movements`', String(d.watermark.movimientos)],
        ['`cash_sessions`', String(d.watermark.sesiones)],
        ['`cash_cierres_dia`', String(d.watermark.cierres)],
        ['Último movimiento', `\`${d.watermark.ultimoMovimiento}\``],
      ],
    ),
    '',
    '> 🔒 **Evidencia de no-escritura.** `count(*)` de las 3 tablas ANTES y DESPUÉS de la corrida:',
    '> ' +
      Object.keys(d.conteos.antes)
        .map(t => `\`${t}\` ${d.conteos.antes[t]} → ${d.conteos.despues[t]}`)
        .join(' · ') +
      ` — **${d.conteos.iguales ? 'idénticos ✅' : 'DISTINTOS ❌'}**.`,
    `> El canal rechazó la escritura de prueba con: \`${d.smoke.replace(/\s+/g, ' ').slice(0, 140)}\``,
    '',
    '---',
    '',
  )

  renderCuerpo(d, p)

  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** Cuerpo del reporte: corrida anclada + las dos preguntas obligatorias. */
function renderCuerpo(P: DatosT1B, p: (...xs: string[]) => void): void {
  const r = P.replay
  const okProd = P.pares.filter(x => x.reproduce)

  p(
    '---',
    '',
    '## 1 · Corrida anclada, día por día',
    '',
    '> **READ-ONLY sobre PRODUCCIÓN**, con el mismo doble opt-in que el T0-B: ref clavado en el código',
    '> **y** `T0_PROD_FIRMADO`. Antes de leer un solo dato, el canal rechazó una escritura de prueba.',
    '',
    tabla(
      ['Campo', 'Valor'],
      [
        ['Proyecto', `\`${P.ref}\` (PRODUCCIÓN)`],
        ['`cash_movements`', String(P.watermark.movimientos)],
        ['`cash_cierres_dia`', String(P.watermark.cierres)],
        ['Pares de cierres completos consecutivos', String(P.pares.length)],
        ['✅ Reproducen', `**${okProd.length} de ${P.pares.length}**`],
        [
          'Conteos antes → después',
          Object.keys(P.conteos.antes).map(t => `${P.conteos.antes[t]}→${P.conteos.despues[t]}`).join(' · ') +
            (P.conteos.iguales ? ' **idénticos ✅**' : ' **DISTINTOS ❌**'),
        ],
      ],
    ),
    '',
    tabla(
      ['Ancla (d−1)', 'Día d', 'Gap', 'Esperado', 'Contado', 'Dif. recon.', 'Dif. sellada', 'Residuo', 'Diagnóstico', ''],
      P.pares.map(x => [
        `\`${x.fechaAnterior}\``,
        `\`${x.fecha}\``,
        `${x.diasDeGap}d`,
        fi(x.esperado),
        fi(x.contado),
        fi(x.difReconstruida),
        fi(x.difSellada),
        `**${fi(x.residuo)}**`,
        `\`${x.diagnostico}\``,
        x.reproduce ? '✅' : '🔴',
      ]),
    ),
    '',
  )

  // ── 5 · Pregunta 1 ────────────────────────────────────────────────────────
  const sobrante = r.difSellada
  const residual = r.difSinRestarPropinas
  const propinasTot = r.propinasM + r.propinasN
  p(
    '---',
    '',
    `## 2 · Pregunta 1 — el SOBRANTE del \`${r.fecha}\` (${fi(sobrante)})`,
    '',
    '### 2.1 · El replay reproduce el número sellado',
    '',
    'Se recalculó `deberia` con la MISMA fórmula de `CashCierre.tsx`, usando `saldoCajaFuerte` (la función',
    'real) sobre el ledger **tal como estaba al sellar** (`created_at ≤` el del cierre). Con el ledger de HOY',
    'da otro número — la misma fragilidad de orden que apareció en staging.',
    '',
    tabla(
      ['Componente', 'Fórmula', 'Monto'],
      [
        ['`ef_real_m`', 'ventas efectivo mediodía (BRUTAS)', fi(r.efRealM)],
        ['`propinas_m`', 'propinas selladas de la fase 1', fi(-r.propinasM)],
        ['**`netoM`**', '`ef_real_m − propinas_m`', `**${fi(r.netoM)}**`],
        ['`ef_real_n`', 'ventas efectivo noche (BRUTAS)', fi(r.efRealN)],
        ['`propinas_n`', 'propinas selladas de la fase 2', fi(-r.propinasN)],
        ['`otros_n`', 'retiro de dueños', fi(-r.otrosN)],
        ['**`netoN`**', '`ef_real_n − propinas_n − otros_n`', `**${fi(r.netoN)}**`],
        ['`saldoBase`', `\`saldoCajaFuerte\` al sellar (${r.filasAlSellar} de ${r.filasHoy} filas existían)`, fi(r.saldoBaseCF)],
        ['**`deberia`**', '`saldoBase + netoM + netoN`', `**${fi(r.deberia)}**`],
        ['`contado`', '`sep_diaria + sep_registradora + remanente`', fi(r.contado)],
        ['**Diferencia recalculada**', '`contado − deberia`', `**${fi(r.difCalculada)}**`],
        ['Diferencia sellada', 'lo que guardó el cierre', fi(r.difSellada)],
        ['**¿Reproduce?**', '', r.coincide ? '**✅ sí, al céntimo**' : `**❌ no (${fi(r.difCalculada - r.difSellada)})**`],
      ],
    ),
    '',
    '### 2.2 · El `Ventas cierre` negativo no es un error: es `netoN`',
    '',
    `\`recordCierreSales\` postea el **neto** de cada fase. Con ventas de noche de ${fi(r.efRealN)} y`,
    `${fi(r.propinasN)} de propinas pagadas ese día, el neto da negativo — y es exactamente lo que hay`,
    'en el ledger:',
    '',
    tabla(
      ['Pierna', 'Esperado (`neto`)', 'En el ledger', '¿Coincide?'],
      [
        ['Mediodía', fi(r.ventasCierreEsperado.mediodia),
          r.ventasCierreReal.mediodia === null ? '—' : fi(r.ventasCierreReal.mediodia),
          r.ventasCierreReal.mediodia !== null && Math.abs(r.ventasCierreReal.mediodia - r.ventasCierreEsperado.mediodia) < 0.005 ? '✅' : '🔴'],
        ['Noche', fi(r.ventasCierreEsperado.noche),
          r.ventasCierreReal.noche === null ? '—' : fi(r.ventasCierreReal.noche),
          r.ventasCierreReal.noche !== null && Math.abs(r.ventasCierreReal.noche - r.ventasCierreEsperado.noche) < 0.005 ? '✅' : '🔴'],
      ],
    ),
    '',
    '### 2.3 · De dónde sale el sobrante, colón por colón',
    '',
    '**Dónde estaban esas propinas** — y qué ve de ellas el modelo actual:',
    '',
    tabla(
      ['id', 'caja_origen', 'método', 'monto', 'Aporte a `saldoCajaFuerte`', 'descripción'],
      r.propinasDelDia.map(x => [
        `\`${x.id.slice(0, 8)}\``,
        `**\`${x.caja}\`**`,
        esc(x.method),
        fi(x.monto),
        fi(x.aporteASaldoCF),
        esc(x.descripcion),
      ]),
    ),
    '',
    `Suman ${fi(propinasTot)} y su aporte al ledger de Caja Fuerte es **${fi(r.aporteCFdeLasPropinas)}**:`,
    'salieron de otra caja, así que `saldoCajaFuerte` **no las ve**. Pero `deberia` **sí las resta**, vía',
    '`propinas_n`. La cuenta cierra así:',
    '',
    '```',
    `sobrante sellado          ${fi(sobrante)}`,
    `− propinas restadas       ${fi(propinasTot)}`,
    `= residuo por debajo      ${fi(residual)}`,
    '```',
    '',
    `**El sobrante de ${fi(sobrante)} es la resta de las propinas (${fi(propinasTot)}) menos un faltante`,
    `real de ${fi(Math.abs(residual))} que queda escondido debajo.**`,
    '',
    `> **Por qué las propinas inflan el sobrante.** La venta de noche se registró como ${fi(r.efRealN)}`,
    `> mientras ese mismo día se pagaron ${fi(r.propinasN)} de propinas desde la \`Registradora\`. Una venta`,
    '> nocturna de ese tamaño no es plausible: lo compatible con los números es que la cifra cargada **ya',
    '> venía neta** de las propinas pagadas con la plata de la caja. Si fue así, el cierre las restó **una',
    '> segunda vez**, que es justo el doble conteo que el rediseño tiene que cerrar. Ojo con el alcance: lo',
    '> que los datos prueban es la aritmética; qué se tecleó como "venta bruta" no queda registrado en ningún',
    '> lado, así que esa parte es la lectura más compatible, no un hecho verificable.',
    '',
    `> 🔴 **Residuo NO-EXPLICADO: ${fi(Math.abs(residual))}.** Aun neutralizando las propinas queda ese`,
    `> faltante. Ese día salió de las cajas físicas, además de las propinas, ${fi(r.otroEfectivoDelDia.crc)} en`,
    `> ${r.otroEfectivoDelDia.n} movimiento(s) de efectivo: ` +
      (r.otroEfectivoDelDia.n === 0
        ? '**no hay ningún movimiento que pueda cubrirlo**.'
        : 'ninguno coincide con el monto.') +
      ' Queda declarado, no forzado.',
    '',
  )


  // ── 2.4 · Abrir el período del par anclado ────────────────────────────────
  const per = P.periodoSobrante
  if (per) {
    p(
      `### 2.4 · El par anclado deja ${fi(per.residuo)} — se abre el período`,
      '',
      `El par \`${per.desde}\` → \`${per.hasta}\` arrastra un hueco de **${per.diasDeGap} días** y deja un residuo`,
      `de ${fi(per.residuo)}. Éste es el período completo, movimiento por movimiento, con lo que cada fila`,
      'aporta al pozo (`excluido` = ya contabilizado por un campo sellado del cierre):',
      '',
      tabla(
        ['Fecha', 'id', 'tipo', 'caja_origen', 'método', 'subcategoría', 'monto', 'Aporte al pozo', 'clase', 'descripción'],
        per.filas.map(f => [
          `\`${f.fecha}\``,
          `\`${f.id.slice(0, 8)}\``,
          `\`${f.tipo}\``,
          `\`${f.caja}\``,
          esc(f.method),
          esc(f.subcategoria),
          fi(f.monto),
          f.aportePozo ? fi(f.aportePozo) : '—',
          `\`${f.clase}\``,
          esc(f.descripcion),
        ]),
      ),
      '',
      tabla(
        ['Comprobación', 'Monto'],
        [
          ['Residuo del par anclado', `**${fi(per.residuo)}**`],
          [
            `Efectivo que SALIÓ de cajas físicas en el período (${per.egresosEfectivo.n} movimientos)`,
            `**${fi(per.egresosEfectivo.crc)}**`,
          ],
          ['**Residuo − ese efectivo**', `**${fi(per.sobranteTrasEgresos)}**`],
          [
            '¿Cierra?',
            per.cierraConEgresos
              ? `**✅ sí** — queda ${fi(per.sobranteTrasEgresos)}, dentro de ${fi(TOLERANCIA_CRC)}`
              : `**🔴 no** — quedan ${fi(Math.abs(per.sobranteTrasEgresos))} sin atribuir`,
          ],
        ],
      ),
      '',
      per.cierraConEgresos
        ? `> ✅ **La aritmética cierra.** El residuo de ${fi(per.residuo)} es —al céntimo salvo ` +
          `${fi(Math.abs(per.sobranteTrasEgresos))}— el efectivo que salió de las cajas físicas durante los ` +
          `${per.diasDeGap} días sin cerrar: ${fi(per.egresosEfectivo.crc)} en ${per.egresosEfectivo.n} ` +
          'movimientos. Esa plata se fue, pero **el conteo del día del cierre no la refleja**: como no hubo ' +
          'cierre en los días del medio, ningún campo sellado la registró y el ancla ya no alcanza.'
        : `> 🔴 **NO cierra.** Atribuyendo el residuo a los ${fi(per.egresosEfectivo.crc)} de efectivo del ` +
          `período todavía quedan ${fi(Math.abs(per.sobranteTrasEgresos))} sin explicación. Queda declarado.`,
      '',
    )
  }

  // ── 6 · Pregunta 2 ────────────────────────────────────────────────────────
  const explicados = P.fondo.filter(x => x.explicado)
  p(
    '---',
    '',
    '## 3 · Pregunta 2 — por qué el "hueco 2" no se comporta igual todos los días',
    '',
    'La hipótesis a contrastar era: *depende de si la plata del fondo estaba dentro del pool*. Los datos la',
    '**refinan**: lo que decide no es dónde estaba la plata, sino **por qué canal `deberia` ya la había',
    'descontado**. Hay tres, y una misma fila puede pegarle a dos:',
    '',
    '1. **El ledger de Caja Fuerte** — solo si `caja_origen = Caja Fuerte`. `saldoCajaFuerte` ignora',
    '   `Caja Proveedores` y `Registradora` por completo.',
    '2. **Los campos sellados `propinas_m/n`** — restan la propina *aunque haya salido de otra caja*.',
    '3. **Ninguno** — la plata sale de una caja física y `deberia` ni se entera.',
    '',
    'Si todo ese efectivo salió del pool contado, el cierre tendría que haber mostrado exactamente:',
    '',
    '```',
    'difEsperada = −(efectivo que salió) + (lo que bajó por el ledger) + (lo que bajó por propinas selladas)',
    '```',
    '',
    tabla(
      ['Día', 'Efectivo que salió', 'Vía ledger CF', 'Vía propinas selladas', 'Doble conteo', 'Invisible', 'Dif. sellada', 'Vista por día: esperada / brecha', 'Vista ANCLADA: contado − esperado / residuo', '¿El pozo reconstruye el conteo?'],
      P.fondo.map(x => [
        `\`${x.fecha}\``,
        fi(x.totalEfectivo),
        fi(x.viaLedgerCF),
        fi(x.propinasSelladas),
        x.dobleConteo ? `⚠️ ${fi(x.dobleConteo)}` : '—',
        fi(x.invisible),
        fi(x.difSellada),
        `${fi(x.difEsperada)} / **${fi(x.brecha)}**`,
        x.anclado ? `${fi(x.anclado.difReconstruida)} / **${fi(x.anclado.residuo)}**` : '— (sin par)',
        x.anclado ? (x.anclado.pozoCuadra ? '✅ sí' : '🔴 no') : '—',
      ]),
    ),
    '',
    `**${explicados.length} de ${P.fondo.length} días quedan explicados mecánicamente** dentro de ${fi(TOLERANCIA_CRC)}.`,
    '',
  )


  // ── 3.x · El flujo del FONDO ──────────────────────────────────────────────
  p(
    `### 3.1 · El flujo del fondo: cómo se recarga \`Caja Proveedores\``,
    '',
    'La hipótesis apunta al fondo, así que hay que mirarle las dos puntas: **de dónde sale** el efectivo',
    'con el que se paga (el `sep_diaria` que el cierre anterior apartó del conteo) y **cómo se recarga**',
    '(¿queda asentado como ingreso a `Caja Proveedores`?).',
    '',
    tabla(
      ['Día', 'Cierre anterior', '`sep_diaria` apartado', 'Ingresos al fondo ESE día', 'Ingresos en el período', 'Egresos del fondo ese día', 'Última recarga asentada'],
      P.flujo.map(f => [
        `\`${f.fecha}\``,
        f.cierreAnterior ? `\`${f.cierreAnterior}\`` : '—',
        fi(f.sepDiariaAnterior),
        f.ingresosAlFondoDelDia.n ? `${fi(f.ingresosAlFondoDelDia.crc)} (${f.ingresosAlFondoDelDia.n})` : '**₡ 0,00 · ninguno**',
        f.ingresosAlFondoDelPeriodo.n ? `${fi(f.ingresosAlFondoDelPeriodo.crc)} (${f.ingresosAlFondoDelPeriodo.n})` : '**₡ 0,00 · ninguno**',
        f.egresosDelFondoDelDia.n ? `${fi(f.egresosDelFondoDelDia.crc)} (${f.egresosDelFondoDelDia.n})` : '—',
        f.ultimaRecargaAsentada
          ? `\`${f.ultimaRecargaAsentada.fecha}\` (${fi(f.ultimaRecargaAsentada.crc)}) — hace **${f.diasDesdeLaUltimaRecarga} días**`
          : 'nunca',
      ]),
    ),
    '',
    '> 🚩 **El fondo se recarga sin dejar rastro en el ledger.** En los tres días el cierre anterior apartó',
    `> ${fi(P.flujo[0]?.sepDiariaAnterior ?? 0)}–${fi(Math.max(...P.flujo.map(f => f.sepDiariaAnterior)))} como`,
    '> "Caja Diaria mañana" —o sea que el fondo **sí está dentro del conteo físico**— pero **no hay un solo',
    '> ingreso a `Caja Proveedores` registrado** en ninguno de esos días ni en sus períodos. La última recarga',
    `> asentada es de hace ${Math.min(...P.flujo.map(f => f.diasDesdeLaUltimaRecarga ?? 9999))} días o más.`,
    '>',
    '> Es decir: el fondo se rellena cada noche apartando efectivo del conteo (`sep_diaria`), no mediante un',
    '> movimiento. Para `saldoCajaFuerte` esa recarga **no existe**, y los pagos que salen de él tampoco.',
    '',
  )

  P.fondo.forEach((x, i) => {
    p(
      `### 3.${i + 2} · \`${x.fecha}\` — ${(x.anclado ? x.anclado.pozoCuadra : x.explicado) ? 'explicado' : '🔴 NO-EXPLICADO'}`,
      '',
      tabla(
        ['id', 'caja_origen', 'subcategoría', 'monto', 'Vía ledger CF', '¿Doble conteo?', 'descripción'],
        x.egresos.map(e => [
          `\`${e.id.slice(0, 8)}\``,
          `**\`${e.caja}\`**`,
          esc(e.subcategoria),
          fi(e.monto),
          fi(e.viaLedgerCF),
          e.dobleConteo ? '⚠️ sí' : 'no',
          esc(e.descripcion),
        ]),
      ),
      '',
    )
    const mandaAnclado = x.anclado !== null
    const ok = mandaAnclado ? x.anclado!.pozoCuadra : x.explicado
    if (ok) {
      p(
        `> ✅ Salieron ${fi(x.totalEfectivo)} de efectivo y \`deberia\` ya había descontado ${fi(x.viaLedgerCF + x.propinasSelladas)}.`,
        ...(x.anclado
          ? [
              `> **El pozo reconstruye el conteo físico**: contado − esperado = ${fi(x.anclado.difReconstruida)}, dentro de`,
              `> ${fi(TOLERANCIA_CRC)}. El cierre selló ${fi(x.difSellada)}, así que los dos modelos difieren en`,
              `> ${fi(x.anclado.residuo)} — **y esa diferencia no es error del pozo: es lo que el modelo actual no puede ver.**`,
            ]
          : [`> Diferencia esperada ${fi(x.difEsperada)} vs sellada ${fi(x.difSellada)} — brecha ${fi(x.brecha)}.`]),
        '',
      )
    } else {
      p(
        `> 🔴 **NO-EXPLICADO.** Vista anclada: contado − esperado = ${x.anclado ? fi(x.anclado.difReconstruida) : '—'}, ` +
          `residuo ${x.anclado ? fi(x.anclado.residuo) : '—'}. Vista por día: esperado ${fi(x.difEsperada)}, sellado ${fi(x.difSellada)}, brecha ${fi(x.brecha)}.` +
          (x.dobleConteo
            ? ` Este día además arrastra ${fi(x.dobleConteo)} restados DOS veces: una propina cargada en \`Caja Fuerte\` baja el ledger Y encima está en \`propinas_m/n\`.`
            : ''),
        '> No se fuerza una conclusión: el número queda a la vista para contrastarlo con el comprobante físico.',
        '',
      )
    }
  })

  const d09 = P.fondo.find(x => x.fecha === '2026-07-09')
  const d20 = P.fondo.find(x => x.fecha === '2026-07-20')
  const d21 = P.fondo.find(x => x.fecha === '2026-07-21')
  const linea = (x: DiaFondo | undefined, nota: string): string[] =>
    x
      ? [
          `- \`${x.fecha}\` — salieron ${fi(x.totalEfectivo)} en efectivo; \`deberia\` los descontó por: ledger CF ` +
            `${fi(x.viaLedgerCF)} · propinas selladas ${fi(x.propinasSelladas)}` +
            (x.dobleConteo ? ` (⚠️ ${fi(x.dobleConteo)} contados por AMBOS canales)` : '') +
            `; quedaron **${fi(x.invisible)} invisibles**. ` +
            (x.anclado
              ? `El pozo reconstruye el conteo con ${fi(x.anclado.difReconstruida)} ${x.anclado.pozoCuadra ? '✅' : '🔴'} ` +
                `y difiere del cierre en ${fi(x.anclado.residuo)}. `
              : '') +
            nota,
        ]
      : []

  p(
    `### 3.${P.fondo.length + 2} · Veredicto sobre la hipótesis`,
    '',
    '**La hipótesis, como estaba formulada, queda REFUTADA — y los datos la reemplazan por algo más útil.**',
    '',
    'No es que el fondo esté "dentro o fuera del pool". §3.1 lo muestra sin ambigüedad: el fondo **siempre**',
    'está dentro del pool contado (se aparta cada noche como `sep_diaria`) y **nunca** está dentro del ledger',
    '(cero ingresos a `Caja Proveedores` en 43–55 días). Esas dos cosas son fijas los tres días, así que no',
    'pueden explicar por qué unos días cuadran y otros no.',
    '',
    'Lo que sí cambia de un día a otro es **por cuántos de los tres canales se enteró `deberia`**:',
    '',
    ...linea(d09, 'El faltante apareció casi entero.'),
    ...linea(d21, '**Caso Ronny:** recategorizar el pago a `Caja Fuerte` no "arregló" la plata — la hizo visible para el único canal que el cierre mira, y por eso el día cuadra.'),
    ...linea(d20, 'Los dos efectos se cruzan: plata invisible por un lado y restada dos veces por el otro.'),
    '',
    `**El matiz que importa:** el pozo reconstruye el conteo físico en ` +
      `${P.fondo.filter(x => x.anclado?.pozoCuadra).length} de los ${P.fondo.filter(x => x.anclado).length} días con par anclado` +
      (P.fondo.some(x => x.anclado && !x.anclado.pozoCuadra)
        ? `; el que no —${P.fondo.filter(x => x.anclado && !x.anclado.pozoCuadra).map(x => `\`${x.fecha}\` (${fi(x.anclado!.difReconstruida)})`).join(', ')}— ` +
          'queda declarado y no se maquilla. '
        : '. ') +
      'En los que sí, el cierre se desvía justo por lo que no puede ver. La no-uniformidad no está en la plata',
    'ni en el fondo: está en **cuál de los tres canales llegó a enterarse**, que depende de en qué caja se',
    'tecleó el movimiento y de si además era una propina.',
    '',
    '**Para el rediseño:** mientras el "debería" se calcule sobre UNA caja y las propinas se resten por un',
    'canal aparte, el mismo hecho físico —sacar efectivo de la casa— da resultados distintos según dónde se',
    'cargó, y a veces resta dos veces. El pozo elimina la pregunta: las tres cajas físicas suman al mismo',
    'saldo y cada salida resta exactamente una vez.',
    '',
  )
}
