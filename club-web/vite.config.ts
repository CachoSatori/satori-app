import { defineConfig } from 'vite'

// Mini-sitio aparte de la app: sin PWA ni service worker. Se publica en su propio
// proyecto de Cloudflare Pages (dist/ + functions/).
export default defineConfig({
  base: '/',
  build: { target: 'es2020', outDir: 'dist', emptyOutDir: true, sourcemap: false },
})
