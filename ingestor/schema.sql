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
  solar_rad   DOUBLE PRECISION
);

SELECT create_hypertable('readings', 'time', if_not_exists => TRUE);

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

-- ── Lightning strikes (S125 historical-data-vision Phase 1a) ────
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
  -- PK gives natural dedup across overlapping polls. lat/lon truncated to ~1m
  -- precision is more than enough — meteo2api itself emits 5-decimal coords.
  PRIMARY KEY (time, lat, lon)
);
SELECT create_hypertable('lightning_strikes', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_strikes_loc ON lightning_strikes (lat, lon);

-- ── Active fires (S125 historical-data-vision Phase 1a) ─────────
-- NASA FIRMS VIIRS hotspots persisted from each /api/v1/firms cache miss.
-- Keys include satellite + acq time so the same physical fire seen by SNPP
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

-- ── Upper-air sounding (S125 Phase 1b TIER 1 — sinóptica) ────────
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

-- ── Convection indices per sector (S125 Phase 1b TIER 1) ─────────
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

-- ── Retention (uncomment when ready) ─────────────────
-- SELECT add_retention_policy('readings', INTERVAL '2 years', if_not_exists => TRUE);
-- SELECT add_retention_policy('alerts', INTERVAL '1 year', if_not_exists => TRUE);
-- SELECT add_retention_policy('webcam_readings', INTERVAL '6 months', if_not_exists => TRUE);
-- Lightning + fires + upper_air + convection kept FOREVER (foundation of
-- historical pattern dataset — these tables are the substrate, not derived)
