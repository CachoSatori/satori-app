// Chequeo de lint con línea base (CI, job «Gate»). Corre `eslint .` con la config del repo y compara la cantidad
// total de problemas (errores + advertencias) contra scripts/ci/lint-linea-base.json:
//   - más que la línea base → falla y lista los archivos con problemas;
//   - igual o menos → pasa (si bajó, avisa para bajar el número en el mismo PR).
// Uso: node scripts/ci/lint-linea-base.mjs   (desde la raíz del repo, después de `npm ci`)
import { readFileSync } from 'node:fs'
import { ESLint } from 'eslint'

const base = JSON.parse(readFileSync(new URL('./lint-linea-base.json', import.meta.url), 'utf8'))
const eslint = new ESLint()
const resultados = await eslint.lintFiles(['.'])

let errores = 0
let advertencias = 0
for (const r of resultados) {
  errores += r.errorCount
  advertencias += r.warningCount
}
const total = errores + advertencias
console.log(`eslint: ${total} problemas (${errores} errores, ${advertencias} advertencias) · línea base: ${base.problemas}`)

if (total > base.problemas) {
  const formato = await eslint.loadFormatter('stylish')
  console.log(await formato.format(resultados))
  console.log(`::error title=Lint::El lint subió de ${base.problemas} a ${total} problemas. Arreglá los nuevos (la lista está arriba); la línea base no se sube sin OK del dueño.`)
  process.exit(1)
}
if (total < base.problemas) {
  console.log(`::notice title=Lint::El lint bajó de ${base.problemas} a ${total}. Bajá "problemas" a ${total} en scripts/ci/lint-linea-base.json en este mismo PR.`)
}
