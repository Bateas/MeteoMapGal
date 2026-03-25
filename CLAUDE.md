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
- **Zustand 5** for state (15 stores: weather, weatherSelection, weatherLayer, sector, alert, notification, toast, thermal, temperatureOverlay, ui, airspace, spot, buoy, mapStyle, theme)
- **Vitest 4** with 185 tests across 11 test files
- **Six real-time sources**: AEMET, MeteoGalicia, Meteoclimatic, Weather Underground, Netatmo, SkyX
- **Supplementary sources**: Open-Meteo (forecast/history + atmospheric context: CAPE, PBL, LI, CIN), Lightning (meteo2api), AEMET Radar (national composite, Cerceda/A Coruña), RainViewer (animated radar past 2h, free tier), EUMETSAT satellite, ENAIRE airspace, IHM tides, Puertos del Estado (marine buoys), Observatorio Costeiro da Xunta (supplementary buoy data — humidity, dew point, 10min resolution), RADAR ON RAIA / INTECMAR (HF radar surface currents WMS — Rías only), CMEMS / Copernicus Marine (SST WMTS tiles — Rías only), OpenSeaMap (seamark overlay — Rías only), IHM ENC (official nautical charts WMS — Rías only)
- **Map base styles**: 6 switchable base maps via `mapStyleStore` — OSM, Positron (light), Dark Matter, Voyager, IGN Topográfico, IGN Base Gris. All free, no API keys. Dynamic `buildMapStyle()` rebuilds full MapLibre StyleSpecification on switch
- **Multi-sector**: `sectorStore.ts` + `src/config/sectors.ts` define Embalse / Rías Baixas with independent center, radius, regions
- **PWA**: Service worker (`public/sw.js`) + web manifest for installable app
- **n8n webhook**: Alerts via `webhookClient.ts` (frontend spot transitions) + `alertDispatcher.ts` (ingestor 24/7). Daily summary via ingestor `dailySummary.ts` at 9AM (both sectors). Frontend summary DISABLED (moved to ingestor to avoid duplicate sends). Endpoints: `meteomap-alert`, `meteomap-summary`
- **Vite proxy** for CORS (17 routes): `/aemet-api`, `/aemet-data`, `/meteogalicia-api`, `/meteoclimatic-api`, `/netatmo-api`, `/netatmo-auth`, `/meteo2api`, `/ideg-api`, `/enaire-api`, `/ihm-api`, `/eumetsat-api`, `/portus-api`, `/obscosteiro-api`, `/hfradar-api`, `/skyx-api`, `/noaa-api`, `/api/v1` (history)
- **Production deployment**: nginx reverse proxy (`nginx.conf`) to Proxmox LXC, mirrors all Vite proxy routes
- **TimescaleDB ingestor**: `ingestor/` — standalone Node.js service polling 6 sources every 5min → TimescaleDB. Runs as `meteo-ingestor.service` (systemd) on LXC 305. Includes: station coords persistence (`stations` table), spot analyzer (distance-filtered scoring + verdict transitions → Telegram), forecast cache (Open-Meteo 48h both sectors), daily summary (9AM both sectors). Logs to `/var/log/meteo-ingestor.log`
- **Forecast API (Phase 3)**: `/api/v1/forecast?sector=rias` served by ingestor API (`api.ts` port 3001). Frontend Auto mode reads from own API first → fallback Open-Meteo. Specific models (ICON/GFS/ECMWF) still use Open-Meteo direct. Eliminates frontend 429 rate limits

## Key Conventions

- **Internal units**: m/s for wind speed. Display in **knots (kt)** via `msToKnots()`.
- **Wind direction**: meteorological "from" convention. Arrows point "to" (add 180°).
- **Station IDs**: prefixed by source (`aemet_`, `mg_`, `mc_`, `wu_`, `nt_`, `skyx_`).
- **Normalization**: All vendor types → `NormalizedStation` / `NormalizedReading` (see `src/services/normalizer.ts`). Includes `pressure` (hPa), `dewPoint` (°C), `solarRadiation` (W/m²) — all `number | null`.
- **Language**: UI in Spanish. Git commits in English.
- **AEMET `dir` field**: In **decadegrees** (0-36), NOT real degrees. Multiply by 10. `dir=99` = variable, `dir=0` = calm.

## Project Structure

```
src/
├── api/              # API clients (AEMET, MeteoGalicia, Meteoclimatic, WU, Netatmo, Open-Meteo, lightning, radar, webhook, buoys, Obs Costeiro, history, stationDiscovery, openMeteoQueue)
├── components/
│   ├── charts/       # Recharts visualizations (TimeSeriesChart, WindRose, WindRoseHistorical, ForecastTimeline, ThermalWindPanel, BestDaysSearch)
│   ├── common/       # Shared UI (LoadingSpinner, ErrorBoundary, ToastContainer, KeyboardShortcutHelp, SourceStatusIndicator, SourceStatusBanner)
│   ├── dashboard/    # Sidebar components (StationCard, StationTable, BuoyPanel, HistoryDashboard)
│   ├── guide/        # MeteoGuide modal + 13 section pages (thermal, zones, sailing, spots, campo, history, glossary, etc.)
│   ├── layout/       # AppShell, Header, Sidebar, FieldDrawer
│   └── map/          # MapLibre overlays (Wind, Humidity, Satellite, Radar, Lightning, Currents, Bathymetry, Seamarks, NauticalChart, MapStyleSelector, Markers, CriticalAlertBanner)
├── config/           # Constants, thermal zones, source config
├── hooks/            # useWeatherData, useStations, useThermalAnalysis, useLightningData, useStormShadow, useForecastTimeline, useAutoRefresh
├── services/         # Business logic (see src/services/CLAUDE.md)
├── store/            # Zustand stores (weather, weatherSelection, weatherLayer, sector, alert, notification, toast, thermal, temperatureOverlay, ui, airspace, spot, buoy, mapStyle)
├── test/             # Test setup (vitest + jsdom + @testing-library)
└── types/            # TypeScript types
```

### Ingestor (`ingestor/`)

```
ingestor/
├── index.ts              # Main loop: 5min poll, 1h rediscovery, graceful shutdown
├── db.ts                 # pg Pool + batchUpsert + batchUpsertStations
├── discover.ts           # Station discovery from 6 sources (both sectors)
├── fetchers.ts           # Observation fetchers → NormalizedReading[]
├── buoyFetcher.ts        # PORTUS + ObsCosteiro buoy fetcher + merge
├── analyzer.ts           # Spot scoring (distance-filtered) + verdict transitions → alerts
├── alertDispatcher.ts    # Webhook dispatch to n8n (cooldown + night silence)
├── forecastFetcher.ts    # Open-Meteo 48h forecast cache (both sectors, all fields)
├── dailySummary.ts       # 9AM summary (both sectors) → n8n → Telegram
├── api.ts                # HTTP API server (port 3001) — history + forecast endpoints
├── queries.ts            # SQL queries (readings, buoys, stations, hourly aggregates)
├── xml.ts                # Server-side Meteoclimatic XML parser (regex)
├── logger.ts             # Colored console logger with timestamps
├── schema.sql            # Idempotent DB schema (stations, readings, buoys, alerts, alert_log)
└── meteo-ingestor.service  # systemd unit (logs → /var/log/meteo-ingestor.log)
```

## Critical Gotchas

- **Canvas overlays**: Must sit OUTSIDE `<Map>` component with `pointer-events-none`. MapLibre native layers (Satellite, Radar) go INSIDE `<Map>`.
- **IDW per-pixel `unproject()` is fatal**: Use 4-corner pre-computation + linear interpolation instead.
- **MapLibre `beforeId`**: `beforeId="base-tiles"` on raster layers hides them below base tiles. Omit it. Source/layer IDs are `base-tiles` (not `osm-tiles`) since style is now dynamic.
- **Vite HMR caching**: New `.tsx` files may require dev server restart.
- **Wind particle SPEED_SCALE**: At Galician scale (~50km viewport), use 0.0006. Values >0.001 produce unnaturally fast particles; real scale (~0.00000014) is impractical.
- **Sector switch cleanup**: `setStations([])` triggers full state reset (readings, history, sourceFreshness) + `weatherSelectionStore.resetSelection()`. Fetch flags in `useWeatherData` also reset.
- **Embalse-only features**: Thermal zones, thermal panel, sailing banner, and propagation arrows are conditionally rendered only when `activeSector.id === 'embalse'`.
- **Both-sector forecast**: `useForecastTimeline` — Auto mode reads from own API (`/api/v1/forecast`), fallback Open-Meteo. Specific models (ICON/GFS/ECMWF) use Open-Meteo direct. Coords: Embalse (42.29, -8.1), Rías (42.307, -8.619). Switches on sector change.
- **Rías-only features**: BuoyPanel (marine buoys from Puertos del Estado + Observatorio Costeiro) in Stations tab, tide predictions (IHM), surface currents overlay (RADAR ON RAIA), bathymetry overlay (EMODnet), SST overlay (CMEMS WMTS), OpenSeaMap seamarks, IHM nautical chart overlay. Rendered when `activeSector.id === 'rias'`.
- **Map style selector**: `MapStyleSelector` component with `mapStyleStore` (persisted). Nautical overlay toggles (OpenSeaMap, IHM ENC) only visible in Rías sector. IGN overlays (Ortofotos PNOA, Sombreado MDT, Curvas de nivel) available in both sectors. All raster overlays have `minzoom` optimized to avoid wasted tile requests.
- **Spot scoring**: `spotScoringEngine.ts` computes per-spot verdicts (5-level: calm/light/sailing/good/strong) from nearby station wind consensus + buoy waves. **Composite weighting**: `distance × sourceQuality × freshness`. Source quality: AEMET/MG=1.0, Meteoclimatic=0.85, WU=0.7, Netatmo/SkyX=0.6. Freshness decay: ≤5min=1.0, 10min=0.95, 20min=0.85, 30min=0.7. Buoys use freshness decay (quality=1.0, professional). `SpotScore` includes airTemp, humidity, windChill (Environment Canada formula, T<10°C), windDirDeg (for arrow display). Storm alerts ONLY from lightning-confirmed storms (not storm-shadow). `windVerdict()` uses `Math.round(spd)` to match displayed integer. Calm verdict capped at score 10. **`windCalibrationKt`**: optional per-spot offset added to consensus avg (e.g. Lourido +1kt — uses closest ría stations Pontevedra/Sanxenxo ~3km).
- **Marker z-ordering**: Spot z-25, station z-20. Station SVG `pointerEvents: none` with r=22 hit circle.
- **Sector switch guard**: `useWeatherData` captures sector ID before fetch — discards results if sector changed mid-flight.
- **Map pan optimization**: Markers `visibility: hidden` during pan. Wind particles pause `movestart→moveend`. `will-change: transform` + `contain: layout style`.
- **Mobile z-index stack**: Bottom toolbar z-40, mobile popups z-50, MapLibre popups z-30, markers z-20/25.
- **Zoom-scale markers**: Stations/buoys scale 0.45→1.0 (zoom 9.5→12). Wind arrows hidden below zoom 11.
- **FlyTo NaN guard**: `WeatherMap.tsx` validates coords with `Number.isFinite()` before `map.flyTo()`.
- **Radar**: RainViewer-only tiles (AEMET PNG removed — lag + misalignment). 2h animated, 12 frames.
- **Dark/Light theme**: `themeStore.ts` (persisted). CSS var override via `[data-theme="light"]`. Map has `.map-dark-scope` class.
- **Persisted preferences**: weatherLayerStore, uiStore, mapStyleStore, spotStore, themeStore → all via Zustand `persist` → localStorage.
- **Daily Telegram summary**: INGESTOR only (`ingestor/dailySummary.ts`). 9AM both sectors. Frontend DISABLED.
- **Spot alerts**: Frontend `spotAlertService.ts` + ingestor `alertDispatcher.ts` both detect transitions → n8n. 2h cooldown, night silence.
- **Alert classification**: Inversions, fog, cloud = `info` (blue/gris). Storms, strong wind, big waves, rain = `moderate/high/critical` (yellow/red).
- **Feedback form**: DISABLED (RGPD/bot concerns). Code preserved.
- **AEMET Radar**: Code 'ga' NEVER existed. Use `/api/red/radar/nacional` (national composite).
- **SailingWindows 429 cooldown**: Skips polls 5min after Open-Meteo 429.
- **Ingestor code sharing**: `ingestor/*.ts` CAN import from `../src/services/` and `../src/types/` (tsx resolves). NEVER duplicate utility functions — import `haversineDistance`, `msToKnots`, `degreesToCardinal` from `src/`. `windVerdict` thresholds are per-spot and MUST match frontend exactly.
- **Ingestor spot IDs**: MUST match frontend `spots.ts` IDs exactly (e.g. `centro-ria` not `ria-vigo`). Mismatch causes silent alert failures.
- **DB stations table**: `readings` has no lat/lon. Distance queries need `JOIN stations` (populated by discovery cycle).
- **LXC no journald**: Use `StandardOutput=append:/var/log/meteo-ingestor.log` in service file.
- **Production .env split**: Frontend at `/opt/MeteoMapGal/.env` (VITE_ vars). Ingestor at `/opt/MeteoMapGal/ingestor/.env` (DB, N8N webhooks, OBSCOSTEIRO key). Both needed.
- **Open-Meteo dual caller**: Frontend + ingestor both hit Open-Meteo → 429s. Auto mode uses `/api/v1/forecast` (own API). Specific models still direct.
- **n8n Telegram Base URL**: MUST be `https://api.telegram.org`. NEVER `https://t.me/...` (returns HTML page).
- **Humidity precursor (bruma pattern)**: `spotScoringEngine.ts` → `humidityPrecursorBoost()`. Uses buoy humidity (Rande for Cesantes) to detect ria thermal/bruma pattern. 96% correlation in 3-year Open-Meteo analysis. When humidity >65% + WSW direction + daytime → boost +3kt and +12pts. Rande has NO wind data — only humidity/temp/dewpoint from Observatorio Costeiro.
- **Theta-v gradient (virtual potential temperature)**: `calcThetaV()` + `computeThetaVGradient()` in spotScoringEngine. Compares marine (buoy airTemp+humidity) vs land (nearest station temp+humidity+pressure) air density. Positive gradient = virazon potential, negative = bocana/terral. Source: nicobm115/monitor approach + PhD Montero (1999).
- **Bocana detector**: theta-v < -1.5K + morning 6-11h → "Viento probable hasta ~Xh (E/NE)". Strength scales with gradient magnitude. Bocana channels through center of ria (not edges — shore stations miss it).
- **Extreme thermal detector**: T>=30C + HR<=45% + calm + 2+ stations confirming → "Dia epico: viento SW fuerte inminente". Source: 20 Aug 2011 event (La Taberna del Puerto forum, Cangas 32.6C → 30kt).
- **Thermal forecast detector (BETA)**: `thermalForecastDetector.ts` — crosses Open-Meteo forecast 12-48h ahead with thermal thresholds (temp, humidity, cloud, wind). Shows in SpotPopup, SpotSelector, Ticker, Telegram. 5-signal confidence scoring. Calibration pending April-May 2026 real data.
- **Buoy proximity boost**: Preferred buoys within 5km of a spot get 2x weight in wind consensus. Buoys measure wind ON WATER = sailor's truth. Marín (3223) is key for Lourido.
- **Wind trend detection**: `windTrendService.ts` analyzes 30min reading history for wind ramps. Signals: `building` (+3kt), `rapid` (+6kt), `dropping`. Trend label added to spot summary. `windTrendAlerts.ts` triggers alert for rapid changes → Telegram via webhook pipeline. SpotScore includes `windTrend` field.
- **Upwind propagation**: `upwindStations` config in spots.ts. When upwind stations show wind in a pattern direction but spot is calm → score +8 + "Viento detectado en costa" in summary. Only for frontal wind (NOT thermal/bruma which generates locally). Cesantes: Bouzas as upwind indicator.
- **Unified forecast**: `useSailingWindows` reuses `forecastStore` data (no duplicate Rías fetch). `thermalPrecursorService` `forecastFavorable` signal now receives real forecast data for Rías (was always 0%).
- **Buoy merge bidirectional**: `mergeBuoyReadings()` preserves ALL fields from both PORTUS + ObsCosteiro regardless of which is newer. Fixes: Rande waterTemp, humidity, dewPoint all shown. SpotScore includes `dewPoint` + `humiditySignal`.
- **Wind blacklist (35 stations)**: `WIND_BLACKLIST` in spotScoringEngine — stations with avg <1.5kt daytime excluded from wind consensus (still contribute temp/humidity). DB-validated Mar 10-25 2026. Key: wu_IVILAB5 (4km Cesantes), wu_IMARN6 (4km Lourido), 10 WU Vigo. Re-evaluate quarterly.
- **Preferred station 3x weight**: preferredStations in spots.ts get 3x boost <=2km, 2x <=5km, 1.5x beyond. Prevents distant sheltered stations diluting on-water readings. SkyX dominates Castrelo, Porto de Vigo dominates Bocana/Ría Vigo.
- **Consensus bonus +1kt**: When 3+ sources report >7kt, add +1kt to compensate land underreporting vs water.
- **Gust sanity cap**: Reject gusts >60kt or >4x average (sensor glitches like SkyX 88kt).
- **Zoom filter (markers+arrows)**: At zoom <10: hide stations <4kt. At zoom <11: hide <2kt. WindFieldOverlay synced with same thresholds. Reduces map clutter at overview zoom.
- **Wind particle zoom scaling**: `SPEED_SCALE * 2^(refZoom - currentZoom)` keeps visual velocity consistent across zoom levels. Prevents particles racing at high zoom.
- **Frontend alerts DISABLED**: `spotAlertService.ts` webhook disabled — ingestor handles 24/7 Telegram alerts. Prevents duplicate/incompatible format sends.
- **Corrientes WMS (INTECMAR)**: Server frequently offline. Not a MeteoMapGal bug — provider issue. Graceful fallback (layer simply doesn't load).

## Performance Rules

- **All polling intervals MUST use `useVisibilityPolling`**: Never use raw `setInterval` for API fetches. Background tabs must not waste network/CPU. All 9 polling intervals are visibility-aware. Exception: `AppShell.tsx` uses raw `setInterval` for non-network housekeeping (pruneHistory, pruneAlertHistory) — this is intentional.
- **New overlays MUST be toggle-guarded**: MapLibre layers should not render when their toggle is off. Use `if (!isActive) return null`.
- **New sidebar components MUST be `React.lazy`**: Any component >5KB in sidebar tabs must be lazy-loaded (8 in Sidebar + 2 in FieldDrawer already lazy: TidePanel, AtmosphericProfile).
- **Pure computation services = low impact**: Alert services that compute from existing data (no new fetches, no new intervals) are safe to add. Examples: pressureTrendService, maritimeFogService, crossSeaService.
- **Avoid adding stores to AppShell.tsx**: Already has 14 store subscriptions. Consider extracting to a dedicated hook if more are needed.
- **Canvas animation = O(1) per entity**: Wind particles use pre-computed 24×24 grid. Never do per-pixel/per-particle IDW in animation loops.
- **Bundle**: Main chunk ~379KB gzip ~122KB (optimized from 658KB: esbuild.drop console, lazy FieldDrawer+OnboardingTour, deferred GDD/teleconnections). Heavy data (aemetDailyHistory 501KB) already lazy via `import()`. Recharts (412KB) lazy via React.lazy tabs.

## Testing

```bash
npm test              # Vitest in watch mode
npx vitest run        # Single run (CI)
```

185 tests across 11 files: `normalizer.test.ts`, `windUtils.test.ts`, `alertService.test.ts`, `thermalScoringEngine.test.ts`, `toastStore.test.ts`, `csvUtils.test.ts`, `airspaceService.test.ts`, `sailingWindowService.test.ts`, `ConditionsTicker.test.tsx`, `MobileSailingBanner.test.tsx`, `Header.test.tsx`. Config in `vite.config.ts` (`test` block) with jsdom environment and `src/test/setup.ts`.

## Deployment

**Production** runs via nginx reverse proxy on a Proxmox LXC container:
1. `npm run build` produces `dist/` with hashed assets
2. Copy `dist/` to `/var/www/meteomapgal` on the LXC
3. `nginx.conf` (root of repo) provides all CORS proxy routes + SPA fallback + gzip + PWA cache headers + security blocking (dotfiles, CMS/admin paths, dangerous extensions → 444)
4. n8n webhook route (commented template in `nginx.conf`) proxies `/api/webhook/` to n8n instance for Telegram alert forwarding
5. **nginx.conf deploy is separate**: `update-meteomap` only copies `dist/`. To update nginx: `sudo cp nginx.conf /etc/nginx/sites-available/meteomapgal && nginx -t && systemctl reload nginx`
6. **Ingestor deploy**: `cd /opt/MeteoMapGal && git pull origin master && sudo systemctl restart meteo-ingestor && sudo systemctl restart meteo-api`. Logs: `tail -f /var/log/meteo-ingestor.log`
7. **Full deploy** (frontend + nginx + ingestor): `cd /opt/MeteoMapGal && git pull origin master && npm run build && cp -r dist/* /var/www/meteomapgal/ && sudo cp nginx.conf /etc/nginx/sites-available/meteomapgal && sudo nginx -t && sudo systemctl reload nginx && sudo systemctl restart meteo-ingestor && sudo systemctl restart meteo-api`
