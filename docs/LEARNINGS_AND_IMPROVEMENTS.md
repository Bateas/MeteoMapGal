# MeteoMapGal — Memoria Técnica y Registro de Mejoras Continuas (Knowledge Base)

> **Propósito de este documento:**  
> Este registro centraliza la memoria técnica del proyecto MeteoMapGal: post-mortems de incidencias, causas raíz de errores resueltos, patrones de diseño obligatorios, anti-patrones prohibidos y registro cronológico de optimizaciones.  
> **Regla de oro:** Cada vez que se resuelva un bug complejo o se aplique una mejora arquitectónica importante, debe quedar documentada aquí la causa, la solución y la regla preventiva para evitar regresiones en el futuro.

---

## 1. Principios de Ingeniería del Proyecto

1. **El usuario y el veredicto náutico primero:**  
   Todo desarrollo debe alinearse con el Norte del proyecto: *"¿Un velero/kiter/surfer/windsurfista sabe en 30s si sale, vuelve o se refugia?"*.
2. **Confianza absoluta en el dato:**  
   No se inventan visualizaciones ni capas complejas sobre datos no verificados. Los sensores físicos (boyas, estaciones oficiales AEMET/MeteoGalicia) y los consensos espaciales calibrados tienen máxima prioridad sobre inferencias de IA no validadas.
3. **No-bloqueo del Event Loop (Backend Node.js):**  
   El ingestor y el servidor HTTP corren en procesos Node.js monohilo. Cualquier operación de disco o red DEBE ser 100% asíncrona (`node:fs/promises`, streaming, timeouts defensivos). Prohibido el uso de métodos síncronos (`*Sync`) en controladores de petición.
4. **Frontera estricta Frontend / Backend:**  
   El backend (`ingestor/`) nunca debe depender de rutas relativas frágiles hacia el código del frontend (`../src/...`). Tipos y contratos deben ser compartidos de forma desacoplada.
5. **Seguridad en Repositorio Público y Supply-Chain:**  
   * Ningún secreto, credencial (`.env`), token o IP privada (`192.168.x.x`) se añade a Git.
   * `.npmrc` fuerza `ignore-scripts=true` para prevenir ataques de dependencias comprometidas en `install/postinstall`.
   * Todo commit pasa por el protocolo pre-push obligatorio (build sobre working tree limpio + suite completa de tests).

---

## 2. Registro de Post-Mortems y Errores Resueltos

### Incidente 001: Bloqueo del Event Loop en subida de Webcams (v2.139.9)
* **Fecha:** Septiembre 2026
* **Componente:** `ingestor/api.ts` (`handleWebcamUpload`)
* **Severidad:** Media-Alta (Latencia en ráfagas de clientes)
* **Causa Raíz:**  
  Al recibir una imagen de webcam vía `POST /api/v1/webcam/:spotId/upload`, el controlador ejecutaba `fs.mkdirSync(...)` y `fs.writeFileSync(...)` dos veces de forma síncrona (guardando `.jpg` y `.json`). Al ser Node.js un proceso de un solo hilo, cada escritura a disco congelaba el Event Loop completo, retrasando las respuestas a consultas concurrentes de estaciones y proxies.
* **Solución:**  
  Sustitución por `await fs.promises.mkdir(...)` y `await fs.promises.writeFile(...)`. La operación se delega al threadpool de `libuv` sin bloquear el loop principal.
* **Regla Preventiva:**  
  Prohibido usar métodos `fs.*Sync` en el backend. Añadir verificación estática o linter que bloquee métodos síncronos en `ingestor/`.

### Incidente 002: Despliegue roto en LXC por WIP local no commiteado (v2.81.5)
* **Fecha:** Julio 2026
* **Componente:** Frontend Build & Deploy pipeline
* **Severidad:** Crítica (Producción rota, hotfix v2.81.6)
* **Causa Raíz:**  
  Se ejecutó `npm run build` en la máquina de desarrollo con archivos sin commitear presentes en el working tree (ej. `profileFlags.ts`). El build pasó localmente porque los imports se resolvían en disco local, pero al hacer push e invocar `meteomap-update` en el LXC, Git solo trajo los archivos commiteados, provocando error *"Could not resolve"* en producción.
* **Solución:**  
  Adopción del protocolo pre-push obligatorio con `git stash push -u --keep-index` para validar el build única y exclusivamente sobre los archivos preparados para el commit.
* **Regla Preventiva:**  
  Nunca hacer push sin haber validado el build sobre el árbol exacto que tendrá la rama `master`.

### Incidente 003: Micro-congelaciones ("Pilladas") en UI por ruptura de Commit Isolation en WeatherMap (v2.140.1)
* **Fecha:** Septiembre 2026
* **Componente:** `src/components/map/WeatherMap.tsx`
* **Severidad:** Media (Degradación de fluidez / caídas de frames en el mapa)
* **Causa Raíz:**  
  `WeatherMap` se suscribía al mapa completo de puntuaciones de Zustand (`const spotScores = useSpotStore((s) => s.scores)` y `userScores`). Dado que el motor `useSpotScoring` recalcula puntuaciones cada 5s durante el arranque inicial (primeros 90s) y cada 30s en régimen continuo, cada recálculo emitía una nueva referencia de `Map`. Esto provocaba que `WeatherMap` (735 líneas, instancia WebGL de MapLibre, 25 capas de overlays y listeners) se re-renderizara en su totalidad continuamente, incluso cuando ningún popup de spot estaba abierto en pantalla.
* **Solución:**  
  Se desacopló la suscripción de `WeatherMap`. Ahora `SpotPopup` y `UserSpotPopup` leen su propia puntuación de forma granular y bajo demanda (`useSpotStore((s) => s.scores.get(spot.id))`). Cuando ningún popup está abierto, ninguna suscripción al score individual está activa, eliminando al 100% los re-renders parásitos del mapa raíz.
* **Regla Preventiva:**  
  Respetar el principio de **Commit Isolation**: los componentes contenedores o pesados (como `WeatherMap`) nunca deben suscribirse a mapas o colecciones Zustand que cambian por polling periódico si el dato solo lo consume un popup o componente hijo puntual.

### Incidente 004: Bucle infinito ("Cargando eterno") en BuoyTrend48h por estado en deps de useEffect (v2.141.2)
* **Fecha:** Septiembre 2026
* **Componente:** `src/components/map/BuoyTrend48h.tsx`
* **Severidad:** Media (Bloqueo de UI en tarjeta de balizas)
* **Causa Raíz:**  
  En el hook `useEffect` de carga bajo demanda, se incluyó la variable de estado `loading` dentro del array de dependencias `[expanded, stationId, data, loading]`. Al ejecutar `setLoading(true)`, React 19 re-renderizaba el componente y, al detectar que la dependencia `loading` había cambiado de `false` a `true`, ejecutaba la función de limpieza (*cleanup*) del efecto anterior (`cancelled = true`). Cuando la petición asíncrona de TimescaleDB retornaba con los datos, la condición `if (!cancelled)` evaluaba a `false`. Como resultado, `setData` y `setLoading(false)` nunca se ejecutaban y el spinner se quedaba en estado de carga permanente. Adicionalmente, el texto mostraba jerga técnica interna de infraestructura ("Consultando TimescaleDB...").
* **Solución:**  
  1. Se extrajo `loading` del array de dependencias de `useEffect`, ejecutando la carga únicamente si `expanded && data === null`.
  2. Se añadió un efecto de reseteo explícito de `data`, `loading` y `fetchError` cuando cambia `stationId`.
  3. Se sustituyó la jerga técnica por texto natural ("Cargando datos...").
  4. Se añadió un filtro defensivo de valores físicos imposibles (`water_temp >= 5.0 °C`) para descartar glitches de sondas en bajamar (como los 0.75 °C observados en Cortegada).
* **Regla Preventiva:**  
  1. **Nunca incluir el propio booleano `loading` que se muta dentro del efecto en su propio array de dependencias**, salvo que se gestione mediante una máquina de estados o `useRef`.
  2. **Prohibido exponer nombres de motores de base de datos o APIs internas en la UI** ("TimescaleDB", "Postgres", etc.). El usuario debe ver siempre mensajes funcionales y amigables.

---

## 3. Catálogo de Anti-Patrones Prohibidos

| Anti-Patrón | Por qué es peligroso | Alternativa Obligatoria |
| :--- | :--- | :--- |
| `git add .` / `git add -A` | Puede commitear inadvertidamente `.env`, logs, dumps o claves de API en un repo público. | `git add <archivo1> <archivo2>` explícito. |
| `fs.readFileSync` / `writeFileSync` en handlers | Congela el Event Loop de Node.js y eleva el p99 de latencia de la API. | `fs.promises.readFile` / `fs.promises.writeFile` con `await`. |
| Push sin bump de versión | Rompe la trazabilidad SemVer y el mecanismo de detección de cambios de `meteomap-update`. | Incrementar `package.json` en CADA push (PATCH o MINOR) y sincronizar `package-lock.json`. |
| Merge automático o a ciegas de ramas de Dependabot | Dependabot suele bifurcar ramas desde commits antiguos, provocando regresiones silenciosas (ej: revertir fixes en `spotScoringEngine`). | Tratar Dependabot de forma manual: auditar superficie de ataque real y aplicar parches localmente con tests. |
| Suscribir componentes de mapa a colecciones mutables globales | Provoca re-renders del árbol completo de WebGL/canvas ("pilladas" en UI). | Selectores granulares en componentes hoja (Commit Isolation). |
| `npm audit fix --force` a ciegas | Puede introducir breaking changes mayores que rompan mapas o servicios sin tests visuales. | Auditar cada vulnerabilidad individualmente y verificar suites de test. |

---

## 4. Registro Cronológico de Mejoras y Refactorizaciones

### [v2.141.0] — Septiembre 2026: Detección de Afloramiento (Upwelling), Frentes Térmicos y Tendencias 48h en Balizas
* **Autor:** Bateas
* **Cambios realizados:**
  1. **Inteligencia Oceanográfica (`upwellingDetector.ts`):** Clasificación automática de masas de agua según $T_{\text{agua}}$ y Salinidad (ACNA / Afloramiento profundo $\le 14.5\text{°C}$, Estuario/Fluvial $< 33\text{ PSU}$, Atlántica superficial $\ge 17\text{°C}$). Detección de frentes térmicos entre el exterior (Cabo Silleiro) y el interior (Rande).
  2. **Aviso Náutico y de Pesca en Ticker (`ConditionsTicker.tsx`):** Alerta en tiempo real de afloramiento y frentes térmicos en el sector costero con consejos prácticos para pesca de calamar (luras) y pelágicos (caballas/xardas).
  3. **Evolución 48h en Popup de Balizas (`BuoyPopup.tsx` & `BuoyTrend48h.tsx`):** Sección colapsable bajo demanda con consulta directa a TimescaleDB (`/api/v1/buoys/readings`). Visualiza $\Delta T$, $\Delta S$ y mini-gráfica sparkline SVG sin impacto en el bundle inicial.
  4. **Contexto en BuoyPanel (`BuoyPanel.tsx`):** Etiquetas dinámicas de `❄️ Aflorando` y `🌊 Fondo` en las tarjetas de balizas.
* **Lección aprendida:**  
  Aprovechar la persistencia temporal de TimescaleDB para inferir dinámicas marinas complejas en el frontend enriquece drásticamente el valor de la app para marineros y pescadores con coste cero de computación adicional.

### [v2.140.1] — Septiembre 2026: Rendimiento (Commit Isolation), Cero Vulnerabilidades en Ingestor y Actualización de Métricas
* **Autor:** Bateas
* **Cambios realizados:**
  1. **Optimización de Rendimiento Frontend:** Eliminación de los re-renders innecesarios en `WeatherMap` desacoplando `spotScores` y `userScores` hacia los popups individuales. Fin de las micro-congelaciones ("pilladas") periódicas durante el paneo y zoom.
  2. **Auditoría de Dependabot y Lockfile:** Resueltas las alertas de `brace-expansion` (High) y `esbuild` (Low) en `package-lock.json`. Ingestor auditado al 100% con 0 vulnerabilidades. Verificado que el CVE de `maplibre-gl` no afecta la superficie de ataque (no se usa `Popup.setHTML()`).
  3. **Métricas de Calidad en Documentación:** Actualización de `README.md` reflejando 2066 tests y 118 ficheros en verde.
* **Lección aprendida:**  
  Las dependencias críticas con breaking change mayor (como MapLibre 5.x -> 6.x) no deben actualizarse a ciegas mediante merge de PRs de Dependabot, ya que pueden provocar regresiones de código y rotura de contratos WebGL.

### [v2.140.0] — Septiembre 2026: Memoria Técnica, Dependencias y Modularización
* **Autor:** Bateas
* **Cambios realizados:**
  1. **Memoria Técnica Continua:** Creación de `docs/LEARNINGS_AND_IMPROVEMENTS.md` para evitar pérdida de contexto y documentar post-mortems y buenas prácticas.
  2. **Seguridad de Dependencias:** Actualización de `sharp` a `>=0.35.4` en `ingestor/` resolviendo vulnerabilidad alta de `libheif` (GHSA-rgj7-g3m4-5g8c). Actualización de herramientas de desarrollo (`vitest`).
  3. **Modularización de `ingestor/api.ts`:** Extracción de controladores especializados (`ingestor/routes/webcam.ts` y `ingestor/routes/proxies.ts`), reduciendo la complejidad del despachador monolítico.
* **Lección aprendida:**  
  Mantener la suite de tests en paridad con cada refactorización garantiza que la modularización del backend no rompa contratos de API existentes.

### [v2.141.2] — Septiembre 2026: Corrección de Carga en Tendencia de Balizas y Supresión de Jerga Técnica
* **Autor:** Bateas
* **Cambios realizados:**
  1. **Hotfix React 19 en `BuoyTrend48h.tsx`:** Eliminado el estado `loading` del array de dependencias para evitar la auto-cancelación prematura de la promesa asíncrona.
  2. **Regla de Lenguaje Natural en UI:** Sustituido "Consultando TimescaleDB..." por "Cargando datos...".
  3. **Filtro Físico contra Glitches:** Descartadas lecturas de temperatura de agua $< 5.0\text{ °C}$ causadas por sondas al aire en bajamares vivas.

---

## 5. Física y Dinámica Meteorológica de Galicia (Descubrimientos Empíricos)

Este apartado documenta los patrones físicos propios de la mesoescala gallega descubiertos a partir del análisis de los datos reales históricos de TimescaleDB (>15.000 descargas eléctricas y series de balizas REDMAR):

### 5.1 Los Tres Corredores de Tormentas de Galicia
A partir de la agregación espacial de más de 15.000 descargas eléctricas de MeteoGalicia (`lightning_strikes`), se identificaron empíricamente los tres pasillos de máxima actividad convectiva:
1. **La Dorsal Central (Curtis - Sobrado dos Monxes - Friol - Guitiriz - Palas de Rei, longitud `-7.94` a `-7.98` W):**
   * Concentra 5 de las 12 celdas con mayor número de rayos de toda Galicia.
   * **Mecanismo físico:** Línea de convergencia de brisas (*breeze convergence line*). La brisa marina fresca del Atlántico y del Cantábrico penetra hacia el interior y choca frontalmente con la masa recalentada de la cuenca de Lugo. Al no tener salida lateral, el aire converge y se dispara verticalmente a media tarde en verano, formando tormentas explosivas casi estacionarias.
2. **El Borde Oriental (Ancares y O Courel, longitud `-6.91` a `-7.47` W):**
   * Máxima severidad de impactos (descargas de hasta 99 kA).
   * **Mecanismo físico:** Entrada de inestabilidad meseteña y leonesa que remonta la cuenca del Sil y choca contra los cordales de 1.800 - 2.000 m (Tres Bispos, Miravalles), forzando convección profunda continental.
3. **La Muralla Prelitoral (Serra do Suído - Faro de Avión - O Deza, latitud `42.49` N, longitud `-8.06` W):**
   * Nexo orográfico donde conecta la humedad directa de las Rías Baixas con el centro de Galicia.

### 5.2 ¿Por qué una nube "explota" al chocar con la Serra do Suído?
La Serra do Suído y el Faro de Avión (1.155 m) se alzan a apenas 25-30 km en línea recta del océano Atlántico y de las Rías Baixas.
* **Mecanismo termodinámico:**
  1. **Ascenso orográfico forzado:** La masa de aire marítimo cargada de humedad (humedad relativa 75-85% en superficie) es empujada por vientos de componente oeste o sur. Al toparse con la muralla montañosa, se ve forzada a ascender de 0 a 1.000 m en pocos minutos.
  2. **Enfriamiento adiabático:** Por cada 100 m de ascenso el aire se enfría ~0.7 °C a 1.0 °C. Un ascenso de 1.000 m enfría la masa ~7 °C a 9 °C, alcanzando el nivel de condensación por elevación (LCL) a solo 400-600 m de cota.
  3. **Liberación de calor latente (Lapse Rate Runaway):** La condensación masiva de vapor libera ~2.500 J por gramo de agua. Este calor calienta el núcleo de la nube por encima de la temperatura del aire circundante (aumenta el empuje de flotabilidad / CAPE local).
  4. **Aceleración convectiva:** La nube se convierte en una chimenea térmica con corrientes ascendentes de 15 a 25 m/s, perforando la troposfera media hasta los 9.000 m en cuestión de minutos y desencadenando rayos y granizo. Por eso el refranero popular acierta: *"Cando o Suído pon o chapeu, tronada en terra"*.

### 5.3 Marea Meteorológica Real (Storm Surge / Resaca) en las Rías
La marea en Galicia nunca es puramente astronómica en situaciones de temporal o borrascas atlánticas:
$$\text{Nivel Real del Mar} = \text{Marea Astronómica (IHM)} + \text{Resaca Meteorológica (Puertos del Estado)}$$
* **Componentes de la Resaca:**
  1. **Efecto barométrico inverso:** $1\text{ hPa}$ de caída por debajo de $1013\text{ hPa} \approx +1\text{ cm}$ de elevación del nivel del mar. Una borrasca profunda de $980\text{ hPa}$ eleva el mar $+33\text{ cm}$.
  2. **Apilamiento por viento (*Wind setup*):** Temporales de SW empujan el agua hacia las rías. Debido a su forma de embudo que se estrecha hacia el fondo (Vigo $\to$ Rande $\to$ Arcade; Pontevedra $\to$ Combarro $\to$ Vilaboa), el agua se apila $+15\text{ a }+30\text{ cm}$ adicionales.
* **Riesgo crítico de rebose:**
  Una pleamar astronómica viva ($3.8\text{ m}$) combinada con $+40\text{ cm}$ de resaca alcanza $4.2\text{ m}$, inundando muelles, lonjas, bateas y paseos marítimos (Bouzas, Arcade, Vilagarcía, Moaña).
