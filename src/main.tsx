import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Auto-actualización del PWA: al detectar versión nueva, el SW nuevo toma control
// (skipWaiting/clientsClaim) y acá se recarga UNA vez para servir la versión actual.
// Hardening del incidente 06-12:
//  - guard anti-loop: máximo UNA recarga por controllerchange cada 60s (un SW en mal
//    estado que dispare controllerchange repetido ya no puede ciclar recargas infinitas);
//  - chequeo periódico (60 min): las tablets/TVs que quedan abiertas días enteros
//    también reciben la versión nueva, no solo al reabrir la app.
if ('serviceWorker' in navigator) {
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    const last = Number(sessionStorage.getItem('satori-sw-reload-at') || 0)
    if (Date.now() - last < 60_000) return   // anti-loop entre recargas sucesivas
    reloaded = true
    sessionStorage.setItem('satori-sw-reload-at', String(Date.now()))
    window.location.reload()
  })
  const checkUpdate = () => navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => {
      reg.update().catch(() => {})
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
    })
  }).catch(() => {})
  checkUpdate()
  window.setInterval(checkUpdate, 60 * 60_000)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
