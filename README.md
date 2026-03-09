# MeteoMapGal

**Real-time weather monitoring for Galicia** — 90+ stations, 3D interactive map, thermal wind analysis for sailing, agricultural alerts for viticulture.

> **Monitorización meteorolóxica en tempo real para Galicia** — 90+ estacións, mapa 3D interactivo, análise de vento térmico para navegación e alertas agrícolas para viticultura.

<!-- TODO: Add hero screenshot -->
<!-- ![MeteoMapGal](hero.png) -->

---

## About

MeteoMapGal is a real-time weather monitoring application for **Galicia (Spain)**, currently covering two sectors:

- **Embalse de Castrelo de Miño** (Ourense) — thermal wind analysis for inland sailing, 35 km radius
- **Rías Baixas** (Pontevedra) — coastal wind and maritime monitoring, 30 km radius

It aggregates data from **5 station networks** (90+ stations), numerical models, satellite imagery, radar, tides, airspace and lunar data into a single unified interface. A **TimescaleDB ingestor** runs 24/7 persisting readings every 5 minutes for historical analysis.

> **Roadmap:** New monitoring zones across Galicia are planned for future releases (A Coruña, Lugo, Costa da Morte...).

## Sobre o proxecto

MeteoMapGal é unha aplicación de monitorización meteorolóxica en tempo real para **Galicia**, que cobre actualmente dous sectores:

- **Encoro de Castrelo de Miño** (Ourense) — análise de vento térmico para navegación interior, radio de 35 km
- **Rías Baixas** (Pontevedra) — monitorización de vento costeiro e marítimo, radio de 30 km

Agrega datos de **5 redes de estacións** (90+ estacións), modelos numéricos, imaxes de satélite, radar, mareas, espazo aéreo e datos lunares nunha única interface. Un **inxestor TimescaleDB** funciona 24/7 gardando lecturas cada 5 minutos para análise histórica.

> **Folla de ruta:** Prevense novas zonas de monitorización en futuras versións (A Coruña, Lugo, Costa da Morte...).

## Features

| Feature | Description |
|---|---|
| **Real-time wind** | 90+ stations with multi-station consensus, trend and zone coherence |
| **3D interactive map** | MapLibre GL with 3D terrain, wind particles, humidity heatmap |
| **Sailing briefing** | Score 0–100 with GO / Marginal / No-Go verdict based on real consensus |
| **Atmospheric profile** | CAPE, BLH, CIN, Lifted Index for thermal evaluation |
| **IR satellite** | EUMETSAT infrared imagery updated every 15 min |
| **Precipitation radar** | AEMET Cuntis with time animation |
| **Lightning** | Real-time detection with proximity alerts |
| **Tides** | IHM predictions for 5 Rías Baixas ports |
| **Airspace** | UAS zones and ENAIRE NOTAMs with drone verdict |
| **Field panel** | Frost, rain, fog, ET₀, phytosanitary risk, GDD, lunar calendar |
| **GDD (viticulture)** | Growing degree days: phenological stage, progress and crop advice |
| **Lunar phases** | 8 phases, illumination %, agricultural advice for Galician crops |
| **24h charts** | Time series with CSV export |
| **PWA** | Installable, works offline with data cache |
| **TimescaleDB** | Persistent storage: 90+ stations polled every 5 min, hourly aggregates |

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
| TimescaleDB | Historical readings (PostgreSQL + hypertables) |

## Data Sources

All data comes from **open and public sources**:

| Source | Type | Data |
|---|---|---|
| **AEMET** OpenData | Official stations | 9 stations, Cuntis radar |
| **MeteoGalicia** | Regional network | 13 stations, lightning |
| **Meteoclimatic** | Citizen network | 6 stations |
| **Weather Underground** | Personal stations | 1 station |
| **Netatmo** | Consumer IoT | 60+ stations |
| **Open-Meteo** | Numerical model | ECMWF/GFS forecast + atmospheric profile + GDD archive |
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
├── services/      # Business logic (scoring, alerts, IDW, GDD, lunar...)
├── store/         # Zustand stores (9 stores)
└── types/         # TypeScript types

ingestor/          # Standalone Node.js service → TimescaleDB
├── index.ts       # Main loop: 5min poll, 1h rediscovery
├── db.ts          # pg Pool + batch upsert
├── discover.ts    # Station discovery (5 sources, both sectors)
├── fetchers.ts    # Observation fetchers → NormalizedReading[]
└── schema.sql     # Idempotent DB schema
```

## Deployment

Production runs on nginx reverse proxy (Proxmox LXC). The ingestor runs as a systemd service on the same host, writing to a separate TimescaleDB LXC. See `nginx.conf` for CORS proxy routes and security headers.

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
  <sub>Feito en Galicia · Datos abertos · Código aberto</sub>
</p>
