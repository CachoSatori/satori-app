import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Base dinámico: producción (GitHub Pages) sirve bajo /satori-app/; staging (Cloudflare
// Pages) sirve en la raíz /. Se decide por VITE_APP_ENV (build:staging lo setea).
// Todo lo del PWA (manifest, iconos, scope, fallback) usa BASE → no más rutas clavadas.
const BASE = process.env.VITE_APP_ENV === 'staging' ? '/' : '/satori-app/'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name:             'Satori App',
        short_name:       'Satori',
        description:      'Sistema de gestión — Satori Restaurant, Santa Teresa CR',
        theme_color:      '#0a0a0a',
        background_color: '#0a0a0a',
        display:          'standalone',
        orientation:      'portrait-primary',
        start_url:        BASE,
        scope:            BASE,
        lang:             'es',
        icons: [
          { src: `${BASE}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${BASE}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        shortcuts: [
          { name: 'Resumen del Día', url: `${BASE}resumen`, icons: [{ src: `${BASE}icon-192.png`, sizes: '192x192' }] },
          { name: 'Propinas',        url: `${BASE}propinas`, icons: [{ src: `${BASE}icon-192.png`, sizes: '192x192' }] },
          { name: 'Caja',            url: `${BASE}caja`,     icons: [{ src: `${BASE}icon-192.png`, sizes: '192x192' }] },
        ],
        // Compartir una foto desde WhatsApp/galería → Satori (Bandeja). El POST
        // lo intercepta sw-share.js y redirige a {BASE}inbox?shared=1.
        share_target: {
          action:  `${BASE}inbox/share`,
          method:  'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'image', accept: ['image/*'] }] },
        },
      },
      // Force immediate SW activation — skip waiting when new version is detected
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // 404.html es el fallback SERVER-SIDE de GitHub Pages — la app nunca lo pide.
        // En staging además se borra del dist post-build (Cloudflare usa su propio
        // fallback): si quedara en el manifest, el SW pediría un archivo inexistente
        // al instalar → instalación fallida → SW 'redundant' (bug encontrado 06-12).
        globIgnores: ['404.html'],
        importScripts: [`${BASE}sw-share.js`],   // handler del Share Target
        navigateFallback: `${BASE}index.html`,
        navigateFallbackAllowlist: [new RegExp('^' + BASE)],
        navigateFallbackDenylist: [/\/inbox\/share$/],   // el POST de compartir lo maneja sw-share.js
        // Claim clients immediately so new SW takes over all tabs right away
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com/,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-webfonts', expiration: { maxEntries: 20, maxAgeSeconds: 31536000 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  base: BASE,
  build: {
    rollupOptions: {
      output: {
        // xlsx (~300KB) lo importan VentasXLS y VentasHistorico — sin esto se
        // duplica dentro de ambos chunks. Como chunk propio se descarga UNA vez
        // y solo cuando se entra a esas pestañas (siguen siendo lazy).
        manualChunks(id: string) {
          if (id.includes('node_modules/xlsx')) return 'xlsx'
          // recharts pesa ~300KB y solo lo usa VentasHistorico: chunk propio para
          // que el resto de Ventas no lo arrastre y la gráfica cargue aparte.
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'recharts'
        },
      },
    },
  },
})
