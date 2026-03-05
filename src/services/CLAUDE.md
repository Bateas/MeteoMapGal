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

## Forecast & History

- **`forecastScoringUtils.ts`** — Scores forecast hours for sailing conditions.
- **`inversionForecastService.ts`** — Predicts temperature inversions from forecast data.
- **`dewPointService.ts`** — Dew point calculation and fog probability estimation.
- **`solarUtils.ts`** — Sunrise/sunset times for the region.
- **`aemetHistoryParser.ts`** — Parses AEMET daily historical JSON data.
- **`bestDaysSearch.ts`** — Finds best historical sailing days from AEMET records.

## Data Logging

- **`stationDataLogger.ts`** — Logs readings to localStorage as CSV. Includes CSV injection defense (escapes `=`, `+`, `-`, `@` prefixes).
- **`tendencyDetector.ts`** — Detects rising/falling/stable trends in time series data.

## Testing

Test files live alongside their source (`*.test.ts`). Currently tested: `normalizer`, `windUtils`, `alertService`, `thermalScoringEngine`, `toastStore`. Run with `npm test` (Vitest).
