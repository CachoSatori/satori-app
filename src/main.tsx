import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Auto-actualización del PWA: al abrir la app se busca una versión nueva; si
// el nuevo service worker toma control, se recarga UNA vez automáticamente para
// servir la versión actual. El chequeo es solo al abrir (no en medio del turno),
// así la recarga cae al inicio y no interrumpe la carga de datos en curso.
if ('serviceWorker' in navigator) {
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => {
      reg.update().catch(() => {})
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
