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
- **n8n webhook**: `src/api/webhookClient.ts` posts alerts, daily summaries, and user feedback to n8n for Telegram (non-critical, fails silently). Endpoints: `meteomap-alert`, `meteomap-summary`, `meteomap-feedback`
- **Vite proxy** for CORS (17 routes): `/aemet-api`, `/aemet-data`, `/meteogalicia-api`, `/meteoclimatic-api`, `/netatmo-api`, `/netatmo-auth`, `/meteo2api`, `/ideg-api`, `/enaire-api`, `/ihm-api`, `/eumetsat-api`, `/portus-api`, `/obscosteiro-api`, `/hfradar-api`, `/skyx-api`, `/noaa-api`, `/api/v1` (history)
- **Production deployment**: nginx reverse proxy (`nginx.conf`) to Proxmox LXC, mirrors all Vite proxy routes
- **TimescaleDB ingestor**: `ingestor/` — standalone Node.js service polling 5 sources every 5min → TimescaleDB. Runs as `meteo-ingestor.service` (systemd) on LXC 305. Reuses `normalizer.ts` + `geoUtils.ts` from `src/`

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
- **Sector switch cleanup**: `setStations([])` triggers full state reset (readings, history, sourceFreshness) + `weatherSelectionStore.resetSelection()`. Fetch flags in `useWeatherData` also reset.
- **Embalse-only features**: Thermal zones, thermal panel, sailing banner, and propagation arrows are conditionally rendered only when `activeSector.id === 'embalse'`.
- **Both-sector forecast**: `useForecastTimeline` fetches Open-Meteo forecast for both Embalse (42.29, -8.1) and Rías (42.307, -8.619). Forecast tab visible in both sectors. Coordinates switch automatically on sector change.
- **Rías-only features**: BuoyPanel (marine buoys from Puertos del Estado + Observatorio Costeiro) in Stations tab, tide predictions (IHM), surface currents overlay (RADAR ON RAIA), bathymetry overlay (EMODnet), SST overlay (CMEMS WMTS), OpenSeaMap seamarks, IHM nautical chart overlay. Rendered when `activeSector.id === 'rias'`.
- **Map style selector**: `MapStyleSelector` component with `mapStyleStore` (persisted). Nautical overlay toggles (OpenSeaMap, IHM ENC) only visible in Rías sector. IGN overlays (Ortofotos PNOA, Sombreado MDT, Curvas de nivel) available in both sectors. All raster overlays have `minzoom` optimized to avoid wasted tile requests.
- **Spot scoring**: `spotScoringEngine.ts` computes per-spot verdicts (5-level: calm/light/sailing/good/strong) from nearby station wind consensus + buoy waves. **Composite weighting**: `distance × sourceQuality × freshness`. Source quality: AEMET/MG=1.0, Meteoclimatic=0.85, WU=0.7, Netatmo/SkyX=0.6. Freshness decay: ≤5min=1.0, 10min=0.95, 20min=0.85, 30min=0.7. Buoys use freshness decay (quality=1.0, professional). `SpotScore` includes airTemp, humidity, windChill (Environment Canada formula, T<10°C), windDirDeg (for arrow display). Storm alerts ONLY from lightning-confirmed storms (not storm-shadow). `windVerdict()` uses `Math.round(spd)` to match displayed integer. Calm verdict capped at score 10. **`windCalibrationKt`**: optional per-spot offset added to consensus avg (e.g. Lourido +1kt — uses closest ría stations Pontevedra/Sanxenxo ~3km).
- **Spot webcams**: `SpotWebcam` config in `spots.ts`. Phase 1: Cíes-Ría (MeteoGalicia JPG, auto-refresh) + Cesantes (tmkites stream link). Collapsible section in `SpotPopup.tsx`.
- **Marker z-ordering**: Spot markers z-index 25 (CSS `:has(.spot-marker)`), station markers z-index 20. Station SVG `pointerEvents: none` with r=22 hit circle to avoid blocking spots.
- **Both-sector features**: CriticalAlertBanner (top-of-screen PELIGRO banner), AlertPanel, spot-based sailing scoring, DistanceTool (nautical miles measurement).
- **Onboarding tour**: `OnboardingTour.tsx` — 5-step first-visit walkthrough with element highlighting (pulsing ring via `data-tour` attributes). Persisted via Zustand → localStorage (`meteomap-ui`). Auto-launches 3s after first load.
- **Geolocation auto-sector**: `geolocationService.ts` — detects user location on first visit, switches to nearest sector within 80km. Runs once per device (localStorage flag).
- **Daily Telegram summary**: `dailySummaryService.ts` — sends morning sailing briefing at 8:00 AM via n8n webhook. Collects spots, alerts, best sailing window.
- **Proactive spot alerts**: `spotAlertService.ts` — detects verdict transitions (calm/light → sailing/good/strong), posts to n8n webhook for Telegram. 2h cooldown per spot, night silence, sector-switch reset.
- **GeoJSON export**: `exportService.ts` — downloads current station + buoy data as GeoJSON FeatureCollection. Button in sidebar footer.
- **Embeddable widget**: `widget.html` + `src/widget/` — separate Vite entry point for iframe embed. Params: `spot`, `sector`, `theme` (dark/light), `compact`. Self-contained data fetch (no AppShell dependency), 5min auto-refresh. Multi-page build via `rollupOptions.input`.
- **Sector switch guard**: `useWeatherData` captures sector ID before fetch — discards results if sector changed mid-flight (prevents stale data injection).
- **Wind sparkline in popups**: `StationPopup` shows 40×14px SVG trend line (last 12 readings) + ↑↓→ arrow indicator.
- **Favorite spots**: Star ★ button in `SpotPopup` + `SpotSelector` header. Persisted in `spotStore` → localStorage.
- **Share conditions**: Web Share API in `SpotPopup` — shares spot name, wind, verdict, temp. Falls back to clipboard.
- **Feedback form**: `FeedbackModal.tsx` — DISABLED (RGPD/bot concerns). Code preserved, import commented out in AppShell. Sidebar button removed. To re-enable: uncomment lazy import + render in AppShell, re-add button in Sidebar footer.
- **Ko-fi donations**: SVG cup icon (no emoji). Prominent card in MeteoGuide sidebar + link in main sidebar footer.
- **Zoom-scale markers**: Stations/buoys scale 0.45→1.0 (zoom 9.5→12). Spots always 100%. Wind arrows hidden below zoom 11.
- **Header visual hierarchy**: 3-tier design — nav buttons (hamburger/guide) transparent, sector buttons blue glow when active + dashed when inactive, Panel button color-coded by alert level.
- **Map pan optimization**: `will-change: transform` + `contain: layout style` on marker containers. Markers `visibility: hidden` during pan (freed from GPU compositor). Wind particles pause during `movestart→moveend`. All marker transitions killed during pan.
- **Mobile z-index stack**: Bottom toolbar = z-40. Mobile bottom sheets (Spot/Station/Buoy popups) = z-50. MapLibre popups = z-30. Markers = z-20/25.
- **Distance tool**: `DistanceTool.tsx` — click-to-measure in nautical miles + km + bearing. Dashed amber line + midpoint label. Toggle in bottom toolbar. Escape to cancel.
- **Typed selectors**: `typedSelectors.ts` — `useMaxAlertLevel()`, `useActiveAlerts()`, `useStationCount()`, `useWeatherSelection()` computed selectors to avoid inline re-derivation.
- **weatherSelectionStore**: Split from weatherStore (R1). UI selection state (selectedStationId, highlightedStationId, chartSelectedStations) lives here. weatherStore is data-only.
- **Alert service modular**: `src/services/alerts/` — split from 626-line monolith into 7 files: types, riskEngine, stormAlerts, thermalAlerts, fieldAlerts, aggregator, index. Original `alertService.ts` is now a 20-line re-export barrel.
- **Typed Portus**: `PortusStationResponse`, `PortusDatoEntry`, `PortusLastDataResponse` interfaces replace `any[]` in buoyClient.
- **Persisted preferences**: `weatherLayerStore` persists activeLayer + opacity. `uiStore` persists bathymetry/SST toggles. `mapStyleStore` persists base map + overlays. `spotStore` persists favorites. `themeStore` persists dark/light mode. All via Zustand `persist` middleware → localStorage.
- **AEMET Radar**: Code 'ga' NEVER existed. Galicia radar = Cerceda (A Coruña), NOT Cuntis. Use `/api/red/radar/nacional` (national composite). Regional endpoint returns 404.
- **Source status banner**: `SourceStatusBanner.tsx` — amber warning bar below header when critical sources (AEMET/MG) are down >10min. Auto-dismisses on recovery. Dismissible by user. `role="alert"` + `aria-live="polite"`.
- **Skip-to-content**: `<a href="#main-map">` in AppShell — `sr-only` until keyboard-focused, then visible at z-60.
- **Keyboard accessibility**: All interactive `<div>`s have `onKeyDown` (Enter/Space), `tabIndex`, `role="button"`. Backdrop overlays have Escape handlers.
- **FlyTo NaN guard**: `WeatherMap.tsx` validates `flyToTarget` coords with `Number.isFinite()` before `map.flyTo()`. Popup render also guarded against invalid `activeSpot.center`.
- **SailingWindows rate limit cooldown**: `useSailingWindows.ts` skips polls for 5min after Open-Meteo 429. Prevents error log spam in console.
- **Radar animation**: `RadarOverlay.tsx` dual mode — static (AEMET national composite) + animated (RainViewer past 2h, 12 frames). `rainviewerClient.ts` fetches frame list from public API (no key). Animation controls: play/pause, frame slider, timestamp. RainViewer tiles max zoom 7 (upscaled beyond). Toggle button over map.
- **Dark/Light theme**: `themeStore.ts` (persisted). Overrides Tailwind v4 `--color-slate-*` CSS variables via `[data-theme="light"]` on `<html>`. Also overrides `--color-white` for text inversion. Map container has `.map-dark-scope` class that restores dark palette for all map overlays. Toggle button (sun/moon) in Header.
- **Humidity precursor (bruma pattern)**: `spotScoringEngine.ts` → `humidityPrecursorBoost()`. Uses buoy humidity (Rande for Cesantes) to detect ría thermal/bruma pattern. 96% correlation in 3-year Open-Meteo analysis. When humidity >65% + WSW direction + daytime → boost +3kt and +12pts. Rande has NO wind data — only humidity/temp/dewpoint from Observatorio Costeiro.
- **Buoy proximity boost**: Preferred buoys within 5km of a spot get 2x weight in wind consensus. Buoys measure wind ON WATER = sailor's truth. Marín (3223) is key for Lourido.
- **Wind trend detection**: `windTrendService.ts` analyzes 30min reading history for wind ramps. Signals: `building` (+3kt), `rapid` (+6kt), `dropping`. Trend label added to spot summary. `windTrendAlerts.ts` triggers alert for rapid changes → Telegram via webhook pipeline. SpotScore includes `windTrend` field.
- **Upwind propagation**: `upwindStations` config in spots.ts. When upwind stations show wind in a pattern direction but spot is calm → score +8 + "Viento detectado en costa" in summary. Only for frontal wind (NOT thermal/bruma which generates locally). Cesantes: Bouzas as upwind indicator.
- **Unified forecast**: `useSailingWindows` reuses `forecastStore` data (no duplicate Rías fetch). `thermalPrecursorService` `forecastFavorable` signal now receives real forecast data for Rías (was always 0%).
- **Buoy merge bidirectional**: `mergeBuoyReadings()` preserves ALL fields from both PORTUS + ObsCosteiro regardless of which is newer. Fixes: Rande waterTemp, humidity, dewPoint all shown. SpotScore includes `dewPoint` + `humiditySignal`.

## Performance Rules

- **All polling intervals MUST use `useVisibilityPolling`**: Never use raw `setInterval` for API fetches. Background tabs must not waste network/CPU. All 9 polling intervals are visibility-aware. Exception: `AppShell.tsx` uses raw `setInterval` for non-network housekeeping (pruneHistory, pruneAlertHistory) — this is intentional.
- **New overlays MUST be toggle-guarded**: MapLibre layers should not render when their toggle is off. Use `if (!isActive) return null`.
- **New sidebar components MUST be `React.lazy`**: Any component >5KB in sidebar tabs must be lazy-loaded (8 in Sidebar + 2 in FieldDrawer already lazy: TidePanel, AtmosphericProfile).
- **Pure computation services = low impact**: Alert services that compute from existing data (no new fetches, no new intervals) are safe to add. Examples: pressureTrendService, maritimeFogService, crossSeaService.
- **Avoid adding stores to AppShell.tsx**: Already has 14 store subscriptions. Consider extracting to a dedicated hook if more are needed.
- **Canvas animation = O(1) per entity**: Wind particles use pre-computed 24×24 grid. Never do per-pixel/per-particle IDW in animation loops.
- **Bundle**: Main chunk ~658KB gzip 210KB. Heavy data (aemetDailyHistory 501KB) already lazy via `import()`. Recharts (412KB) lazy via React.lazy tabs.

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
5. **nginx.conf deploy is separate**: `update-meteomap` only copies `dist/`. To update nginx: `curl -o /etc/nginx/sites-available/meteomapgal https://raw.githubusercontent.com/Bateas/MeteoMapGal/master/nginx.conf && nginx -t && systemctl reload nginx`
