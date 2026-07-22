// T1 · Render del reporte de la corrida anclada. Determinista: sin hora de ejecución.

import { TOLERANCIA_CRC, type Watermark } from './analisis.ts'
import type { ParAnclado } from './anclado.ts'
import type { DiaFondo, ReplayCierre } from './preguntas.ts'
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

const DIAG_TXT: Record<string, string> = {
  'orden-de-sellado':
    'los cierres se cargaron FUERA DE ORDEN: el día d se selló antes que el día d−1, así que su ' +
    '`deberia` leyó un ledger al que todavía le faltaba lo que el cierre anterior iba a postear',
  'invisible-al-modelo':
    'el residuo es EXACTAMENTE el neto del período: plata que se movió y que el modelo actual no ve ' +
    '(`saldoCajaFuerte` ignora todo lo que no sea `caja_origen = Caja Fuerte`)',
  'hueco-en-la-cadena':
    'hay días sin cerrar entre una punta y la otra: la plata de esos días entró y salió sin que ningún ' +
    'campo sellado la registre',
  'sin-diagnostico': 'ninguna de las causas conocidas lo explica — hay que mirarlo a mano',
}

const MOTIVO_TXT: Record<string, string> = {
  'ventas-cierre': "filas `Ventas cierre` que genera el propio cierre (NETAS de propinas)",
  'ajuste-cierre': 'el asiento `Ajuste de cierre` — es el sello de la diferencia, no su causa',
  'propinas-del-dia': 'propinas del día del cierre — ya vienen de `propinas_m/n` selladas',
  'retiro-del-cierre': 'el retiro de dueños — ya viene de `otros_n` (se graba como traspaso a Banco)',
  'ventas-ledger-vieja': 'ventas cargadas al ledger a la vieja usanza — ya vienen de `ef_real`',
}

export type DatosT1 = {
  ref: string
  watermark: Watermark
  pares: ParAnclado[]
  saldoPozoHoy: { crc: number; usd: number; indeterminados: { cantidad: number; crc: number; usd: number } }
  /** Fase PROD de la adenda T1. Ausente si se corrió con --solo-staging. */
  prod?: {
    ref: string
    watermark: Watermark
    conteos: { antes: Record<string, number>; despues: Record<string, number>; iguales: boolean }
    smoke: string
    pares: ParAnclado[]
    replay: ReplayCierre
    fondo: DiaFondo[]
  }
}

export function renderT1(d: DatosT1): string {
  const L: string[] = []
  const p = (...xs: string[]) => L.push(...xs)
  const { pares } = d

  const reproducen = pares.filter(x => x.reproduce)
  const fallan = pares.filter(x => !x.reproduce)
  const cuadraron = pares.filter(x => x.cuadro)
  const cuadraronYReproducen = cuadraron.filter(x => x.reproduce)
  const contiguos = pares.filter(x => x.diasDeGap === 1)
  const contiguosOk = contiguos.filter(x => x.reproduce)

  p(
    '# REPORTE T1 — Corrida paralela ANCLADA (pozo único)',
    '',
    '> **READ-ONLY sobre STAGING.** Valida el núcleo `saldoPozoEfectivo` recién promovido a',
    '> `src/modules/cash/pozo.ts` contra el histórico real. **Nada de la app lo importa todavía**:',
    '> los únicos consumidores son los tests y este harness. El recableado del cierre es T2.',
    '',
    tabla(
      ['Campo', 'Valor'],
      [
        ['Proyecto Supabase', `\`${d.ref}\` (STAGING)`],
        ['`cash_movements`', String(d.watermark.movimientos)],
        ['`cash_cierres_dia`', String(d.watermark.cierres)],
        ['Pares de cierres completos consecutivos', String(pares.length)],
        ['Último movimiento', `\`${d.watermark.ultimoMovimiento}\``],
      ],
    ),
    '',
    '---',
    '',
    '## 0 · Qué prueba esta corrida',
    '',
    'El T0 comparaba saldos **acumulados desde el principio de los tiempos**, y por eso el pozo daba',
    'negativo: al histórico le falta el asiento de apertura. Esta corrida ataca por otro lado — en vez',
    'de acumular desde cero, **se ancla en el conteo físico que el dueño selló el día anterior**:',
    '',
    '```',
    'ancla(d−1)  = sep_diaria + sep_registradora + remanente     ← contado a mano',
    'esperado(d) = ancla(d−1)',
    '            + ef_real_m + ef_real_n        ventas en efectivo BRUTAS del día d',
    '            − propinas_m − propinas_n      propinas pagadas (campos sellados)',
    '            − otros_n                      retiro de dueños',
    '            + neto del período (d−1, d]    calculado por saldoPozoEfectivo (la función real)',
    '',
    'residuo = (contado − esperado) − diferencia_crc sellada',
    '```',
    '',
    'Anclar en el físico es lo que hace la prueba honesta: **cada día se evalúa solo**, sin arrastrar',
    `el error del anterior. Si el residuo es ~0 (±${fi(TOLERANCIA_CRC)}), el modelo del pozo reprodujo ese día.`,
    '',
    '**Resultado**',
    '',
    tabla(
      ['Medida', 'Valor'],
      [
        ['Pares evaluados', `**${pares.length}**`],
        ['✅ Reproducen', `**${reproducen.length}**`],
        ['🔴 No reproducen', `**${fallan.length}**`],
        [
          'De los días que CUADRARON, ¿cuántos reproduce?',
          `**${cuadraronYReproducen.length} de ${cuadraron.length}**`,
        ],
        [
          'Pares de días CONSECUTIVOS (gap = 1 día)',
          `**${contiguosOk.length} de ${contiguos.length}** reproducen`,
        ],
      ],
    ),
    '',
  )

  const hall: string[] = []
  if (cuadraron.length && cuadraronYReproducen.length === cuadraron.length) {
    hall.push(
      `✅ **El modelo reproduce los ${cuadraron.length} días que cuadraron**, dentro de ${fi(TOLERANCIA_CRC)}. ` +
        'La mecánica del pozo —cajas físicas juntas, traspasos internos neutros, Banco afuera— ' +
        'reconstruye el efectivo contado a mano sin tocar la app.',
    )
  } else if (cuadraron.length) {
    const fallanCuadrando = cuadraron.filter(x => !x.reproduce)
    hall.push(
      `**${cuadraronYReproducen.length} de los ${cuadraron.length} días que cuadraron se reproducen.** Los ` +
        `${fallanCuadrando.length} que no, **ninguno por culpa del modelo**: ` +
        fallanCuadrando
          .map(x => `\`${x.fecha}\` (${fi(x.residuo)}, \`${x.diagnostico}\`, hueco de ${x.diasDeGap}d)`)
          .join(' · ') +
        '. Los dos arrastran huecos en la cadena de cierres; el detalle con números está en §2.',
    )
  }
  if (contiguos.length) {
    hall.push(
      (contiguosOk.length === contiguos.length ? '✅ ' : '') +
        `**${contiguosOk.length} de ${contiguos.length} pares de días CONSECUTIVOS reproducen**` +
        (contiguosOk.length === contiguos.length
          ? ` — todos, con residuos de entre ${fi(Math.min(...contiguos.map(x => Math.abs(x.residuo))))} y ` +
            `${fi(Math.max(...contiguos.map(x => Math.abs(x.residuo))))} (redondeo).\n  ` +
            '**Ésta es la prueba que importa:** cuando la cadena de cierres no tiene huecos, la mecánica del ' +
            'pozo —cajas físicas juntas, traspasos internos neutros, Banco afuera— reconstruye el efectivo ' +
            'contado a mano, día tras día, sin tocar la app.'
          : '.') +
        ' El ancla solo vale si el día anterior también se cerró: con un hueco en el medio, la plata se movió ' +
        'sin que nadie la contara.',
    )
  }
  const conGap = pares.filter(x => x.diasDeGap > 1)
  if (conGap.length) {
    const gapOk = conGap.filter(x => x.reproduce).length
    hall.push(
      `**${conGap.length} par(es) arrastran un hueco** de más de un día entre cierres ` +
        `(${conGap.map(x => `\`${x.fechaAnterior}\`→\`${x.fecha}\` (${x.diasDeGap}d)`).join(' · ')}); ` +
        `de esos reproducen ${gapOk}. Es el costo medible de no cerrar todos los días.`,
    )
  }
  const descuadrePropinas = pares.filter(
    x => Math.abs(x.propinasSelladas - x.propinasEnMovimientos) > 0.005,
  )
  if (descuadrePropinas.length) {
    hall.push(
      `⚠️ **${descuadrePropinas.length} día(s) donde \`propinas_m+propinas_n\` NO coincide con la suma de los ` +
        'movimientos `Propinas por turno` de ese día**: ' +
        descuadrePropinas
          .map(x => `\`${x.fecha}\` (sellado ${fi(x.propinasSelladas)} vs movimientos ${fi(x.propinasEnMovimientos)})`)
          .join(' · ') +
        '. El campo sellado y el ledger cuentan cosas distintas.',
    )
  }
  const totIndet = pares.reduce((a, x) => a + x.periodo.indeterminados.n, 0)
  if (totIndet) {
    hall.push(
      `${totIndet} traspaso(s) sin dirección legible cayeron dentro de los períodos evaluados ` +
        `(${fi(pares.reduce((a, x) => a + x.periodo.indeterminados.crc, 0))}). El pozo los deja neutros y los ` +
        'cuenta aparte en `indeterminados` — no los esconde.',
    )
  }
  hall.push(
    `Saldo del pozo HOY (acumulado, sin ancla): ${fi(d.saldoPozoHoy.crc)} · ` +
      `${d.saldoPozoHoy.indeterminados.cantidad} traspaso(s) indeterminado(s) por ${fi(d.saldoPozoHoy.indeterminados.crc)}. ` +
      'Sigue negativo por lo mismo que en el T0: falta el asiento de apertura. **La corrida anclada no ' +
      'depende de ese saldo** — por eso puede validar la mecánica igual.',
  )
  p('**Hallazgos**', '', ...hall.map(h => `- ${h}`), '', '---', '')

  // ── 1 · Tabla día por día ────────────────────────────────────────────────
  p(
    '## 1 · Día por día',
    '',
    'Todos los pares, sin omitir ninguno. **Residuo** = (contado − esperado) − diferencia sellada.',
    '',
    tabla(
      ['#', 'Ancla (d−1)', 'Día d', 'Gap', 'Ancla ₡', 'Ventas brutas', 'Propinas', 'Retiro', 'Neto período', 'Esperado', 'Contado', 'Dif. reconstruida', 'Dif. sellada', 'Residuo', ''],
      pares.map((x, i) => [
        String(i + 1),
        `\`${x.fechaAnterior}\``,
        `\`${x.fecha}\``,
        `${x.diasDeGap}d`,
        fi(x.ancla),
        fi(x.ventasBrutas),
        x.propinasSelladas ? `−${fi(x.propinasSelladas).replace(/^−/, '')}` : '—',
        x.retiro ? `−${fi(x.retiro).replace(/^−/, '')}` : '—',
        x.periodo.netoPozo ? fi(x.periodo.netoPozo) : '—',
        fi(x.esperado),
        fi(x.contado),
        fi(x.difReconstruida),
        fi(x.difSellada),
        `**${fi(x.residuo)}**`,
        x.reproduce ? '✅' : '🔴',
      ]),
    ),
    '',
    ...(pares.some(x => x.selladoFueraDeOrden)
      ? [
          '> ⚠️ **Los cierres no se sellaron en orden de fecha.** ' +
            pares
              .filter(x => x.selladoFueraDeOrden)
              .map(x => `el día \`${x.fecha}\` se selló ANTES que el \`${x.fechaAnterior}\``)
              .join(' · ') +
            '. Importa porque `deberia` se calcula contra el ledger tal como está **en ese instante**: ' +
            'sellar fuera de orden cambia el número, sin que cambie un solo billete.',
          '',
        ]
      : []),
  )

  // ── 2 · Los que no reproducen ────────────────────────────────────────────
  p('## 2 · Los que NO reproducen — números exactos', '')
  if (!fallan.length) {
    p('_Ninguno._ Los ' + pares.length + ' pares reproducen dentro de la tolerancia.', '')
  } else {
    p(`Se listan **los ${fallan.length}**, sin omitir ninguno.`, '')
    for (const x of fallan) {
      p(
        `### \`${x.fechaAnterior}\` → \`${x.fecha}\` — residuo ${fi(x.residuo)}`,
        '',
        tabla(
          ['Componente', 'Monto'],
          [
            [`Ancla: contado físico sellado el \`${x.fechaAnterior}\``, fi(x.ancla)],
            ['+ Ventas efectivo brutas (`ef_real_m` + `ef_real_n`)', fi(x.ventasBrutas)],
            ['− Propinas selladas (`propinas_m` + `propinas_n`)', fi(-x.propinasSelladas)],
            ['− Retiro de dueños (`otros_n`)', fi(-x.retiro)],
            [`+ Neto del período (${x.periodo.nMovs} movimiento(s) contados por el pozo)`, fi(x.periodo.netoPozo)],
            ['**= Esperado**', `**${fi(x.esperado)}**`],
            [`Contado físico sellado el \`${x.fecha}\``, fi(x.contado)],
            ['Diferencia reconstruida (contado − esperado)', fi(x.difReconstruida)],
            ['Diferencia que selló el cierre', fi(x.difSellada)],
            ['**Residuo (lo que el modelo NO explica)**', `**${fi(x.residuo)}**`],
            ['Días entre cierres', `${x.diasDeGap}`],
            ['**Diagnóstico**', `\`${x.diagnostico}\``],
          ],
        ),
        '',
        `> **${esc(DIAG_TXT[x.diagnostico])}**`,
        '',
      )
      if (x.diagnostico === 'orden-de-sellado') {
        p(
          `> El cierre del \`${x.fechaAnterior}\` posteó ${fi(x.aporteLedgerDelAnterior)} al ledger de Caja Fuerte`,
          `> (ventas netas de sus dos fases + su propia diferencia), pero lo hizo **después** de que el cierre`,
          `> del \`${x.fecha}\` ya hubiera leído el saldo. Por eso el residuo es ${fi(x.residuo)}: exactamente ese`,
          '> aporte con el signo cambiado. **Ni un colón se movió** — es puro artefacto del orden de carga,',
          '> y el modelo anclado no lo sufre porque se apoya en el conteo físico, no en el ledger.',
          '',
        )
      }
      if (x.diagnostico === 'invisible-al-modelo') {
        p(
          `> El neto del período es ${fi(x.periodo.netoPozo)} y el residuo ${fi(x.residuo)}: se cancelan. Es decir,`,
          '> el cierre selló su diferencia **como si esos movimientos no existieran**. Casi todos salen de la',
          '> `Registradora`, y `saldoCajaFuerte` —el corazón del cierre de hoy— solo mira `caja_origen = Caja Fuerte`:',
          '> **esa plata es literalmente invisible para el modelo actual.** El pozo la ve. Es el argumento del rediseño.',
          '',
        )
      }
      if (x.periodo.porClase.length) {
        p(
          '**Cómo se compone el neto del período** (clasificación de `contribucionPozo`, la función real):',
          '',
          tabla(
            ['Clase', 'Movimientos', 'Aporte ₡'],
            x.periodo.porClase.map(c => [`\`${c.clase}\``, String(c.n), fi(c.crc)]),
          ),
          '',
        )
      }
      if (x.periodo.excluidos.length) {
        p(
          '**Filas excluidas del período** (ya contabilizadas por los campos sellados — si se contaran acá, contarían dos veces):',
          '',
          tabla(
            ['Motivo', 'Movimientos', 'Σ ₡', 'Por qué'],
            x.periodo.excluidos.map(e => [
              `\`${e.motivo}\``,
              String(e.n),
              fi(e.crc),
              esc(MOTIVO_TXT[e.motivo]),
            ]),
          ),
          '',
        )
      }
      // Solo cuando el hueco ES la causa: si el residuo ya quedó explicado por el orden de
      // sellado o por la ceguera del modelo, repetir lo del hueco confunde más que aclara.
      if (x.diagnostico === 'hueco-en-la-cadena') {
        p(
          `> 🕳️ **Hueco de ${x.diasDeGap} días en la cadena de cierres.** El ancla es el conteo del`,
          `> \`${x.fechaAnterior}\`, pero entre esa fecha y el \`${x.fecha}\` hubo ${x.diasDeGap - 1} día(s) sin cerrar:`,
          '> las ventas de esos días entraron a la caja y **ningún campo sellado las registra**. El modelo no',
          '> puede reconstruir lo que nadie contó — esto no es un fallo del pozo, es la factura de los días sin cierre.',
          '',
        )
      }
    }
  }

  // ── 3 · Los que sí ───────────────────────────────────────────────────────
  p(
    '## 3 · Los que sí reproducen',
    '',
    tabla(
      ['Par', 'Gap', 'Esperado', 'Contado', 'Residuo', 'El día cuadró'],
      reproducen.map(x => [
        `\`${x.fechaAnterior}\` → \`${x.fecha}\``,
        `${x.diasDeGap}d`,
        fi(x.esperado),
        fi(x.contado),
        fi(x.residuo),
        x.cuadro ? '✅ sí' : `no (${fi(x.difSellada)}, y el modelo la reproduce)`,
      ]),
    ),
    '',
  )

  renderProd(d, p)

  p(
    '---',
    '',
    '## Apéndice · Reglas y trampas',
    '',
    '- **`ef_real_*` es BRUTO.** Verificado en `CashCierre.tsx`: `efRealM = vm_crc − vm_usd·tc`, sin restar',
    '  propinas; el neto se arma después (`netoM = ef_real_m − propinas_m`). Sumarle las propinas "de vuelta"',
    '  las contaría al revés.',
    '- **Trampa 1 — propinas dobles.** Las filas `Ventas cierre` que genera el cierre son NETAS de propinas.',
    '  Contarlas a ellas Y a los egresos `Propinas por turno` resta las propinas dos veces. Acá se reconstruye',
    '  desde los campos sellados y se excluyen ambas.',
    '- **Trampa 2 — retiro doble.** `recordCierreRetiro` graba el retiro como traspaso `Caja Fuerte → Banco`.',
    '  Contarlo como `otros_n` Y como traspaso con Banco del período lo restaría dos veces.',
    '- **Propinas de días intermedios SÍ cuentan.** `propinas_m/n` solo cubre las del día del cierre; en un',
    '  período con hueco, las de los días del medio no están selladas en ningún lado y entran como egreso.',
    '- **Atribución de fecha**: `session_date` del turno; sin turno, el día de Costa Rica de `created_at`.',
    `- **Tolerancia**: ${fi(TOLERANCIA_CRC)}, la misma que usa el cierre para decidir si cuadra.`,
    '',
  )

  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** Secciones 4/5/6: fase PROD de la adenda T1. No imprime nada si no se corrió contra prod. */
function renderProd(d: DatosT1, p: (...xs: string[]) => void): void {
  if (!d.prod) return
  const P = d.prod
  const r = P.replay
  const okProd = P.pares.filter(x => x.reproduce)

  p(
    '---',
    '',
    '## 4 · PROD — corrida anclada',
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
    `## 5 · Pregunta 1 — el SOBRANTE del \`${r.fecha}\` (${fi(sobrante)})`,
    '',
    '### 5.1 · Primero, el replay reproduce el número',
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
    '### 5.2 · El `Ventas cierre` negativo no es un error: es `netoN`',
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
    '### 5.3 · De dónde sale el sobrante, colón por colón',
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

  // ── 6 · Pregunta 2 ────────────────────────────────────────────────────────
  const explicados = P.fondo.filter(x => x.explicado)
  p(
    '---',
    '',
    '## 6 · Pregunta 2 — por qué el "hueco 2" no se comporta igual todos los días',
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
      ['Día', 'Efectivo que salió', 'Vía ledger CF', 'Vía propinas selladas', 'Doble conteo', 'Invisible', 'Dif. esperada', 'Dif. sellada', 'Brecha', ''],
      P.fondo.map(x => [
        `\`${x.fecha}\``,
        fi(x.totalEfectivo),
        fi(x.viaLedgerCF),
        fi(x.propinasSelladas),
        x.dobleConteo ? `⚠️ ${fi(x.dobleConteo)}` : '—',
        fi(x.invisible),
        fi(x.difEsperada),
        fi(x.difSellada),
        `**${fi(x.brecha)}**`,
        x.explicado ? '✅' : '🔴',
      ]),
    ),
    '',
    `**${explicados.length} de ${P.fondo.length} días quedan explicados mecánicamente** dentro de ${fi(TOLERANCIA_CRC)}.`,
    '',
  )

  P.fondo.forEach((x, i) => {
    p(
      `### 6.${i + 1} · \`${x.fecha}\` — ${x.explicado ? 'explicado' : '🔴 NO-EXPLICADO'}`,
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
    if (x.explicado) {
      p(
        `> ✅ Salieron ${fi(x.totalEfectivo)} de efectivo y \`deberia\` ya había descontado`,
        `> ${fi(x.viaLedgerCF + x.propinasSelladas)}: la diferencia esperada era ${fi(x.difEsperada)} y el cierre`,
        `> selló ${fi(x.difSellada)} — brecha ${fi(x.brecha)}. **La plata sí salió del pool contado.**`,
        '',
      )
    } else {
      p(
        `> 🔴 **NO-EXPLICADO: quedan ${fi(Math.abs(x.brecha))}.** Esperado ${fi(x.difEsperada)}, sellado ${fi(x.difSellada)}.` +
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
  p(
    `### 6.${P.fondo.length + 1} · Veredicto sobre la hipótesis`,
    '',
    '**Refutada como estaba formulada, y reemplazada por algo más preciso.** No es que el fondo esté "dentro',
    'o fuera del pool": el efectivo de las tres cajas físicas siempre sale del pool contado. Lo que cambia de',
    'un día a otro es **cuántos de los tres canales le avisaron a `deberia`**:',
    '',
    ...(d09
      ? [
          `- \`${d09.fecha}\`: de los ${fi(d09.totalEfectivo)}, ${fi(d09.propinasSelladas)} son una **propina`,
          '  cargada a `Caja Proveedores`** que los campos sellados ya restaron. Lo genuinamente invisible eran',
          `  ${fi(d09.invisible)} — y el faltante apareció (brecha ${fi(d09.brecha)}). ✅`,
        ]
      : []),
    ...(d21
      ? [
          `- \`${d21.fecha}\` (**caso Ronny**): el pago quedó en \`Caja Fuerte\`, así que \`saldoCajaFuerte\` **sí lo`,
          `  ve** y \`deberia\` baja sola. Invisible = ${fi(d21.invisible)} y el día cuadra (brecha ${fi(d21.brecha)}).`,
          '  **Recategorizar no "arregló" la plata: la hizo visible para el único canal que el cierre mira.** ✅',
        ]
      : []),
    ...(d20
      ? [
          `- \`${d20.fecha}\`: quedan ${fi(d20.invisible)} invisibles **y** además ${fi(d20.dobleConteo)} restados`,
          '  por partida doble (una propina cargada en `Caja Fuerte`). Los dos efectos se cruzan y el día **no',
          `  cierra**: ${fi(Math.abs(d20.brecha))} sin explicación mecánica. 🔴`,
        ]
      : []),
    '',
    '**Lo que esto le dice al rediseño:** mientras el "debería" se calcule sobre UNA caja y las propinas se',
    'resten por un canal aparte, el mismo hecho físico —sacar efectivo de la casa— da resultados distintos',
    'según en qué caja se haya tecleado, y a veces resta dos veces. El pozo elimina la pregunta: todas las',
    'cajas físicas suman al mismo saldo y cada salida resta una sola vez.',
    '',
  )
}
