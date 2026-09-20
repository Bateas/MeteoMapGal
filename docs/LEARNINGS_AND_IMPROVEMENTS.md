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
### Incidente 005: Latencia y bloqueo de estaciones interiores al cambiar de sector (v2.141.6)
* **Fecha:** Septiembre 2026
* **Componente:** `src/hooks/useWeatherData.ts`, `src/api/stationDiscovery.ts`, `src/hooks/useStations.ts`
* **Severidad:** Alta (Demoras de 10-15s en visualización de estaciones de la zona interior / Embalse de Castrelo)
* **Causa Raíz:**  
  1. **Omisión del ingestor local:** Para MeteoGalicia (la fuente con mayor cobertura en Galicia y la única en estaciones clave del valle del Miño como Castrelo `mg_10144`, Leiro `mg_10145`, Remuíño `mg_10146`, Arnoia `mg_10148`), el frontend disparaba 20-30 peticiones HTTP individuales a `servizos.meteogalicia.gal`. Su proxy upstream arrojaba errores 110 (Connection timed out) de 5 a 15 segundos en nginx, a pesar de que TimescaleDB ya disponía de 1.521 estaciones actualizadas en local respondiendo en 5-10 ms.
  2. **Monolito de promesas:** `fetchData` aguardaba un `await Promise.all(tasks)` monolítico antes de invocar `updateReadings(allReadings)`. Si MeteoGalicia o Netatmo se demoraban, ninguna estación (ni AEMET ni WU) se mostraba en pantalla.
  3. **Reintento bloqueante síncrono:** `stationDiscovery.ts` esperaba con `retryAfterDelay(..., 5000)` si una fuente secundaria fallaba en el barrido inicial, retrasando el descubrimiento 5 segundos adicionales.
  4. **Falta de persistencia en `sessionStorage`:** Las estaciones descubiertas solo vivían en la memoria de la sesión actual; el primer cambio de sector a Embalse vaciaba el mapa con `setStations([])`.
  5. **Dependencia errónea en `useWeatherData`:** La reactividad del refresco dependía de que `stations.length` fuera 0 para reiniciar `hasFetchedRef.current`, impidiendo el refresco inmediato si se precargaban estaciones del nuevo sector.
* **Solución:**  
  1. **Ingestor primero:** MeteoGalicia y Meteoclimatic consultan `/api/v1/readings/latest?source=...` con fallback a API remota solo si el ingestor no retorna filas.
  2. **Hidratación progresiva:** Cada fuente invoca `onSourceReadings(readings)` tan pronto resuelve su tarea (<10ms para MeteoGalicia local), pintando estaciones de inmediato en olas.
  3. **Descubrimiento no bloqueante:** Eliminado el retardo de 5s en `stationDiscovery.ts`.
  4. **Caché en `sessionStorage`:** Las estaciones descubiertas de cada sector se respaldan en `sessionStorage`, permitiendo un reingreso en 0 ms.
  5. **Seguimiento explícito de sector:** `useWeatherData` detecta el cambio con `lastSectorIdRef.current !== activeSector.id` y dispara el refresco de lecturas de inmediato.
* **Regla Preventiva:**  
  El frontend siempre debe consultar primero el ingestor local en TimescaleDB antes de efectuar abanicos concurrentes contra APIs externas de administraciones públicas, y aplicar hidratación progresiva en la UI para que las fuentes rápidas se muestren en milisegundos sin esperar a la más lenta.

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
| Abanico HTTP directo contra APIs públicas externas | Provoca timeouts de 10-15s e inestabilidad en red móvil/proxy. | Priorizar ingestor local de TimescaleDB con fallback a API remota. |
| `Promise.all` monolítico en hidratación de mapas | Bloquea la visualización de datos rápidos esperando por la fuente más lenta. | Hidratación progresiva (`onSourceReadings`). |

---

## 4. Registro Cronológico de Mejoras y Refactorizaciones

### [v2.141.6] — Septiembre 2026: Despliegue Instantáneo en Cambio de Sector e Hidratación Progresiva
* **Autor:** Bateas
* **Cambios realizados:**
  1. **Ingestor Local Primero para MeteoGalicia y Meteoclimatic (`useWeatherData.ts`):** Reducción del tiempo de respuesta para las estaciones interiores (Castrelo, Leiro, Remuíño, etc.) de 10-15s a 5-10ms.
  2. **Hidratación Progresiva en Mapa (`onSourceReadings`):** Los marcadores de estaciones se pueblan conforme cada proveedor resuelve, eliminando pantallas en espera.
  3. **Caché en `sessionStorage` y Descubrimiento Inmediato (`stationDiscovery.ts` & `useStations.ts`):** Transición entre Rías y Embalse en 0 ms. Eliminado el retardo bloqueante de 5 segundos.
  4. **Throttle de Instantáneas Optimizado (`weatherStore.ts`):** Reducido de 30s a 2s con flush automático en cambio de sector.

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
