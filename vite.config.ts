/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // Load .env vars (including non-VITE_) for use in proxy config
  const env = loadEnv(mode, process.cwd(), '');
  return ({
  plugins: [react(), tailwindcss()],
  esbuild: {
    ...(mode === 'production' ? { drop: ['console'] } : {}),
  },
  build: {
    target: 'esnext',
    sourcemap: false,
    // Filter modulepreload: only preload chunks needed for first paint.
    // Vite adds preloads for ALL transitive deps including lazy chunks like
    // recharts (412KB) and shared service chunks (240KB) — wastes bandwidth.
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter(d => !d.includes('recharts') && !d.includes('windTrend') && !d.includes('date-fns') && !d.includes('aemetDaily')),
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        widget: resolve(__dirname, 'widget.html'),
      },
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
      // MeteoSIX v5: reuses /meteogalicia-api/ proxy via /meteogalicia-api/apiv5/ path
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
      // EUMETSAT proxy removed — non-commercial license incompatible
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
        // SkyX public auth — extracted from their own web client (DevTools Network panel).
        // NOT a credential leak. Single shared Cesantes station, no per-user auth.
        headers: { 'X-Auth': process.env.SKYX_AUTH || 'a21bd737-a714-4a5c-9b08-e7d3d2693a51' },
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
        // Dev: point to production via env var DEV_API_TARGET (e.g. https://meteomapgal.navia3d.com)
        // or local ingestor http://APP_HOST:3001. Defaults to placeholder for security.
        target: env.DEV_API_TARGET || 'http://REDACTED_APP_HOST:3001',
        changeOrigin: true,
        secure: true,
      },
      '/lmstudio-api': {
        target: `http://${process.env.LMSTUDIO_HOST || 'localhost'}:1234`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lmstudio-api/, ''),
      },
      '/opensky-api': {
        target: 'https://opensky-network.org/api',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/opensky-api/, ''),
        secure: true,
      },
      '/swan-api': {
        target: 'https://thredds-meteo.cesga.es',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/swan-api/, ''),
        secure: true,
      },
    },
  },
  });
})
