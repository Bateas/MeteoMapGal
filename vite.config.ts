import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    },
  },
})
