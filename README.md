# MeteoMapGal

[![Version](https://img.shields.io/badge/version-1.9.5-blue)](https://github.com/Bateas/MeteoMapGal/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-159%20passed-brightgreen)](src/test/)

**Real-time weather monitoring for Galicia** — 100+ weather stations, 12 marine buoys, 3D interactive map, thermal wind analysis for sailing, spot-based sailing intelligence, and agricultural alerts for viticulture.

> **Monitorización meteorolóxica en tempo real para Galicia** — 100+ estacións meteorolóxicas, 12 boias mariñas, mapa 3D interactivo, análise de vento térmico para navegación, intelixencia de navegación por spots e alertas agrícolas para viticultura.

<!-- TODO: Add hero screenshot -->
<!-- ![MeteoMapGal](hero.png) -->

---

## What is MeteoMapGal?

MeteoMapGal is a free, open-source weather monitoring application built specifically for **Galicia (Spain)**. It brings together data from **6 station networks** and **7 supplementary sources** into a single real-time dashboard with a 3D interactive map.

Currently monitoring two zones:

| Zone | Location | Focus | Coverage |
|------|----------|-------|----------|
| **Embalse de Castrelo de Miño** | Ourense (inland) | Thermal wind analysis for sailing | 35 km radius, 90+ stations |
| **Rías Baixas** | Pontevedra (coast) | Coastal wind, waves, tides & marine monitoring | 40 km radius, 60+ stations + 12 buoys |

> **Roadmap:** New monitoring zones across Galicia are planned for future releases (A Coruña, Lugo, Costa da Morte...).

## Que é MeteoMapGal?

MeteoMapGal é unha aplicación gratuíta e de código aberto de monitorización meteorolóxica creada especificamente para **Galicia**. Agrega datos de **6 redes de estacións** e **7 fontes complementarias** nun panel en tempo real cun mapa 3D interactivo.

Actualmente monitoriza dúas zonas:

| Zona | Localización | Enfoque | Cobertura |
|------|--------------|---------|-----------|
| **Encoro de Castrelo de Miño** | Ourense (interior) | Análise de vento térmico para navegación | Radio 35 km, 90+ estacións |
| **Rías Baixas** | Pontevedra (costa) | Vento costeiro, ondas, mareas e monitorización mariña | Radio 40 km, 60+ estacións + 12 boias |

> **Folla de ruta:** Prevense novas zonas de monitorización en futuras versións (A Coruña, Lugo, Costa da Morte...).

---

## Features

### Map & Visualization

| Feature | Description |
|---------|-------------|
| **3D interactive map** | Terrain visualization with MapLibre GL — pan, zoom, tilt freely |
| **Wind particles** | Animated wind flow overlay showing real-time direction and speed |
| **Humidity heatmap** | IDW-interpolated humidity layer across all stations |
| **IR satellite** | EUMETSAT Meteosat infrared imagery, updated every 15 minutes |
| **Precipitation radar** | AEMET Cuntis radar with time animation |
| **Surface currents** | RADAR ON RAIA HF radar WMS overlay (Rías only) |
| **Bathymetry** | EMODnet depth contour overlay for marine context |

### Real-Time Monitoring

| Feature | Description |
|---------|-------------|
| **100+ weather stations** | From 5 networks: AEMET, MeteoGalicia, Meteoclimatic, Weather Underground, Netatmo |
| **12 marine buoys** | Wave height, period, direction, water temperature, currents and sea level |
| **Wind consensus** | Multi-station trend analysis with zone coherence and stability duration |
| **Lightning detection** | Real-time strikes with proximity alerts |
| **Unified alert system** | Prioritized alerts with coherent severity: PELIGRO (critical), ALERTA, AVISO, OK |
| **Critical alert banner** | Top-of-screen banner for dangerous conditions with subtle audio notification |
| **Barometric pressure trend** | 3h consensus pressure drop/rise detection across stations |
| **Historical data** | TimescaleDB storage — 90+ stations polled every 5 min, with interactive charts |
| **Wind rose** | Historical wind direction analysis with speed bins |
| **Station comparison** | Side-by-side time series for any two stations |

### Sailing & Navigation (Embalse sector)

| Feature | Description |
|---------|-------------|
| **Spot-based scoring** | Per-spot GO / Marginal / No-Go verdict with thermal context |
| **Thermal wind cycle** | Lake/mountain breeze analysis with propagation timing |
| **Atmospheric profile** | CAPE, PBL height, CIN, Lifted Index for thermal evaluation |
| **Storm shadow** | Lightning-confirmed hazard detection with night filtering |

### Maritime Monitoring (Rías Baixas sector)

| Feature | Description |
|---------|-------------|
| **Spot-based scoring** | 4 sailing spots (Cesantes, Bocana, Centro Ría, Cíes-Ría) with wind pattern scoring |
| **Tide predictions** | IHM data for 5 Rías Baixas ports with tide curves |
| **Wave conditions** | Height, period, direction with sea state visualization |
| **Ocean currents** | Speed and direction from coastal buoys |
| **Maritime fog predictor** | Advection fog from SST-air ΔT + onshore wind + humidity |
| **Cross-sea alerts** | Wave-wind angular divergence detection with severity scaling |
| **Marine buoy network** | REDEXT, CETMAR, REMPOR, REDMAR stations across all 3 Rías |

### Agriculture & Field Work

| Feature | Description |
|---------|-------------|
| **Field alert panel** | Frost, rain, fog, ET₀, phytosanitary risk |
| **GDD (viticulture)** | Growing degree days with phenological stage tracking for Galician grapes |
| **Lunar phases** | 8 phases, illumination %, agricultural advice for Galician crops |
| **Drone airspace** | UAS zones and ENAIRE NOTAMs with fly/no-fly verdict |

### General

| Feature | Description |
|---------|-------------|
| **PWA** | Installable on mobile and desktop, works offline with data cache |
| **24h charts** | Time series with CSV export for any station |
| **Keyboard shortcuts** | Full keyboard navigation (W, A, T, E, B keys + more) |
| **CSS micro-animations** | Smooth transitions, glow effects, animated borders on active elements |

---

## Data Sources

All data comes from **open and public sources** — no paid APIs required (only AEMET needs a free API key):

| Source | Type | Data |
|--------|------|------|
| **AEMET** OpenData | Official network | 9 stations, Cuntis precipitation radar |
| **MeteoGalicia** | Regional network | 13 stations, lightning detection |
| **Meteoclimatic** | Citizen network | 6 stations |
| **Weather Underground** | Personal stations | 1 station |
| **Netatmo** | Consumer IoT | 60+ stations |
| **Puertos del Estado** | Marine buoys | 12 stations (REDEXT, CETMAR, REMPOR, REDMAR) |
| **Observatorio Costeiro** | Xunta supplementary | 6 buoy platforms (humidity, dew point, 10-min resolution) |
| **Open-Meteo** | Numerical models | ECMWF/GFS forecast, atmospheric profile, GDD archive |
| **EUMETSAT** | Satellite | Meteosat IR imagery |
| **RADAR ON RAIA** | HF radar | Surface currents WMS (INTECMAR THREDDS, Rías only) |
| **IHM** | Tides | 5 Rías Baixas ports |
| **ENAIRE** | Airspace | UAS zones + NOTAMs |
| **EMODnet** | Bathymetry | Depth contour WMS overlay |

---

## Roadmap

### Done

- [x] Multi-sector support (Embalse + Rías Baixas)
- [x] 90+ weather stations from 5 networks
- [x] 12 marine buoys (Puertos del Estado) + Observatorio Costeiro supplementary data
- [x] Wind particles, humidity heatmap, satellite & radar overlays
- [x] Surface currents overlay (RADAR ON RAIA HF radar)
- [x] Bathymetry overlay (EMODnet)
- [x] Spot-based sailing intelligence (Cesantes, Bocana, Centro Ría, Cíes-Ría + Castrelo)
- [x] Sailing scoring with GO/Marginal/No-Go verdict
- [x] Thermal wind analysis & atmospheric profile
- [x] Coherent alert system (PELIGRO reserved for extremes, subtle audio notifications)
- [x] Barometric pressure trend + maritime fog predictor + cross-sea alerts
- [x] Tide predictions (5 ports)
- [x] Lightning detection with alerts
- [x] Field panel (frost, fog, rain, ET₀, phytosanitary)
- [x] GDD for viticulture (9 phenological stages)
- [x] Lunar phases with agricultural advice
- [x] Drone airspace (UAS zones + NOTAMs)
- [x] Historical data dashboard (TimescaleDB)
- [x] Wind rose & station comparison
- [x] Smart station filtering (interior exclusion zones + cross-source proximity dedup)
- [x] PWA (installable, offline mode)
- [x] CSV export
- [x] CSS micro-animations & BETA badges

### Planned

- [ ] New monitoring zones (A Coruña, Lugo, Costa da Morte)
- [ ] Fog & inversion forecast improvements
- [ ] Feedback form + community suggestions
- [ ] Ko-fi donations

---

## Screenshots

<p align="center">
  <img src="hero.png" width="100%" alt="MeteoMapGal — 3D map with real-time stations" />
</p>

<!-- TODO: Add more screenshots showing different panels and sectors -->

---

## For Developers

<details>
<summary><strong>Quick Start</strong></summary>

```bash
git clone https://github.com/Bateas/MeteoMapGal.git
cd MeteoMapGal
npm install

# Configure API keys (required)
cp .env.example .env
# Edit .env with your AEMET key from https://opendata.aemet.es
# and Observatorio Costeiro key

npm run dev       # http://localhost:5173
npm run build     # Production build → dist/
npm test          # 159 tests (Vitest)
```

</details>

<details>
<summary><strong>Tech Stack</strong></summary>

| Technology | Purpose |
|------------|---------|
| React 19 + TypeScript 5.9 | Strictly typed UI |
| Vite 7 | Build tool + HMR + CORS proxy |
| MapLibre GL JS 5 | 3D map with terrain |
| Zustand 5 | Global state (10 stores) |
| Tailwind CSS 4 | Utility-first styling |
| Recharts | Time series charts |
| Vitest | 159 unit tests |
| TimescaleDB | Historical readings (PostgreSQL + hypertables) |

</details>

<details>
<summary><strong>Project Structure</strong></summary>

```
src/
├── api/           # API clients (13 sources)
├── components/    # UI (map, dashboard, charts, guide, layout)
├── config/        # Constants, thermal zones, sectors
├── hooks/         # Custom hooks (weather, thermal, forecast...)
├── services/      # Business logic (scoring, alerts, IDW, GDD, lunar...)
├── store/         # Zustand stores (10 stores)
└── types/         # TypeScript types

ingestor/          # Standalone Node.js service → TimescaleDB
├── index.ts       # Main loop: 5min poll, 1h rediscovery
├── db.ts          # pg Pool + batch upsert
├── discover.ts    # Station discovery (5 sources, both sectors)
├── fetchers.ts    # Observation fetchers → NormalizedReading[]
└── schema.sql     # Idempotent DB schema
```

</details>

<details>
<summary><strong>Deployment</strong></summary>

Production runs on **nginx reverse proxy** (Proxmox LXC). The ingestor runs as a systemd service on the same host, writing to a separate TimescaleDB LXC. See `nginx.conf` for CORS proxy routes and security headers.

```bash
npm run build     # Build → dist/
# Copy dist/ to server
```

</details>

---

## License

[MIT](LICENSE)

## Acknowledgements

Built with the assistance of [Claude](https://claude.ai) (Anthropic).

---

<p align="center">
  <sub>Feito en Galicia · Datos abertos · Código aberto</sub>
</p>
