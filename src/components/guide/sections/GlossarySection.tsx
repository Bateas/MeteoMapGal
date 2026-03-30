/**
 * Guide section: Glosario — meteorological terminology for non-experts.
 * Covers key concepts used throughout MeteoMapGal with practical examples.
 */
import { WeatherIcon } from '../../icons/WeatherIcons';

export function GlossarySection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Glosario meteorológico</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        Referencia rápida de los términos que encontrarás en MeteoMapGal.
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
          example="MeteoMapGal detecta frentes de racha cuando varias estaciones a barlovento muestran incrementos súbitos coordinados."
          color="#22c55e"
        />
        <Term
          term="CALMA"
          definition="Veredicto del banner de navegación cuando la velocidad del viento es inferior a 4 nudos. Indica ausencia de viento útil para navegar."
          example="Banner gris 'Sin viento' o '3 kt' → condiciones de calma. Si el score térmico es alto, se muestra 'Esperar térmico'."
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
          term="PBL (Planetary Boundary Layer)"
          definition="Altura de la capa límite planetaria (m). Capa de mezcla atmosférica donde se desarrollan los térmicos. A mayor altura, térmicos más potentes."
          example="PBL > 1500m = capa de mezcla profunda, excelentes térmicos. PBL < 800m = térmicos débiles o inexistentes."
          color="#f59e0b"
        />
        <Term
          term="Lifted Index (LI)"
          definition="Índice de estabilidad atmosférica (°C). Valores negativos indican inestabilidad — el aire quiere ascender. Valores positivos = aire estable."
          example="LI < -2°C = inestable, buenos térmicos. LI < -6°C = muy inestable (riesgo de tormentas). LI > 0 = estable, sin térmicos."
          color="#f59e0b"
        />
        <Term
          term="CIN (Convective Inhibition)"
          definition="Barrera energética que impide el desarrollo de convección (J/kg). Si es baja, las térmicas se desarrollan libremente."
          example="CIN < 50 J/kg = barrera mínima, térmicos se activan fácilmente. CIN > 200 J/kg = tapadera fuerte, difícil que arranquen."
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
          example="En la imagen satelital IR de MeteoMapGal, los Cb se ven como manchas blancas brillantes (topes fríos a -50°C)."
          color="#ef4444"
        />
        <Term
          term="Sombra de tormenta (storm shadow)"
          definition="Sistema de alerta de MeteoMapGal que cruza datos de radiación solar, rayos y anomalías de viento para detectar tormentas aproximándose."
          example="Caída brusca de radiación solar + rayos a 30km + rachas anómalas = alerta de sombra de tormenta activada."
          color="#ef4444"
        />
        <Term
          term="Outflow / flujo de salida"
          definition="Masa de aire frío que escapa de la base de una tormenta. Produce rachas violentas y caída brusca de temperatura."
          example="MeteoMapGal detecta outflows cuando 2+ estaciones consecutivas miden un incremento brusco de viento coordinado con la dirección de la tormenta."
          color="#ef4444"
        />
        <Term
          term="Corriente de pico (kA)"
          definition="Intensidad del rayo medida en kiloamperios. Valores positivos (+kA) suelen indicar rayos nube-tierra más potentes."
          example="Los rayos se muestran en el mapa coloreados por antigüedad: rojo = reciente, amarillo = horas, gris = antiguo."
          color="#ef4444"
        />
      </TermGroup>

      {/* ── Comfort & Safety ── */}
      <TermGroup title="Confort y seguridad">
        <Term
          term="Índice de calor (Heat Index)"
          definition="Temperatura aparente que combina aire y humedad relativa. A partir de 27°C y HR>40%, el cuerpo percibe más calor del real."
          example="32°C con 60% HR → sensación de 38°C. MeteoMapGal muestra alerta amarilla >27°C, naranja >32°C, roja >35°C en el popup del spot."
          color="#f59e0b"
        />
        <Term
          term="Wind Chill (sensación térmica)"
          definition="Temperatura percibida por el efecto refrigerante del viento. Se aplica cuando T<10°C. Fórmula Environment Canada."
          example="8°C con 15kt → sensación de 4°C. MeteoMapGal lo muestra en popups de spots para que lleves ropa adecuada."
          color="#f59e0b"
        />
        <Term
          term="Factor de racha (Gust Factor)"
          definition="Ratio entre la racha máxima y el viento sostenido (×N.N). Valores altos (>2.0) indican turbulencia y condiciones impredecibles."
          example="Viento 8kt con racha 18kt → factor ×2.3, aire muy turbulento. MeteoMapGal lo muestra en el popup de la estación."
          color="#f59e0b"
        />
        <Term
          term="Afloramiento (Upwelling)"
          definition="Ascenso de agua fría profunda a la superficie por efecto del viento N/NW sostenido (transporte de Ekman). Típico de la costa gallega en verano."
          example="Viento NW ≥12kt durante 6+ horas → bajada brusca de SST de 3-5°C. MeteoMapGal detecta y alerta sobre el evento."
          color="#f59e0b"
        />
        <Term
          term="NAO (Oscilación del Atlántico Norte)"
          definition="Índice climático que mide la diferencia de presión entre Islandia y Azores. NAO+ = más viento y lluvia en el norte de Europa; NAO- = más borrasca en Galicia."
          example="NAO negativa en invierno → mayor probabilidad de temporales atlánticos en Galicia. MeteoMapGal muestra el índice actual."
          color="#f59e0b"
        />
      </TermGroup>

      {/* ── Agriculture & Viticulture ── */}
      <TermGroup title="Agricultura y viticultura">
        <Term
          term="ET₀ (Evapotranspiración de referencia)"
          definition="Cantidad de agua que pierde el suelo/cultivo por evaporación y transpiración (mm/día). Se calcula con temperatura, radiación, viento y humedad."
          example="ET₀ de 5 mm/día en verano → el viñedo pierde 5 litros de agua por m² diario. Necesita riego suplementario."
          color="#10b981"
        />
        <Term
          term="Mildiu (Downy Mildew)"
          definition="Enfermedad fúngica de la vid (Plasmopara viticola). Necesita calor (>10°C), humedad alta (>90%) y lluvia para propagarse. Ataca hojas y racimos."
          example="Noche con 14°C, HR 95% y lluvia durante 4h = alto riesgo de infección. MeteoMapGal cuenta las horas favorables en las próximas 24h."
          color="#10b981"
        />
        <Term
          term="Oídio (Powdery Mildew)"
          definition="Enfermedad fúngica (Erysiphe necator) que prefiere temperaturas moderadas (15-25°C) y humedad alta (>70%) SIN lluvia. Polvo blanco en hojas."
          example="Día soleado de 22°C con HR 75% → condiciones ideales para oídio. La lluvia inhibe su desarrollo."
          color="#10b981"
        />
        <Term
          term="Hargreaves-Samani"
          definition="Fórmula empírica para estimar la evapotranspiración (ET₀) a partir de temperaturas mínima y máxima. Versión simplificada de Penman-Monteith cuando faltan datos de radiación."
          example="MeteoMapGal calcula ET₀ diaria con Hargreaves-Samani usando las previsiones Open-Meteo de 48h, corrigiendo por viento y humedad."
          color="#10b981"
        />
      </TermGroup>

      {/* ── Tides & Navigation ── */}
      <TermGroup title="Mareas y navegación">
        <Term
          term="Pleamar"
          definition="Nivel máximo que alcanza la marea en un ciclo. Se produce aproximadamente cada 12h 25min (ciclo semidiurno)."
          example="Pleamar en Vigo a las 14:32, altura 3.8m → nivel máximo del día. Acceso a fondeos poco profundos."
          color="#0ea5e9"
        />
        <Term
          term="Bajamar"
          definition="Nivel mínimo de la marea en un ciclo. Los bajos y bancos de arena quedan expuestos."
          example="Bajamar en Baiona a las 08:15, altura 0.6m → mínimo del día. Precaución con calados bajos."
          color="#0ea5e9"
        />
        <Term
          term="Datum de carta"
          definition="Nivel de referencia (0 m) sobre el que se miden las alturas de marea. Corresponde aproximadamente a la bajamar más baja astronómica."
          example="Marea de 2.5m = el agua está 2.5m por encima del datum. Los calados de la carta se miden desde aquí."
          color="#0ea5e9"
        />
        <Term
          term="Coeficiente de marea"
          definition="Valor 20-120 que indica la amplitud relativa de la marea. > 95 = mareas vivas (gran amplitud), < 45 = mareas muertas."
          example="Coeficiente 110 = mareas vivas de equinoccio → diferencia de 4m entre plea y baja en Vigo."
          color="#0ea5e9"
        />
        <Term
          term="IHM (Instituto Hidrográfico de la Marina)"
          definition="Organismo español que publica las predicciones oficiales de mareas para puertos españoles."
          example="MeteoMapGal obtiene datos de mareas del API IHM para 5 puertos de las Rías Baixas."
          color="#0ea5e9"
        />
      </TermGroup>

      {/* ── Aviation & Drones ── */}
      <TermGroup title="Aviación y drones">
        <Term
          term="NOTAM (Notice to Airmen)"
          definition="Aviso temporal a pilotos sobre restricciones o peligros en el espacio aéreo. Incluye ejercicios militares, trabajos aéreos, etc."
          example="NOTAM de restricción temporal a 500m AGL sobre una zona agrícola → drones no pueden volar en esa área."
          color="#a855f7"
        />
        <Term
          term="UAS (Unmanned Aircraft System)"
          definition="Sistema de aeronave no tripulada (drones). Las zonas UAS (ZGUAS) de ENAIRE regulan dónde y cómo pueden operar."
          example="Zona UAS prohibida sobre aeródromo → MeteoMapGal muestra en rojo en el mapa y bloquea el veredicto Dron."
          color="#a855f7"
        />
        <Term
          term="ZGUAS (Zona Geográfica UAS)"
          definition="Delimitación geográfica de ENAIRE que define restricciones para operaciones de drones: prohibidas, autorizadas con condiciones, o informativas."
          example="ZGUAS de tipo prohibido sobre base militar → MeteoMapGal marca la zona en rojo y la lista en el tab Dron."
          color="#a855f7"
        />
        <Term
          term="AGL (Above Ground Level)"
          definition="Altura medida desde el nivel del suelo, no del mar. Las restricciones de drones se expresan en metros AGL."
          example="NOTAM restringe vuelo por debajo de 120m AGL → altura máxima legal para drones recreativos en España."
          color="#a855f7"
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
          definition="Escala de 0 a 12 que clasifica la fuerza del viento por sus efectos. MeteoMapGal usa su escala de colores para los marcadores."
          example="Fuerza 3 (7-10 kt) = hojas y banderas se mueven → ideal para velero pequeño."
          color="#a855f7"
        />
        <Term
          term="Propagación del viento"
          definition="Análisis que detecta cómo un cambio de viento se desplaza geográficamente de estación en estación."
          example="Si Ribadavia marca 15 kt del SW y 10 min después Castrelo marca lo mismo, hay propagación — MeteoMapGal calcula el ETA al embalse."
          color="#a855f7"
        />
        <Term
          term="Presión atmosférica (hPa)"
          definition="Peso del aire sobre un punto, medido en hectopascales (hPa) o milibares (mb). La tendencia barométrica indica cambios de tiempo inminentes."
          example="Presión cayendo rápidamente (>3 hPa/3h) = frente acercándose. Presión alta estable (>1020 hPa) = buen tiempo."
          color="#a855f7"
        />
        <Term
          term="Reflectividad radar (dBZ)"
          definition="Intensidad de la señal que el radar recibe al rebotar en gotas de lluvia, nieve o granizo. A mayor dBZ, mayor intensidad."
          example="15 dBZ = llovizna. 35 dBZ = lluvia moderada. 50+ dBZ = tormenta fuerte con posible granizo."
          color="#a855f7"
        />
      </TermGroup>

      {/* Quick-reference cheat sheet */}
      <div className="bg-gradient-to-r from-blue-900/20 to-cyan-900/20 rounded-lg p-4 border border-slate-700 space-y-2">
        <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5"><WeatherIcon id="clipboard-list" size={14} /> Referencia rápida de umbrales</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          <ThresholdRow label="Viento ideal velero" value="6 – 20 kt" />
          <ThresholdRow label="Racha peligrosa" value="> 25 kt" />
          <ThresholdRow label="HR ideal térmicos" value="45 – 65%" />
          <ThresholdRow label="Niebla inminente" value="Spread < 2°C" />
          <ThresholdRow label="Tormenta cercana" value="CAPE > 1000 J/kg" />
          <ThresholdRow label="Rayo peligroso" value="< 10 km" />
          <ThresholdRow label="Gradiente térmico OK" value="ΔT > 8°C" />
          <ThresholdRow label="PBL térmicos buenos" value="> 1500 m" />
          <ThresholdRow label="LI inestable" value="< -2°C" />
          <ThresholdRow label="CIN barrera baja" value="< 50 J/kg" />
          <ThresholdRow label="Helada radiativa" value="Tmin < 0°C, viento < 2 m/s" />
          <ThresholdRow label="ET₀ riego necesario" value="> 4 mm/día" />
          <ThresholdRow label="Mildiu favorable" value="T>10°C + HR>90% + lluvia" />
          <ThresholdRow label="Oídio favorable" value="T 15-25°C + HR>70% seco" />
          <ThresholdRow label="Dron max viento" value="< 15 kt (18 kt rachas)" />
          <ThresholdRow label="Mareas vivas" value="Coef. > 95" />
          <ThresholdRow label="Estabilidad excelente" value="BLH > 1500m, CAPE > 200" />
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
      style={{ borderColor: `${color}20`, background: `${color}08` }}
    >
      <span className="text-xs font-bold" style={{ color }}>{term}</span>
      <p className="text-[11px] text-slate-400 leading-relaxed">{definition}</p>
      <p className="text-[11px] text-slate-500 leading-relaxed italic">
        <strong className="text-slate-400 not-italic">Ejemplo:</strong> {example}
      </p>
    </div>
  );
}

function ThresholdRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-300 font-mono font-semibold">{value}</span>
    </div>
  );
}
