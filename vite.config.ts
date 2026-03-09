/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: 'esnext',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'maplibre': ['maplibre-gl'],
          'recharts': ['recharts'],
          'date-fns': ['date-fns'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
  server: {
    proxy: {
      '/aemet-api': {
        target: 'https://opendata.aemet.es/opendata',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/aemet-api/, ''),
        secure: true,
      },
      '/aemet-data': {
        target: 'https://opendata.aemet.es',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/aemet-data/, ''),
        secure: true,
      },
      '/meteogalicia-api': {
        target: 'https://servizos.meteogalicia.gal',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/meteogalicia-api/, ''),
        secure: true,
      },
      '/meteoclimatic-api': {
        target: 'https://www.meteoclimatic.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/meteoclimatic-api/, ''),
        secure: true,
      },
      '/ideg-api': {
        target: 'https://ideg.xunta.gal',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ideg-api/, ''),
        secure: true,
      },
      '/netatmo-api': {
        target: 'https://app.netatmo.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/netatmo-api/, ''),
        secure: true,
      },
      '/netatmo-auth': {
        target: 'https://auth.netatmo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/netatmo-auth/, ''),
        secure: true,
      },
      '/meteo2api': {
        target: 'https://apis-ext.xunta.gal',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/meteo2api/, '/meteo2api'),
        secure: true,
      },
      '/enaire-api': {
        target: 'https://servais.enaire.es',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/enaire-api/, ''),
        secure: true,
      },
      '/ihm-api': {
        target: 'https://ideihm.covam.es',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ihm-api/, ''),
        secure: true,
      },
      '/eumetsat-api': {
        target: 'https://view.eumetsat.int',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/eumetsat-api/, ''),
        secure: true,
      },
      '/api/v1': {
        target: 'http://REDACTED_APP_HOST:3001',
        changeOrigin: true,
      },
    },
  },
})
