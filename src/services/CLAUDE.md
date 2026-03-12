# Services — Business Logic Layer

Pure functions and algorithms used across the app. No React dependencies.

## Wind & Weather

- **`windUtils.ts`** — `msToKnots()`, `windSpeedColor()` (Beaufort scale), `degreesToCardinal()`. All wind display formatting. Also includes `formatPressure()`, `formatDewPoint()`, `pressureColor()`, `dewPointSpreadColor()` for barometric and moisture display.
- **`normalizer.ts`** — Converts vendor-specific API responses to `NormalizedStation`/`NormalizedReading`. AEMET `dir` field is in decadegrees (multiply by 10).
- **`idwInterpolation.ts`** — Inverse Distance Weighting for wind vectors and scalar fields (humidity). `fastDistanceKm()` uses equirectangular approximation (~100x faster than haversine). Shared by WindParticleOverlay and HumidityHeatmapOverlay.
- **`geoUtils.ts`** — `isWithinRadius()` for station discovery filtering.

## Thermal Analysis

- **`thermalScoringEngine.ts`** — Scores thermal wind probability from real-time station data. Rules derived from AEMET historical analysis (1412 records). Key thresholds: HR 45-65% sweet spot, HR >75% kills thermal, Tmax >31°C boosts probability.
- **`humidityWindAnalyzer.ts`** — Cross-station humidity-wind correlation analysis.
- **`windPropagationDetector.ts`** — Detects thermal wind propagation patterns across station network (e.g., Ribadavia SW → Ourense W → Carballiño NW).
- **`windPropagationService.ts`** — Higher-level service wrapping propagation detection with scoring.
- **`lapseRateService.ts`** — Computes temperature lapse rate from stations at different altitudes. Used for thermal gradient overlay on map.

## Alert Systems

- **`fieldAlertEngine.ts`** — Agricultural alert checks: frost (helada), rain, fog/dew, wind propagation. Returns severity levels (none/low/medium/high/critical).
- **`alertService.ts`** — `aggregateAllAlerts()` merges storm alerts, thermal profile, zone alerts, field alerts, and forecast into unified risk level.
- **`notificationService.ts`** — Browser push notifications + audio alerts for escalated alerts.
- **`stormTracker.ts`** — Lightning proximity analysis: danger <10km, warning <25km, watch <50km from reservoir center.
- **`stormShadowDetector.ts`** — Detects storm cloud presence by analyzing solar radiation drops across stations, cross-referenced with lightning data and wind anomalies (gust fronts). Estimates storm position, movement vector, and approach to Castrelo.
- **`airspaceService.ts`** — Evaluates drone flight restrictions: ENAIRE UAS zones + active NOTAMs for sector center. Used by FieldDrawer Dron panel.
- **`pressureTrendService.ts`** — 3h barometric pressure trend detection across stations. Consensus-based rapid drop/rise alerts. Pure computation on existing readings.
- **`maritimeFogService.ts`** — Advection fog predictor for Rías. Uses buoy SST vs air temp delta, coastal humidity, wind direction, **solar radiation suppression** (≥250 W/m² daytime = fog cleared). Pure computation — no new fetches.
- **`crossSeaService.ts`** — Cross-sea risk from wave-wind angular divergence >45°. Uses buoy waveDir vs windDir. Wave height amplification for severity. Pure computation.

## Forecast & History

- **`forecastScoringUtils.ts`** — Scores forecast hours for sailing conditions.
- **`inversionForecastService.ts`** — Predicts temperature inversions from forecast data.
- **`dewPointService.ts`** — Dew point calculation and fog probability estimation.
- **`solarUtils.ts`** — Sunrise/sunset times for the region.
- **`aemetHistoryParser.ts`** — Parses AEMET daily historical JSON data.
- **`bestDaysSearch.ts`** — Finds best historical sailing days from AEMET records.

## Agriculture

- **`gddService.ts`** — Growing Degree Days (GDD) for Vitis vinifera. `dailyGDD()` formula (base 10°C), `fetchSeasonGDD()` via Open-Meteo archive API (session-cached 1h), `computeTodayGDD()` from forecast, `getGrowthStage()` returns 9 phenological stages calibrated for Galician viticulture (Latencia → Vendimia). Season starts March 1.
- **`lunarService.ts`** — Lunar phase calculation (Jean Meeus algorithm). 8 phases in Spanish, illumination %, moon age, next phase ETA, agricultural recommendations for Galician crops. Pure algorithmic — no API calls.

## Data Logging

- **`stationDataLogger.ts`** — Logs readings to localStorage as CSV. Uses `csvUtils` for safe escaping.
- **`csvUtils.ts`** — CSV injection defense: escapes `=`, `+`, `-`, `@` prefixes and handles quoting.
- **`tendencyDetector.ts`** — Detects rising/falling/stable trends in time series data.

## Testing

Test files live alongside their source (`*.test.ts`). Currently tested: `normalizer`, `windUtils`, `alertService`, `thermalScoringEngine`, `toastStore`, `csvUtils`, `airspaceService`. Run with `npm test` (Vitest).
