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
