# MeteoMapGal

Real-time weather monitoring app for Galicia (Spain), with multi-sector support: **Embalse de Castrelo** (thermal sailing, 35km radius) and **Rías Baixas** (coastal wind monitoring, 40km radius).

## Quick Start

```bash
npm install
npm run dev       # Vite dev server on http://localhost:5173
npm run build     # Production build
npm test          # Vitest
```

Requires `.env` with `VITE_AEMET_API_KEY` and `VITE_OBSCOSTEIRO_API_KEY`. Other sources (MeteoGalicia, Meteoclimatic, Netatmo) need no auth.

## Architecture

- **React 19.2 + TypeScript 5.9 + Vite 7.3 + Tailwind CSS 4.2**
- **MapLibre GL JS 5.19** (react-map-gl/maplibre) with 3D terrain
- **Zustand 5** for state (12 stores: weather, weatherLayer, sector, alert, notification, toast, thermal, temperatureOverlay, ui, airspace, spot, buoy, mapStyle)
- **Vitest 4** with 159 tests across 7 test files
- **Five real-time sources**: AEMET, MeteoGalicia, Meteoclimatic, Weather Underground, Netatmo
- **Supplementary sources**: Open-Meteo (forecast/history + atmospheric context: CAPE, PBL, LI, CIN), Lightning (meteo2api), AEMET Radar (Cuntis), EUMETSAT satellite, ENAIRE airspace, IHM tides, Puertos del Estado (marine buoys), Observatorio Costeiro da Xunta (supplementary buoy data — humidity, dew point, 10min resolution), RADAR ON RAIA / INTECMAR (HF radar surface currents WMS — Rías only), CMEMS / Copernicus Marine (SST WMTS tiles — Rías only), OpenSeaMap (seamark overlay — Rías only), IHM ENC (official nautical charts WMS — Rías only)
- **Map base styles**: 6 switchable base maps via `mapStyleStore` — OSM, Positron (light), Dark Matter, Voyager, IGN Topográfico, IGN Base Gris. All free, no API keys. Dynamic `buildMapStyle()` rebuilds full MapLibre StyleSpecification on switch
- **Multi-sector**: `sectorStore.ts` + `src/config/sectors.ts` define Embalse / Rías Baixas with independent center, radius, regions
- **PWA**: Service worker (`public/sw.js`) + web manifest for installable app
- **n8n webhook**: `src/api/webhookClient.ts` posts alerts to n8n for Telegram notifications (non-critical, fails silently)
- **Vite proxy** for CORS (15 routes): `/aemet-api`, `/aemet-data`, `/meteogalicia-api`, `/meteoclimatic-api`, `/netatmo-api`, `/netatmo-auth`, `/meteo2api`, `/ideg-api`, `/enaire-api`, `/ihm-api`, `/eumetsat-api`, `/portus-api`, `/obscosteiro-api`, `/hfradar-api`, `/api/v1` (history)
- **Production deployment**: nginx reverse proxy (`nginx.conf`) to Proxmox LXC, mirrors all Vite proxy routes
- **TimescaleDB ingestor**: `ingestor/` — standalone Node.js service polling 5 sources every 5min → TimescaleDB. Runs as `meteo-ingestor.service` (systemd) on LXC 305. Reuses `normalizer.ts` + `geoUtils.ts` from `src/`

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
├── api/              # API clients (AEMET, MeteoGalicia, Meteoclimatic, WU, Netatmo, Open-Meteo, lightning, radar, webhook, buoys, Obs Costeiro, history, stationDiscovery, openMeteoQueue)
├── components/
│   ├── charts/       # Recharts visualizations (TimeSeriesChart, WindRose, WindRoseHistorical, ForecastTimeline, ThermalWindPanel, BestDaysSearch)
│   ├── common/       # Shared UI (LoadingSpinner, ErrorBoundary, ToastContainer, KeyboardShortcutHelp, SourceStatusIndicator)
│   ├── dashboard/    # Sidebar components (StationCard, StationTable, BuoyPanel, HistoryDashboard)
│   ├── guide/        # MeteoGuide modal + 13 section pages (thermal, zones, sailing, spots, campo, history, glossary, etc.)
│   ├── layout/       # AppShell, Header, Sidebar, FieldDrawer
│   └── map/          # MapLibre overlays (Wind, Humidity, Satellite, Radar, Lightning, Currents, Bathymetry, Seamarks, NauticalChart, MapStyleSelector, Markers, CriticalAlertBanner)
├── config/           # Constants, thermal zones, source config
├── hooks/            # useWeatherData, useStations, useThermalAnalysis, useLightningData, useStormShadow, useForecastTimeline, useAutoRefresh
├── services/         # Business logic (see src/services/CLAUDE.md)
├── store/            # Zustand stores (weather, weatherLayer, sector, alert, notification, toast, thermal, temperatureOverlay, ui, airspace, spot, buoy, mapStyle)
├── test/             # Test setup (vitest + jsdom + @testing-library)
└── types/            # TypeScript types
```

### Ingestor (`ingestor/`)

```
ingestor/
├── index.ts         # Main loop: 5min poll, 1h rediscovery, graceful shutdown
├── db.ts            # pg Pool + batchUpsert (ON CONFLICT DO NOTHING)
├── discover.ts      # Station discovery from 5 sources (both sectors)
├── fetchers.ts      # Observation fetchers → NormalizedReading[]
├── xml.ts           # Server-side Meteoclimatic XML parser (regex)
├── logger.ts        # Colored console logger with timestamps
├── schema.sql       # Idempotent DB schema (IF NOT EXISTS)
└── meteo-ingestor.service  # systemd unit (Restart=always)
```

## Critical Gotchas

- **Canvas overlays**: Must sit OUTSIDE `<Map>` component with `pointer-events-none`. MapLibre native layers (Satellite, Radar) go INSIDE `<Map>`.
- **IDW per-pixel `unproject()` is fatal**: Use 4-corner pre-computation + linear interpolation instead.
- **MapLibre `beforeId`**: `beforeId="base-tiles"` on raster layers hides them below base tiles. Omit it. Source/layer IDs are `base-tiles` (not `osm-tiles`) since style is now dynamic.
- **Vite HMR caching**: New `.tsx` files may require dev server restart.
- **Wind particle SPEED_SCALE**: At Galician scale (~50km viewport), use 0.0006. Values >0.001 produce unnaturally fast particles; real scale (~0.00000014) is impractical.
- **Sector switch cleanup**: `setStations([])` triggers full state reset (readings, history, selections, sourceFreshness). Fetch flags in `useWeatherData` also reset.
- **Embalse-only features**: Thermal zones, forecast timeline, thermal panel, sailing banner, and propagation arrows are conditionally rendered only when `activeSector.id === 'embalse'`.
- **Rías-only features**: BuoyPanel (marine buoys from Puertos del Estado + Observatorio Costeiro) in Stations tab, tide predictions (IHM), surface currents overlay (RADAR ON RAIA), bathymetry overlay (EMODnet), SST overlay (CMEMS WMTS), OpenSeaMap seamarks, IHM nautical chart overlay. Rendered when `activeSector.id === 'rias'`.
- **Map style selector**: `MapStyleSelector` component with `mapStyleStore` (persisted). Nautical overlay toggles (OpenSeaMap, IHM ENC) only visible in Rías sector. IGN overlays (Ortofotos PNOA, Sombreado MDT, Curvas de nivel) available in both sectors. All raster overlays have `minzoom` optimized to avoid wasted tile requests.
- **Spot scoring**: `spotScoringEngine.ts` computes per-spot verdicts (5-level: calm/light/sailing/good/strong) from nearby station wind consensus + buoy waves. `SpotScore` includes airTemp, humidity, windChill (Environment Canada formula, T<10°C), windDirDeg (for arrow display). Storm alerts ONLY from lightning-confirmed storms (not storm-shadow).
- **Both-sector features**: CriticalAlertBanner (top-of-screen PELIGRO banner), AlertPanel, spot-based sailing scoring.

## Performance Rules

- **All polling intervals MUST use `useVisibilityPolling`**: Never use raw `setInterval` for API fetches. Background tabs must not waste network/CPU. All 9 polling intervals are visibility-aware. Exception: `AppShell.tsx` uses raw `setInterval` for non-network housekeeping (pruneHistory, pruneAlertHistory) — this is intentional.
- **New overlays MUST be toggle-guarded**: MapLibre layers should not render when their toggle is off. Use `if (!isActive) return null`.
- **New sidebar components MUST be `React.lazy`**: Any component >5KB in sidebar tabs must be lazy-loaded (7 in Sidebar + 2 in FieldDrawer already lazy: TidePanel, AtmosphericProfile).
- **Pure computation services = low impact**: Alert services that compute from existing data (no new fetches, no new intervals) are safe to add. Examples: pressureTrendService, maritimeFogService, crossSeaService.
- **Avoid adding stores to AppShell.tsx**: Already has 13 store subscriptions (24 selectors, 349 lines). Consider extracting to a dedicated hook if more are needed.
- **Canvas animation = O(1) per entity**: Wind particles use pre-computed 24×24 grid. Never do per-pixel/per-particle IDW in animation loops.
- **Bundle**: Main chunk ~564KB gzip 183KB. Heavy data (aemetDailyHistory 501KB) already lazy via `import()`. Recharts (420KB) lazy via React.lazy tabs.

## Testing

```bash
npm test              # Vitest in watch mode
npx vitest run        # Single run (CI)
```

159 tests across 7 files: `normalizer.test.ts`, `windUtils.test.ts`, `alertService.test.ts`, `thermalScoringEngine.test.ts`, `toastStore.test.ts`, `csvUtils.test.ts`, `airspaceService.test.ts`. Config in `vite.config.ts` (`test` block) with jsdom environment and `src/test/setup.ts`.

## Deployment

**Production** runs via nginx reverse proxy on a Proxmox LXC container:
1. `npm run build` produces `dist/` with hashed assets
2. Copy `dist/` to `/var/www/meteomapgal` on the LXC
3. `nginx.conf` (root of repo) provides all CORS proxy routes + SPA fallback + gzip + PWA cache headers + security blocking (dotfiles, CMS/admin paths, dangerous extensions → 444)
4. n8n webhook route (commented template in `nginx.conf`) proxies `/api/webhook/` to n8n instance for Telegram alert forwarding
5. **nginx.conf deploy is separate**: `update-meteomap` only copies `dist/`. To update nginx: `curl -o /etc/nginx/sites-available/meteomapgal https://raw.githubusercontent.com/Bateas/MeteoMapGal/master/nginx.conf && nginx -t && systemctl reload nginx`
