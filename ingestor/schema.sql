-- MeteoMapGal — TimescaleDB Schema (idempotent)
-- Run: psql -h REDACTED_DB_HOST -U meteomap_app -d meteomapgal -f schema.sql

-- ── Readings hypertable ──────────────────────────────
CREATE TABLE IF NOT EXISTS readings (
  time        TIMESTAMPTZ     NOT NULL,
  station_id  TEXT            NOT NULL,
  source      TEXT            NOT NULL,
  temperature DOUBLE PRECISION,
  humidity    DOUBLE PRECISION,
  wind_speed  DOUBLE PRECISION,
  wind_gust   DOUBLE PRECISION,
  wind_dir    DOUBLE PRECISION,
  pressure    DOUBLE PRECISION,
  dew_point   DOUBLE PRECISION,
  precip      DOUBLE PRECISION,
  solar_rad   DOUBLE PRECISION,
  visibility  DOUBLE PRECISION  -- km, only ~8 AEMET airport stations report it
);

SELECT create_hypertable('readings', 'time', if_not_exists => TRUE);

-- Idempotent column add for already-deployed databases (no-op if column exists)
ALTER TABLE readings ADD COLUMN IF NOT EXISTS visibility DOUBLE PRECISION;

-- Unique constraint for dedup (ON CONFLICT DO NOTHING)
CREATE UNIQUE INDEX IF NOT EXISTS readings_time_station_idx
  ON readings (time, station_id);

-- Source index for per-source queries
CREATE INDEX IF NOT EXISTS readings_source_idx
  ON readings (source, time DESC);

-- Station index for per-station history
CREATE INDEX IF NOT EXISTS readings_station_idx
  ON readings (station_id, time DESC);

-- ── Station metadata (coordinates, source, altitude) ─
-- Updated on each discovery cycle (upsert).
CREATE TABLE IF NOT EXISTS stations (
  station_id  TEXT            PRIMARY KEY,
  source      TEXT            NOT NULL,
  name        TEXT,
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  altitude    DOUBLE PRECISION,
  updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stations_source_idx
  ON stations (source);

-- Spatial-ish index for distance queries (lat/lon range)
CREATE INDEX IF NOT EXISTS stations_coords_idx
  ON stations (latitude, longitude);

-- ── Alerts hypertable ────────────────────────────────
-- ⚠️ RESERVED / NOT WIRED (S136+3+5 audit): no writer or reader anywhere
-- in ingestor or frontend. Designed for alert persistence but the pipeline
-- dispatches via webhook (alertDispatcher) without DB logging. Kept empty
-- intentionally — do NOT re-flag as "dead" without deciding to build the
-- alert-history feature. DROP only after confirming the feature is abandoned.
CREATE TABLE IF NOT EXISTS alerts (
  time      TIMESTAMPTZ NOT NULL,
  alert_id  TEXT        NOT NULL,
  category  TEXT        NOT NULL,
  severity  TEXT        NOT NULL,
  title     TEXT        NOT NULL,
  detail    TEXT,
  score     DOUBLE PRECISION,
  sector    TEXT
);

SELECT create_hypertable('alerts', 'time', if_not_exists => TRUE);

CREATE UNIQUE INDEX IF NOT EXISTS alerts_time_id_idx
  ON alerts (time, alert_id);

-- ── Hourly continuous aggregate ──────────────────────
-- Note: CREATE MATERIALIZED VIEW ... IF NOT EXISTS is supported in TS 2.x
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates
    WHERE view_name = 'readings_hourly'
  ) THEN
    EXECUTE '
      CREATE MATERIALIZED VIEW readings_hourly
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket(''1 hour'', time) AS bucket,
        station_id,
        source,
        AVG(temperature)  AS avg_temp,
        AVG(humidity)     AS avg_humidity,
        AVG(wind_speed)   AS avg_wind,
        MAX(wind_gust)    AS max_gust,
        AVG(pressure)     AS avg_pressure,
        SUM(precip)       AS total_precip
      FROM readings
      GROUP BY bucket, station_id, source
      WITH NO DATA
    ';
  END IF;
END $$;

-- ── Buoy readings hypertable ───────────────────────────
CREATE TABLE IF NOT EXISTS buoy_readings (
  time             TIMESTAMPTZ      NOT NULL,
  station_id       INTEGER          NOT NULL,
  station_name     TEXT             NOT NULL,
  source           TEXT             NOT NULL,  -- 'portus' or 'obscosteiro'
  -- Wave
  wave_height      DOUBLE PRECISION,  -- Hm0 (m)
  wave_height_max  DOUBLE PRECISION,  -- Hmax (m)
  wave_period      DOUBLE PRECISION,  -- Tp (s)
  wave_period_mean DOUBLE PRECISION,  -- Tm02 (s)
  wave_dir         DOUBLE PRECISION,  -- MeanDir (deg)
  -- Wind
  wind_speed       DOUBLE PRECISION,  -- m/s
  wind_dir         DOUBLE PRECISION,  -- deg (from)
  wind_gust        DOUBLE PRECISION,  -- m/s
  -- Temperature
  water_temp       DOUBLE PRECISION,  -- °C
  air_temp         DOUBLE PRECISION,  -- °C
  -- Pressure
  air_pressure     DOUBLE PRECISION,  -- hPa
  -- Currents
  current_speed    DOUBLE PRECISION,  -- m/s
  current_dir      DOUBLE PRECISION,  -- deg
  -- Salinity
  salinity         DOUBLE PRECISION,  -- PSU
  -- Sea level
  sea_level        DOUBLE PRECISION,  -- cm
  -- Observatorio Costeiro extras
  humidity         DOUBLE PRECISION,  -- %
  dew_point        DOUBLE PRECISION   -- °C
);

SELECT create_hypertable('buoy_readings', 'time', if_not_exists => TRUE);

-- Unique constraint for dedup
CREATE UNIQUE INDEX IF NOT EXISTS buoy_readings_time_station_idx
  ON buoy_readings (time, station_id);

-- Station index for per-station history
CREATE INDEX IF NOT EXISTS buoy_readings_station_idx
  ON buoy_readings (station_id, time DESC);

-- Source index
CREATE INDEX IF NOT EXISTS buoy_readings_source_idx
  ON buoy_readings (source, time DESC);

-- ── Buoy hourly continuous aggregate ───────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates
    WHERE view_name = 'buoy_readings_hourly'
  ) THEN
    EXECUTE '
      CREATE MATERIALIZED VIEW buoy_readings_hourly
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket(''1 hour'', time) AS bucket,
        station_id,
        source,
        AVG(wave_height)   AS avg_wave_height,
        MAX(wave_height)   AS max_wave_height,
        AVG(wave_period)   AS avg_wave_period,
        AVG(wind_speed)    AS avg_wind,
        MAX(wind_gust)     AS max_gust,
        AVG(water_temp)    AS avg_water_temp,
        AVG(air_temp)      AS avg_air_temp,
        AVG(air_pressure)  AS avg_pressure,
        AVG(current_speed) AS avg_current,
        AVG(humidity)      AS avg_humidity,
        AVG(sea_level)     AS avg_sea_level
      FROM buoy_readings
      GROUP BY bucket, station_id, source
      WITH NO DATA
    ';
  END IF;
END $$;

-- ── Alert evaluation log (for validation & calibration) ──
-- ⚠️ RESERVED / NOT WIRED (S136+3+5 audit): no writer or reader yet. Designed
-- for the alert thumbs-up/down validation feature (analogous to
-- prediction_outcomes for storms) but never built. Kept empty intentionally.
-- Records every alert evaluation with input parameters so the user
-- can validate (thumbs up/down) and we can measure accuracy over time.
CREATE TABLE IF NOT EXISTS alert_log (
  time          TIMESTAMPTZ      NOT NULL,
  alert_type    TEXT             NOT NULL,  -- 'maritime-fog', 'radiative-fog', 'cross-sea', 'frost', 'inversion', 'storm', 'pressure-drop', 'thermal'
  sector        TEXT             NOT NULL,  -- 'embalse' or 'rias'
  level         TEXT             NOT NULL,  -- 'none', 'riesgo', 'alto', 'critico'
  score         DOUBLE PRECISION,           -- 0-100 confidence/score
  -- Key input parameters (JSONB for flexibility across alert types)
  params        JSONB,                      -- e.g. {"delta_t": 2.1, "humidity": 88, "wind_dir": 210, "solar_rad": 45}
  hypothesis    TEXT,                       -- Human-readable hypothesis text
  -- User validation (null = not yet validated)
  validated     BOOLEAN,                    -- true = correct alert, false = false positive/negative
  validated_at  TIMESTAMPTZ,                -- when the user validated
  user_notes    TEXT                        -- optional user feedback
);

SELECT create_hypertable('alert_log', 'time', if_not_exists => TRUE);

-- Index for querying by alert type + validation status
CREATE INDEX IF NOT EXISTS alert_log_type_idx
  ON alert_log (alert_type, time DESC);

-- Index for finding unvalidated alerts
CREATE INDEX IF NOT EXISTS alert_log_unvalidated_idx
  ON alert_log (validated, time DESC)
  WHERE validated IS NULL;

-- ── Compression (uncomment after data starts flowing) ─
-- ALTER TABLE readings SET (
--   timescaledb.compress,
--   timescaledb.compress_segmentby = 'station_id,source'
-- );
-- SELECT add_compression_policy('readings', INTERVAL '7 days', if_not_exists => TRUE);

-- ── Webcam vision readings ──────────────────────────
CREATE TABLE IF NOT EXISTS webcam_readings (
  time        TIMESTAMPTZ     NOT NULL,
  webcam_id   TEXT            NOT NULL,
  spot_id     TEXT,
  beaufort    INTEGER,
  confidence  TEXT,
  fog         BOOLEAN         DEFAULT FALSE,
  visibility  TEXT,
  sky         TEXT,
  description TEXT,
  provider    TEXT,
  latency_ms  INTEGER,
  PRIMARY KEY (time, webcam_id)
);
SELECT create_hypertable('webcam_readings', 'time', if_not_exists => TRUE);

-- ── Storm predictions hypertable ────────────────────────
-- Frontend sends prediction snapshots every 5min when prob > 0 or lightning active.
-- Used for ML calibration of signal weights.
CREATE TABLE IF NOT EXISTS storm_predictions (
  time          TIMESTAMPTZ     NOT NULL,
  sector        TEXT            NOT NULL,
  probability   SMALLINT        NOT NULL,  -- 0-100
  horizon       TEXT,                      -- imminent/likely/possible/none
  severity      TEXT,                      -- extreme/severe/moderate/none
  has_lightning  BOOLEAN         NOT NULL DEFAULT FALSE,
  -- Signal weights (compact: 9 values matching stormPredictor signals order)
  signal_cape   REAL,
  signal_precip REAL,
  signal_cloud  REAL,
  signal_lightning REAL,
  signal_approach  REAL,
  signal_shadow    REAL,
  signal_gusts     REAL,
  signal_mg_warning REAL,
  signal_sky_state  REAL,
  PRIMARY KEY (time, sector)
);
SELECT create_hypertable('storm_predictions', 'time', if_not_exists => TRUE);

-- ── Spot scores (analyzer per-cycle verdict persistence) ────
-- Written by analyzer.ts persistSpotScores() every 5min poll.
-- Read by api.ts /api/v1/spots/scores → SpotHistoryChart (24h history).
-- NOTE: this table was created out-of-band on LXC 306 before being added
-- here (S136+3+5 audit). The ALTER below adds the detector-boost columns
-- to pre-existing deployments idempotently.
CREATE TABLE IF NOT EXISTS spot_scores (
  time             TIMESTAMPTZ     NOT NULL,
  spot_id          TEXT            NOT NULL,
  sector           TEXT            NOT NULL,
  verdict          TEXT            NOT NULL,
  wind_kt          REAL,                       -- effective wind (post-boost)
  gust_kt          REAL,
  wind_dir         REAL,
  score            SMALLINT        DEFAULT 0,   -- reserved (analyzer emits verdict, not 0-100)
  station_count    SMALLINT,
  inferred_dir     TEXT,
  -- Detector boost provenance (S136+3+5) — enables auditing Cesantes
  -- canalization + Bocana terral activation against real conditions.
  raw_wind_kt      REAL,                        -- measured avg before any boost
  boosted_by       TEXT,                        -- 'cesantes-canalization' | 'bocana-terral' | NULL
  boost_confidence SMALLINT,                    -- 0-100 when boosted_by set
  PRIMARY KEY (time, spot_id)
);
SELECT create_hypertable('spot_scores', 'time', if_not_exists => TRUE);
-- Idempotent column adds for the out-of-band prod table:
ALTER TABLE spot_scores ADD COLUMN IF NOT EXISTS raw_wind_kt REAL;
ALTER TABLE spot_scores ADD COLUMN IF NOT EXISTS boosted_by TEXT;
ALTER TABLE spot_scores ADD COLUMN IF NOT EXISTS boost_confidence SMALLINT;

-- ── Lightning strikes (historical-data-vision Phase 1a) ────
-- Individual strikes from MeteoGalicia meteo2api raios/lenda.
-- Persisting raw strikes enables: (a) heatmap of where lightning hits most,
-- (b) cross-correlation with synoptic flow + fronts + station wind, (c)
-- calibration of stormPredictor weights from real ground truth.
-- Volume: ~500/day Galicia typical, ~5000/day extreme storm = ~7.5MB/year.
CREATE TABLE IF NOT EXISTS lightning_strikes (
  time           TIMESTAMPTZ     NOT NULL,
  lat            DOUBLE PRECISION NOT NULL,
  lon            DOUBLE PRECISION NOT NULL,
  peak_current   REAL,                       -- kA, signed (positive/negative polarity)
  cloud_to_cloud BOOLEAN         NOT NULL DEFAULT FALSE,
  multiplicity   SMALLINT        DEFAULT 1,
  -- TRUE if inside the Galicia-relevant bbox (N 44.5 / S 41.5 / W -10.5 /
  -- E -6.0). meteo2api returns the whole NW peninsula; ~32% (audited
  -- 2026-05-14) fall outside the area that affects Galician weather. Kept
  -- for storm-approach analysis but the predictor/analyzer should filter
  -- WHERE is_galicia = TRUE for clean calibration. DEFAULT TRUE so legacy
  -- rows before the backfill don't silently drop out of queries.
  is_galicia     BOOLEAN         NOT NULL DEFAULT TRUE,
  -- PK gives natural dedup across overlapping polls. lat/lon truncated to ~1m
  -- precision is more than enough — meteo2api itself emits 5-decimal coords.
  PRIMARY KEY (time, lat, lon)
);
SELECT create_hypertable('lightning_strikes', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_strikes_loc ON lightning_strikes (lat, lon);
-- Idempotent add for existing deployments (CREATE TABLE IF NOT EXISTS skips
-- the new column on an already-existing table — this ALTER applies it).
ALTER TABLE lightning_strikes ADD COLUMN IF NOT EXISTS is_galicia BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_strikes_galicia ON lightning_strikes (is_galicia, time DESC);

-- ── Active fires (historical-data-vision Phase 1a) ─────────
-- NASA FIRMS VIIRS hotspots, written 24/7 by firmsFetcher.ts (its own NASA
-- call — the /api/v1/firms proxy only caches for the browser, it never writes).
-- Keys include satellite + acq time so the same physical fire seen by S-NPP
-- and NOAA-20 doesn't get deduped (we want both observations for accuracy).
CREATE TABLE IF NOT EXISTS active_fires (
  time           TIMESTAMPTZ     NOT NULL,
  lat            DOUBLE PRECISION NOT NULL,
  lon            DOUBLE PRECISION NOT NULL,
  satellite      TEXT            NOT NULL,
  brightness     REAL,                        -- bright_ti4, Kelvin
  frp            REAL,                        -- Fire Radiative Power, MW
  confidence     TEXT,                        -- 'low' | 'nominal' | 'high'
  daynight       CHAR(1),
  PRIMARY KEY (time, lat, lon, satellite)
);
SELECT create_hypertable('active_fires', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_fires_loc ON active_fires (lat, lon);

-- ── Upper-air sounding (Phase 1b TIER 1 — sinóptica) ────────
-- Wind + temperature at standard pressure levels (850/700/500 hPa) per
-- sector. Data from Open-Meteo `hourly=wind_speed_850hPa,...`. Hourly cadence
-- per sector × 3 levels = ~144 rows/day, ~5MB/year. Kept forever — this is
-- the synoptic spine of the historical dataset (without aloft wind we cannot
-- correlate "where lightning forms" with "what the atmosphere is doing").
CREATE TABLE IF NOT EXISTS upper_air_hourly (
  time            TIMESTAMPTZ      NOT NULL,
  sector          TEXT             NOT NULL,
  pressure_hpa    SMALLINT         NOT NULL,        -- 850 | 700 | 500
  wind_dir_deg    REAL,                             -- meteorological "from"
  wind_speed_ms   REAL,
  temperature_c   REAL,
  geopotential_m  REAL,                             -- height of the pressure level (m)
  PRIMARY KEY (time, sector, pressure_hpa)
);
SELECT create_hypertable('upper_air_hourly', 'time', if_not_exists => TRUE);

-- ── ICA air quality (Phase 1b TIER 2) ──────────────────────
-- Official MeteoGalicia/Xunta network: ~30 stations reporting hourly.
-- Persists raw ICA decimal value + dominant pollutant per station so we
-- can later correlate poor-air episodes with calima fronts, traffic, fires.
-- Volume: ~30 stations × 24h = 720 rows/day ≈ 263K/year ≈ 25MB/year. Trivial.
CREATE TABLE IF NOT EXISTS ica_readings (
  time            TIMESTAMPTZ      NOT NULL,
  station         TEXT             NOT NULL,
  lat             DOUBLE PRECISION NOT NULL,
  lon             DOUBLE PRECISION NOT NULL,
  ica             REAL,                              -- decimal 1.0-5.0
  category_es     TEXT,                              -- "Adecuada", "Mala", etc
  dominant        TEXT,                              -- O3, NO2, PM10, PM25, SO2, CO, BEN
  PRIMARY KEY (time, station)
);
SELECT create_hypertable('ica_readings', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_ica_loc ON ica_readings (lat, lon);

-- ── Convection indices per sector (Phase 1b TIER 1) ─────────
-- Persists the CAPE/CIN/LI/PWAT we already fetch for the storm predictor
-- but currently throw away after each cycle. Required for predictor
-- calibration: "when CAPE > X and LI < -Y, did lightning ACTUALLY occur?"
CREATE TABLE IF NOT EXISTS convection_hourly (
  time            TIMESTAMPTZ      NOT NULL,
  sector          TEXT             NOT NULL,
  cape            REAL,                             -- J/kg, surface-based
  cin             REAL,                             -- J/kg, convective inhibition
  lifted_index    REAL,                             -- LI dimensionless
  precipitable_water REAL,                          -- PWAT mm, total atmospheric column
  boundary_layer_m   REAL,                          -- BL height m
  PRIMARY KEY (time, sector)
);
SELECT create_hypertable('convection_hourly', 'time', if_not_exists => TRUE);

-- ════════════════════════════════════════════════════════════════
-- Phase 2 — Continuous aggregates
-- ════════════════════════════════════════════════════════════════
-- These materialized views pre-compute the rollups we'll hit on the analytics
-- tab + future ML feature engineering. TimescaleDB refreshes them on a policy
-- (every N minutes, covering the last X hours) so reads are fast and writes
-- pay only the marginal-bucket cost.
--
-- Naming convention: <source>_<bucket>_<dimension>
--   lightning_hourly_zone   → strikes per hour per ~5 km cell
--   convection_daily_sector → daily peak instability per sector
--   ica_daily_station       → daily AQ stats per station
--
-- All defined idempotently (DO blocks, IF NOT EXISTS guards) so applying the
-- schema repeatedly is a no-op.

-- ── lightning_hourly_zone ───────────────────────────────
-- "Where do storms hit most?" base layer. Buckets coords to 0.05 deg
-- (~5.5 km lat × ~4 km lon at 42°N) so the heatmap stays small while keeping
-- enough spatial resolution to distinguish ría from interior.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates
    WHERE view_name = 'lightning_hourly_zone'
  ) THEN
    EXECUTE '
      CREATE MATERIALIZED VIEW lightning_hourly_zone
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket(''1 hour'', time)               AS bucket,
        ROUND(lat::numeric, 2)                      AS lat_cell,
        ROUND(lon::numeric, 2)                      AS lon_cell,
        COUNT(*)                                    AS strike_count,
        AVG(ABS(peak_current))                      AS avg_peak_current,
        MAX(ABS(peak_current))                      AS max_peak_current,
        SUM(CASE WHEN cloud_to_cloud THEN 1 ELSE 0 END) AS cc_count
      FROM lightning_strikes
      GROUP BY bucket, lat_cell, lon_cell
      WITH NO DATA
    ';
  END IF;
END $$;

-- Refresh policy: every 30 min refresh the last 6 h (late strikes + dedup).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.jobs
    WHERE proc_name = 'policy_refresh_continuous_aggregate'
      AND hypertable_name = 'lightning_hourly_zone'
  ) THEN
    PERFORM add_continuous_aggregate_policy(
      'lightning_hourly_zone',
      start_offset => INTERVAL '6 hours',
      end_offset   => INTERVAL '5 minutes',
      schedule_interval => INTERVAL '30 minutes'
    );
  END IF;
END $$;

-- ── convection_daily_sector ─────────────────────────────
-- Daily peak instability per sector. Correlates with lightning_hourly_zone
-- to answer "did the predictor's CAPE ever materialise as strikes?"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates
    WHERE view_name = 'convection_daily_sector'
  ) THEN
    EXECUTE '
      CREATE MATERIALIZED VIEW convection_daily_sector
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket(''1 day'', time, ''Europe/Madrid'')  AS bucket,
        sector,
        MAX(cape)                AS peak_cape,
        MIN(lifted_index)        AS min_lifted_index,
        AVG(cape)                AS avg_cape,
        AVG(cin)                 AS avg_cin,
        AVG(boundary_layer_m)    AS avg_blh
      FROM convection_hourly
      GROUP BY bucket, sector
      WITH NO DATA
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.jobs
    WHERE proc_name = 'policy_refresh_continuous_aggregate'
      AND hypertable_name = 'convection_daily_sector'
  ) THEN
    PERFORM add_continuous_aggregate_policy(
      'convection_daily_sector',
      start_offset => INTERVAL '3 days',
      end_offset   => INTERVAL '1 hour',
      schedule_interval => INTERVAL '1 hour'
    );
  END IF;
END $$;

-- ── ica_daily_station ───────────────────────────────────
-- Daily AQ rollup per station. Drives "bad-air episode" detection:
--   peak ICA + most-frequent dominant pollutant + hours over threshold.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates
    WHERE view_name = 'ica_daily_station'
  ) THEN
    EXECUTE '
      CREATE MATERIALIZED VIEW ica_daily_station
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket(''1 day'', time, ''Europe/Madrid'') AS bucket,
        station,
        AVG(lat)                                AS lat,
        AVG(lon)                                AS lon,
        AVG(ica)                                AS avg_ica,
        MAX(ica)                                AS peak_ica,
        SUM(CASE WHEN ica >= 4 THEN 1 ELSE 0 END) AS hours_unhealthy
      FROM ica_readings
      GROUP BY bucket, station
      WITH NO DATA
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.jobs
    WHERE proc_name = 'policy_refresh_continuous_aggregate'
      AND hypertable_name = 'ica_daily_station'
  ) THEN
    PERFORM add_continuous_aggregate_policy(
      'ica_daily_station',
      start_offset => INTERVAL '3 days',
      end_offset   => INTERVAL '1 hour',
      schedule_interval => INTERVAL '1 hour'
    );
  END IF;
END $$;

-- Read-only access for the app role (continuous aggregates need explicit GRANT
-- — they do NOT inherit from the base table's permissions because the CAGG
-- is owned by `postgres`. Missing GRANT → endpoint returns
-- `permission denied for view X`, silent in the ingestor log).
GRANT SELECT ON readings_hourly         TO meteomap_app;
GRANT SELECT ON buoy_readings_hourly    TO meteomap_app;
GRANT SELECT ON lightning_hourly_zone   TO meteomap_app;
GRANT SELECT ON convection_daily_sector TO meteomap_app;
GRANT SELECT ON ica_daily_station       TO meteomap_app;

-- ── Spatial convection grid (5km Galicia) ──────
-- One row per (forecast_time, cell). The fetcher runs every 30min covering
-- t+0..t+5h. ON CONFLICT DO UPDATE so re-fetches refine the same cell with
-- a fresher model run. cell_i/cell_j are the grid indices from
-- spatialGridService.generateGridCells(GALICIA_GRID).
--
-- Volume estimate at 5km resolution:
--   ~2256 cells × 6 hours horizon × 48 runs/day = ~650K rows/day
--   With TimescaleDB compression (~3×) and 30d retention: ~1 GB total.
-- Starting at 10km (~640 cells) for first week, then promote to 5km.
CREATE TABLE IF NOT EXISTS convection_grid_hourly (
  time              TIMESTAMPTZ NOT NULL,        -- forecast_time (UTC hour)
  fetched_at        TIMESTAMPTZ NOT NULL,        -- when this row was ingested
  cell_i            SMALLINT    NOT NULL,
  cell_j            SMALLINT    NOT NULL,
  lat               REAL        NOT NULL,
  lon               REAL        NOT NULL,
  cape              REAL,                        -- J/kg
  lifted_index      REAL,                        -- °C (negative = unstable)
  cin               REAL,                        -- J/kg (positive value)
  boundary_layer_m  REAL,                        -- m
  precip_mm         REAL,                        -- mm/h, Open-Meteo `precipitation`
  risk              REAL        NOT NULL DEFAULT 0,  -- 0-100 (CAPE × -LI / 1000)
  PRIMARY KEY (time, cell_i, cell_j)
);

-- For existing deployments: add column if missing (non-breaking migration)
ALTER TABLE convection_grid_hourly ADD COLUMN IF NOT EXISTS precip_mm REAL;

SELECT create_hypertable(
  'convection_grid_hourly', 'time',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_cgh_time_risk
  ON convection_grid_hourly (time DESC, risk DESC);

-- ON CONFLICT DO UPDATE requires UPDATE permission (not just INSERT)
GRANT SELECT, INSERT, UPDATE ON convection_grid_hourly TO meteomap_app;

-- ── convection_grid_daily_peak ──────────────────────────
-- Daily peak per cell. Powers the "Histórico de inestabilidad" tab on the
-- frontend (Phase 4) without scanning ~650K rows per query: each cell
-- collapses to one row per day with its peak CAPE/risk and total precip.
-- Useful queries:
--   SELECT * FROM convection_grid_daily_peak
--    WHERE bucket >= NOW() - INTERVAL '30 days'
--      AND peak_risk > 10                      -- 30d hotspot map
--   GROUP BY cell_i, cell_j;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates
    WHERE view_name = 'convection_grid_daily_peak'
  ) THEN
    EXECUTE '
      CREATE MATERIALIZED VIEW convection_grid_daily_peak
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket(''1 day'', time, ''Europe/Madrid'') AS bucket,
        cell_i,
        cell_j,
        AVG(lat)              AS lat,
        AVG(lon)              AS lon,
        MAX(cape)             AS peak_cape,
        MIN(lifted_index)     AS min_lifted_index,
        MAX(risk)             AS peak_risk,
        AVG(cape)             AS avg_cape,
        AVG(cin)              AS avg_cin,
        SUM(precip_mm)        AS total_precip_mm,
        MAX(precip_mm)        AS peak_precip_mm,
        COUNT(*)              AS samples
      FROM convection_grid_hourly
      GROUP BY bucket, cell_i, cell_j
      WITH NO DATA
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.jobs
    WHERE proc_name = 'policy_refresh_continuous_aggregate'
      AND hypertable_name = 'convection_grid_daily_peak'
  ) THEN
    PERFORM add_continuous_aggregate_policy(
      'convection_grid_daily_peak',
      start_offset      => INTERVAL '3 days',
      end_offset        => INTERVAL '1 hour',
      schedule_interval => INTERVAL '1 hour'
    );
  END IF;
END $$;

GRANT SELECT ON convection_grid_daily_peak TO meteomap_app;

-- ── Prediction outcomes — measure storm_predictions accuracy ──
-- For each prediction made by the frontend stormPredictor, evaluate what
-- ACTUALLY happened in the next 6h. Enables measuring accuracy over time
-- and eventually re-calibrating signal weights from real outcomes.
--
-- Evaluation runs nightly (3 AM UTC) on predictions made >=6h ago that
-- don't have an outcome yet. See ingestor/outcomeEvaluator.ts.
CREATE TABLE IF NOT EXISTS prediction_outcomes (
  prediction_time TIMESTAMPTZ NOT NULL,    -- = storm_predictions.time
  sector          TEXT NOT NULL,            -- = storm_predictions.sector
  evaluated_at    TIMESTAMPTZ NOT NULL,
  -- Snapshot of what the prediction said (denormalized for ML training queries)
  predicted_probability SMALLINT,
  predicted_horizon     TEXT,
  predicted_severity    TEXT,
  -- Reality observed in the [prediction_time, prediction_time + 6h] window
  observed_lightning_count INT  DEFAULT 0,
  -- Open-Meteo grid (spatial coverage, model analysis ~10km interpolation)
  observed_max_rain_grid_mm     REAL,
  -- Real station readings (direct pluviometer measurements — ground truth where coverage exists)
  observed_max_rain_stations_mm REAL,
  -- Verdict uses MAX(grid, stations). NULL when prediction was in uncertain 30-60% band
  was_correct  BOOLEAN,
  notes        TEXT,
  PRIMARY KEY (prediction_time, sector)
);

CREATE INDEX IF NOT EXISTS idx_outcomes_eval_at
  ON prediction_outcomes (evaluated_at DESC);

GRANT SELECT, INSERT ON prediction_outcomes TO meteomap_app;

-- ── Magic Window detections (T2-2 S136+3+3) ──────────
-- One row per minute per sector when the magic-window detector fires.
-- Append-only; low volume (~1 row per hour at most).
--
-- The detector evaluates RARE alignments of SW synoptic + delta-T + thermal
-- hour + humid mouth — when active, multiple Rias Baixas spots become
-- favorable in the next 1-6h. Frontend may query the latest active row for
-- a banner.
CREATE TABLE IF NOT EXISTS magic_windows (
  time            TIMESTAMPTZ NOT NULL,
  sector          TEXT        NOT NULL,
  score           SMALLINT    NOT NULL,
  summary         TEXT        NOT NULL,
  estimated_hours SMALLINT    NOT NULL,
  PRIMARY KEY (time, sector)
);

CREATE INDEX IF NOT EXISTS idx_magic_windows_recent
  ON magic_windows (time DESC, sector);

GRANT SELECT, INSERT ON magic_windows TO meteomap_app;
GRANT SELECT, INSERT ON spot_scores TO meteomap_app;

-- ── Retention (uncomment when ready) ─────────────────
-- SELECT add_retention_policy('readings', INTERVAL '2 years', if_not_exists => TRUE);
-- SELECT add_retention_policy('alerts', INTERVAL '1 year', if_not_exists => TRUE);
-- SELECT add_retention_policy('webcam_readings', INTERVAL '6 months', if_not_exists => TRUE);
-- Lightning + fires + upper_air + convection kept FOREVER (foundation of
-- historical pattern dataset — these tables are the substrate, not derived)
