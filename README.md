# MeteoMapGal

[![Version](https://img.shields.io/badge/version-1.22.9-blue)](https://github.com/Bateas/MeteoMapGal/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-185%20passed-brightgreen)](src/test/)
[![Stations](https://img.shields.io/badge/stations-100%2B-orange)](src/api/)
[![Buoys](https://img.shields.io/badge/buoys-13-cyan)](src/api/buoyClient.ts)

**Real-time weather monitoring for Galicia** — 100+ weather stations from 6 networks, 13 marine buoys, 3D interactive map, spot-based sailing intelligence with thermal wind detection, tide predictions, webcams, Telegram alerts, and agricultural monitoring for viticulture.

> **Monitorización meteorolóxica en tempo real para Galicia** — 100+ estacións de 6 redes, 13 boias mariñas, mapa 3D interactivo, intelixencia de navegación por spots con detección de vento térmico, predición de mareas, webcams, alertas por Telegram e monitorización agrícola para viticultura.

<p align="center">
  <img src="hero.png" width="100%" alt="MeteoMapGal — 3D map with real-time weather stations, wind arrows, and sailing spots" />
</p>

---

## What is MeteoMapGal?

MeteoMapGal is a free, open-source weather monitoring application built specifically for **Galicia (Spain)**. It brings together data from **6 station networks** and **10+ supplementary sources** into a single real-time dashboard with a 3D interactive map.

Currently monitoring two zones:

| Zone | Location | Focus | Coverage |
|------|----------|-------|----------|
| **Embalse de Castrelo de Miño** | Ourense (inland) | Thermal wind analysis for sailing & viticulture | 35 km radius |
| **Rías Baixas** | Pontevedra (coast) | Coastal wind, waves, tides, spots & marine monitoring | 40 km radius, 100+ stations + 13 buoys |

**Live**: [meteomapgal.navia3d.com](https://meteomapgal.navia3d.com)

> **Roadmap:** New monitoring zones across Galicia are planned for future releases (A Coruña, Lugo, Costa da Morte...).

## Que é MeteoMapGal?

MeteoMapGal é unha aplicación gratuíta e de código aberto de monitorización meteorolóxica creada especificamente para **Galicia**. Agrega datos de **6 redes de estacións** e **10+ fontes complementarias** nun panel en tempo real cun mapa 3D interactivo.

| Zona | Localización | Enfoque | Cobertura |
|------|--------------|---------|-----------|
| **Encoro de Castrelo de Miño** | Ourense (interior) | Análise de vento térmico para navegación e viticultura | Radio 35 km |
| **Rías Baixas** | Pontevedra (costa) | Vento costeiro, ondas, mareas, spots e monitorización mariña | Radio 40 km, 100+ estacións + 13 boias |

---

## Features

### Map & Visualization

| Feature | Description |
|---------|-------------|
| **3D interactive map** | Terrain visualization with MapLibre GL — pan, zoom, tilt freely |
| **6 base map styles** | OSM, Positron, Dark Matter, Voyager (default), IGN Topográfico, IGN Base Gris |
| **Wind particles** | Animated wind flow overlay showing real-time direction and speed |
| **Humidity heatmap** | IDW-interpolated humidity layer across all stations |
| **Temperature overlay** | Per-station temperature circles with color gradient |
| **IR satellite** | EUMETSAT Meteosat infrared imagery, updated every 15 minutes |
| **Precipitation radar** | AEMET Cuntis radar with time animation |
| **Surface currents** | RADAR ON RAIA HF radar WMS overlay (Rías only) |
| **Bathymetry** | EMODnet depth contour overlay for marine context |
| **SST overlay** | Copernicus Marine (CMEMS) sea surface temperature WMTS tiles (Rías only) |
| **Nautical charts** | OpenSeaMap seamarks + IHM ENC official nautical charts (Rías only) |
| **IGN overlays** | Ortofotos PNOA, hillshade MDT, contour lines (both sectors) |

### Real-Time Monitoring

| Feature | Description |
|---------|-------------|
| **90+ weather stations** | From 6 networks: AEMET, MeteoGalicia, Meteoclimatic, Weather Underground, Netatmo, SkyX |
| **13 marine buoys** | Wave height, period, direction, water temperature, wind, currents, sea level, humidity |
| **Wind consensus** | Quality-weighted multi-station analysis (source quality × distance × freshness) |
| **Wind arrows on buoys** | Direct wind arrow + speed badge on buoy markers with anemometers |
| **Lightning detection** | Real-time strikes with proximity alerts |
| **Unified alert system** | Prioritized alerts with coherent severity: PELIGRO (critical), ALERTA, AVISO, OK |
| **Critical alert banner** | Top-of-screen banner for dangerous conditions with subtle audio notification |
| **Barometric pressure trend** | 3h consensus pressure drop/rise detection across stations |
| **Historical data** | TimescaleDB storage — 93 stations polled every 5 min, with interactive charts |
| **Wind rose** | Historical wind direction analysis with speed bins |
| **Station comparison** | Side-by-side time series for any two stations |
| **Rankings panel** | Top stations by wind, temperature, humidity, pressure |
| **Forecast verification** | "¿Acertó?" — compares past Open-Meteo forecasts vs actual observations (MAE, bias, accuracy) |
| **Forecast delta** | Real-time Δ badges showing forecast vs observation deviation |
| **Stale indicator** | Visual opacity fade on stations with outdated readings |
| **Telegram alerts** | n8n webhook → Telegram bot for real-time push notifications |

### Sailing & Spot Intelligence

| Feature | Description |
|---------|-------------|
| **6 sailing spots** | Cesantes, Bocana, Centro Ría, Cíes-Ría, Lourido (Rías) + Castrelo (Embalse) |
| **5-level scoring** | CALMA → FLOJO → NAVEGABLE → BUENO → FUERTE with GO/Marginal/No-Go verdict |
| **Thermal boost** | Amplifies scoring when thermal probability ≥40% + WSW direction (land stations underestimate water wind) |
| **Tide summary per spot** | Integrated IHM tide predictions (▲ pleamar / ▼ bajamar) with next-tide highlight |
| **Best sailing window** | "¿Cuándo salgo?" — 48h forecast per-spot window detection with dual scoring |
| **Scoring breakdown** | "¿Por qué?" — transparent per-component score explanation |
| **Webcams** | Live camera feeds in spot popups (Cíes image, Cesantes stream, Vigo Móvil, Lourido) |
| **Wind trend + sparkline** | 2h wind history graph + trend indicator (↑/→/↓) in spot popup |
| **Thermal wind cycle** | Lake/mountain breeze analysis with propagation timing (Embalse) |
| **Atmospheric profile** | CAPE, PBL height, CIN, Lifted Index for thermal evaluation (Embalse) |

### Maritime Monitoring (Rías Baixas)

| Feature | Description |
|---------|-------------|
| **Tide predictions** | IHM data for 5 Rías Baixas ports (Vigo, Marín, Vilagarcía, Baiona, Sanxenxo) |
| **Wave conditions** | Height, period, direction with animated wave glyph visualization |
| **Ocean currents** | Speed and direction from coastal buoys + HF radar overlay |
| **Maritime fog predictor** | Advection fog from SST-air ΔT + onshore wind + humidity + solar radiation |
| **Cross-sea alerts** | Wave-wind angular divergence detection with wave period severity scaling |
| **Upwelling detector** | N/NW wind sustained ≥12kt → Ekman transport → SST drop alert |
| **Marine buoy network** | REDEXT, CETMAR, REMPOR, REDMAR + Observatorio Costeiro across all 3 Rías |

### Agriculture & Field Work

| Feature | Description |
|---------|-------------|
| **Field alert panel** | Frost, rain, fog, ET₀, phytosanitary risk |
| **GDD (viticulture)** | Growing degree days with 9 phenological stages for Galician grapes |
| **Lunar phases** | 8 phases, illumination %, agricultural advice for Galician crops |
| **Drone airspace** | UAS zones and ENAIRE NOTAMs with fly/no-fly verdict |
| **NAO/AO teleconnections** | North Atlantic Oscillation indices for seasonal context |

### General

| Feature | Description |
|---------|-------------|
| **PWA** | Installable on mobile and desktop, works offline with data cache |
| **24h charts** | Time series with CSV export for any station |
| **Keyboard shortcuts** | Full keyboard navigation (W, A, T, E, B keys + more) |
| **MeteoGuide** | 13-section in-app guide with animated diagrams (press G) |
| **Visibility polling** | All API fetches pause in background tabs to save bandwidth |
| **Mobile-first** | Bottom sheets, touch-optimized controls, responsive sidebar |

---

## Data Sources

All data comes from **open and public sources** — no paid APIs required (only AEMET needs a free API key):

| Source | Type | Data |
|--------|------|------|
| **AEMET** OpenData | Official network | ~9 stations, Cuntis precipitation radar |
| **MeteoGalicia** | Regional network | ~13 stations, lightning detection |
| **Meteoclimatic** | Citizen network | ~10 stations |
| **Weather Underground** | Personal stations | ~10 stations (auto-discovered) |
| **Netatmo** | Consumer IoT | 60+ stations |
| **SkyX** | Personal PWS | 1 station (GPS-based auto-discovery) |
| **Puertos del Estado** | Marine buoys | 12 stations (REDEXT, CETMAR, REMPOR, REDMAR) |
| **Observatorio Costeiro** | Xunta supplementary | 6 buoy platforms (humidity, dew point, 10-min resolution) |
| **Open-Meteo** | Numerical models | ECMWF/GFS forecast, atmospheric profile, GDD archive, Previous Runs API |
| **EUMETSAT** | Satellite | Meteosat IR imagery |
| **RADAR ON RAIA** | HF radar | Surface currents WMS (INTECMAR THREDDS, Rías only) |
| **CMEMS** | Sea surface temp | Copernicus Marine SST WMTS tiles (Rías only) |
| **IHM** | Tides | 5 Rías Baixas ports |
| **ENAIRE** | Airspace | UAS zones + NOTAMs |
| **EMODnet** | Bathymetry | Depth contour WMS overlay |
| **IGN** | Cartography | Topographic map, ortophotos, hillshade, contour lines |

---

## Roadmap

### Done (v1.0 → v1.22)

- [x] Multi-sector support (Embalse + Rías Baixas)
- [x] 100+ weather stations from 6 networks (incl. SkyX personal PWS with GPS auto-discovery)
- [x] 13 marine buoys (Puertos del Estado + Observatorio Costeiro) with wind arrows
- [x] 6 sailing spots with 5-level scoring, thermal boost, webcams, tide summary
- [x] Wind particles, humidity heatmap, satellite, radar, currents overlays
- [x] SST overlay (CMEMS), bathymetry (EMODnet), nautical charts (OpenSeaMap + IHM)
- [x] 6 switchable base maps + IGN overlays (ortho, hillshade, contours)
- [x] Thermal wind analysis & atmospheric profile (Embalse)
- [x] Best sailing window "¿Cuándo salgo?" (48h per-spot forecast)
- [x] Forecast verification "¿Acertó?" (Previous Runs API vs observations)
- [x] Forecast delta badges (real-time Δ wind/temp)
- [x] Coherent alert system (PELIGRO reserved for extremes)
- [x] Barometric pressure trend + maritime fog + cross-sea + upwelling alerts
- [x] Tide predictions (5 ports) + per-spot tide summary
- [x] Lightning detection with alerts + storm shadow detector
- [x] Field panel (frost, fog, rain, ET₀, phytosanitary)
- [x] GDD for viticulture (9 phenological stages) + lunar phases
- [x] Drone airspace (UAS zones + NOTAMs)
- [x] Historical data dashboard (TimescaleDB, 93 stations, 5min cadence)
- [x] Wind rose, station comparison, rankings, NAO/AO indices
- [x] Quality-weighted scoring (source quality × distance × freshness)
- [x] n8n + Telegram bot for push notifications (moderate + high + critical severity)
- [x] PWA (installable, offline mode) + CSV export
- [x] Smart station filtering (interior exclusion + cross-source proximity dedup)
- [x] Conditions ticker — scrolling banner with spot verdicts, max wind, waves, temperature range
- [x] Spot favorites — persistent per-user favorite spot with quick access
- [x] Heat index — NWS formula for apparent temperature when T>27°C and HR>40%
- [x] Wind gust factor — turbulence indicator in station popups
- [x] Webcam vision IA — LLM-powered multiparameter analysis (Beaufort, sky, fog, visibility, precipitation) — experimental, dev only
- [x] Typed Zustand selectors — compile-time safety for store property access
- [x] Sailing Windows — "¿Cuándo salgo?" 48h per-spot forecast with best sailing window detection
- [x] Forecast mini-timeline — 12h hourly forecast inline in SpotPopup
- [x] Swipe-to-dismiss on mobile bottom sheets (spots, stations, buoys)
- [x] Focus trap + ARIA roles for accessible modals
- [x] Zoom-dependent station labels (hidden at low zoom to reduce clutter)
- [x] Web Vitals performance monitoring (LCP, INP, CLS)

### Planned

- [ ] Daily summary Telegram bot (N2-Bot) — morning conditions report
- [ ] Proactive spot alerts (N3-Bot) — push when spot goes from bad to good
- [ ] New monitoring zones (A Coruña, Lugo, Costa da Morte)
- [ ] More sailing spots (Sanxenxo, Lanzada, A Illa de Arousa, Samil)
- [ ] Ko-fi donations + feedback form
- [ ] Vision IA cross-validation with real-time alerts

---

## Screenshots

<p align="center">
  <img src="hero.png" width="100%" alt="MeteoMapGal — Embalse de Castrelo with 3D terrain, wind stations, and thermal zones" />
  <br/>
  <sub>Embalse de Castrelo — 3D terrain map with real-time wind stations, thermal zones, and sailing scoring</sub>
</p>

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
npm test          # 185 tests (Vitest)
```

</details>

<details>
<summary><strong>Tech Stack</strong></summary>

| Technology | Purpose |
|------------|---------|
| React 19.2 + TypeScript 5.9 | Strictly typed UI |
| Vite 7.3 | Build tool + HMR + CORS proxy (17 routes) |
| MapLibre GL JS 5.19 | 3D map with terrain |
| Zustand 5 | Global state (13 stores, typed selectors) |
| Tailwind CSS 4.2 | Utility-first styling |
| Recharts | Time series charts |
| Vitest 4 | 185 unit tests |
| TimescaleDB 2.25 | Historical readings (PostgreSQL + hypertables, 2y retention) |

</details>

<details>
<summary><strong>Project Structure</strong></summary>

```
src/
├── api/           # API clients (16 sources)
├── components/    # UI (map, dashboard, charts, guide, layout, icons)
│   ├── map/       # 30+ map overlays, markers, popups
│   ├── dashboard/ # Sidebar components (lazy-loaded)
│   ├── charts/    # Recharts visualizations
│   └── guide/     # MeteoGuide (13 sections)
├── config/        # Constants, thermal zones, sectors, spots
├── hooks/         # Custom hooks (weather, thermal, forecast, buoys, spots...)
├── services/      # Business logic (25+ services: scoring, alerts, IDW, GDD...)
├── store/         # Zustand stores (13 stores)
└── types/         # TypeScript types

ingestor/          # Standalone Node.js service → TimescaleDB
├── index.ts       # Main loop: 5min poll, 1h rediscovery, graceful shutdown
├── db.ts          # pg Pool + batch upsert (ON CONFLICT DO NOTHING)
├── discover.ts    # Station discovery (5 sources, both sectors)
├── fetchers.ts    # Observation fetchers → NormalizedReading[]
└── schema.sql     # Idempotent DB schema (hypertables, compression, retention)
```

</details>

<details>
<summary><strong>Deployment</strong></summary>

Production runs on **nginx reverse proxy** on a Proxmox LXC container (Debian 12, Node 22). The ingestor runs as a systemd service on the same host, writing to a separate TimescaleDB LXC (PostgreSQL 16 + TimescaleDB 2.25).

```bash
npm run build     # Build → dist/
# Copy dist/ to /var/www/meteomapgal on the LXC
# nginx.conf provides 17 CORS proxy routes + SPA fallback + gzip + security
```

Public access via Cloudflare Tunnel.

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
