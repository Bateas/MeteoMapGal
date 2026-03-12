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

-- ── Retention (uncomment when ready) ─────────────────
-- SELECT add_retention_policy('readings', INTERVAL '2 years', if_not_exists => TRUE);
-- SELECT add_retention_policy('alerts', INTERVAL '1 year', if_not_exists => TRUE);
