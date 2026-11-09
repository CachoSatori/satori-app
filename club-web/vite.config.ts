import { defineConfig, loadEnv } from 'vite'
import { clubUrlValida, ERROR_SIN_CLUB_URL } from './src/clubUrl'

// Mini-sitio aparte de la app: sin PWA ni service worker. Se publica en su propio
// proyecto de Cloudflare Pages (dist/ + functions/).
export default defineConfig(({ command, mode }) => {
  // (09-nov, auditoría) El build de producción no sale sin VITE_CLUB_URL válida (variable de entorno o archivo .env*).
  if (command === 'build' && mode === 'production') {
    const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
    if (!clubUrlValida(env.VITE_CLUB_URL)) throw new Error(ERROR_SIN_CLUB_URL)
  }
  return {
    base: '/',
    build: { target: 'es2020', outDir: 'dist', emptyOutDir: true, sourcemap: false },
  }
})
