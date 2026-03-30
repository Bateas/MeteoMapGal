# MeteoMapGal

[![Version](https://img.shields.io/badge/version-1.54.0-blue)](https://github.com/Bateas/MeteoMapGal/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-220%20passed-brightgreen)](src/test/)
[![Stations](https://img.shields.io/badge/stations-100%2B-orange)](src/api/)
[![Buoys](https://img.shields.io/badge/buoys-13-cyan)](src/api/buoyClient.ts)

**Real-time weather monitoring for Galicia** — 100+ stations from 6 networks, 13 marine buoys, 3D interactive map, spot-based sailing intelligence with thermal wind detection, tide predictions, Telegram alerts, and agricultural monitoring.

> **Monitorización meteorolóxica en tempo real para Galicia** — 100+ estacións, 13 boias, mapa 3D, intelixencia de navegación con detección térmica, mareas, alertas Telegram e monitorización agrícola.

<p align="center">
  <img src="hero.png" width="100%" alt="MeteoMapGal — 3D map with real-time weather stations, wind arrows, and sailing spots" />
</p>

**Live**: [meteomapgal.navia3d.com](https://meteomapgal.navia3d.com) &mdash; Free, no account needed. Works on any device. Installable as PWA.

---

## Zones

| Zone | Location | Focus | Coverage |
|------|----------|-------|----------|
| **Embalse de Castrelo de Miño** | Ourense (inland) | Thermal wind for sailing & viticulture | 35 km radius |
| **Rías Baixas** | Pontevedra (coast) | Coastal wind, waves, tides, marine monitoring | 40 km radius, 100+ stations + 13 buoys |

---

## How to Use

1. Open [meteomapgal.navia3d.com](https://meteomapgal.navia3d.com) on phone or desktop
2. Choose zone — Rías Baixas (coast) or Embalse (inland)
3. Tap a **spot** (sailing icon) for conditions: wind, waves, verdict (CALMA → NAVEGABLE → FUERTE)
4. Check the **color**: green = good, amber = marginal, red = dangerous
5. Explore **tabs**: Estaciones, Gráfica, Previsión, Rankings, Historial
6. **Telegram alerts** — daily summary at 9:00 AM + instant alerts for wind changes

---

## Features

### Map & Overlays

- 3D terrain map (MapLibre GL) with 6 switchable base styles + IGN overlays
- Animated wind particles, humidity heatmap, temperature circles
- EUMETSAT satellite IR, RainViewer radar (2h animated), lightning
- Surface currents (RADAR ON RAIA), SST (CMEMS), bathymetry (EMODnet)
- Nautical charts: OpenSeaMap seamarks + IHM ENC (Rías only)

### Weather Intelligence

- **100+ stations** from 6 networks (AEMET, MeteoGalicia, Meteoclimatic, WU, Netatmo, SkyX)
- **13 marine buoys** — waves, wind, water temp, currents, humidity
- Wind consensus: proximity-weighted multi-station analysis (distance x freshness x source quality)
- Wind trend detection: 30min ramp analysis (building/rapid/dropping)
- Barometric pressure trend, fog predictor, cross-sea alerts, upwelling detection
- Historical data in TimescaleDB with interactive charts and CSV export

### Sailing Spots (6 spots)

- 5-level scoring: CALMA → FLOJO → NAVEGABLE → BUEN DÍA → FUERTE
- Thermal boost, humidity precursor (bruma pattern, 96% correlation)
- Theta-v gradient for thermal/bocana detection
- Bocana detector (morning land drainage NE wind)
- Epic day detector (T>30C + HR<45% = strong thermal onset)
- Thermal forecast BETA (12-48h early warning)
- Upwind propagation (coastal wind approaching before it arrives)
- Tide summary per spot (IHM data, 5 ports)
- Best sailing window "Cuándo salgo?" (48h per-spot forecast)
- Webcams in spot popups

### Maritime (Rías Baixas)

- Tide predictions for 5 ports (Vigo, Marín, Vilagarcía, Baiona, Sanxenxo)
- Tide info in scrolling ticker
- Wave conditions with animated glyph visualization
- Maritime fog, cross-sea, upwelling alerts

### Agriculture

- Field alerts (frost, rain, fog, ET0, phytosanitary risk)
- GDD for viticulture (9 phenological stages, Galician calibration)
- Lunar phases with agricultural recommendations
- Drone airspace (UAS zones + ENAIRE NOTAMs)

### General

- PWA installable, keyboard shortcuts, dark/light theme
- Conditions ticker with priority-sorted live data + tide (Rías)
- Telegram alerts (n8n webhook) — daily summary + instant wind changes
- Embeddable widget for clubs/websites
- 220 tests (Vitest), 15 Zustand stores, lazy-loaded components

---

## Widget

```html
<!-- All spots -->
<iframe src="https://meteomapgal.navia3d.com/widget.html?sector=rias"
  width="700" height="400" frameborder="0"></iframe>

<!-- Single spot -->
<iframe src="https://meteomapgal.navia3d.com/widget.html?spot=cesantes&theme=light"
  width="380" height="180" frameborder="0"></iframe>
```

---

## Data Sources

| Source | Data |
|--------|------|
| **AEMET** OpenData | ~9 stations, national radar |
| **MeteoGalicia** | ~13 stations, lightning |
| **Meteoclimatic** | ~10 citizen stations |
| **Weather Underground** | ~10 personal stations |
| **Netatmo** | 60+ consumer stations |
| **SkyX** | 1 personal PWS |
| **Puertos del Estado** | 12 marine buoys |
| **Observatorio Costeiro** | 6 buoy platforms (10-min resolution) |
| **Open-Meteo** | ECMWF/GFS/ICON forecast, GDD archive |
| **EUMETSAT** | Meteosat IR satellite |
| **IHM** | Tides (5 ports) |
| **ENAIRE** | Airspace (UAS + NOTAMs) |
| **CMEMS, EMODnet, IGN, INTECMAR** | SST, bathymetry, cartography, currents |

All data from open/public sources. Only AEMET requires a free API key.

---

## For Developers

```bash
git clone https://github.com/Bateas/MeteoMapGal.git
cd MeteoMapGal
npm install
cp .env.example .env    # Add AEMET + ObsCosteiro API keys
npm run dev             # http://localhost:5173
npm run build           # Production → dist/
npm test                # 220 tests (Vitest)
```

**Stack**: React 19.2 + TypeScript 5.9 + Vite 7.3 + MapLibre GL 5.19 + Zustand 5 + Tailwind 4.2 + Recharts + TimescaleDB

**Ingestor**: Standalone Node.js service polling 6 sources every 5min → TimescaleDB. Runs as systemd service.

---

## Support

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20MeteoMapGal-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/meteomapgal)

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Feito en Galicia · Datos abertos · Código aberto</sub>
</p>
