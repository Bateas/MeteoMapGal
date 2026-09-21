# MeteoMapGal ML v1 — Guía Rápida de Entrenamiento (RTX 5090)

Para la teoría física completa, diagramas termodinámicos y justificación de variables, consulta:
👉 [`docs/data-science/HIPOTESIS_MODELO_PREDICTOR_CESANTES.md`](../docs/data-science/HIPOTESIS_MODELO_PREDICTOR_CESANTES.md)

---

## Comandos Rápidos de Ejecución

### 1. En el Servidor de Base de Datos (troceado por meses, fuera de horas de uso):
```bash
cd RUTA_DEL_REPO
git pull origin master
sudo -u postgres psql -d meteomapgal -f tools/export_cesantes_curated.sql -A -F ',' | gzip > /tmp/cesantes_curated_2026.csv.gz
```

### 2. En tu PC Local (con la RTX 5090):
Descarga el fichero:
```powershell
scp USUARIO@SERVIDOR_DB:/tmp/cesantes_curated_2026.csv.gz RUTA_LOCAL
```
Descomprime el archivo `.gz` para obtener `cesantes_curated_2026.csv`.

Instala los paquetes necesarios:
```bash
pip install polars lightgbm scikit-learn matplotlib pyarrow
```

Ejecuta el pipeline:
```bash
python tools/train_cesantes_5090.py --data cesantes_curated_2026.csv
```

El script genera:
* Métrica ROC-AUC de acierto probabilístico en evaluación ciega (Agosto-Septiembre 2026).
* Error MAE en nudos de viento.
* Ranking Top 12 de variables físicas determinantes.
* Modelos exportados ultraligeros: `cesantes_thermal_classifier.txt` y `cesantes_wind_regressor.txt` (<2 MB).
