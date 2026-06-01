import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

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
        start_url:        '/satori-app/',
        scope:            '/satori-app/',
        lang:             'es',
        icons: [
          { src: '/satori-app/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/satori-app/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        shortcuts: [
          { name: 'Resumen del Día', url: '/satori-app/resumen', icons: [{ src: '/satori-app/icon-192.png', sizes: '192x192' }] },
          { name: 'Propinas',        url: '/satori-app/propinas', icons: [{ src: '/satori-app/icon-192.png', sizes: '192x192' }] },
          { name: 'Caja',            url: '/satori-app/caja',     icons: [{ src: '/satori-app/icon-192.png', sizes: '192x192' }] },
        ],
      },
      // Force immediate SW activation — skip waiting when new version is detected
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/satori-app/index.html',
        navigateFallbackAllowlist: [/^\/satori-app/],
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
  base: '/satori-app/',
})
