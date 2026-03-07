# MeteoMapGal

**Real-time weather monitoring for Galicia** — 41 stations, 3D interactive map, thermal wind analysis for sailing.

<!-- TODO: Add hero screenshot -->
<!-- ![MeteoMapGal](hero.png) -->

---

## About

MeteoMapGal is a real-time weather monitoring application for **Galicia (Spain)**, currently covering two sectors:

- **Embalse de Castrelo de Miño** (Ourense) — thermal wind analysis for inland sailing, 35 km radius
- **Rías Baixas** (Pontevedra) — coastal wind and maritime monitoring, 30 km radius

It aggregates data from **5 station networks**, numerical models, satellite imagery, radar, tides and airspace into a single unified interface.

> **Roadmap:** New monitoring zones across Galicia are planned for future releases (A Coruña, Lugo, Costa da Morte...).

## Features

| Feature | Description |
|---|---|
| **Real-time wind** | 41 stations with multi-station consensus, trend and zone coherence |
| **3D interactive map** | MapLibre GL with 3D terrain, wind particles, humidity heatmap |
| **Sailing briefing** | Score 0–100 with GO / Marginal / No-Go verdict based on real consensus |
| **Atmospheric profile** | CAPE, BLH, CIN, Lifted Index for thermal evaluation |
| **IR satellite** | EUMETSAT infrared imagery updated every 15 min |
| **Precipitation radar** | AEMET Cuntis with time animation |
| **Lightning** | Real-time detection with proximity alerts |
| **Tides** | IHM predictions for 5 Rías Baixas ports |
| **Airspace** | UAS zones and ENAIRE NOTAMs with drone verdict |
| **Field panel** | Phytosanitary risk (mildew/oidium) and evapotranspiration for irrigation |
| **24h charts** | Time series with CSV export |
| **PWA** | Installable, works offline with data cache |

## Screenshots

<p align="center">
  <img src="hero.png" width="100%" alt="MeteoMapGal — 3D map with real-time stations" />
</p>

## Quick Start

```bash
# Clone and install
git clone https://github.com/Bateas/MeteoMapGal.git
cd MeteoMapGal
npm install

# Configure AEMET API key (required)
cp .env.example .env
# Edit .env with your key from https://opendata.aemet.es

# Development
npm run dev       # http://localhost:5173

# Production
npm run build     # dist/ with hashed assets
npm test          # 159 tests (Vitest)
```

## Tech Stack

| Technology | Purpose |
|---|---|
| React 19 + TypeScript 5.9 | Strictly typed UI |
| Vite 7 | Build tool + HMR + CORS proxy |
| MapLibre GL JS 5 | 3D map with terrain |
| Zustand 5 | Global state (9 stores) |
| Tailwind CSS 4 | Utility-first styling |
| Recharts | Time series charts |
| Vitest | 159 unit tests |

## Data Sources

All data comes from **open and public sources**:

| Source | Type | Data |
|---|---|---|
| **AEMET** OpenData | Official stations | 9 stations, Cuntis radar |
| **MeteoGalicia** | Regional network | 13 stations, lightning |
| **Meteoclimatic** | Citizen network | 6 stations |
| **Weather Underground** | Personal stations | 1 station |
| **Netatmo** | Consumer IoT | 11 stations |
| **Open-Meteo** | Numerical model | ECMWF/GFS forecast + atmospheric profile |
| **EUMETSAT** | Satellite | Meteosat IR imagery |
| **IHM** | Tides | 5 Rías Baixas ports |
| **ENAIRE** | Airspace | UAS zones + NOTAMs |

## Project Structure

```
src/
├── api/           # API clients (9 sources)
├── components/    # UI (map, dashboard, charts, guide, layout)
├── config/        # Constants, thermal zones, sectors
├── hooks/         # Custom hooks (weather, thermal, forecast...)
├── services/      # Business logic (scoring, alerts, IDW...)
├── store/         # Zustand stores (9 stores)
└── types/         # TypeScript types
```

## Deployment

Production runs on nginx reverse proxy (Proxmox LXC). See `nginx.conf` for CORS proxy routes and security headers.

```bash
npm run build
# Copy dist/ to server
```

## License

[MIT](LICENSE)

<!-- ## Support

If MeteoMapGal is useful to you, consider supporting its development:

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/TU_USUARIO)
-->

## Acknowledgements

Built with the assistance of [Claude](https://claude.ai) (Anthropic).

---

<p align="center">
  <sub>Built in Galicia &middot; Open data &middot; Open source</sub>
</p>
