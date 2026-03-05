# MeteoMap

Real-time weather monitoring app for Galicia (Spain), with multi-sector support: **Embalse de Castrelo** (thermal sailing, 35km radius) and **Rías Baixas** (coastal wind monitoring, 30km radius).

## Quick Start

```bash
npm install
npm run dev       # Vite dev server on http://localhost:5173
npm run build     # Production build
npm test          # Vitest
```

Requires `.env` with `VITE_AEMET_API_KEY`. Other sources (MeteoGalicia, Meteoclimatic, Netatmo) need no auth.

## Architecture

- **React 19.2 + TypeScript 5.9 + Vite 7.3 + Tailwind CSS 4.2**
- **MapLibre GL JS 5.19** (react-map-gl/maplibre) with 3D terrain
- **Zustand 5** for state (weatherStore, weatherLayerStore, alertStore, sectorStore, toastStore, etc.)
- **Vitest 4** with 103 tests across 5 test files
- **Five real-time sources**: AEMET, MeteoGalicia, Meteoclimatic, Weather Underground, Netatmo
- **Supplementary sources**: Open-Meteo (forecast/history + atmospheric context: CAPE, PBL, LI, CIN), Lightning (meteo2api), AEMET Radar (Cuntis)
- **Multi-sector**: `sectorStore.ts` + `src/config/sectors.ts` define Embalse / Rías Baixas with independent center, radius, regions
- **PWA**: Service worker (`public/sw.js`) + web manifest for installable app
- **n8n webhook**: `src/api/webhookClient.ts` posts alerts to n8n for Telegram notifications (non-critical, fails silently)
- **Vite proxy** for CORS (8 routes): `/aemet-api`, `/aemet-data`, `/meteogalicia-api`, `/meteoclimatic-api`, `/netatmo-api`, `/netatmo-auth`, `/meteo2api`, `/ideg-api`
- **Production deployment**: nginx reverse proxy (`nginx.conf`) to Proxmox LXC, mirrors all Vite proxy routes

## Key Conventions

- **Internal units**: m/s for wind speed. Display in **knots (kt)** via `msToKnots()`.
- **Wind direction**: meteorological "from" convention. Arrows point "to" (add 180°).
- **Station IDs**: prefixed by source (`aemet_`, `mg_`, `mc_`, `wu_`, `nt_`).
- **Normalization**: All vendor types → `NormalizedStation` / `NormalizedReading` (see `src/services/normalizer.ts`). Includes `pressure` (hPa), `dewPoint` (°C), `solarRadiation` (W/m²) — all `number | null`.
- **Language**: UI in Spanish. Git commits in English.
- **AEMET `dir` field**: In **decadegrees** (0-36), NOT real degrees. Multiply by 10. `dir=99` = variable, `dir=0` = calm.

## Project Structure

```
src/
├── api/              # API clients (AEMET, MeteoGalicia, Meteoclimatic, WU, Netatmo, Open-Meteo, lightning, radar, webhook)
├── components/
│   ├── charts/       # Recharts visualizations (TimeSeriesChart, WindRose, ForecastTimeline, ThermalWindPanel, BestDaysSearch)
│   ├── common/       # Shared UI (LoadingSpinner, ErrorBoundary, ToastContainer, KeyboardShortcutHelp, SourceStatusIndicator)
│   ├── dashboard/    # Sidebar components (StationCard, StationTable)
│   ├── guide/        # MeteoGuide modal + 9 section pages (thermal cycle, zones, sailing, campo panel, etc.)
│   ├── layout/       # AppShell, Header, Sidebar, FieldDrawer
│   └── map/          # MapLibre overlays (Wind, Humidity, Satellite, Radar, Lightning, Markers)
├── config/           # Constants, thermal zones, source config
├── hooks/            # useWeatherData, useStations, useThermalAnalysis, useLightningData, useStormShadow, useForecastTimeline, useAutoRefresh
├── services/         # Business logic (see src/services/CLAUDE.md)
├── store/            # Zustand stores (weather, weatherLayer, sector, alert, notification, toast, thermal, temperatureOverlay, ui)
├── test/             # Test setup (vitest + jsdom + @testing-library)
└── types/            # TypeScript types
```

## Critical Gotchas

- **Canvas overlays**: Must sit OUTSIDE `<Map>` component with `pointer-events-none`. MapLibre native layers (Satellite, Radar) go INSIDE `<Map>`.
- **IDW per-pixel `unproject()` is fatal**: Use 4-corner pre-computation + linear interpolation instead.
- **MapLibre `beforeId`**: `beforeId="osm-tiles"` on raster layers hides them below base tiles. Omit it.
- **Vite HMR caching**: New `.tsx` files may require dev server restart.
- **Wind particle SPEED_SCALE**: At Galician scale (~50km viewport), use 0.0015. Values <0.001 produce invisible sub-pixel movement.
- **Sector switch cleanup**: `setStations([])` triggers full state reset (readings, history, selections, sourceFreshness). Fetch flags in `useWeatherData` also reset.
- **Embalse-only features**: Thermal zones, forecast timeline, thermal panel, sailing banner, and propagation arrows are conditionally rendered only when `activeSector.id === 'embalse'`.

## Testing

```bash
npm test              # Vitest in watch mode
npx vitest run        # Single run (CI)
```

132 tests across 6 files: `normalizer.test.ts`, `windUtils.test.ts`, `alertService.test.ts`, `thermalScoringEngine.test.ts`, `toastStore.test.ts`, `csvUtils.test.ts`. Config in `vite.config.ts` (`test` block) with jsdom environment and `src/test/setup.ts`.

## Deployment

**Production** runs via nginx reverse proxy on a Proxmox LXC container:
1. `npm run build` produces `dist/` with hashed assets
2. Copy `dist/` to `/var/www/meteomap` on the LXC
3. `nginx.conf` (root of repo) provides all CORS proxy routes + SPA fallback + gzip + PWA cache headers
4. n8n webhook route (commented template in `nginx.conf`) proxies `/api/webhook/` to n8n instance for Telegram alert forwarding
