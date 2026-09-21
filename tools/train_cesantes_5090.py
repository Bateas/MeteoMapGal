"""
MeteoMapGal — Cesantes Thermal Wind ML Training Pipeline (RTX 5090 Edition)
--------------------------------------------------------------------------
Entrenamiento y validación de modelo de Machine Learning para predicción de
viento térmico local en Cesantes (Ría de Vigo / Ensenada de San Simón).

Requisitos en local (ejecutar en tu PC con la 5090):
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
    # Declinación solar
    dec = 23.45 * math.sin(math.radians((360 / 365) * (day_of_year - 81)))
    # Ángulo horario (solar noon ~14:30 en horario de verano en Galicia)
    ha = (hour_local - 14.5) * 15.0
    lat_rad = math.radians(lat)
    dec_rad = math.radians(dec)
    ha_rad = math.radians(ha)
    sin_alt = math.sin(lat_rad) * math.sin(dec_rad) + math.cos(lat_rad) * math.cos(dec_rad) * math.cos(ha_rad)
    return math.degrees(math.asin(max(-1.0, min(1.0, sin_alt))))

def build_features(df: pl.DataFrame) -> pl.DataFrame:
    """Ingeniería de características físicas a partir de series temporales alineadas."""
    print("⚙️  Calculando características físicas y termodinámicas...")
    
    # 1. Gradientes térmicos y barométricos
    df = df.with_columns([
        # Gradiente Interior vs Agua de la Ría (El motor principal de succión)
        (pl.col("ourense_temp") - pl.col("rande_water_temp")).alias("delta_t_ourense_water"),
        # Gradiente Costa vs Agua de la Ría
        (pl.col("vigo_temp") - pl.col("rande_water_temp")).alias("delta_t_vigo_water"),
        # Componentes vectoriales U/V del viento exterior (Cabo Silleiro)
        (-pl.col("silleiro_wind_kt") * (pl.col("silleiro_wind_dir") * math.pi / 180).sin()).alias("silleiro_u"),
        (-pl.col("silleiro_wind_kt") * (pl.col("silleiro_wind_dir") * math.pi / 180).cos()).alias("silleiro_v"),
        # Componentes U/V Rande
        (-pl.col("rande_wind_kt") * (pl.col("rande_wind_dir") * math.pi / 180).sin()).alias("rande_u"),
        (-pl.col("rande_wind_kt") * (pl.col("rande_wind_dir") * math.pi / 180).cos()).alias("rande_v"),
    ])

    # 2. Derivadas temporales (ramp rates a 1 hora = 4 pasos de 15m)
    df = df.with_columns([
        (pl.col("vigo_solar_rad") - pl.col("vigo_solar_rad").shift(4)).alias("solar_ramp_1h"),
        (pl.col("vigo_pressure") - pl.col("vigo_pressure").shift(12)).alias("pressure_drop_3h"), # tendencia barométrica 3h
        (pl.col("vigo_sea_level_cm") - pl.col("vigo_sea_level_cm").shift(4)).alias("tide_rate_1h"), # velocidad marea
    ])

    # 3. Lags de condiciones (qué pasaba hace 1h y 2h)
    df = df.with_columns([
        pl.col("rande_wind_kt").shift(4).alias("rande_wind_kt_lag1h"),
        pl.col("silleiro_wind_kt").shift(4).alias("silleiro_wind_kt_lag1h"),
        pl.col("vigo_temp").shift(4).alias("vigo_temp_lag1h"),
    ])

    # 4. Definición de Variable Objetivo (TARGET):
    # ¿Hay térmico navegable en Cesantes dentro de 2 horas (t + 8 pasos)?
    # Definición física: Viento >= 11 kt con dirección SW (210° a 270°)
    target_lead_steps = 8 # 2 horas vista
    df = df.with_columns([
        pl.col("cesantes_wind_kt").shift(-target_lead_steps).alias("target_wind_kt_lead2h"),
        pl.col("cesantes_gust_kt").shift(-target_lead_steps).alias("target_gust_kt_lead2h"),
        pl.col("cesantes_wind_dir").shift(-target_lead_steps).alias("target_wind_dir_lead2h"),
    ])

    # Clasificación binaria: ¿Térmico navegable activo a t+2h?
    df = df.with_columns([
        (
            (pl.col("target_wind_kt_lead2h") >= 11.0) & 
            (pl.col("target_wind_dir_lead2h") >= 200.0) & 
            (pl.col("target_wind_dir_lead2h") <= 270.0)
        ).cast(pl.Int32).alias("target_thermal_active_lead2h")
    ])

    return df

def train_and_evaluate(df: pl.DataFrame):
    import lightgbm as lgb
    from sklearn.metrics import roc_auc_score, mean_absolute_error, classification_report

    # Filtrar únicamente horas diurnas (10:00 a 20:00 local) donde tiene sentido predecir térmicos
    df_day = df.filter((pl.col("hour_local") >= 10) & (pl.col("hour_local") <= 20))
    
    # Partición temporal ciega (Out-of-time):
    # Train: Marzo - Julio 2026
    # Test: Agosto - Septiembre 2026
    train_mask = pl.col("month") <= 7
    test_mask = pl.col("month") >= 8

    train_df = df_day.filter(train_mask).drop_nulls(subset=["target_wind_kt_lead2h"])
    test_df = df_day.filter(test_mask).drop_nulls(subset=["target_wind_kt_lead2h"])

    print(f"\n📊 Partición de Datos:")
    print(f"   - Entrenamiento (Marzo-Julio): {len(train_df)} muestras")
    print(f"   - Evaluación ciega (Agosto-Septiembre): {len(test_df)} muestras")

    features = [
        "hour_local", "day_of_year", "delta_t_ourense_water", "delta_t_vigo_water",
        "ourense_temp", "rande_water_temp", "vigo_temp", "vigo_solar_rad", "solar_ramp_1h",
        "vigo_pressure", "pressure_drop_3h", "tide_rate_1h", "vigo_sea_level_cm",
        "silleiro_wind_kt", "silleiro_u", "silleiro_v", "silleiro_wave_height", "silleiro_water_temp",
        "rande_wind_kt", "rande_u", "rande_v", "rande_salinity",
        "cies_wind_kt", "cies_wind_dir",
        "rande_wind_kt_lag1h", "silleiro_wind_kt_lag1h", "vigo_temp_lag1h"
    ]

    # Convertir a pandas/numpy para LightGBM
    X_train = train_df.select(features).to_pandas()
    y_train_reg = train_df.select("target_wind_kt_lead2h").to_series().to_numpy()
    y_train_clf = train_df.select("target_thermal_active_lead2h").to_series().to_numpy()

    X_test = test_df.select(features).to_pandas()
    y_test_reg = test_df.select("target_wind_kt_lead2h").to_series().to_numpy()
    y_test_clf = test_df.select("target_thermal_active_lead2h").to_series().to_numpy()

    print("\n🚀 Entrenando Modelo 1: Clasificador de Probabilidad de Térmico (LightGBM)...")
    clf = lgb.LGBMClassifier(
        n_estimators=300,
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
    print(f"🎯 ROC-AUC en evaluación ciega (Agosto-Septiembre): {auc:.4f}")

    print("\n🚀 Entrenando Modelo 2: Regresor de Viento en Nudos (LightGBM)...")
    reg = lgb.LGBMRegressor(
        n_estimators=400,
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
    sorted_idx = np.argsort(importances)[::-1][:10]
    print("\n🏆 Top 10 Variables Físicas que gobiernan el viento en Cesantes:")
    for i, idx in enumerate(sorted_idx, 1):
        print(f"   {i}. {features[idx]}: {importances[idx]} puntos")

    # Guardar modelos exportados
    print("\n💾 Exportando modelos a disco...")
    clf.booster_.save_model("cesantes_thermal_classifier.txt")
    reg.booster_.save_model("cesantes_wind_regressor.txt")
    print("✅ Modelos guardados en formato nativo ultraligero (cesantes_*.txt)")

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
