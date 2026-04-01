# Auditoría UX v2 — MeteoMapGal v1.58.0
**URL:** https://meteomapgal.navia3d.com/
**Fecha:** 1 de abril de 2026
**Versión auditada:** v1.58.0 (anterior: v1.51.2)
**Estándares:** WCAG 2.2 · Nielsen 10 Heurísticas · Core Web Vitals · App móvil amplia audiencia

---

## 🏆 Progreso desde auditoría anterior

De los **20 issues** reportados en la auditoría v1, aquí el estado real:

| # | Issue | Estado |
|---|-------|--------|
| 1 | Texto 6–10px ilegible | ⚠️ Parcial — texto 11px ahora predomina, aún hay elementos de 6–9px |
| 2 | Touch targets < 44px | ⚠️ Parcial — algunos botones principales subieron, pero barra inferior sigue a 16–19px |
| 3 | 2 botones sin aria-label | ✅ Mejorado — de 2 bajó a 1 |
| 4 | Sin aria-live en datos tiempo real | ✅ Resuelto — "Actualizado hace X min" tiene aria-live="polite" |
| 5 | Ticker sin pausa (WCAG 2.2.2) | ⚠️ Parcial — existe tickerControls en DOM pero sin botón visible |
| 6 | Sin onboarding visible | ⚠️ Persiste — guía 16px, sin tooltip de primer uso |
| 7 | H1 con versión concatenada | ✅ Resuelto — H1 limpio "MeteoMapGal" |
| 8 | Siglas sin leyenda/tooltip | ⚠️ Persiste — MG/MC/WU/NT/SX sin tooltips descriptivos |
| 9 | Badge de frescura inconsistente | ✅ Mejorado — badge "offline Xm" más claro en SkyX1 |
| 10 | "Panel" nombre poco descriptivo | ✅ Resuelto — ahora "Condiciones, alertas y campo" |
| 11 | Estado vacío Gráfica con bajo contraste | Sin verificar en esta auditoría |
| 12 | 11 tamaños tipográficos | ⚠️ Parcial — reducido, pero aún irregular |
| 13 | Badges BETA inconsistentes | ✅ Mejorado — más uniforme en panel Condiciones |
| 14 | Markers sin aria-label descriptivo | ✅ Resuelto — markers ahora tienen aria-label con nombre de estación |
| 15 | Sin meta color-scheme | ✅ Resuelto — `dark light` añadido |
| 16 | Skip link 1×1px | ❌ Persiste — sigue siendo 1×1px sin foco visible |
| 17 | CTA "Apoyar" enterrado | ⚠️ Parcial — visible al fondo del viewport pero sin prominencia |
| 18 | Sin opción de compartir | ❌ Persiste — no hay deep links ni botón compartir |
| 19 | Exportar GeoJSON sin contexto | ⚠️ Parcial — icono presente pero sin tooltip |
| 20 | Slider sin aria-value descriptivo | Sin verificar en esta auditoría |

**Balance: 7 resueltos ✅ · 9 parciales ⚠️ · 2 persistentes ❌ · 2 sin verificar**

---

## 🔴 CRÍTICO — Bloqueantes para audiencia amplia

### 1. Tabs de navegación con 19px de altura — táctil imposible
**Estándar:** WCAG 2.5.5 / Apple HIG 44px mínimo
**Problema:** Los tabs del panel izquierdo (Estaciones, Gráfica, Comparar, Previsión, Térmico, Rankings, Historial) tienen **19px de altura**. En un teléfono, son prácticamente imposibles de pulsar con el dedo. Esto es el principal bloqueante para uso móvil masivo.
**Recomendación:** Elevar el área de toque de los tabs a mínimo **40px de altura** con padding vertical. El texto puede quedar en 11–12px pero el área interactiva debe ser mayor:
```css
[role="tab"] {
  min-height: 40px;
  display: flex;
  align-items: center;
  padding: 0 12px;
}
```

---

### 2. Barra inferior del panel: botones de 16×19px
**Estándar:** WCAG 2.5.5
**Problema:** Los botones "Abrir guía meteorológica", "Enviar feedback" y "Exportar GeoJSON" en el pie del panel izquierdo miden **16×19px**. Son iconos sin texto y prácticamente invisibles en pantallas táctiles. La guía meteorológica es especialmente crítica para usuarios nuevos.
**Recomendación:** Mínimo 40×40px. Añadir etiqueta de texto visible o un tooltip. Considerar agruparlos en un menú "⋯ Más opciones".

---

### 3. Skip link no visible al recibir foco (sigue sin corregirse)
**Estándar:** WCAG 2.4.1 (A) — bypass blocks
**Problema:** El "Saltar al mapa" sigue midiendo **1×1px** incluso en estado focused. Un usuario que navega por teclado no puede ver el skip link en ningún momento.
**Recomendación:**
```css
.skip-link { position: absolute; opacity: 0; pointer-events: none; }
.skip-link:focus-visible {
  opacity: 1;
  position: fixed;
  top: 8px; left: 8px;
  background: #1e40af;
  color: white;
  padding: 8px 16px;
  border-radius: 6px;
  z-index: 9999;
  font-size: 14px;
  pointer-events: auto;
}
```

---

### 4. 1 botón sin aria-label persiste
**Estándar:** WCAG 4.1.2 (A)
**Problema:** Aún hay 1 `<button>` sin texto ni aria-label. Clases: `ml-auto rounded border border-slate-600 text-slate-400 hover`. Parece ser el botón de "cerrar" o "colapsar" del panel de estaciones.
**Recomendación:** `aria-label="Colapsar panel"` o el nombre descriptivo correspondiente. Implementar linting automático en CI que falle si hay botones sin label accesible.

---

### 5. Ticker marquee sin botón de pausa visible
**Estándar:** WCAG 2.2.2 (A) — pause, stop, hide
**Problema:** El ticker (`role="marquee"`) sigue moviéndose continuamente. Aunque el DOM tiene `tickerControls`, no hay ningún botón visible para pausarlo. Un usuario con trastornos vestibulares, TDAH o simplemente que quiera leer un mensaje completo no tiene control.
**Recomendación:** Añadir un botón de pausa ⏸ junto al ticker, visible siempre. Alternativa más elegante: pausar automáticamente al hacer hover o focus sobre el ticker, y añadir `aria-label="Pausar ticker de alertas"`.

---

## 🟠 ALTO — Impacto significativo en retención y audiencia amplia

### 6. Sin onboarding ni contextualización para usuarios no técnicos
**Heurística Nielsen:** #6 Reconocimiento antes que recuerdo · #10 Ayuda y documentación
**Problema:** Para una audiencia amplia, ver "19.8 kt ENE 86°" no comunica nada. No hay ningún contexto que diga: "¿Esto es peligroso para navegar? ¿Para un dron?". La app asume conocimiento náutico-meteorológico.
**Recomendaciones concretas:**
- En cada tarjeta de estación, añadir un indicador semántico de condición: `🟢 Calma · 🟡 Moderado · 🔴 Fuerte`
- En el panel Condiciones, contextualizar los valores técnicos: "CAPE 0 J/kg — Sin riesgo de tormenta"
- Tooltip de primer uso (localStorage para no repetir) explicando los 3 controles principales del mapa

---

### 7. Sin invitación a instalar la PWA
**Contexto:** La app tiene `manifest.json` + Service Worker — está lista para instalarse como app en iOS/Android/desktop.
**Problema:** No hay ningún CTA que invite al usuario a "Instalar app". Un usuario que visita desde el móvil no sabe que puede tener MeteoMapGal en su pantalla de inicio sin pasar por una app store.
**Recomendación:** Implementar el evento `beforeinstallprompt` (Android) y para iOS mostrar un banner manual tipo: "📲 Añade MeteoMapGal a tu pantalla de inicio: toca Compartir → Añadir a pantalla de inicio". Dispararlo después de 2-3 visitas o tras el primer uso significativo.
```js
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  showInstallBanner(e); // Mostrar banner propio, no el nativo del navegador
});
```

---

### 8. `aria-label="Map"` en inglés y genérico
**Estándar:** WCAG 2.4.6 · Localización
**Problema:** La región del mapa tiene `aria-label="Map"` — en inglés y sin descripción. Para un lector de pantalla en español es confuso.
**Recomendación:**
```html
<div role="region" aria-label="Mapa meteorológico interactivo de Galicia. Usa las flechas para navegar entre estaciones.">
```

---

### 9. Filtros de fuentes sin tooltips — barrera de entrada para nuevos usuarios
**Heurística Nielsen:** #6 Reconocimiento antes que recuerdo
**Problema:** Los badges MG/MC/WU/NT/SX siguen sin tener tooltip o leyenda. Los `aria-label` de los botones sí dicen el nombre completo ("Ocultar meteogalicia (13)"), pero visualmente solo se ven las siglas. Un usuario nuevo no sabe qué está filtrando.
**Recomendación:**
```html
<button aria-label="Ocultar MeteoGalicia (13 estaciones)" title="MeteoGalicia — 13 estaciones">
  <span aria-hidden="true">MG</span>
</button>
```
Añadir tooltip CSS (`:hover::after`) con el nombre completo de la fuente.

---

### 10. Sin `<nav>` landmark — orientación para lector de pantalla
**Estándar:** WCAG 1.3.6 · ARIA landmarks
**Problema:** La app no tiene ningún `<nav>` landmark. Los tabs del panel y los controles del mapa no están agrupados en landmarks navegables. Un usuario de lector de pantalla no puede saltar directamente a la navegación principal.
**Recomendación:**
```html
<nav aria-label="Secciones de análisis">
  <!-- Tabs: Estaciones, Gráfica, Comparar... -->
</nav>
```

---

## 🟡 MEDIO — Calidad, consistencia y experiencia refinada

### 11. Elementos de 6–9px persisten (aunque reducidos)
**Problema:** Aún existen 55 elementos con fuentes menores de 12px. La mayoría parecen ser labels técnicos o badges secundarios. Aunque menos críticos que antes, contribuyen a la percepción de "interfaz difícil".
**Recomendación:** Establecer en Tailwind config/CSS variables: `--text-min: 11px` como floor absoluto. Revisar componentes con fuente 6–9px y evaluar si pueden eliminarse o fundirse con el texto principal.

---

### 12. `role="status"` mal usado en el contenedor de filtros
**Estándar:** WAI-ARIA 1.2
**Problema:** El contenedor de los badges de fuentes de datos (MG/MC/WU/NT/SX) tiene `role="status"`. Este rol es para mensajes de estado que se anuncian automáticamente. Aplicado a controles interactivos, puede confundir a lectores de pantalla anunciando el contenido innecesariamente.
**Recomendación:** Usar `role="group"` con `aria-label="Filtro por fuente de datos"` para ese contenedor.

---

### 13. Panel "Condiciones" sin gestión de foco (focus trap)
**Estándar:** WCAG 2.1.2 · Patrón ARIA Dialog
**Problema:** Al abrir el panel lateral de Condiciones (que tiene `role="dialog"`), el foco no se mueve al interior del panel. El usuario de teclado tiene que tabular muchos elementos antes de llegar al contenido del panel.
**Recomendación:** Al abrir el panel, mover el foco al primer elemento interactivo dentro de él (`panel.querySelector('[role="tab"], button, a')`). Al cerrarlo, devolver el foco al botón que lo abrió.

---

### 14. `aria-label` del mapa en inglés (MapLibre por defecto)
**Detalle:** Los botones de zoom del mapa ("Zoom in", "Zoom out", "Drag to rotate map") vienen en inglés desde MapLibre. Para audiencia hispanohablante son confusos.
**Recomendación:** MapLibre permite localización:
```js
map.addControl(new maplibregl.NavigationControl(), 'top-right');
// Sobrescribir después:
document.querySelector('.maplibregl-ctrl-zoom-in').setAttribute('aria-label', 'Acercar');
document.querySelector('.maplibregl-ctrl-zoom-out').setAttribute('aria-label', 'Alejar');
```

---

### 15. Sin modo "vista simplificada" para audiencia no técnica
**Heurística Nielsen:** #7 Flexibilidad y eficiencia
**Problema:** La app tiene dos audiencias muy distintas: expertos náuticos/meteorólogos y usuarios generales. Actualmente solo sirve bien a los primeros.
**Recomendación:** Añadir un toggle "Modo experto / Modo básico" en ajustes:
- **Modo básico:** Muestra temperatura, viento en km/h (no kt), condición general (texto) y 1-2 métricas. Sin CAPE, CIN, Lifted Idx, etc.
- **Modo experto:** La vista actual completa.

---

## 🟢 QUICK WINS — Alto impacto, bajo esfuerzo

### 16. Open Graph / SEO para audiencia amplia
**Problema:** No se detectaron meta tags OG. Cuando alguien comparte un link de MeteoMapGal en WhatsApp, Telegram o redes sociales, no aparece ninguna preview con imagen ni descripción.
**Recomendación:** Añadir en `<head>`:
```html
<meta property="og:title" content="MeteoMapGal — Meteorología en tiempo real para Galicia">
<meta property="og:description" content="Viento, temperatura, lluvia y alertas. 90+ estaciones en Galicia.">
<meta property="og:image" content="https://meteomapgal.navia3d.com/og-image.jpg">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
```

---

### 17. Contextualizar unidades para audiencia no náutica
**Problema:** Los nudos (kt) son estándar náutico. El 80% de los usuarios generales no saben qué es 1 kt.
**Recomendación:** Mostrar km/h como unidad principal o como unidad secundaria entre paréntesis: `19.8 kt (37 km/h)`. Añadir en ajustes una opción para cambiar entre kt y km/h.

---

### 18. Badge "offline" sin aria semántico
**Problema:** El badge "offline" de la estación SkyX1 no tiene `role` ni `aria-label` específico. Para un lector de pantalla el estado de la estación no se comunica.
**Recomendación:**
```html
<span role="status" aria-label="Estación sin datos recientes — última actualización hace 0 minutos">
  offline 0m
</span>
```

---

### 19. `aria-label` del panel Condiciones en minúsculas inconsistente
**Detalle menor:** El `aria-label` del dialog es `"Panel de alertas y campo"` pero el título visible dice `"Condiciones"`. Si son distintos, los lectores de pantalla anuncian uno y el usuario ve otro.
**Recomendación:** Alinear aria-label con el título visible: `aria-label="Condiciones, alertas y campo"` (ya usado en el botón que lo abre — mantener consistencia).

---

### 20. Falta feedback visual en el botón de "Refrescar" durante carga
**Heurística Nielsen:** #1 Visibilidad del estado del sistema
**Problema:** Al pulsar "Refrescar", no hay indicación visual inmediata de que la carga está en proceso (spinner, texto cambiante). El texto `aria-live` "Actualizado hace X minutos" es correcto, pero el botón en sí no da feedback inmediato.
**Recomendación:** Mientras se refresca, cambiar el texto a "Actualizando..." y añadir un spinner SVG inline con `aria-busy="true"` en el contenedor principal.

---

## 📊 Evaluación para audiencia amplia (score estimado)

| Dimensión | Score actual | Meta |
|-----------|-------------|------|
| Accesibilidad técnica (WCAG 2.2 A/AA) | 68/100 | 90/100 |
| Usabilidad primera visita | 45/100 | 75/100 |
| Usabilidad usuario recurrente | 82/100 | 90/100 |
| Experiencia móvil táctil | 42/100 | 80/100 |
| Consistencia visual | 70/100 | 88/100 |
| Alcance audiencia no técnica | 30/100 | 65/100 |

---

## Hoja de ruta sugerida por sprints

**Sprint 1 — Accesibilidad bloqueante (1–2 días)**
- Fix skip link visible en focus
- Tabs y barra inferior a mínimo 40px touch target
- Etiquetar el botón sin label
- `role="group"` en filtros de fuentes
- Localizar labels de MapLibre al español

**Sprint 2 — Audiencia móvil (2–3 días)**
- Banner de instalación PWA
- Responsive check: panel izquierdo en < 768px
- Tooltips en siglas de fuentes (MG/MC/WU/NT/SX)
- Botón de pausa visible en ticker
- Focus trap en panel Condiciones

**Sprint 3 — Audiencia amplia (1 semana)**
- Opción km/h además de kt
- Open Graph tags para sharing
- Indicador semáforo (verde/amarillo/rojo) en tarjetas de estación
- Tooltip de primer uso (onboarding contextual)
- Modo básico / experto en ajustes

---

---

## 📖 Auditoría específica: Guía MeteoMapGal (nueva feature)

La guía es una **incorporación excelente y muy completa** que cubre 9 secciones:
Introducción · Cómo leer el mapa · Spots de navegación · El térmico de Castrelo · Paneles y alertas · Historial · Glosario · Roadmap y fuentes · Aviso legal

Resuelve directamente los issues #6 (onboarding) y #17 (contextualizar unidades). El contenido es de alta calidad: explica kt, el scoring de los spots (calma/flojo/navegable/buen día/fuerte), el checklist del día perfecto con datos históricos AEMET, los módulos de alerta con sus niveles (Riesgo/Alto/Crítico), y un glosario meteorológico con ejemplos prácticos. **Muy por encima de lo habitual en apps de este tipo.**

Sin embargo, la guía tiene sus propios problemas UX que limitan su impacto:

### G1. 🔴 El botón de acceso mide 16×19px — el mejor contenido, inaccesible
La guía más completa de meteorología náutica de la app está detrás de un icono de **16×19px** en el pie del panel. El 90% de los usuarios nuevos nunca la encontrará.
**Recomendación:** Promover el acceso a la guía de forma prominente. Opciones:
- Un botón "¿Cómo funciona?" o "Guía" visible en la barra superior junto al logo.
- Un banner de primer uso: "Primera vez aquí? Consulta la guía →" (desaparece tras leerla).
- Un tooltip en elementos técnicos (CAPE, kt, scoring) que enlace a la sección del glosario correspondiente.

### G2. 🟠 Dos H1 simultáneos en el documento
El documento tiene dos `<h1>`: el de la app ("MeteoMapGal") y el de la guía ("Guía MeteoMapGal"). Esto confunde a lectores de pantalla y es incorrecto semánticamente — la guía debería empezar en `<h2>`.
**Recomendación:** El título de la guía debe ser `<h2>Guía MeteoMapGal</h2>`. Las secciones actuales de H2 pasan a H3, y los H3 a H4.

### G3. 🟠 Sin `aria-modal="true"` — el foco puede escapar al fondo
El dialog de la guía tiene `role="dialog"` pero no tiene `aria-modal="true"`. Usuarios de teclado o lector de pantalla pueden navegar al mapa mientras la guía está abierta, sin saber que hay un modal encima.
**Recomendación:**
```html
<div role="dialog" aria-modal="true" aria-labelledby="guide-title">
```
Y gestionar focus trap: primer elemento al abrir, devolver foco al botón al cerrar.

### G4. 🟠 Sin búsqueda en el glosario
El glosario tiene términos como CAPE, CIN, Lifted Index, wind shear, gradiente térmico… Para una audiencia no técnica que llega a la app y ve "CAPE 0 J/kg", necesita poder buscar ese término directamente.
**Recomendación:** Un `<input type="search">` en el sidebar de la guía que filtre las secciones/entradas del glosario en tiempo real. Implementación sencilla con JS client-side, sin backend.

### G5. 🟡 Navegación de secciones sin deep-linking
Los ítems del sidebar son botones, no `<a href="#section-id">`. Esto significa que no se puede enlazar directamente a una sección concreta (ej: `/guia#glosario`). Si alguien quiere compartir "mira la sección de CAPE", no puede.
**Recomendación:** Implementar `<a href="#glosario">` con scroll suave o actualizar la URL al navegar: `history.pushState(null, '', '#guia/glosario')`.

### G6. 🟡 Sin imágenes ni diagramas
Para conceptos como "viento térmico", "frente de racha" o "inversión térmica", una imagen vale más que 100 palabras. La guía es solo texto — funciona bien para expertos pero crea barrera para usuarios visuales.
**Recomendación:** Añadir al menos un diagrama simple por sección clave (térmica, score de spot, capas atmosféricas). SVGs inline son ideales: ligeros, escalables y accesibles con `<title>` + `<desc>`.

### G7. 🟡 Atajos de teclado (C, 1–4) documentados solo en la guía
La guía documenta que la tecla `C` abre el panel Condiciones y las teclas `1–4` cambian de tab. Sin embargo, no hay indicación de esto en la propia UI (ningún tooltip, badge ni hint).
**Recomendación:** Añadir hints de teclado en los elementos correspondientes:
```html
<button aria-label="Condiciones, alertas y campo (tecla C)">Condiciones</button>
```
Y un pequeño badge `⌨ C` visible en el botón (opcionalmente ocultable en móvil).

### G8. 🟢 "Apoya el proyecto" bien posicionado dentro de la guía
El CTA de Ko-fi está correctamente integrado en el sidebar de la guía con contexto de valor ("MeteoMapGal es gratuito y open source"). **Esto es mucho mejor que en la versión anterior.** Mantener y replicar este patrón en otros puntos de la app.

---

## Tabla de impacto actualizada: issues de la guía

| # | Issue Guía | Prioridad | Esfuerzo |
|---|-----------|-----------|----------|
| G1 | Botón acceso 16px — guía invisible | 🔴 Crítico | Bajo |
| G2 | Dos H1 simultáneos | 🟠 Alto | Bajo |
| G3 | Sin aria-modal ni focus trap | 🟠 Alto | Medio |
| G4 | Sin búsqueda en glosario | 🟠 Alto | Medio |
| G5 | Sin deep-linking a secciones | 🟡 Medio | Bajo |
| G6 | Sin imágenes/diagramas | 🟡 Medio | Alto |
| G7 | Atajos de teclado sin hint en UI | 🟡 Medio | Bajo |
| G8 | CTA Ko-fi bien contextualizado | ✅ Positivo | — |

---

*Auditoría realizada con análisis de árbol de accesibilidad ARIA, inspección programática del DOM, exploración manual de las 9 secciones de la guía, chequeos de touch targets, color scheme, landmarks, semántica ARIA y heurísticas Nielsen. Comparada contra versión v1.51.2.*
