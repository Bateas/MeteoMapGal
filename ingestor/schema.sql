-- MeteoMapGal — TimescaleDB Schema (idempotent)
-- Run: psql -h 192.168.10.121 -U meteomap_app -d meteomapgal -f schema.sql

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

-- ── Compression (uncomment after data starts flowing) ─
-- ALTER TABLE readings SET (
--   timescaledb.compress,
--   timescaledb.compress_segmentby = 'station_id,source'
-- );
-- SELECT add_compression_policy('readings', INTERVAL '7 days', if_not_exists => TRUE);

-- ── Retention (uncomment when ready) ─────────────────
-- SELECT add_retention_policy('readings', INTERVAL '2 years', if_not_exists => TRUE);
-- SELECT add_retention_policy('alerts', INTERVAL '1 year', if_not_exists => TRUE);
