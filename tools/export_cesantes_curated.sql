-- ==============================================================================
-- SQL Extraction & Curation Query for Cesantes Thermal ML Model
-- Generates a clean 15-minute resampled time-series dataset from 2026-03-07 to 2026-09-21.
-- Optimized for TimescaleDB with zero-duplicate conditional aggregation.
-- ==============================================================================

WITH 
-- 1. Resampled 15-min Station Readings by Geographic Clusters
station_cluster_15m AS (
  SELECT 
    time_bucket('15 minutes', time) AS bucket,
    
    -- Cluster Vigo (Costa y aeropuerto: gradiente barométrico y radiación)
    AVG(CASE WHEN station_id IN ('aemet_1484C', '1484C', '10145', 'mc_ESGAL3600000036316A') AND temperature BETWEEN -5 AND 45 THEN temperature END) AS vigo_temp,
    AVG(CASE WHEN station_id IN ('aemet_1484C', '1484C', '10145', 'mc_ESGAL3600000036316A') AND humidity BETWEEN 5 AND 100 THEN humidity END) AS vigo_hum,
    AVG(CASE WHEN station_id IN ('aemet_1484C', '1484C', '10145') AND pressure BETWEEN 950 AND 1050 THEN pressure END) AS vigo_pressure,
    AVG(CASE 
      WHEN station_id IN ('10145', 'aemet_1484C') AND EXTRACT(HOUR FROM time) BETWEEN 6 AND 21 AND solar_rad BETWEEN 0 AND 1350 THEN solar_rad
      WHEN EXTRACT(HOUR FROM time) NOT BETWEEN 6 AND 21 THEN 0
      ELSE NULL 
    END) AS vigo_solar_rad,
    AVG(CASE WHEN station_id IN ('aemet_1484C', '1484C', '10145') AND wind_speed BETWEEN 0 AND 40 THEN wind_speed * 1.94384 END) AS vigo_wind_kt,
    AVG(CASE WHEN station_id IN ('aemet_1484C', '1484C', '10145') AND wind_dir BETWEEN 0 AND 360 THEN wind_dir END) AS vigo_wind_dir,

    -- Cluster Redondela / San Simón (Sensores locales de borde apantallados)
    AVG(CASE WHEN station_id IN ('wu_IREDON16', 'mg_10154', '10154') AND temperature BETWEEN -5 AND 45 THEN temperature END) AS redon_temp,
    AVG(CASE WHEN station_id IN ('wu_IREDON16', 'mg_10154', '10154') AND humidity BETWEEN 5 AND 100 THEN humidity END) AS redon_hum,
    AVG(CASE WHEN station_id IN ('wu_IREDON16', 'mg_10154', '10154') AND wind_speed BETWEEN 0 AND 40 THEN wind_speed * 1.94384 END) AS redon_wind_kt,
    MAX(CASE WHEN station_id IN ('wu_IREDON16', 'mg_10154', '10154') AND wind_gust BETWEEN 0 AND 60 THEN wind_gust * 1.94384 END) AS redon_gust_kt,
    AVG(CASE WHEN station_id IN ('wu_IREDON16', 'mg_10154', '10154') AND wind_dir BETWEEN 0 AND 360 THEN wind_dir END) AS redon_wind_dir,

    -- Cluster Boca de Ría (Moaña / Cangas / Bouzas: humedad marítima de entrada)
    AVG(CASE WHEN station_id IN ('mg_10150', '10150', 'mc_ESGAL3600000036209A') AND humidity BETWEEN 5 AND 100 THEN humidity END) AS mouth_hum,
    AVG(CASE WHEN station_id IN ('mg_10150', '10150', 'mc_ESGAL3600000036209A') AND temperature BETWEEN -5 AND 45 THEN temperature END) AS mouth_temp,

    -- Cluster Ourense (Motor térmico continental: baja térmica de interior)
    AVG(CASE WHEN station_id IN ('aemet_1690A', '1690A', '10137', 'mg_10137', 'wu_IOUREN24') AND temperature BETWEEN -5 AND 45 THEN temperature END) AS ourense_temp,
    AVG(CASE WHEN station_id IN ('aemet_1690A', '1690A', '10137', 'mg_10137', 'wu_IOUREN24') AND humidity BETWEEN 5 AND 100 THEN humidity END) AS ourense_hum,
    AVG(CASE 
      WHEN station_id IN ('10137', 'mg_10137') AND EXTRACT(HOUR FROM time) BETWEEN 6 AND 21 AND solar_rad BETWEEN 0 AND 1350 THEN solar_rad
      WHEN EXTRACT(HOUR FROM time) NOT BETWEEN 6 AND 21 THEN 0
      ELSE NULL 
    END) AS ourense_solar_rad,
    AVG(CASE WHEN station_id IN ('aemet_1690A', '1690A') AND pressure BETWEEN 950 AND 1050 THEN pressure END) AS ourense_pressure

  FROM readings
  WHERE time >= '2026-03-07 00:00:00+00' 
    AND time <= '2026-09-21 23:59:59+00'
    AND (qc_flag = 0 OR qc_flag IS NULL)
  GROUP BY 1
),

-- 2. Resampled 15-min Buoy Readings Pivoted
buoy_pivoted_15m AS (
  SELECT 
    time_bucket('15 minutes', time) AS bucket,
    
    -- Boya 1251 (Rande CETMAR: gradiente con lámina de agua interior)
    AVG(CASE WHEN station_id = 1251 AND water_temp BETWEEN 10.5 AND 25.0 THEN water_temp END) AS rande_water_temp,
    AVG(CASE WHEN station_id = 1251 AND air_temp BETWEEN -2.0 AND 40.0 THEN air_temp END) AS rande_air_temp,
    AVG(CASE WHEN station_id = 1251 AND wind_speed BETWEEN 0 AND 40 THEN wind_speed * 1.94384 END) AS rande_wind_kt,
    AVG(CASE WHEN station_id = 1251 AND wind_dir BETWEEN 0 AND 360 THEN wind_dir END) AS rande_wind_dir,
    AVG(CASE WHEN station_id = 1251 AND salinity BETWEEN 25 AND 37 THEN salinity END) AS rande_salinity,

    -- Boya 1252 (Islas Cíes CETMAR: Boca de Ría)
    AVG(CASE WHEN station_id = 1252 AND wind_speed BETWEEN 0 AND 40 THEN wind_speed * 1.94384 END) AS cies_wind_kt,
    AVG(CASE WHEN station_id = 1252 AND wind_dir BETWEEN 0 AND 360 THEN wind_dir END) AS cies_wind_dir,
    AVG(CASE WHEN station_id = 1252 AND water_temp BETWEEN 10.5 AND 25.0 THEN water_temp END) AS cies_water_temp,
    AVG(CASE WHEN station_id = 1252 AND wave_height BETWEEN 0 AND 15 THEN wave_height END) AS cies_wave_height,

    -- Boya 2248 (Cabo Silleiro REDEXT: Viento sinóptico de fondo y oleaje atlántico)
    AVG(CASE WHEN station_id = 2248 AND wind_speed BETWEEN 0 AND 40 THEN wind_speed * 1.94384 END) AS silleiro_wind_kt,
    AVG(CASE WHEN station_id = 2248 AND wind_dir BETWEEN 0 AND 360 THEN wind_dir END) AS silleiro_wind_dir,
    AVG(CASE WHEN station_id = 2248 AND wave_height BETWEEN 0 AND 15 THEN wave_height END) AS silleiro_wave_height,
    AVG(CASE WHEN station_id = 2248 AND wave_period BETWEEN 1 AND 25 THEN wave_period END) AS silleiro_wave_period,
    AVG(CASE WHEN station_id = 2248 AND water_temp BETWEEN 10.5 AND 25.0 THEN water_temp END) AS silleiro_water_temp,

    -- Boya 3221 (Vigo REDMAR: Nivel de marea astronómica + meteorológica)
    AVG(CASE WHEN station_id = 3221 AND sea_level BETWEEN -200 AND 600 THEN sea_level END) AS vigo_sea_level_cm

  FROM buoy_readings
  WHERE time >= '2026-03-07 00:00:00+00' 
    AND time <= '2026-09-21 23:59:59+00'
  GROUP BY 1
),

-- 3. Resampled 15-min Spot Scores Target for Cesantes
spot_15m AS (
  SELECT 
    time_bucket('15 minutes', time) AS bucket,
    AVG(wind_kt) AS cesantes_wind_kt,
    MAX(gust_kt) AS cesantes_gust_kt,
    AVG(wind_dir) AS cesantes_wind_dir,
    MODE() WITHIN GROUP (ORDER BY verdict) AS cesantes_verdict,
    MAX(raw_wind_kt) AS cesantes_raw_wind_kt,
    MODE() WITHIN GROUP (ORDER BY boosted_by) AS cesantes_boosted_by
  FROM spot_scores
  WHERE spot_id = 'cesantes'
    AND time >= '2026-03-07 00:00:00+00'
    AND time <= '2026-09-21 23:59:59+00'
  GROUP BY 1
),

-- 4. Grilla de Tiempo Regular Continua (cada 15 minutos exactos)
grid AS (
  SELECT generate_series(
    '2026-03-07 00:00:00+00'::timestamptz,
    '2026-09-21 23:45:00+00'::timestamptz,
    '15 minutes'::interval
  ) AS bucket
)

-- 5. Consulta Final Maestra: Unión Alineada sin Duplicados
SELECT 
  g.bucket AS timestamp_utc,
  EXTRACT(HOUR FROM g.bucket AT TIME ZONE 'Europe/Madrid') AS hour_local,
  EXTRACT(DOY FROM g.bucket AT TIME ZONE 'Europe/Madrid') AS day_of_year,
  EXTRACT(MONTH FROM g.bucket AT TIME ZONE 'Europe/Madrid') AS month,
  
  -- Target Cesantes
  s.cesantes_wind_kt,
  s.cesantes_gust_kt,
  s.cesantes_wind_dir,
  s.cesantes_verdict,
  s.cesantes_boosted_by,
  
  -- Boyas
  b.rande_water_temp,
  b.rande_air_temp,
  b.rande_wind_kt,
  b.rande_wind_dir,
  b.rande_salinity,
  b.cies_wind_kt,
  b.cies_wind_dir,
  b.cies_water_temp,
  b.cies_wave_height,
  b.silleiro_wind_kt,
  b.silleiro_wind_dir,
  b.silleiro_wave_height,
  b.silleiro_wave_period,
  b.silleiro_water_temp,
  b.vigo_sea_level_cm,

  -- Estaciones Terrestres
  st.vigo_temp,
  st.vigo_hum,
  st.vigo_solar_rad,
  st.vigo_pressure,
  st.vigo_wind_kt,
  st.vigo_wind_dir,
  st.redon_temp,
  st.redon_hum,
  st.redon_wind_kt,
  st.redon_gust_kt,
  st.redon_wind_dir,
  st.mouth_hum,
  st.mouth_temp,
  st.ourense_temp,
  st.ourense_hum,
  st.ourense_solar_rad,
  st.ourense_pressure

FROM grid g
LEFT JOIN spot_15m s ON s.bucket = g.bucket
LEFT JOIN buoy_pivoted_15m b ON b.bucket = g.bucket
LEFT JOIN station_cluster_15m st ON st.bucket = g.bucket
ORDER BY g.bucket ASC;
