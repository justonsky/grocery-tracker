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
      includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Grocery Tracker',
        short_name: 'Groceries',
        description: 'Track grocery trips, lists, and price history.',
        theme_color: '#17734B',
        background_color: '#F6F7F3',
        display: 'standalone',
        // A watercolor tote of produce. PNGs (not just the SVG) so Android and
        // iOS home-screen installs get a real icon; the maskable one has a safe margin.
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
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
