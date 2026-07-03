// Setup global de vitest. Corre para TODOS los archivos de test, en el entorno de cada uno
// (Node por defecto; happy-dom en los que lo piden con `// @vitest-environment happy-dom`).
//
// Único trabajo: auto-cleanup de React Testing Library entre tests (desmonta el árbol y limpia
// el document) para que no haya fugas de DOM de un test al siguiente. GUARDADO: en entornos sin
// DOM (los tests Node existentes) sale temprano y NO importa RTL — así este setup es inofensivo
// para los 18 tests Node y no cambia su comportamiento.
import { afterEach } from 'vitest'

afterEach(async () => {
  if (typeof document === 'undefined') return // entorno Node: nada que limpiar
  const { cleanup } = await import('@testing-library/react')
  cleanup()
})
