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
          'zustand': ['zustand'],
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
      '/portus-api': {
        target: 'https://portus.puertos.es/portussvr/api',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/portus-api/, ''),
        secure: true,
      },
      '/obscosteiro-api': {
        target: 'https://apis-ext.xunta.gal',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/obscosteiro-api/, '/mgplatpubapi/v1/api'),
        secure: true,
      },
      '/skyx-api': {
        target: 'https://api.skyxglobal.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/skyx-api/, ''),
        secure: true,
      },
      '/hfradar-api': {
        target: 'https://opendap.intecmar.gal',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hfradar-api/, '/thredds/wms/HFRADAR_Galicia_Aggr_NRT_v2.2_Totals'),
        secure: true,
      },
      '/noaa-api': {
        target: 'https://ftp.cpc.ncep.noaa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/noaa-api/, ''),
        secure: true,
      },
      '/api/v1': {
        target: 'http://192.168.10.120:3001',
        changeOrigin: true,
      },
    },
  },
})
