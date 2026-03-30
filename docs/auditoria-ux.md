# Auditoría UX — MeteoMapGal
**URL:** https://meteomapgal.navia3d.com/
**Fecha:** 30 de marzo de 2026
**Foco:** Usabilidad · Accesibilidad (WCAG) · Consistencia visual · CTAs

---

## Resumen ejecutivo

MeteoMapGal es una aplicación de monitorización meteorológica técnicamente sólida, con una densidad de información muy alta y una audiencia que parece ser usuarios con conocimiento náutico/meteorológico. El mayor riesgo UX es la **curva de aprendizaje no guiada**: un usuario nuevo no sabe por dónde empezar. A nivel técnico de accesibilidad hay problemas graves (texto de 6–9px, touch targets de 16px, 0 regiones aria-live para datos en tiempo real).

---

## 🔴 CRÍTICO — Bloqueantes de usabilidad o accesibilidad grave

### 1. Texto con tamaños ilegibles (6–10px)
**Categoría:** Accesibilidad / Consistencia visual
**Problema:** Se detectaron elementos con fuentes de 6px, 7px, 8px, 9px y 10px. El texto más pequeño es básicamente ilegible sin zoom, y viola WCAG 1.4.4 (texto redimensionable) en la práctica.
**Elementos afectados:** Etiquetas de datos en tarjetas de estación, badges de fuentes (MG/MC/WU...), valores secundarios.
**Recomendación:** Establecer un mínimo de **12px** para cualquier texto visible (preferiblemente 13–14px para datos secundarios). Definir una escala tipográfica de no más de 5 tamaños.

---

### 2. Touch targets por debajo de 44×44px
**Categoría:** Accesibilidad (WCAG 2.5.5) / Usabilidad móvil
**Problema:** Múltiples controles tienen áreas de toque insuficientes:
- "Abrir guía meteorológica": **16×16px**
- "Panel campo y alertas": **28×17px**
- "Cambiar a modo claro": **32×32px**
- "Enviar feedback": **32×32px**
- "Refrescar": **50×18px** (ancho OK, pero muy poca altura)

**Recomendación:** Todo control interactivo debe tener como mínimo 44×44px de área de toque (o 24×24px con separación de 10px, WCAG 2.5.8). En iconos pequeños, usar padding para ampliar el área sin cambiar el visual.

---

### 3. 2 botones completamente sin etiqueta
**Categoría:** Accesibilidad (WCAG 4.1.2)
**Problema:** Hay dos `<button>` sin texto visible ni `aria-label`. Son completamente invisibles para lectores de pantalla y para cualquier test automatizado de a11y.
**Identificadores CSS:** `ml-auto rounded border border-slate-600` y `flex items-center justify-center gap-1 px-2 py-2 rounded-lg`.
**Recomendación:** Añadir `aria-label` descriptivo a todos los botones icónicos. Regla de código: ningún `<button>` en el codebase sin texto accesible.

---

### 4. Cero regiones `aria-live` en una app de datos en tiempo real
**Categoría:** Accesibilidad (WCAG 4.1.3)
**Problema:** Los datos se actualizan cada minuto, hay alertas meteorológicas, y el ticker cambia constantemente. Ninguno de estos elementos usa `aria-live`. Un usuario con lector de pantalla nunca sabe que los datos han cambiado.
**Recomendación:**
- Ticker de alertas: `aria-live="polite"` o mejor un botón para abrirlo como panel.
- Badge "Actualizado hace X minutos": `aria-live="polite"` con `aria-atomic="true"`.
- Alertas críticas: `aria-live="assertive"`.

---

### 5. Contenido en movimiento sin opción de pausa (Ticker marquee)
**Categoría:** Accesibilidad (WCAG 2.2.2) / Usabilidad
**Problema:** El ticker usa `role="marquee"` y el texto se mueve continuamente. No hay botón de pausa/stop. Esto viola WCAG 2.2.2 (pausar, detener, ocultar) y puede causar problemas a usuarios con trastornos vestibulares o TDAH.
**Recomendación:** Añadir un botón para pausar el ticker, o reemplazarlo por un carrusel estático con autoplay pausado en hover/focus. Alternativamente, convertirlo en un panel de alertas expandible.

---

## 🟠 ALTO — Impacto significativo en usabilidad o experiencia

### 6. Sin onboarding ni guía de inicio visible
**Categoría:** Usabilidad
**Problema:** Un usuario nuevo ve: 8 tabs en el panel izquierdo, 6 filtros de fuentes de datos, 4 capas de mapa (Viento/Humedad/Satélite/Radar), un panel de alertas separado, controles 3D del mapa, y un ticker con información técnica. No hay ningún tooltip, tooltip de bienvenida ni flujo guiado.
El botón "Abrir guía meteorológica" existe pero mide **16×16px** y es prácticamente invisible.
**Recomendación:**
- Hacer el botón de guía visible: texto + icono, al menos 44px de altura.
- Añadir un tooltip de primer uso ("¿Primera vez aquí? Haz clic en una estación del mapa para ver sus datos").
- Considerar un overlay de onboarding de 3 pasos la primera visita.

---

### 7. H1 con versión de app mezclada sin separación semántica
**Categoría:** Accesibilidad / Usabilidad
**Problema:** El H1 del documento lee `"MeteoMapGalv1.51.2"` — el número de versión está concatenado directamente al nombre sin espacio ni elemento separado. Para un lector de pantalla suena como "MeteoMapGalvunopuntocincounopuntodos".
**Recomendación:**
```html
<h1>MeteoMapGal <span class="version" aria-label="versión 1.51.2">v1.51.2</span></h1>
```

---

### 8. Siglas de fuentes de datos sin leyenda ni tooltip
**Categoría:** Usabilidad / Consistencia visual
**Problema:** Los filtros MG, MC, WU, NT, SX, A1 aparecen como badges de colores en el panel, pero sin ninguna explicación de qué significan (MeteoGalicia, MeteoClimatic, Weather Underground, Netatmo, SkyX, AEMET). Un usuario no técnico no tiene forma de saberlo.
**Recomendación:** Añadir tooltips al hacer hover sobre cada badge, con el nombre completo de la fuente. En móvil, mostrar el nombre completo o un modal explicativo.

---

### 9. Badge de datos desactualizados sin explicación del sistema
**Categoría:** Usabilidad / Consistencia visual
**Problema:** La estación "A LAMA" muestra un badge naranja "82min" — que indica que sus datos tienen 82 minutos de antigüedad. Este patrón no aparece explicado en ningún lugar y no es consistente con el resto de tarjetas (que no muestran ningún indicador de frescura).
**Recomendación:** Estandarizar la visualización de frescura de datos en todas las tarjetas de estación. Por ejemplo, un icono con color semántico (verde < 10min, amarillo < 60min, rojo > 60min) con tooltip explicativo.

---

### 10. Panel "Alertas" con nombre poco descriptivo ("Panel")
**Categoría:** Usabilidad
**Problema:** El botón en la esquina superior derecha se llama simplemente "Panel". No indica que contiene alertas, condiciones atmosféricas para vuelo/campo/dron, etc.
**Recomendación:** Renombrar a "Alertas y condiciones" o usar un icono de alerta con badge numérico cuando hay alertas activas. Esto aumentaría el descubrimiento de una feature muy valiosa.

---

### 11. Estado vacío de "Gráfica" con instrucciones de bajo contraste
**Categoría:** Usabilidad
**Problema:** La pestaña "Gráfica" muestra instrucciones en texto gris sobre fondo oscuro, en tamaño pequeño. El mensaje es correcto ("Haz click en una estación del mapa y pulsa 'Añadir a gráfica'"), pero la instrucción referencia una acción que ocurre en otro panel.
**Recomendación:** Mejorar el estado vacío con: icono ilustrativo, texto de mayor contraste, y si es posible un botón/link que lleve al usuario a interactuar con el mapa. Considerar una animación sutil que muestre el flujo.

---

## 🟡 MEDIO — Mejoras de calidad y consistencia

### 12. 11 tamaños tipográficos distintos (sistema de tipografía inconsistente)
**Categoría:** Consistencia visual
**Problema:** Se detectaron fuentes de: 6, 7, 8, 9, 10, 11, 12, 13, 14, 16 y 18px. Esto sugiere que cada componente fue estilado de manera independiente sin un design token de tipografía compartido.
**Recomendación:** Definir una escala de no más de 5–6 tamaños en CSS variables o Tailwind config:
```
xs: 11px (labels técnicos) / sm: 12px / base: 14px / md: 16px / lg: 18px / xl: 24px
```

---

### 13. Badges BETA con presentación inconsistente
**Categoría:** Consistencia visual
**Problema:** Los módulos "Perfil Atmosférico", "Viento en estaciones" y "Niebla/Rocío" muestran el estado BETA de distintas maneras: algunos como badge inline, otros como texto separado.
**Recomendación:** Crear un componente `<BetaBadge>` único y reutilizable con estilo y posición consistente.

---

### 14. Marcadores del mapa con accesibilidad genérica
**Categoría:** Accesibilidad
**Problema:** Antes cada marker del mapa tenía `aria-label="Map marker"` (genérico e inútil para lector de pantalla). Aunque actualmente parece que ese label fue removido, los markers deben tener descripciones específicas.
**Recomendación:** Cada marker debe tener `aria-label` con el nombre de la estación y dato principal: `aria-label="Fornelos de Montes: Viento 6.3kt, Temp 6.1°C"`.

---

### 15. Sin `meta[name="color-scheme"]`
**Categoría:** Accesibilidad / Consistencia visual
**Problema:** La app tiene modo oscuro/claro pero no declara `<meta name="color-scheme" content="dark light">`. Esto puede causar flash of unstyled content (FOUC) en el cambio de tema y no indica al navegador el esquema preferido.
**Recomendación:** Añadir `<meta name="color-scheme" content="dark light">` en el `<head>`.

---

### 16. Skip link de 1×1px (mal implementado)
**Categoría:** Accesibilidad (WCAG 2.4.1)
**Problema:** Hay un "skip link" ("Saltar al mapa") presente en el árbol de accesibilidad, pero su tamaño es 1×1px — lo que indica que está ocultado incorrectamente. Debería ser visible al recibir foco por teclado.
**Recomendación:** Implementar el patrón estándar de skip link que se muestra al recibir foco:
```css
.skip-link:not(:focus) {
  position: absolute;
  width: 1px; height: 1px;
  clip: rect(0,0,0,0);
  overflow: hidden;
}
.skip-link:focus {
  position: fixed; top: 0; left: 0;
  width: auto; height: auto;
  z-index: 9999; padding: 1rem;
}
```

---

## 🟢 BAJO — Quick wins y mejoras de experiencia

### 17. CTA "Apoyar" (Ko-fi) enterrado
**Categoría:** Conversión
**Problema:** El único CTA de monetización está al fondo del panel izquierdo, casi fuera del viewport. La mayoría de usuarios nunca lo verá.
**Recomendación:** Sin ser intrusivo: añadir un pequeño banner sutil en la parte inferior del panel o un modal ocasional de "Si te gusta MeteoMapGal, apoya el proyecto". También añadir un enlace en el footer del panel de alertas.

---

### 18. Sin opción de compartir o enlazar estado actual
**Categoría:** Conversión / Usabilidad
**Problema:** No hay forma de compartir un link a la estación seleccionada con sus datos actuales. En apps de datos, el sharing aumenta el tráfico de retorno y la retención.
**Recomendación:** Implementar URLs con parámetros de estado (`?station=fornelos&layer=wind`) y un botón "Copiar enlace" en la vista de cada estación.

---

### 19. "Exportar datos GeoJSON" sin contexto
**Categoría:** Usabilidad
**Problema:** El botón de exportación está visible en el panel pero sin explicación de qué exporta, para qué sirve o qué formato es.
**Recomendación:** Añadir tooltip: "Exporta las posiciones y datos actuales de todas las estaciones en formato GeoJSON para usar en SIG o mapas propios." Evaluar si este botón debería estar en un menú secundario de opciones avanzadas.

---

### 20. Falta `aria-describedby` en el slider de opacidad
**Categoría:** Accesibilidad
**Problema:** El `<input type="range">` de opacidad tiene `aria-label="Opacidad de la capa"` (correcto), pero no describe su unidad de medida ni los valores mín/máx de forma accesible.
**Recomendación:**
```html
<input type="range" min="0" max="100"
  aria-label="Opacidad de la capa"
  aria-valuemin="0" aria-valuemax="100"
  aria-valuenow="100" aria-valuetext="100%">
```

---

## Resumen de prioridades

| Prioridad | Nº | Issue |
|-----------|-----|-------|
| 🔴 Crítico | 1 | Texto de 6–10px ilegible |
| 🔴 Crítico | 2 | Touch targets < 44px |
| 🔴 Crítico | 3 | Botones sin aria-label |
| 🔴 Crítico | 4 | Sin aria-live en datos tiempo real |
| 🔴 Crítico | 5 | Ticker sin pausa (WCAG 2.2.2) |
| 🟠 Alto | 6 | Sin onboarding ni guía visible |
| 🟠 Alto | 7 | H1 con versión concatenada |
| 🟠 Alto | 8 | Siglas sin leyenda/tooltip |
| 🟠 Alto | 9 | Badge de frescura de datos inconsistente |
| 🟠 Alto | 10 | Nombre del panel poco descriptivo |
| 🟠 Alto | 11 | Estado vacío de Gráfica con bajo contraste |
| 🟡 Medio | 12 | 11 tamaños tipográficos distintos |
| 🟡 Medio | 13 | Badges BETA inconsistentes |
| 🟡 Medio | 14 | Markers del mapa sin aria-label descriptivo |
| 🟡 Medio | 15 | Sin meta color-scheme |
| 🟡 Medio | 16 | Skip link de 1×1px |
| 🟢 Bajo | 17 | CTA "Apoyar" enterrado |
| 🟢 Bajo | 18 | Sin opción de compartir/enlazar estado |
| 🟢 Bajo | 19 | Exportar GeoJSON sin contexto |
| 🟢 Bajo | 20 | Slider de opacidad sin aria-value descriptivo |

---

*Auditoría realizada con análisis de árbol de accesibilidad, inspección del DOM, chequeos programáticos de touch targets, tipografía y semántica ARIA.*
