import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Grocery Tracker',
        short_name: 'Groceries',
        description: 'Track grocery trips, lists, and price history.',
        theme_color: '#6a5dc7',
        background_color: '#f2f1f7',
        display: 'standalone',
        // TODO(PWA phase): replace with real 192/512 PNG icons — SVG-only
        // manifest icons are unsupported on iOS home-screen installs.
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      workbox: {
        // Precache the app shell only — API responses are handled by TanStack
        // Query's own persisted cache, not the service worker.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
    }),
  ],
  server: {
    proxy: {
      // Local dev only: the production build is served same-origin by Kestrel,
      // so this proxy has no equivalent in the deployed app.
      '/api': 'http://localhost:5080',
    },
  },
})
