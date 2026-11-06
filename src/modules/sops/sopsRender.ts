// Markdown de los SoP → HTML (parser por líneas, sin dependencias). El HTML se
// sanitiza con DOMPurify donde se inserta. Testeado en sopsRender.test.ts.
//
// Lo que entiende: # (se omite: el título va en el encabezado), ##–#####, párrafos,
// listas numeradas (cada paso con su número original), viñetas, tablas, notas (>), **negrita**, *cursiva*, `código`, links y
// escapes (\[Nombre\]).

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function inline(s: string): string {
  return escapeHtml(s)
    // Escapes de markdown (\[Nombre\], \*) → el carácter literal, antes de negrita/cursiva.
    .replace(/\\([!-/:-@[-`{-~])/g, (_m, c: string) => `&#${c.charCodeAt(0)};`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}

/** Notas que advierten algo que no se debe hacer: van en laca (único uso del rojo). */
const ALERTA = /^(\*\*)?(prohibido|nunca|cuidado|atenci[oó]n|importante:\s*no|no se debe|⚠)/i

export function renderContent(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n')
  const out: string[] = []
  let i = 0
  let h1done = false
  let list: 'ul' | 'ol' | null = null
  const closeList = () => { if (list) { out.push(list === 'ul' ? '</ul>' : '</ol>'); list = null } }

  while (i < lines.length) {
    const t = lines[i].trim()
    if (t === '') { closeList(); i++; continue }

    // Saltar el primer "# Título" (ya se muestra en el encabezado del lector)
    if (/^#\s+/.test(t) && !h1done) { h1done = true; i++; continue }

    // Línea meta de los SoP viejos: **Categoría:** … · **Aplica a:** …
    if (/^\*\*(Categoría|Aplica a)/.test(t)) {
      closeList()
      const m = t.match(/\*\*Aplica a:\*\*\s*(.+)$/)
      if (m) out.push(`<div class="sop-meta">${inline(m[1].replace(/\s*·\s*$/, ''))}</div>`)
      i++; continue
    }

    // Separador (---)
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { closeList(); out.push('<hr class="sop-hr">'); i++; continue }

    // Encabezados ## ### #### #####
    const h = t.match(/^(#{2,5})\s+(.*)/)
    if (h) {
      closeList()
      const cls = h[1].length === 2 ? 'sop-h2' : h[1].length === 3 ? 'sop-h3' : 'sop-h4'
      out.push(`<div class="${cls}">${inline(h[2])}</div>`)
      i++; continue
    }

    // Nota (>): Cormorant itálica con hilo de oro; si advierte, en laca.
    if (t.startsWith('>')) {
      closeList()
      const parts: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) { parts.push(lines[i].trim().replace(/^>\s?/, '')); i++ }
      const texto = parts.join(' ')
      out.push(`<div class="sop-note${ALERTA.test(texto) ? ' sop-note-alerta' : ''}">${inline(texto)}</div>`)
      continue
    }

    // Tabla
    if (t.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      closeList()
      const head = t.split('|').slice(1, -1).map(c => c.trim())
      i += 2
      const body: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) { body.push(lines[i].trim().split('|').slice(1, -1).map(c => c.trim())); i++ }
      let tb = '<div class="sop-table-wrap"><table class="sop-table"><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
      for (const r of body) tb += '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>'
      out.push(tb + '</tbody></table></div>'); continue
    }

    // Lista numerada: el primer número de la lista se respeta (start=).
    // Cada paso lleva su número tal como está en el markdown (data-n): los pasos siguen
    // 9, 10, 11… entre secciones y el lector lo muestra en gris.
    const ol = t.match(/^(\d+)\.\s+(.*)/)
    if (ol) {
      if (list !== 'ol') { closeList(); out.push('<ol class="sop-ol">'); list = 'ol' }
      out.push(`<li data-n="${ol[1]}">${inline(ol[2])}</li>`); i++; continue
    }

    // Lista con viñetas
    const ul = t.match(/^[-*]\s+(.*)/)
    if (ul) { if (list !== 'ul') { closeList(); out.push('<ul class="sop-ul">'); list = 'ul' } out.push(`<li>${inline(ul[1])}</li>`); i++; continue }

    // Párrafo
    closeList()
    out.push(`<p class="sop-p">${inline(t)}</p>`)
    i++
  }
  closeList()
  return out.join('\n')
}

/** Saca el markdown de una línea para mostrarla como texto plano. */
function plano(s: string): string {
  return s.replace(/\\(.)/g, '$1').replace(/\*\*|__|[*`>|#]/g, '').replace(/\s+/g, ' ').trim()
}

// Líneas de ficha que no sirven como resumen.
const META = /^\*\*(Categoría|Aplica a|Código|Área|Responsable|Versión|Alcance)\b/i

/**
 * Resumen de la tarjeta: el texto del **Objetivo:** si el documento lo tiene;
 * si no (documentos de menú, plano, equipo), el primer párrafo de texto.
 * Nunca muestra «Código:», «Área:» ni otras líneas de ficha.
 */
export function resumenTarjeta(content: string, max = 140): string {
  const lineas = content.replace(/\r/g, '').split('\n').map(l => l.trim())
  const obj = lineas.find(l => /^\*\*Objetivo:?\*\*:?/i.test(l))
  let texto = obj ? plano(obj.replace(/^\*\*Objetivo:?\*\*:?\s*/i, '')) : ''
  if (!texto) {
    const parrafo = lineas.find(l => l && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('>') && !META.test(l) && !/^---/.test(l))
    texto = parrafo ? plano(parrafo.replace(/^([-*]|\d+\.)\s+/, '')) : ''
  }
  return texto.length > max ? texto.slice(0, max).replace(/\s+\S*$/, '') + '…' : texto
}
