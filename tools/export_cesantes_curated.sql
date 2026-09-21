-- SQL Extraction & Curation Query for Cesantes Thermal ML Model
-- Generates a clean 15-minute resampled time-series dataset from 2026-03-07 to 2026-09-21.

WITH 
-- 1. Resampled 15-min Station Readings with Physical Outlier Cleaning
station_15m AS (
  SELECT 
    time_bucket('15 minutes', time) AS bucket,
    station_id,
    AVG(CASE WHEN temperature BETWEEN -5 AND 45 THEN temperature END) AS temp,
    AVG(CASE WHEN humidity BETWEEN 5 AND 100 THEN humidity END) AS hum,
    AVG(CASE WHEN wind_speed BETWEEN 0 AND 40 THEN wind_speed * 1.94384 END) AS wind_kt, -- m/s -> kt
    MAX(CASE WHEN wind_gust BETWEEN 0 AND 60 THEN wind_gust * 1.94384 END) AS gust_kt,
    AVG(CASE WHEN wind_dir BETWEEN 0 AND 360 THEN wind_dir END) AS wind_dir,
    AVG(CASE WHEN pressure BETWEEN 950 AND 1050 THEN pressure END) AS pressure,
    AVG(CASE 
      -- Filter nighttime solar radiation (>5W/m2 between 22h and 06h UTC) and unrealistic peaks (>1350)
      WHEN EXTRACT(HOUR FROM time) BETWEEN 6 AND 21 AND solar_rad BETWEEN 0 AND 1350 THEN solar_rad
      WHEN EXTRACT(HOUR FROM time) NOT BETWEEN 6 AND 21 THEN 0
      ELSE NULL 
    END) AS solar_rad
  FROM readings
  WHERE time >= '2026-03-07 00:00:00+00' 
    AND time <= '2026-09-21 23:59:59+00'
    AND (qc_flag = 0 OR qc_flag IS NULL)
  GROUP BY 1, 2
),

-- 2. Resampled 15-min Buoy Readings with Physical Outlier Cleaning
buoy_15m AS (
  SELECT 
    time_bucket('15 minutes', time) AS bucket,
    station_id,
    AVG(CASE WHEN water_temp BETWEEN 10.5 AND 25.0 THEN water_temp END) AS water_temp,
    AVG(CASE WHEN air_temp BETWEEN -2.0 AND 40.0 THEN air_temp END) AS air_temp,
    AVG(CASE WHEN wind_speed BETWEEN 0 AND 40 THEN wind_speed * 1.94384 END) AS wind_kt,
    AVG(CASE WHEN wind_dir BETWEEN 0 AND 360 THEN wind_dir END) AS wind_dir,
    AVG(CASE WHEN wave_height BETWEEN 0 AND 15 THEN wave_height END) AS wave_height,
    AVG(CASE WHEN wave_period BETWEEN 1 AND 25 THEN wave_period END) AS wave_period,
    AVG(CASE WHEN salinity BETWEEN 25 AND 37 THEN salinity END) AS salinity,
    AVG(CASE WHEN sea_level BETWEEN -200 AND 600 THEN sea_level END) AS sea_level
  FROM buoy_readings
  WHERE time >= '2026-03-07 00:00:00+00' 
    AND time <= '2026-09-21 23:59:59+00'
  GROUP BY 1, 2
),

-- 3. Resampled 15-min Spot Ground-Truth Target for Cesantes
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

-- 4. Unified Time Grid (all 15-min buckets)
grid AS (
  SELECT generate_series(
    '2026-03-07 00:00:00+00'::timestamptz,
    '2026-09-21 23:45:00+00'::timestamptz,
    '15 minutes'::interval
  ) AS bucket
)

-- 5. Final Master Pivot: Aligning Target + Surrounding Sensors
SELECT 
  g.bucket AS timestamp_utc,
  EXTRACT(HOUR FROM g.bucket AT TIME ZONE 'Europe/Madrid') AS hour_local,
  EXTRACT(DOY FROM g.bucket AT TIME ZONE 'Europe/Madrid') AS day_of_year,
  EXTRACT(MONTH FROM g.bucket AT TIME ZONE 'Europe/Madrid') AS month,
  
  -- Target variables at Cesantes
  s.cesantes_wind_kt,
  s.cesantes_gust_kt,
  s.cesantes_wind_dir,
  s.cesantes_verdict,
  s.cesantes_boosted_by,
  
  -- Buoy 1251 (Plataforma de Rande CETMAR - Clave para gradiente ría interior)
  b_rande.water_temp AS rande_water_temp,
  b_rande.air_temp AS rande_air_temp,
  b_rande.wind_kt AS rande_wind_kt,
  b_rande.wind_dir AS rande_wind_dir,
  b_rande.salinity AS rande_salinity,
  
  -- Buoy 1252 (Islas Cíes CETMAR - Boca de Ría)
  b_cies.wind_kt AS cies_wind_kt,
  b_cies.wind_dir AS cies_wind_dir,
  b_cies.water_temp AS cies_water_temp,
  b_cies.wave_height AS cies_wave_height,
  
  -- Buoy 2248 (Cabo Silleiro REDEXT - Atlántico exterior / Viento sinóptico)
  b_silleiro.wind_kt AS silleiro_wind_kt,
  b_silleiro.wind_dir AS silleiro_wind_dir,
  b_silleiro.wave_height AS silleiro_wave_height,
  b_silleiro.wave_period AS silleiro_wave_period,
  b_silleiro.water_temp AS silleiro_water_temp,
  
  -- Buoy 3221 (Vigo REDMAR - Marea / Nivel del mar)
  b_vigo.sea_level AS vigo_sea_level_cm,

  -- Estaciones Terrestres Clave
  -- Vigo Aeropuerto Peinador (aemet_1484C o equivalente en la ría)
  st_vigo.temp AS vigo_temp,
  st_vigo.hum AS vigo_hum,
  st_vigo.solar_rad AS vigo_solar_rad,
  st_vigo.pressure AS vigo_pressure,
  st_vigo.wind_kt AS vigo_wind_kt,
  st_vigo.wind_dir AS vigo_wind_dir,
  
  -- Redondela / San Simón (estaciones locales de borde)
  st_redon.temp AS redon_temp,
  st_redon.hum AS redon_hum,
  st_redon.wind_kt AS redon_wind_kt,
  st_redon.wind_dir AS redon_wind_dir,

  -- Interior Ourense (Motor térmico de succión)
  st_ourense.temp AS ourense_temp,
  st_ourense.hum AS ourense_hum,
  st_ourense.solar_rad AS ourense_solar_rad,
  st_ourense.pressure AS ourense_pressure

FROM grid g
LEFT JOIN spot_15m s ON s.bucket = g.bucket
LEFT JOIN buoy_15m b_rande ON b_rande.bucket = g.bucket AND b_rande.station_id = 1251
LEFT JOIN buoy_15m b_cies ON b_cies.bucket = g.bucket AND b_cies.station_id = 1252
LEFT JOIN buoy_15m b_silleiro ON b_silleiro.bucket = g.bucket AND b_silleiro.station_id = 2248
LEFT JOIN buoy_15m b_vigo ON b_vigo.bucket = g.bucket AND b_vigo.station_id = 3221
-- Estaciones terrestres
LEFT JOIN station_15m st_vigo ON st_vigo.bucket = g.bucket AND st_vigo.station_id IN ('aemet_1484C', '1484C', '10145')
LEFT JOIN station_15m st_redon ON st_redon.bucket = g.bucket AND st_redon.station_id IN ('wu_IREDON16', 'mg_10154', '10154')
LEFT JOIN station_15m st_ourense ON st_ourense.bucket = g.bucket AND st_ourense.station_id IN ('aemet_1690A', '1690A', '10137', 'wu_IOUREN24')
ORDER BY g.bucket ASC;
