# Services — Business Logic Layer

Pure functions and algorithms used across the app. No React dependencies.

## Wind & Weather

- **`windUtils.ts`** — `msToKnots()`, `windSpeedColor()` (Beaufort scale), `degreesToCardinal()`. All wind display formatting. Also includes `formatPressure()`, `formatDewPoint()`, `pressureColor()`, `dewPointSpreadColor()` for barometric and moisture display.
- **`normalizer.ts`** — Converts vendor-specific API responses to `NormalizedStation`/`NormalizedReading`. AEMET `dir` field is in decadegrees (multiply by 10).
- **`idwInterpolation.ts`** — Inverse Distance Weighting for wind vectors and scalar fields (humidity). `fastDistanceKm()` uses equirectangular approximation (~100x faster than haversine). Shared by WindParticleOverlay and HumidityHeatmapOverlay. **Freshness decay**: IDW weights include `freshness` multiplier (1.0→0.7) based on reading age — recent readings contribute more.
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
- **`maritimeFogService.ts`** — Advection fog predictor for Rías. Uses buoy SST vs air temp delta, coastal humidity, wind direction, **solar radiation suppression** (≥250 W/m² daytime = fog cleared), **N/NE wind exclusion** (continental dry air kills fog). Pure computation — no new fetches.
- **`crossSeaService.ts`** — Cross-sea risk from wave-wind angular divergence >45°. Uses buoy waveDir vs windDir. **Wave period (Tp)**: ≥8s swell escalates risk, <4s wind-sea downgrades. Wave height amplification for severity. Pure computation.
- **`upwellingService.ts`** — Galician coastal upwelling detector. N/NW wind ≥12kt for ≥6h → Ekman transport → cold deep water rises. Uses buoy SST history buffer (24h, accumulated in `buoyStore`). Thresholds: SST drop ≥1.5°C moderate, ≥2.5°C high, ≥4.0°C critical. Wind confirmation boosts confidence. Pure computation — no extra API calls.

## Sailing & Spots

- **`spotScoringEngine.ts`** — Per-spot wind verdict scoring (5-level: calm/light/sailing/good/strong). Composite weighting: distance x sourceQuality x freshness. Includes airTemp, humidity, windChill (Environment Canada), windDirDeg. Storm alerts ONLY from lightning-confirmed storms.
- **`sailingWindowService.ts`** — Best Sailing Window: scores 48h forecast per-spot, groups contiguous good hours into `SailingWindow[]`. Dual scoring: thermal-dominant (Embalse) via `scoreForecastThermal()`, wind-dominant (Rías) with direction/speed curves. Min 2h window, 1h merge gap.
- **`buoyUtils.ts`** — Marine buoy color scales (wave height, temperature, period). Single source of truth for shared color functions.

## Forecast & History
- **`forecastDeltaService.ts`** — Compares Open-Meteo forecast to live station readings: wind (kt), temp (°C) deltas. `findNearestForecastHour()` aligns within ±90min. `formatWindDelta()`/`formatTempDelta()` return colored badge data. Used by StationCard.
- **`forecastVerificationService.ts`** — "¿Acertó la previsión?": fetches past Open-Meteo forecasts via Previous Runs API, compares with TimescaleDB hourly observations. Computes MAE, bias, accuracy rate (wind ±3kt, temp ±2°C). No backend changes needed.
- **`forecastScoringUtils.ts`** — Scores forecast hours for sailing conditions. Exports `ForecastBreakdown` type with per-component scores (temp, hour, month, humidity, direction, wind speed) + multipliers. `scoreForecastThermalWithBreakdown()` returns breakdown for tooltip display in ForecastTimeline.
- **`inversionForecastService.ts`** — Predicts temperature inversions from forecast data.
- **`dewPointService.ts`** — Dew point calculation and fog probability estimation. **Forecast visibility cross-validation**: Open-Meteo visibility <1km reinforces fog, >10km suppresses. Continental wind + solar suppression built in.
- **`solarUtils.ts`** — Sunrise/sunset times for the region.
- **`aemetHistoryParser.ts`** — Parses AEMET daily historical JSON data.
- **`bestDaysSearch.ts`** — Finds best historical sailing days from AEMET records.

## Agriculture

- **`gddService.ts`** — Growing Degree Days (GDD) for Vitis vinifera. `dailyGDD()` formula (base 10°C), `fetchSeasonGDD()` via Open-Meteo archive API (session-cached 1h), `computeTodayGDD()` from forecast, `getGrowthStage()` returns 9 phenological stages calibrated for Galician viticulture (Latencia → Vendimia). Season starts March 1.
- **`lunarService.ts`** — Lunar phase calculation (Jean Meeus algorithm). 8 phases in Spanish, illumination %, moon age, next phase ETA, agricultural recommendations for Galician crops. Pure algorithmic — no API calls.

## Thermal Early Warning

- **`thermalPrecursorService.ts`** — Detects 6 precursor signals for thermal wind from existing data: morning terral (25%), ΔT water-air from buoy (20%), solar ramp (20%), humidity gradient coast-inland (15%), cross-station wind divergence (10%), forecast favorable (10%). Returns probability 0-100%, confidence, ETA, signal breakdown. Pure computation — no new API calls. Spot-agnostic via `thermalDetection: true`.
- **`thermalVerificationService.ts`** — Logs thermal precursor predictions vs actual outcomes to localStorage. Computes hit/miss/false-alarm accuracy over 30 days. Analogous to forecastVerificationService. Tracks prediction lead time, hit rate, false alarm rate.

## Webcam Vision

- **`webcamVisionService.ts`** — Beaufort estimation from webcam images via LLM Vision API (OpenAI-compatible). Provider-agnostic: supports LM Studio (dev), DeepSeek API (prod cheap), Ollama (prod free). Fetches image → base64 → vision API → parses JSON response → Beaufort 0-7 + confidence + description. Config via `VITE_VISION_*` env vars. Only processes `type: 'image'` webcams (direct URL). Disabled by default (`VITE_VISION_ENABLED=false`).

## Data Logging

- **`stationDataLogger.ts`** — Logs readings to localStorage as CSV. Uses `csvUtils` for safe escaping.
- **`csvUtils.ts`** — CSV injection defense: escapes `=`, `+`, `-`, `@` prefixes and handles quoting.
- **`tendencyDetector.ts`** — Detects rising/falling/stable trends in time series data.

## Testing

Test files live alongside their source (`*.test.ts`). 185 tests across 11 files: `normalizer`, `windUtils`, `alertService`, `thermalScoringEngine`, `toastStore`, `csvUtils`, `airspaceService`, `sailingWindowService`, `ConditionsTicker`, `MobileSailingBanner`, `Header`. Run with `npm test` (Vitest).
