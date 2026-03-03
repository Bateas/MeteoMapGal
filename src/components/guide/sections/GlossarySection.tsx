/**
 * Guide section: Glosario — meteorological terminology for non-experts.
 * Covers key concepts used throughout MeteoMap with practical examples.
 */
export function GlossarySection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Glosario meteorológico</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        Referencia rápida de los términos que encontrarás en MeteoMap.
        Cada concepto incluye un ejemplo práctico para facilitar su comprensión.
      </p>

      {/* ── Wind & Direction ── */}
      <TermGroup title="Viento y dirección">
        <Term
          term="Nudos (kt)"
          definition="Unidad náutica de velocidad. 1 nudo = 1,852 km/h ≈ 0,51 m/s."
          example="7 kt es una brisa suave ideal para velero. 20+ kt ya es viento fuerte."
          color="#22c55e"
        />
        <Term
          term="Dirección del viento"
          definition="De dónde sopla el viento (convención meteorológica). Un viento 'del N' sopla desde el norte hacia el sur."
          example="Viento del SW en el embalse = brisa térmica típica de tarde en verano."
          color="#22c55e"
        />
        <Term
          term="Racha (ráfaga)"
          definition="Pico momentáneo de velocidad del viento que supera la media sostenida. Suele durar 3-5 segundos."
          example="Viento medio 12 kt con rachas de 22 kt → peligro real para embarcaciones pequeñas."
          color="#22c55e"
        />
        <Term
          term="Cizalladura (wind shear)"
          definition="Cambio brusco de dirección o velocidad del viento en una distancia o altura corta."
          example="Si dos estaciones cercanas miden direcciones opuestas, hay cizalladura — peligro para drones y aviación."
          color="#22c55e"
        />
        <Term
          term="Frente de racha (gust front)"
          definition="Límite de avance de un flujo de aire frío, normalmente asociado a tormentas. Trae rachas violentas y repentinas."
          example="MeteoMap detecta frentes de racha cuando varias estaciones a barlovento muestran incrementos súbitos coordinados."
          color="#22c55e"
        />
      </TermGroup>

      {/* ── Temperature & Humidity ── */}
      <TermGroup title="Temperatura y humedad">
        <Term
          term="Humedad relativa (HR)"
          definition="Porcentaje de vapor de agua en el aire respecto al máximo posible a esa temperatura. 100% = aire saturado."
          example="HR 45-65% = ideal para térmicos. HR > 85% = niebla probable, vientos térmicos muy improbables."
          color="#3b82f6"
        />
        <Term
          term="Punto de rocío (Td)"
          definition="Temperatura a la que el aire se satura y el vapor se condensa en gotas (rocío, niebla o nubes)."
          example="Temperatura 18°C, Td 16°C → spread de 2°C → niebla inminente al anochecer."
          color="#3b82f6"
        />
        <Term
          term="Spread (T − Td)"
          definition="Diferencia entre temperatura actual y punto de rocío. Cuanto menor, más cerca de la saturación."
          example="Spread < 2°C = riesgo alto de niebla. Spread > 10°C = aire seco, buena visibilidad."
          color="#3b82f6"
        />
        <Term
          term="Gradiente térmico"
          definition="Diferencia de temperatura entre dos puntos, generalmente entre valle y montaña."
          example="Valle 31°C, cumbre 22°C → gradiente de 9°C → convección fuerte, buenos térmicos."
          color="#3b82f6"
        />
        <Term
          term="Inversión térmica"
          definition="Situación anómala donde la temperatura aumenta con la altura (normalmente disminuye). Atrapa contaminación y humedad en capas bajas."
          example="Mañana con niebla en el valle pero cielo despejado en montaña = inversión térmica. Los térmicos no se desarrollan hasta que se rompe."
          color="#3b82f6"
        />
      </TermGroup>

      {/* ── Thermal & Convection ── */}
      <TermGroup title="Convección y estabilidad atmosférica">
        <Term
          term="CAPE (Convective Available Potential Energy)"
          definition="Energía potencial disponible para la convección, medida en J/kg. Indica cuánta 'fuerza' tiene el aire para ascender."
          example="CAPE 0-300 = estable (bueno para navegar). CAPE 500-1000 = convección moderada. CAPE > 1500 = tormentas fuertes probables."
          color="#f59e0b"
        />
        <Term
          term="Viento anabático"
          definition="Brisa ascendente por las laderas calentadas por el sol. Se desarrolla por las mañanas y alcanza su pico por la tarde."
          example="En el embalse de Castrelo, el anabático del W/SW es la base del viento térmico para navegar (13h-20h)."
          color="#f59e0b"
        />
        <Term
          term="Viento catabático"
          definition="Flujo descendente de aire frío por las laderas al enfriarse por la noche. Aire denso que 'cae' por gravedad."
          example="Brisa de drenaje nocturna del N en Ribadavia, 3-4 m/s. Más intensa en noches despejadas y secas."
          color="#f59e0b"
        />
        <Term
          term="Térmica / columna térmica"
          definition="Corriente ascendente de aire calentado por el suelo. Los planeadores y aves rapaces las utilizan para ganar altura."
          example="Las térmicas activas generan cúmulos (nubes con base plana) a mediodía. Sin nubes = aire demasiado seco para condensar."
          color="#f59e0b"
        />
        <Term
          term="Convergencia"
          definition="Zona donde flujos de aire de distintas direcciones se encuentran y se ven forzados a ascender."
          example="La brisa de mar (W) y el terral (E) convergen sobre la ría creando una línea de ascendencia."
          color="#f59e0b"
        />
      </TermGroup>

      {/* ── Storm & Lightning ── */}
      <TermGroup title="Tormentas y rayos">
        <Term
          term="Cumulonimbus (Cb)"
          definition="Nube de desarrollo vertical que produce tormentas. Puede alcanzar 12+ km de altura y generar rayos, granizo y rachas."
          example="En la imagen satelital IR de MeteoMap, los Cb se ven como manchas blancas brillantes (topes fríos a -50°C)."
          color="#ef4444"
        />
        <Term
          term="Sombra de tormenta (storm shadow)"
          definition="Sistema de alerta de MeteoMap que cruza datos de radiación solar, rayos y anomalías de viento para detectar tormentas aproximándose."
          example="Caída brusca de radiación solar + rayos a 30km + rachas anómalas = alerta de sombra de tormenta activada."
          color="#ef4444"
        />
        <Term
          term="Outflow / flujo de salida"
          definition="Masa de aire frío que escapa de la base de una tormenta. Produce rachas violentas y caída brusca de temperatura."
          example="MeteoMap detecta outflows cuando 2+ estaciones consecutivas miden un incremento brusco de viento coordinado con la dirección de la tormenta."
          color="#ef4444"
        />
        <Term
          term="Corriente de pico (kA)"
          definition="Intensidad del rayo medida en kiloamperios. Valores positivos (+kA) suelen indicar rayos nube-tierra más potentes."
          example="Los rayos se muestran en el mapa coloreados por antigüedad: rojo = reciente, amarillo = horas, gris = antiguo."
          color="#ef4444"
        />
      </TermGroup>

      {/* ── Data & Interpolation ── */}
      <TermGroup title="Datos y técnicas">
        <Term
          term="IDW (Inverse Distance Weighting)"
          definition="Técnica de interpolación que estima valores entre estaciones. Las estaciones más cercanas tienen más peso en la estimación."
          example="Las capas de viento y humedad usan IDW para crear un mapa continuo a partir de 40 estaciones discretas."
          color="#a855f7"
        />
        <Term
          term="Infrarrojo (IR 10.8μm)"
          definition="Canal de satélite que mide la temperatura de los topes nubosos. Funciona 24h (no necesita luz solar)."
          example="En la capa satélite: blanco/brillante = nubes altas y frías (tormenta), gris oscuro = cielo despejado o nubes bajas."
          color="#a855f7"
        />
        <Term
          term="Escala Beaufort"
          definition="Escala de 0 a 12 que clasifica la fuerza del viento por sus efectos. MeteoMap usa su escala de colores para los marcadores."
          example="Fuerza 3 (7-10 kt) = hojas y banderas se mueven → ideal para velero pequeño."
          color="#a855f7"
        />
        <Term
          term="Propagación del viento"
          definition="Análisis que detecta cómo un cambio de viento se desplaza geográficamente de estación en estación."
          example="Si Ribadavia marca 15 kt del SW y 10 min después Castrelo marca lo mismo, hay propagación — MeteoMap calcula el ETA al embalse."
          color="#a855f7"
        />
      </TermGroup>

      {/* Quick-reference cheat sheet */}
      <div className="bg-gradient-to-r from-blue-900/20 to-cyan-900/20 rounded-lg p-4 border border-slate-700 space-y-2">
        <h3 className="text-xs font-bold text-slate-300">📋 Referencia rápida de umbrales</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          <ThresholdRow label="Viento ideal velero" value="6 – 20 kt" />
          <ThresholdRow label="Racha peligrosa" value="> 25 kt" />
          <ThresholdRow label="HR ideal térmicos" value="45 – 65%" />
          <ThresholdRow label="Niebla inminente" value="Spread < 2°C" />
          <ThresholdRow label="Tormenta cercana" value="CAPE > 1000 J/kg" />
          <ThresholdRow label="Rayo peligroso" value="< 10 km" />
          <ThresholdRow label="Gradiente térmico OK" value="ΔT > 8°C" />
          <ThresholdRow label="Helada radiativa" value="Tmin < 0°C, viento < 2 m/s" />
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────── */

function TermGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold text-white">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Term({
  term,
  definition,
  example,
  color,
}: {
  term: string;
  definition: string;
  example: string;
  color: string;
}) {
  return (
    <div
      className="rounded-lg border p-3 space-y-1"
      style={{ borderColor: `${color}18`, background: `${color}05` }}
    >
      <span className="text-xs font-bold" style={{ color }}>{term}</span>
      <p className="text-[10px] text-slate-400 leading-relaxed">{definition}</p>
      <p className="text-[10px] text-slate-500 leading-relaxed italic">
        <strong className="text-slate-400 not-italic">Ejemplo:</strong> {example}
      </p>
    </div>
  );
}

function ThresholdRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[10px]">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-300 font-mono font-semibold">{value}</span>
    </div>
  );
}
