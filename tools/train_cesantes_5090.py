"""
MeteoMapGal — Cesantes Thermal Wind ML Training Pipeline (RTX 5090 Edition)
--------------------------------------------------------------------------
Entrenamiento y validación de modelo de Machine Learning para predicción de
viento térmico local en Cesantes (Ría de Vigo / Ensenada de San Simón).

Requisitos en local (ejecutar en tu PC con la RTX 5090):
    pip install polars lightgbm scikit-learn matplotlib pyarrow

Uso:
    python tools/train_cesantes_5090.py --data cesantes_curated_2026.csv
"""

import argparse
import sys
import math
import polars as pl
import numpy as np

def compute_solar_elevation(day_of_year: int, hour_local: float, lat: float = 42.3) -> float:
    """Calcula la elevación solar aproximada en grados para la Ría de Vigo."""
    dec = 23.45 * math.sin(math.radians((360 / 365) * (day_of_year - 81)))
    ha = (hour_local - 14.5) * 15.0 # mediodía solar ~14:30 en verano
    lat_rad = math.radians(lat)
    dec_rad = math.radians(dec)
    ha_rad = math.radians(ha)
    sin_alt = math.sin(lat_rad) * math.sin(dec_rad) + math.cos(lat_rad) * math.cos(dec_rad) * math.cos(ha_rad)
    return math.degrees(math.asin(max(-1.0, min(1.0, sin_alt))))

def build_features(df: pl.DataFrame) -> pl.DataFrame:
    """Ingeniería de características físicas a partir de series temporales alineadas."""
    print("⚙️  Calculando características físicas y termodinámicas...")
    
    # 0. Imputación inteligente de boyas con fallback físico (si Rande está offline)
    df = df.with_columns([
        pl.coalesce([
            pl.col("rande_water_temp"),
            pl.col("cies_water_temp"),
            pl.col("silleiro_water_temp"),
            pl.lit(18.5) # Temperatura media del agua en Rías Baixas
        ]).alias("effective_water_temp")
    ])

    # 1. Gradientes termodinámicos Macro -> Micro y barométricos
    df = df.with_columns([
        # Gradiente Macro Interior vs Océano (Motor térmico regional)
        (pl.col("ourense_temp") - pl.col("effective_water_temp")).alias("delta_t_ourense_water"),
        # Gradiente Costa vs Agua de la Ría
        (pl.col("vigo_temp") - pl.col("effective_water_temp")).alias("delta_t_vigo_water"),
        # Gradiente de humedad (Costa/Boca vs Interior)
        (pl.col("mouth_hum") - pl.col("ourense_hum")).alias("delta_humidity_mouth_inland"),
        
        # Componentes vectoriales U/V del viento exterior (Cabo Silleiro - Sinóptico)
        (-pl.col("silleiro_wind_kt") * (pl.col("silleiro_wind_dir") * math.pi / 180).sin()).alias("silleiro_u"),
        (-pl.col("silleiro_wind_kt") * (pl.col("silleiro_wind_dir") * math.pi / 180).cos()).alias("silleiro_v"),
        
        # Componentes U/V Rande (Estrecho Venturi)
        (-pl.col("rande_wind_kt") * (pl.col("rande_wind_dir") * math.pi / 180).sin()).alias("rande_u"),
        (-pl.col("rande_wind_kt") * (pl.col("rande_wind_dir") * math.pi / 180).cos()).alias("rande_v"),
        
        # Componentes U/V Cíes (Boca de Ría)
        (-pl.col("cies_wind_kt") * (pl.col("cies_wind_dir") * math.pi / 180).sin()).alias("cies_u"),
        (-pl.col("cies_wind_kt") * (pl.col("cies_wind_dir") * math.pi / 180).cos()).alias("cies_v"),
    ])

    # 2. Derivadas temporales (ramp rates a 1 hora = 4 pasos de 15m)
    df = df.with_columns([
        (pl.col("vigo_solar_rad") - pl.col("vigo_solar_rad").shift(4)).alias("solar_ramp_1h"),
        (pl.col("ourense_temp") - pl.col("ourense_temp").shift(4)).alias("ourense_heating_rate_1h"),
        (pl.col("vigo_pressure") - pl.col("vigo_pressure").shift(12)).alias("pressure_drop_3h"), # tendencia barométrica 3h
        (pl.col("vigo_sea_level_cm") - pl.col("vigo_sea_level_cm").shift(4)).alias("tide_rate_1h"), # velocidad de marea
    ])

    # 3. Lags de condiciones (memoria atmosférica: hace 1h y 2h)
    df = df.with_columns([
        pl.col("rande_wind_kt").shift(4).alias("rande_wind_kt_lag1h"),
        pl.col("silleiro_wind_kt").shift(4).alias("silleiro_wind_kt_lag1h"),
        pl.col("vigo_temp").shift(4).alias("vigo_temp_lag1h"),
        pl.col("redon_gust_kt").shift(4).alias("redon_gust_kt_lag1h"),
    ])

    # 4. Definición de Variable Objetivo (TARGET):
    # ¿Hay térmico navegable en Cesantes dentro de 2 horas (t + 8 pasos de 15m)?
    # Definición física robusta:
    #   - Viento proyectado en spot >= 11 kt con dirección SW (200° a 270°)
    #   - O racha medida en sensores locales >= 12 kt con dirección SW y gradiente activo
    #   - O veredicto del spot registrado como 'BUENO'
    target_lead_steps = 8 # 2 horas vista
    df = df.with_columns([
        pl.col("cesantes_wind_kt").shift(-target_lead_steps).alias("target_wind_kt_lead2h"),
        pl.col("cesantes_gust_kt").shift(-target_lead_steps).alias("target_gust_kt_lead2h"),
        pl.col("cesantes_wind_dir").shift(-target_lead_steps).alias("target_wind_dir_lead2h"),
        pl.col("cesantes_verdict").shift(-target_lead_steps).alias("target_verdict_lead2h"),
        pl.col("redon_gust_kt").shift(-target_lead_steps).alias("target_redon_gust_lead2h"),
        pl.col("redon_wind_dir").shift(-target_lead_steps).alias("target_redon_dir_lead2h"),
    ])

    # Clasificación binaria: ¿Térmico navegable activo en Cesantes a t+2h?
    df = df.with_columns([
        (
            (
                (pl.col("target_wind_kt_lead2h") >= 11.0) & 
                (pl.col("target_wind_dir_lead2h") >= 200.0) & 
                (pl.col("target_wind_dir_lead2h") <= 270.0)
            ) |
            (
                (pl.col("target_redon_gust_lead2h") >= 12.0) &
                (pl.col("target_redon_dir_lead2h") >= 200.0) &
                (pl.col("target_redon_dir_lead2h") <= 270.0) &
                (pl.col("delta_t_ourense_water") >= 6.0)
            ) |
            (pl.col("target_verdict_lead2h") == "BUENO")
        ).cast(pl.Int32).alias("target_thermal_active_lead2h")
    ])

    return df

def train_and_evaluate(df: pl.DataFrame):
    import lightgbm as lgb
    from sklearn.metrics import roc_auc_score, mean_absolute_error, classification_report, brier_score_loss

    # Filtrar horas diurnas (10:00 a 20:30 local) donde tiene sentido predecir térmicos de tarde
    df_day = df.filter((pl.col("hour_local") >= 10) & (pl.col("hour_local") <= 20))
    
    # Partición temporal ciega (Out-of-time):
    # Train: Marzo - Julio 2026 (70% inicial)
    # Test Ciego: Agosto - Septiembre 2026 (30% final - incluye calor extremo tardío)
    train_mask = pl.col("month") <= 7
    test_mask = pl.col("month") >= 8

    train_df = df_day.filter(train_mask).drop_nulls(subset=["target_thermal_active_lead2h"])
    test_df = df_day.filter(test_mask).drop_nulls(subset=["target_thermal_active_lead2h"])

    print(f"\n📊 Partición de Datos:")
    print(f"   - Entrenamiento (Marzo-Julio): {len(train_df)} muestras")
    print(f"   - Evaluación ciega (Agosto-Septiembre): {len(test_df)} muestras")

    features = [
        "hour_local", "day_of_year", 
        "delta_t_ourense_water", "delta_t_vigo_water", "delta_humidity_mouth_inland",
        "ourense_temp", "ourense_hum", "ourense_heating_rate_1h", "ourense_pressure",
        "effective_water_temp", "vigo_temp", "vigo_hum", "vigo_solar_rad", "solar_ramp_1h",
        "vigo_pressure", "pressure_drop_3h", "tide_rate_1h", "vigo_sea_level_cm",
        "mouth_hum", "mouth_temp",
        "redon_temp", "redon_hum", "redon_wind_kt", "redon_gust_kt", "redon_wind_dir",
        "silleiro_wind_kt", "silleiro_u", "silleiro_v", "silleiro_wave_height", "silleiro_water_temp",
        "rande_wind_kt", "rande_u", "rande_v",
        "cies_wind_kt", "cies_u", "cies_v",
        "rande_wind_kt_lag1h", "silleiro_wind_kt_lag1h", "vigo_temp_lag1h", "redon_gust_kt_lag1h"
    ]

    # Convertir a pandas/numpy para LightGBM
    X_train = train_df.select(features).to_pandas()
    y_train_clf = train_df.select("target_thermal_active_lead2h").to_series().to_numpy()
    y_train_reg = train_df.select("target_wind_kt_lead2h").fill_null(5.0).clip(0.0, 25.0).to_series().to_numpy()

    X_test = test_df.select(features).to_pandas()
    y_test_clf = test_df.select("target_thermal_active_lead2h").to_series().to_numpy()
    y_test_reg = test_df.select("target_wind_kt_lead2h").fill_null(5.0).clip(0.0, 25.0).to_series().to_numpy()

    print("\n🚀 Entrenando Modelo 1: Clasificador de Probabilidad de Térmico (LightGBM)...")
    clf = lgb.LGBMClassifier(
        n_estimators=400,
        learning_rate=0.03,
        num_leaves=31,
        max_depth=6,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        n_jobs=-1
    )
    clf.fit(X_train, y_train_clf)
    
    preds_prob = clf.predict_proba(X_test)[:, 1]
    auc = roc_auc_score(y_test_clf, preds_prob)
    brier = brier_score_loss(y_test_clf, preds_prob)
    print(f"🎯 ROC-AUC en evaluación ciega (Agosto-Septiembre): {auc:.4f}")
    print(f"🎯 Brier Score (calibración probabilística): {brier:.4f}")

    print("\n🚀 Entrenando Modelo 2: Regresor de Intensidad de Viento en Nudos (LightGBM)...")
    reg = lgb.LGBMRegressor(
        n_estimators=500,
        learning_rate=0.03,
        num_leaves=31,
        max_depth=6,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        n_jobs=-1
    )
    reg.fit(X_train, y_train_reg)

    preds_wind = reg.predict(X_test)
    mae = mean_absolute_error(y_test_reg, preds_wind)
    print(f"🎯 Error Absoluto Medio (MAE) en evaluación ciega: {mae:.2f} nudos")

    # Importancia de las variables físicas
    importances = clf.feature_importances_
    sorted_idx = np.argsort(importances)[::-1][:12]
    print("\n🏆 Top 12 Variables Físicas que gobiernan el viento en Cesantes:")
    for i, idx in enumerate(sorted_idx, 1):
        print(f"   {i}. {features[idx]}: {importances[idx]} puntos")

    # Guardar modelos exportados
    print("\n💾 Exportando modelos a disco...")
    clf.booster_.save_model("cesantes_thermal_classifier.txt")
    reg.booster_.save_model("cesantes_wind_regressor.txt")
    print("✅ Modelos guardados en formato nativo ultraligero (cesantes_*.txt)")
    print("   Listos para compilar a ONNX o evaluar directamente en Node.js en ~1 ms.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MeteoMapGal ML Training on RTX 5090")
    parser.add_argument("--data", type=str, required=True, help="Ruta al archivo CSV o Parquet exportado")
    args = parser.parse_args()

    print("📖 Cargando dataset...")
    if args.data.endswith(".parquet"):
        df_raw = pl.read_parquet(args.data)
    else:
        df_raw = pl.read_csv(args.data, try_parse_dates=True)

    print(f"✅ Cargadas {len(df_raw)} filas de series temporales.")
    df_feat = build_features(df_raw)
    train_and_evaluate(df_feat)
