# MeteoMapGal

[![Version](https://img.shields.io/badge/version-2.81.23-blue)](https://github.com/Bateas/MeteoMapGal/releases)
[![CI](https://github.com/Bateas/MeteoMapGal/actions/workflows/ci.yml/badge.svg)](https://github.com/Bateas/MeteoMapGal/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-1028%20passed-brightgreen)](src/test/)
[![Prod](https://img.shields.io/badge/prod-meteomapgal.navia3d.com-blueviolet)](https://meteomapgal.navia3d.com)

**Meteorologia en tiempo real para deportes acuaticos en Galicia** — Viento, olas, mareas y alertas con 100+ estaciones, 13 boyas, 13 spots monitorizados, 22 webcams con IA y mapa 3D interactivo.

**Pruebalo**: [meteomapgal.navia3d.com](https://meteomapgal.navia3d.com) — Gratuito, sin registro. Funciona en movil y escritorio.

---

<p align="center">
  <img src="assets/screenshots/hero-map.png" alt="Vista general del mapa — Embalse de Castrelo" width="100%">
</p>

## Para quien es

| Perfil | Que obtiene |
|--------|-------------|
| **Navegantes de vela** | Saber si merece la pena ir al agua. Veredicto instantaneo por spot |
| **Surfistas** | Olas + viento + marea en un vistazo. Factor costero calibrado por playa |
| **Kitesurfistas / Windsurfistas** | Ventana de viento optima en las proximas 48h |
| **Clubs nauticos** | Panel de seguridad para regatas. Semaforo automatico + log exportable |
| **Coordinadores de seguridad** | Modo Evento: zona personalizable, alertas rayos/viento, responsabilidad documentada |
| **Mariscadores recreativos** | Aguas vivas extremas (coef ≥95) + storm surge avisado en tiempo real |
| **Agricultores / Viticultores** | Helada, lluvia, ET0, grados-dia, riesgo fitosanitario |

---

## Zonas

| Zona | Ubicacion | Enfoque |
|------|-----------|---------|
| **Rias Baixas** | Pontevedra (costa) | Viento costero, olas, mareas, surf, 100+ estaciones + 13 boyas |
| **Embalse de Castrelo** | Ourense (interior) | Viento termico para vela, agua plana, radio 35km |

---

## Como usar

1. Abre [meteomapgal.navia3d.com](https://meteomapgal.navia3d.com) en cualquier dispositivo
2. Elige zona — Rias Baixas o Embalse
3. Toca un **spot** (icono hexagonal) para ver condiciones y veredicto
4. Escala de colores: gris = calma, azul = flojo, verde = navegable, amarillo = bueno, naranja = fuerte
5. Explora: Estaciones, Grafica, Prevision, Rankings, Historial
6. **Modo Simple**: si te abruma, pulsa el boton "Simple" en la cabecera (centro de la barra inferior en movil). Esconde detalles y deja solo lo esencial — spots, prevision y avisos importantes
7. **Alertas Telegram**: resumen diario a las 9:00 + alertas instantaneas de cambio de viento
8. **Modo Evento**: selecciona una zona de agua para monitorizar seguridad en tiempo real

> El viento se mide en **nudos (kt)**: 1 nudo = 1,852 km/h.

---

## Funcionalidades principales

### Modo Simple / Avanzado
- Toggle accesible en cabecera (desktop) y centro de la barra inferior (movil)
- Pensado para usuarios casuales que solo quieren saber "como esta hoy" sin abrumarse
- En modo Simple se esconden: marcadores de estaciones, flechas de viento, ticker de condiciones, selector de capas y tabs secundarios (Grafica, Comparar, Rankings, Historial)
- Se mantienen: spots con veredicto, boyas, previsiones, alertas reactivas (tormentas, niebla, calima, calidad del aire), sector selector
- Banner ambar persistente cuando esta activo, con un clic para volver al modo completo

### Mapa en tiempo real
- Mapa 3D (MapLibre GL) con 6 estilos base + terreno
- Flechas de viento coloreadas por intensidad en cada estacion
- Capas: humedad, temperatura, radar, niebla (DEM terrain), webcams, corrientes, cartas nauticas


### Scoring inteligente (13 spots)
- **Vela** (10 spots): 9 niveles de viento (CALMA a HURACAN). Consenso espacial de multiples estaciones con coherencia regional
- **Surf** (3 spots BETA): 5 niveles de oleaje (FLAT / PEQUE / SURF OK / CLASICO / GRANDE) con correccion costera por playa y alineamiento del swell
- **Coherencia espacial del viento** (#63): si estaciones a barlovento y sotavento coinciden en direccion y velocidad, el agua entre ellas tiene ese mismo viento. 3 niveles: coherencia regional (60%+ coinciden), bracketing espacial (opuestos a ±120°), corroboracion de fuentes
- Boyas en agua pesan x1.5 sobre estaciones terrestres (exposure boost)
- Outlier detection con mediana ponderada — estaciones sheltered penalizadas automaticamente
- Cada spot muestra las fuentes que contribuyen al veredicto (nombre, velocidad, peso %)
- Deteccion de patrones locales: termicas, bocanas, virazones de ria
- **Viración detector** (Rías): identifica fase del ciclo diario (terral matutino → transición → viración tarde → decay nocturno) por spot. Cross-validación con boya local cuando disponible. Patrón empirico calibrado de 12000+ horas de datos reales por ría
- Ventanas de navegacion: "Cuando salgo?" con prevision 48h
- **Prevision WRF 1km por spot**: MeteoSIX de MeteoGalicia, cada spot usa su celda de grid exacta
- **Temperatura del mar (MOHID)**: modelo oceanografico como fallback cuando no hay boya


### Seguimiento de tormentas

Deteccion y tracking de nucleos tormentosos en tiempo real, directamente en el mapa:

```
  En el mapa:                        Etiqueta por cluster:

  ● Amarillo  Rayo <15 min           ┌──────────────────────┐
  ● Naranja   Rayo 15-60 min         │ 12 rayos             │
  ● Rojo      Rayo 1-6h              │ → 45 km/h SW         │
  ● Gris      Rayo 6-24h (hist.)     │ ETA ~18 min          │
  ▲ Violeta   Nucleo tormentoso      │ 32 km                │
  → Naranja   Flecha de avance       └──────────────────────┘
  ┄ Punteada  Proyeccion 5-30 min
```

- **Predictor de 9 senales**: CAPE, CIN, lluvia, nubes, rayos, avance, sombra solar, avisos MeteoGalicia
- **Avisos oficiales**: RSS de MeteoGalicia (amarillo/naranja/rojo) integrado en ticker y panel
- **ETA inteligente**: usa la componente de velocidad hacia ti, no la velocidad total
- **Subdivision automatica**: frentes de 100+ km se dividen en clusters manejables

<p align="center">
  <img src="assets/screenshots/storm-clusters.jpg" alt="Clusters de tormenta con etiquetas y flechas de avance" width="80%">
  <br><sub>Nucleos tormentosos: etiquetas on-map (rayos, velocidad, ETA, distancia) + flechas de avance + radar</sub>
</p>

### Modo Evento / Regata
- Zona personalizable (dibujo libre o zonas predefinidas)
- Semaforo automatico: SEGURO / PRECAUCION / PELIGRO
- Alertas integradas: rayos, viento, oleaje, avisos AEMET
- Prevision 6h corregida con datos reales (elimina sesgo del modelo)
- Log de seguridad exportable para federaciones

<p align="center">
  <img src="assets/screenshots/modo-evento.jpg" alt="Modo Evento para regatas" width="80%">
  <br><sub>Modo Evento: zona de agua, semaforo de seguridad, oleaje, mareas, exportar informe</sub>
</p>

### Alertas 24/7
- Bot Telegram autonomo: cambio brusco, tormentas, oleaje + resumen diario
- Tormentas (rayos <5km = peligro, <25km = aviso, <80km = vigilancia)
- Niebla maritima, frentes de viento, inversiones termicas
- Clasificacion por severidad: info / aviso / alerta / peligro

### Avisos reactivos en el ticker
Solo aparecen cuando son accionables — fuera de su ventana, silencio:
- **UV index extremo** (12-16h, peak sun): UV ≥ 7 con reflexión agua +30% calculada (`UV 8 ALTO · agua +10.4 · gorra/protector`). Escala WHO con colores estándar
- **Aguas vivas extremas** (Rías): coeficiente ≥ 95 + cross-check storm surge por presión baja (`Aguas vivas extremas (coef 102) · bajamar 06:34 · marea +0.3m por baja presión`)
- **Brisa térmica forecast** (Embalse Apr-Sep): detecta días con T>25°C + HR<55% + cielo despejado 12h+ antes
- **Calidad del aire**: cuando ICA Xunta marca deficiente o peor, nombra estación + contaminante
- **Avisos AEMET/MeteoGalicia**: integrados en ticker con color por severidad oficial

### Scoring inteligente — popup de spot

<p align="center">
  <img src="assets/screenshots/spot-popup.jpg" alt="Popup de spot con veredicto" width="45%">
  <img src="assets/screenshots/spot-surf.jpg" alt="Popup de spot de surf" width="45%">
  <br><sub>Izq: spot de vela (veredicto + viento + fuentes). Der: spot de surf (oleaje + periodo + factor costero)</sub>
</p>

### Datos marinos (Rias Baixas)
- 13 boyas: oleaje, viento, temperatura del agua
- Mareas para 5 puertos (IHM)
- Corrientes superficiales HF radar
- Cartas nauticas oficiales (IHM ENC)

<p align="center">
  <img src="assets/screenshots/rias-radar.png" alt="Rias Baixas con estaciones y boyas" width="80%">
  <br><sub>Sector Rias Baixas: estaciones, boyas marinas, spots de vela y surf</sub>
</p>


### Prevision avanzada
- **WRF 1km** (MeteoSIX v5): modelo de MeteoGalicia a 1km de resolucion, por defecto para todos los spots
- **Panel fullscreen**: tabla estilo Windguru con colores por intensidad, dots de calidad, dimming nocturno
- **Meteograma SVG**: sparkline viento+temp+precipitacion (0KB extra de bundle)
- **Conclusion inteligente**: resumen en lenguaje natural de la prevision 48h
- **Predictor de tormentas**: 9 senales combinadas → probabilidad 0-100%
- **Predictor con accuracy medible**: cada predicción se evalúa automáticamente 6h después contra rayos reales + precipitación de estaciones. Substrate de calibración ML para próximas iteraciones
- **Convection grid 10km**: CAPE/LI/CIN/precip persistido por celda en TimescaleDB (retención 2 años) → mapas de inestabilidad históricos consultables en milisegundos via continuous aggregates

### Niebla (DEM terrain overlay)
- Deteccion de niebla radiativa (Embalse) y advectiva (Rias) por analisis dewpoint/temp/HR
- Overlay en mapa basado en modelo digital del terreno (celdas < umbral altitud)
- Validacion con webcams DGT (Ribadavia, Fea-Arrabaldo)

### Vision IA (webcams)
- 22 camaras analizadas cada 15min (19 MeteoGalicia + 2 DGT + 1 ESP32-CAM propia en Castrelo)
- Estimacion Beaufort 0-7 desde la superficie del agua
- Deteccion de niebla, visibilidad, estado del cielo
- Alertas automaticas por visibilidad reducida


---

## Fuentes de datos

| Fuente | Datos |
|--------|-------|
| AEMET, MeteoGalicia, Meteoclimatic | Estaciones oficiales y ciudadanas |
| Weather Underground, Netatmo, SkyX | Estaciones personales |
| Puertos del Estado, Obs. Costeiro | Boyas marinas |
| MeteoSIX v5 (MeteoGalicia) | WRF 1km (atmosferico), USWAN (oleaje nearshore), MOHID (temp mar) |
| Open-Meteo | CAPE, CIN, LI, rachas, visibilidad (conveccion background) |
| CESGA SWAN (THREDDS) | Oleaje nearshore ~250m (WMS overlay con slider temporal 48h) |
| RainViewer, IHM, ENAIRE | Radar precipitacion, mareas, espacio aereo |
| CMEMS, INTECMAR, IGN | SST, corrientes, cartografia |
| Webcams (MG + DGT) + Ollama vision | 19 camaras MeteoGalicia + 2 DGT (Ribadavia, Fea-Arrabaldo) + ESP32-CAM Castrelo (vision IA: Beaufort, niebla) |
| MeteoGalicia Avisos Adversos | Alertas oficiales (tormentas, oleaje, viento) |
| meteo2api (red europea) | Rayos geolocalizados en tiempo real |
| NASA FIRMS VIIRS | Focos de incendio activos (375m, ≤60min latencia) |
| MeteoGalicia ICA (Xunta) | Calidad del aire oficial — Rede Galega |

> Todos los datos de fuentes abiertas. Solo AEMET requiere clave API gratuita.

---

## Para desarrolladores

```bash
git clone https://github.com/Bateas/MeteoMapGal.git
cd MeteoMapGal
npm install
cp .env.example .env    # Añadir claves API (AEMET + ObsCosteiro)
npm run dev             # http://localhost:5173
npm run build           # Produccion → dist/
npm test                # 1028 tests (Vitest)
npm run knip            # Detector dead-code (informativo)
```

**Stack**: React 19.2 · TypeScript 5.9 · Vite 7.3 · MapLibre GL 5.24 · Zustand 5 · Tailwind 4.2 · Recharts · TimescaleDB · Sharp (image preprocess) · Ollama (vision)

**Arquitectura**:
- **Frontend**: React SPA con 20 stores Zustand, predictor de tormentas 8 señales, 7 sub-componentes SpotPopup
- **Backend**: Ingestor Node.js 24/7 → TimescaleDB (polling 6 fuentes cada 5min + MeteoSIX WRF/USWAN + Ollama vision IA)
- **Modelos**: WRF 1km (atmosferico), USWAN (oleaje nearshore), MOHID (temperatura del mar), Open-Meteo (conveccion + grid CAPE/LI 10km)
- **Producción**: nginx reverse proxy en Proxmox LXC + smart deploy script (detecta diff, solo corre lo necesario), Cloudflare Tunnel
- **Performance**: DeferredHooks (9 hooks diferidos 3s), 12 overlays lazy, fonts self-hosted, main bundle ~365KB (gzip ~121KB), FogOverlay chunked-async (yields cada 100 cells, 0 long tasks)
- **Resilience**: Circuit breaker en TODOS los clientes API (4 capas: AEMET, Open-Meteo, lightning, ENAIRE), pre-classifier ahorra ~25min CPU/día en webcam vision, retention 2 años uniforme en hypertables críticas, convection grid query DISTINCT ON tolera cycles parciales
- **Calidad**: knip dead-code detector como CI soft check (informativo), tests 1028/1028, 0 vulnerabilidades npm audit

---

## Apoyar

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Apoyar%20MeteoMapGal-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/bateas)

## Licencia

[MIT](LICENSE) — Codigo abierto. La capa base de datos y seguridad es siempre gratuita.

---

## Sobre o proxecto

> MeteoMapGal nace nas Rias Baixas e no Embalse de Castrelo, de quen navega e coñece o mar galego.
> As ferramentas globais non serven para os microclimas das nosas rias: termicas de val, virazons, bocanas matutinas.
> Este proxecto cruza datos de 100+ estacions, boias e webcams para que o deportista saiba dunha ollada se paga a pena ir a auga.
>
> A capa base de datos e seguridade e sempre de balde. A seguridade dos deportistas non pode estar detras dun muro de pago.
>
> Feito en Galicia. Codigo aberto. Datos abertos.

---

<p align="center">
  <sub>Feito en Galicia · Datos abertos · Codigo aberto</sub>
</p>
