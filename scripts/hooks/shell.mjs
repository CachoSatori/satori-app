// Lector mínimo de comandos de shell para los hooks: parte un comando de Bash en comandos simples (por `;`, `&&`, `||`,
// `|`, `&` y saltos de línea), con comillas, escapes, redirecciones y heredocs. No expande variables: `$X` queda literal.
// Lo de adentro de `$(…)`, de comillas invertidas y de `bash -c '…'` / `sh -c` / `eval` se analiza también, como
// comandos aparte. No pretende ser un shell completo: si algo no se puede leer, los hooks deciden con el texto crudo.

/**
 * @typedef {{ palabras: string[], redirecciones: { op: string, destino: string }[], stdin: string | null }} Simple
 */

/** @param {string} texto @returns {Simple[]} */
export function comandos(texto, profundidad = 0) {
  if (profundidad > 4) return []
  /** @type {Simple[]} */
  const salida = []
  /** @type {string[]} */
  const anidados = []
  let actual = nuevo()
  let palabra = ''
  let enPalabra = false
  /** @type {{ delim: string, cmd: Simple, tabs: boolean }[]} */
  let heredocs = []
  let redireccionPendiente = ''

  function nuevo() { return { palabras: [], redirecciones: [], stdin: null } }
  function cerrarPalabra() {
    if (!enPalabra) return
    if (redireccionPendiente) {
      actual.redirecciones.push({ op: redireccionPendiente, destino: palabra })
      redireccionPendiente = ''
    } else actual.palabras.push(palabra)
    palabra = ''
    enPalabra = false
  }
  function cerrarComando() {
    cerrarPalabra()
    if (actual.palabras.length || actual.redirecciones.length) salida.push(actual)
    actual = nuevo()
  }

  let i = 0
  const n = texto.length
  // Lee `$(` … `)` balanceado desde i (apunta al `(`); devuelve [contenido, índice después del `)`].
  function leerSubshell(desde) {
    let prof = 0
    let j = desde
    let q = ''
    for (; j < n; j++) {
      const c = texto[j]
      if (q) { if (c === q) q = ''; else if (c === '\\' && q === '"') j++; continue }
      if (c === "'" || c === '"') { q = c; continue }
      if (c === '(') prof++
      else if (c === ')') { prof--; if (prof === 0) return [texto.slice(desde + 1, j), j + 1] }
    }
    return [texto.slice(desde + 1), n]
  }

  while (i < n) {
    const c = texto[i]
    // Heredoc pendiente: al llegar al fin de línea se consume el cuerpo.
    if (c === '\n' && heredocs.length) {
      cerrarComando()
      i++
      for (const h of heredocs) {
        const lineas = []
        while (i < n) {
          let fin = texto.indexOf('\n', i)
          if (fin === -1) fin = n
          const linea = texto.slice(i, fin)
          i = fin + 1
          if ((h.tabs ? linea.replace(/^\t+/, '') : linea) === h.delim) break
          lineas.push(linea)
        }
        h.cmd.stdin = (h.cmd.stdin ?? '') + lineas.join('\n')
      }
      heredocs = []
      continue
    }
    if (c === '\\') {
      if (texto[i + 1] === '\n') { i += 2; continue }
      palabra += texto[i + 1] ?? ''
      enPalabra = true
      i += 2
      continue
    }
    if (c === "'") {
      const fin = texto.indexOf("'", i + 1)
      const hasta = fin === -1 ? n : fin
      palabra += texto.slice(i + 1, hasta)
      enPalabra = true
      i = hasta + 1
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < n && texto[j] !== '"') {
        if (texto[j] === '\\' && j + 1 < n) { palabra += texto[j + 1]; j += 2; continue }
        if (texto[j] === '$' && texto[j + 1] === '(') {
          const [dentro, sig] = leerSubshell(j + 1)
          anidados.push(dentro)
          palabra += `$(${dentro})`
          j = sig
          continue
        }
        if (texto[j] === '`') {
          const fin = texto.indexOf('`', j + 1)
          const hasta = fin === -1 ? n : fin
          anidados.push(texto.slice(j + 1, hasta))
          palabra += texto.slice(j, hasta + 1)
          j = hasta + 1
          continue
        }
        palabra += texto[j]
        j++
      }
      enPalabra = true
      i = j + 1
      continue
    }
    if (c === '$' && texto[i + 1] === '(') {
      const [dentro, sig] = leerSubshell(i + 1)
      anidados.push(dentro)
      palabra += `$(${dentro})`
      enPalabra = true
      i = sig
      continue
    }
    if (c === '`') {
      const fin = texto.indexOf('`', i + 1)
      const hasta = fin === -1 ? n : fin
      anidados.push(texto.slice(i + 1, hasta))
      palabra += texto.slice(i, hasta + 1)
      enPalabra = true
      i = hasta + 1
      continue
    }
    if (c === '#' && !enPalabra) { // comentario hasta fin de línea
      const fin = texto.indexOf('\n', i)
      i = fin === -1 ? n : fin
      continue
    }
    if (c === ' ' || c === '\t') { cerrarPalabra(); i++; continue }
    if (c === '\n' || c === ';') { cerrarComando(); i++; continue }
    if (c === '&' || c === '|') {
      if (c === '&' && texto[i + 1] === '>') { // &> y &>>
        cerrarPalabra()
        const op = texto[i + 2] === '>' ? '&>>' : '&>'
        redireccionPendiente = op
        i += op.length
        continue
      }
      cerrarComando()
      i += texto[i + 1] === c ? 2 : 1
      continue
    }
    if (c === '(' || c === ')' || c === '{' && !enPalabra && /\s/.test(texto[i + 1] ?? ' ') || c === '}' && !enPalabra) {
      cerrarComando()
      i++
      continue
    }
    if (c === '<' && texto[i + 1] === '<' && texto[i + 2] !== '<') { // heredoc
      cerrarPalabra()
      let j = i + 2
      const tabs = texto[j] === '-'
      if (tabs) j++
      while (texto[j] === ' ') j++
      let delim = ''
      while (j < n && !/[\s;|&<>()]/.test(texto[j])) {
        if (texto[j] !== "'" && texto[j] !== '"' && texto[j] !== '\\') delim += texto[j]
        j++
      }
      heredocs.push({ delim, cmd: actual, tabs })
      i = j
      continue
    }
    if (c === '<' && texto[i + 1] === '<' && texto[i + 2] === '<') { // here-string: la palabra siguiente es stdin
      cerrarPalabra()
      redireccionPendiente = '<<<'
      i += 3
      continue
    }
    if (c === '>' || c === '<') {
      // N> o N>> : el número ya quedó en `palabra`
      if (enPalabra && /^\d+$/.test(palabra)) { palabra = ''; enPalabra = false } else cerrarPalabra()
      let op = c
      if (texto[i + 1] === '>' || texto[i + 1] === '|' || texto[i + 1] === '&') op += texto[i + 1]
      i += op.length
      if (op.endsWith('&')) { // 2>&1: el destino es un descriptor, no un archivo
        while (i < n && /[0-9-]/.test(texto[i])) i++
        continue
      }
      redireccionPendiente = op
      continue
    }
    palabra += c
    enPalabra = true
    i++
  }
  cerrarComando()

  for (const s of salida) {
    const here = s.redirecciones.filter(r => r.op === '<<<')
    if (here.length) s.stdin = (s.stdin ?? '') + here.map(r => r.destino).join('\n')
  }
  const extra = []
  for (const a of anidados) extra.push(...comandos(a, profundidad + 1))
  // bash -c '…', sh -c, zsh -c, eval '…'
  for (const s of salida) {
    const { prog, args } = programa(s.palabras)
    if (/^(ba|z|da|k)?sh$/.test(prog)) {
      const k = args.findIndex(a => /^-[a-z]*c[a-z]*$/.test(a))
      if (k !== -1 && args[k + 1] !== undefined) extra.push(...comandos(args[k + 1], profundidad + 1))
    } else if (prog === 'eval') extra.push(...comandos(args.join(' '), profundidad + 1))
  }
  return [...salida, ...extra]
}

const ENVOLTORIOS = new Set(['sudo', 'command', 'builtin', 'exec', 'nohup', 'time', 'nice', 'stdbuf', 'caffeinate'])

/** Saca asignaciones `X=y` y envoltorios (`sudo`, `env`, `timeout 30`, …). @param {string[]} palabras */
export function programa(palabras) {
  let i = 0
  while (i < palabras.length) {
    const p = palabras[i]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(p)) { i++; continue }
    if (ENVOLTORIOS.has(p)) { i++; while (palabras[i]?.startsWith('-')) i++; continue }
    if (p === 'env') { i++; while (palabras[i] && (palabras[i].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(palabras[i]))) i++; continue }
    if (p === 'timeout') { i++; while (palabras[i]?.startsWith('-')) i++; i++; continue }
    break
  }
  const crudo = palabras[i] ?? ''
  return { prog: crudo.split('/').pop() ?? '', args: palabras.slice(i + 1) }
}
