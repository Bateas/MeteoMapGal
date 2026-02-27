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
          'maplibre': ['maplibre-gl', 'react-map-gl'],
          'recharts': ['recharts'],
          'date-fns': ['date-fns'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
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
    },
  },
})
