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
    // 'hidden': sourcemaps generated as separate .map files (not referenced
    // from the bundle), to read a production stack trace against the build
    // that made it. They stay in dist/ on the server and are NEVER published:
    // the deploy script removes every .map from the web root and the web
    // server answers 404 to them (security audit 28-oct).
    sourcemap: 'hidden',
    // Filter modulepreload: only preload chunks needed for first paint.
    // Vite adds preloads for ALL transitive deps including lazy chunks like
    // recharts (412KB) and shared service chunks (240KB) — wastes bandwidth.
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter(d =>
          !d.includes('recharts') &&
          !d.includes('windTrend') &&
          !d.includes('date-fns') &&
          !d.includes('aemetDaily') &&
          !d.includes('stationDiscovery')  // S134 audit: 239KB, not LCP-critical
        ),
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
    include: ['src/**/*.test.{ts,tsx}', 'ingestor/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
  server: {
    proxy: {
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
      // Air quality goes through /meteogalicia-api since v2.178.23 (their official JSON).
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
      // PORTUSSRV proxy removed (1-oct-2026): Puertos del Estado asked third parties to use
      // POEM, which only our service reads, with its token (ingestor/poemClient.ts).
      '/skyx-api': {
        target: 'https://api.skyxglobal.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/skyx-api/, ''),
        secure: true,
        // SkyX public auth — extracted from their own web client (DevTools Network panel).
        // NOT a credential leak. Single shared Cesantes station, no per-user auth.
        headers: { 'X-Auth': process.env.SKYX_AUTH || 'a21bd737-a714-4a5c-9b08-e7d3d2693a51' },
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
