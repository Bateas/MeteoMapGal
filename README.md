# MeteoMapGal

[![Versión](https://img.shields.io/badge/versión-2.1.1-blue)](https://github.com/Bateas/MeteoMapGal/releases)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-231%20passed-brightgreen)](src/test/)

**Meteoroloxía en tempo real para Galicia** — Vento, ondas, mareas e alertas con 100+ estacións, 13 boias e mapa 3D interactivo.

**Meteorología en tiempo real para Galicia** — Viento, olas, mareas y alertas con 100+ estaciones, 13 boyas y mapa 3D interactivo.

**En vivo**: [meteomapgal.navia3d.com](https://meteomapgal.navia3d.com) — Gratuito, sin registro. Funciona en cualquier dispositivo. Instalable como app (PWA).

<p align="center">
  <img src="hero.png" width="100%" alt="MeteoMapGal — mapa 3D con estaciones meteorológicas, flechas de viento y spots de navegación" />
</p>

---

## Zonas

| Zona | Ubicación | Enfoque |
|------|-----------|---------|
| **Rías Baixas** | Pontevedra (costa) | Viento costero, olas, mareas, 100+ estaciones + 13 boyas |
| **Embalse de Castrelo** | Ourense (interior) | Viento térmico para vela y viticultura, radio 35km |

---

## Cómo usar

1. Abre [meteomapgal.navia3d.com](https://meteomapgal.navia3d.com)
2. Elige zona — Rías Baixas o Embalse
3. Toca un **spot** (icono de navegación) para ver condiciones: viento, olas, veredicto
4. Colores: verde = bueno, amarillo = justo, rojo = peligroso
5. Explora las pestañas: Estaciones, Gráfica, Previsión, Rankings, Historial
6. **Alertas Telegram** — resumen diario 9:00 + alertas instantáneas de cambio de viento

> O vento mídese en **nudos (kt)**: 1 nudo = 1,852 km/h. Consulta o glosario na guía para máis info.

---

## Funcionalidades

### Mapa e capas
- Mapa 3D (MapLibre GL) con 6 estilos base + terreo + sombreado
- Partículas de vento animadas, humidade, temperatura, satélite IR, radar
- Cartas náuticas, correntes superficiais, batimetría (só Rías)

### Intelixencia meteorolóxica
- **100+ estacións** de 6 redes (AEMET, MeteoGalicia, Meteoclimatic, WU, Netatmo, SkyX)
- **13 boias mariñas** — ondas, vento, temperatura da auga, correntes
- Consenso de vento ponderado por distancia, frescura e calidade
- Detector de tendencias, néboa, frente de racha, afloramento

### Spots de navegación (10 spots)
- **Ría de Vigo**: Cesantes, Bocana, Centro Ría, Cíes-Ría, Vao
- **Ría de Pontevedra**: Lourido
- **Ría de Arousa**: A Lanzada, Castiñeiras, Illa de Arousa
- **Embalse**: Castrelo de Miño
- Puntuación en 5 niveis: CALMA → FLOJO → NAVEGABLE → BUEN DÍA → FUERTE
- Marcadores hexagonais con arco de vento (gauge visual)
- Detección térmica con penalización por vento sinóptico
- Ventana de navegación "Cuándo salgo?" (48h por spot)
- Mareas por spot (5 portos IHM)

### Marítimo (Rías Baixas)
- Mareas para 5 portos, ondas, néboa marítima
- Información de mareas no ticker

### Agricultura
- Alertas de campo (xeada, choiva, néboa, ET0, risco fitosanitario)
- GDD para viticultura (9 fases fenolóxicas)
- Fases lunares, espazos aéreos para drons

---

## Fontes de datos

| Fonte | Datos |
|-------|-------|
| AEMET, MeteoGalicia, Meteoclimatic | Estacións oficiais e cidadás |
| Weather Underground, Netatmo, SkyX | Estacións persoais |
| Puertos del Estado, Obs. Costeiro | Boias mariñas |
| Open-Meteo | Previsión ECMWF/GFS/ICON |
| EUMETSAT, RainViewer, IHM, ENAIRE | Satélite, radar, mareas, espazo aéreo |
| CMEMS, EMODnet, INTECMAR, IGN | SST, batimetría, correntes, cartografía |

Todos os datos de fontes abertas. Só AEMET require chave API gratuíta.

---

## Roadmap

### v2.1.1 — Actual
- **10 spots** (4 novos: Castiñeiras, Vao, A Lanzada, Illa Arousa)
- Marcadores GPU: estacións con letra + anillo, boias diamante, spots hexágono
- Frechas de vento afiladas con grosor variable + glow en rachas
- Tipografía DM Sans + JetBrains Mono
- Rendemento **60fps** (terrain toggle, partículas optimizadas, glyph CDN)
- Detección térmica con penalización por vento sinóptico (N/NW mata, SW suma)
- 19 correccións de accesibilidade + banner PWA + busca no glosario
- 231 tests

### Próximamente
- Seguimento AIS de barcos (posicións en tempo real nas Rías)
- Alertas de aviación no embalse (hidroavións contraincendios)
- Modo regata experimental
- Layout sidebar colapsable

### v3.0 — Futuro
- Modo regata completo (balizas, liña de saída, cronómetro)
- Novas zonas (A Coruña, Costa da Morte)
- Panel Pro para clubs

---

## Para desenvolvedores

```bash
git clone https://github.com/Bateas/MeteoMapGal.git
cd MeteoMapGal
npm install
cp .env.example .env    # Engadir chaves API de AEMET + ObsCosteiro
npm run dev             # http://localhost:5173
npm run build           # Produción → dist/
npm test                # 220 tests (Vitest)
```

**Stack**: React 19 · TypeScript 5.9 · Vite 7 · MapLibre GL 5 · Zustand 5 · Tailwind 4 · Recharts · TimescaleDB

---

## Apoiar

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Apoiar%20MeteoMapGal-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/meteomapgal)

## Licenza

[MIT](LICENSE)

---

<p align="center">
  <sub>Feito en Galicia · Datos abertos · Código aberto</sub>
</p>
