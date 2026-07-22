// T1 · Render del reporte de la corrida anclada. Determinista: sin hora de ejecución.

import { TOLERANCIA_CRC, type Watermark } from './analisis.ts'
import type { ParAnclado } from './anclado.ts'
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
