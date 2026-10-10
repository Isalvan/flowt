/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['flowt-logo.png'],
      manifest: {
        name: 'Flowt - Tracker Financiero',
        short_name: 'Flowt',
        lang: 'es',
        description: 'Tracker financiero automatizado con Gemini AI',
        theme_color: '#080a10',
        background_color: '#080a10',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/flowt-logo.png',
            sizes: '1254x1254',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/flowt-logo.png',
            sizes: '1254x1254',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true
      }
    })
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.tsx',
  },
})
