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

- **React 18 + TypeScript + Vite 7 + Tailwind CSS 4**
- **MapLibre GL JS** (react-map-gl/maplibre) with 3D terrain
- **Zustand** for state (weatherStore, weatherLayerStore, alertStore, etc.)
- **Five data sources**: AEMET, MeteoGalicia, Meteoclimatic, Weather Underground, Netatmo
- **Multi-sector**: `sectorStore.ts` + `src/config/sectors.ts` define Embalse / Rías Baixas with independent center, radius, regions
- **Vite proxy** for CORS: `/aemet-api`, `/meteogalicia-api`, `/meteoclimatic-api`, `/meteo2api`, `/thredds-wms`

## Key Conventions

- **Internal units**: m/s for wind speed. Display in **knots (kt)** via `msToKnots()`.
- **Wind direction**: meteorological "from" convention. Arrows point "to" (add 180°).
- **Station IDs**: prefixed by source (`aemet_`, `mg_`, `mc_`, `wu_`, `nt_`).
- **Normalization**: All vendor types → `NormalizedStation` / `NormalizedReading` (see `src/services/normalizer.ts`).
- **Language**: UI in Spanish. Git commits in English.
- **AEMET `dir` field**: In **decadegrees** (0-36), NOT real degrees. Multiply by 10. `dir=99` = variable, `dir=0` = calm.

## Project Structure

```
src/
├── api/              # API clients (AEMET, MeteoGalicia, Meteoclimatic, WU, Netatmo, WRF, lightning)
├── components/
│   ├── common/       # Shared UI (LoadingSpinner, KeyboardShortcutHelp, SourceStatusIndicator)
│   ├── dashboard/    # Sidebar components (StationCard, StationTable, TimeSeriesChart)
│   ├── layout/       # AppShell, Header, Sidebar, FieldDrawer
│   └── map/          # MapLibre overlays (Wind, Humidity, WRF, Lightning, Markers)
├── config/           # Constants, thermal zones, source config
├── hooks/            # useWeatherData, useThermalAnalysis, useLightningData, useForecastTimeline
├── services/         # Business logic (see src/services/CLAUDE.md)
├── store/            # Zustand stores
└── types/            # TypeScript types
```

## Critical Gotchas

- **Canvas overlays**: Must sit OUTSIDE `<Map>` component with `pointer-events-none`. MapLibre native layers (WRF raster) go INSIDE `<Map>`.
- **IDW per-pixel `unproject()` is fatal**: Use 4-corner pre-computation + linear interpolation instead.
- **WRF WMS styles**: Only `boxfill/rainbow` works. `default-scalar/precip` returns HTTP 400.
- **MapLibre `beforeId`**: `beforeId="osm-tiles"` on raster layers hides them below base tiles. Omit it.
- **Vite HMR caching**: New `.tsx` files may require dev server restart.
- **Wind particle SPEED_SCALE**: At Galician scale (~50km viewport), use 0.0015. Values <0.001 produce invisible sub-pixel movement.
- **Sector switch cleanup**: `setStations([])` triggers full state reset (readings, history, selections, sourceFreshness). Fetch flags in `useWeatherData` also reset.
- **Embalse-only features**: Thermal zones, forecast timeline, thermal panel, sailing banner, and propagation arrows are conditionally rendered only when `activeSector.id === 'embalse'`.
