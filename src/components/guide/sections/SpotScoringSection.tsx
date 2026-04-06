/**
 * Guide section: Spots de navegación — explains the 5-level spot scoring system.
 * Generic section (both sectors).
 */
import { WeatherIcon } from '../../icons/WeatherIcons';

export function SpotScoringSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Spots de navegación</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        Cada sector tiene <strong className="text-slate-300">spots</strong>: zonas concretas
        de navegación con su propio veredicto basado en estaciones
        cercanas, boyas y patrones de viento conocidos. El color del spot en el mapa
        te dice de un vistazo si merece la pena ir.
      </p>

      {/* What is a spot */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">
          <WeatherIcon id="sailboat" size={14} className="inline-block mr-1.5 text-emerald-400" />
          ¿Qué es un spot?
        </h3>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-[11px] text-slate-400 space-y-2 leading-relaxed">
          <p>
            Un spot es una micro-zona de navegación con radio definido (6-15 km). El sistema
            selecciona automáticamente las estaciones meteorológicas y boyas más cercanas
            para calcular un scoring específico.
          </p>
          <p>
            <strong className="text-slate-300">Clica en el marcador</strong> para ver el popup con veredicto,
            viento, oleaje, temperatura, humedad y resumen. En móvil aparece como panel inferior deslizante.
          </p>
          <p>
            <strong className="text-slate-300">Dos tipos de spot en el mapa:</strong>
          </p>
          <ul className="space-y-1 pl-3">
            <li><strong className="text-emerald-400">Hexágono</strong> = spot de <strong>vela/kite</strong>. Veredicto basado en viento (CALMA/FLOJO/NAVEG./BUENO/FUERTE).</li>
            <li><strong className="text-cyan-400">Pentágono</strong> = spot de <strong>surf</strong>. Veredicto basado en olas (FLAT/PEQUE/SURF OK/CLÁSICO/GRANDE).</li>
          </ul>
        </div>
      </div>

      {/* Spots by sector */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Spots disponibles</h3>

        {/* Embalse */}
        <div className="bg-slate-900/50 rounded-lg p-3 border border-amber-500/20 space-y-1.5">
          <div className="text-[11px] font-bold text-amber-400">Embalse de Castrelo</div>
          <SpotRow name="Castrelo" desc="Valle del Miño. Agua dulce, térmica WSW tardes." thermal />
          <p className="text-[11px] text-slate-500 italic pt-1">
            Próximamente: más spots (viñedos, valles colindantes).
          </p>
        </div>

        {/* Rías */}
        <div className="bg-slate-900/50 rounded-lg p-3 border border-blue-500/20 space-y-1.5">
          <div className="text-[11px] font-bold text-blue-400">Rías Baixas</div>
          <SpotRow name="Cesantes" desc="Interior Ría, ensenada de San Simón. Agua plana, térmica WSW tardes." thermal />
          <SpotRow name="Bocana" desc="Estrecho de Rande, Vigo–San Simón. Terral matutino E/ENE." />
          <SpotRow name="Centro Ría" desc="Canido–Limens. Virazón SW tardes, oleaje moderado." />
          <SpotRow name="Cíes-Ría" desc="Baiona–Cíes. Condiciones oceánicas, nortada verano." />
          <SpotRow name="Lourido" desc="Playa Lourido, Ría de Pontevedra. Kite/windsurf, virazón SW." thermal />
          <SpotRow name="Castiñeiras" desc="Costa norte Ría de Arousa. Exposición atlántica, surf y kite." />
          <SpotRow name="Vao" desc="Sur de Vigo, playa urbana. Protección parcial de las Cíes." />
          <SpotRow name="A Lanzada" desc="Playa oceánica O Grove–Sanxenxo. Referencia kite y surf en Galicia." />
          <SpotRow name="Illa Arousa" desc="Interior Ría de Arousa. Agua plana, brisa térmica tardes." thermal />
        </div>

        {/* Surf spots */}
        <div className="bg-slate-900/50 rounded-lg p-3 border border-cyan-500/20 space-y-1.5">
          <div className="text-[11px] font-bold text-cyan-400">
            <WeatherIcon id="waves" size={11} className="inline-block mr-1 text-cyan-400" />
            Spots de Surf <span className="badge-beta ml-1" style={{ borderColor: 'rgba(34,211,238,0.3)', color: '#22d3ee', background: 'rgba(34,211,238,0.1)' }}>Beta</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Marcadores pentagonales. Scoring basado en oleaje (Open-Meteo Marine) con corrección costera.
            Factores: altura ola, período swell, viento offshore/onshore. Previsión de olas 24h en cada popup.
          </p>
          <SurfSpotRow name="Patos" desc="Playa NW en Nigrán. Beach break + reef. Marea media-alta, offshore S/SSW." />
          <SurfSpotRow name="A Lanzada (Surf)" desc="2.4km playa W abierta. Muy consistente. Offshore NE/E. Todas las mareas." />
          <SurfSpotRow name="Corrubedo" desc="Playa NW en parque natural. Olas potentes, intermedio-avanzado. Offshore SE." />
          <div className="pt-1.5 space-y-1.5 text-[11px] text-slate-500 leading-relaxed">
            <p>
              <strong className="text-cyan-300">Swell</strong> = oleaje de fondo generado por tormentas lejanas.
              Período &gt;8s = buena calidad. Las boyas PORTUS miden altura (Hm0), período (Tp) y dirección.
            </p>
            <p>
              <strong className="text-cyan-300">Offshore</strong> = viento de tierra hacia el mar. Limpia y ordena las olas.
              <strong className="text-cyan-300"> Onshore</strong> = lo contrario, destroza la superficie.
            </p>
          </div>
          <div className="pt-2 space-y-1">
            <div className="text-[11px] font-bold text-cyan-300">Escala de oleaje (5 niveles)</div>
            <VerdictRow color="#94a3b8" label="Flat"     wind="&lt; 0.3m" desc="Mar plano. Sin olas para surf." />
            <VerdictRow color="#22d3ee" label="Peque"    wind="0.3-0.8m" desc="Olas pequeñas. Longboard o iniciarse." />
            <VerdictRow color="#3b82f6" label="Surf OK"  wind="0.8-1.5m" desc="Olas surfeables. Buen día para meterse." />
            <VerdictRow color="#22c55e" label="Clásico"  wind="1.5-2.5m" desc="Olas limpias y consistentes." />
            <VerdictRow color="#f97316" label="Grande"   wind="&gt; 2.5m" desc="Mar grande. Solo con experiencia." />
            <p className="text-[10px] text-slate-600 italic pt-1">
              Correccion costera: cada playa tiene su factor segun exposicion al oceano (Patos 0.45 por las Cies, Lanzada 0.75, Corrubedo 0.88). Ademas se ajusta por la direccion del swell respecto a la orientacion de la playa.
            </p>
          </div>
        </div>
      </div>

      {/* 5-level scoring scale */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Escala de viento (9 niveles)</h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-2 text-[11px]">
          <p className="text-slate-400 leading-relaxed">
            El veredicto se basa en el <strong className="text-slate-300">viento real medido</strong> por
            las estaciones cercanas al spot. El color del marcador en el mapa refleja directamente
            la intensidad del viento:
          </p>
          <div className="space-y-1.5 pt-1">
            <VerdictRow color="#64748b" label="Calma"     wind="< 1kt"   desc="Sin viento detectable." />
            <VerdictRow color="#38bdf8" label="Flojo"     wind="1-6kt"   desc="Viento ligero. SUP, paseo, esperar a que suba." />
            <VerdictRow color="#22c55e" label="Navegable" wind="6-9kt"   desc="Viento justo, condiciones limitadas." />
            <VerdictRow color="#84cc16" label="Bueno"     wind="9-13kt"  desc="Buen viento para navegar." />
            <VerdictRow color="#eab308" label="Buen día"  wind="13-18kt" desc="Viento estable, apto para todas las modalidades." />
            <VerdictRow color="#f97316" label="Fuerte"    wind="18-23kt" desc="Requiere experiencia. Viento potente." />
            <VerdictRow color="#ef4444" label="Temporal"  wind="23-30kt" desc="Peligroso. Solo navegantes muy experimentados." />
            <VerdictRow color="#a855f7" label="Tormenta"  wind="30-40kt" desc="Condiciones extremas. No salir al agua." />
            <VerdictRow color="#7c3aed" label="Severo"    wind="40-50kt" desc="Daños materiales probables." />
            <VerdictRow color="#1e1b4b" label="Huracán"   wind="50+ kt"  desc="Situación de emergencia." />
          </div>
          <p className="text-[11px] text-slate-500 italic pt-2">
            Las estaciones meteorológicas están en tierra, no en el agua. El viento real en la
            superficie del agua suele ser un 15-25% superior al que marca la estación más cercana.
          </p>
        </div>
      </div>

      {/* Score nuance */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Matices del scoring</h3>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-[11px] text-slate-400 space-y-2 leading-relaxed">
          <p>
            Además del viento, el score (0-100) incorpora factores que matizan:
          </p>
          <ul className="space-y-1 pl-3">
            <li><strong className="text-slate-300">Patrón reconocido</strong> — térmica, nortada, terral, virazón. Umbral: ≥5kt en spots térmicos, ≥8kt en el resto.</li>
            <li><strong className="text-slate-300">Consenso</strong> — cuántas estaciones confirman viento (más = mayor fiabilidad).</li>
            <li><strong className="text-slate-300">Oleaje</strong> — crítico en Cíes-Ría, moderado en Centro Ría, ignorado en Cesantes.</li>
            <li><strong className="text-slate-300">Norte en Cesantes</strong> — penaliza: el norte mata la térmica.</li>
            <li><strong className="text-slate-300">Canalización térmica</strong> — bonus si en Cesantes hay térmica WSW activa (amplifica viento).</li>
            <li><strong className="text-slate-300">Calibración por spot</strong> — offset en nudos que compensa estaciones montadas a baja altura.</li>
            <li><strong className="text-amber-400">Precursor humedad (bruma)</strong> — si la boya cercana detecta humedad &gt;65% + dirección WSW + horario diurno, el sistema anticipa viento probable. Correlación 96% en análisis histórico 3 años.</li>
            <li><strong className="text-sky-400">Tendencia de viento</strong> — analiza los últimos 30 minutos. Si sube &gt;3kt marca "viento subiendo", si sube &gt;6kt marca "subida rápida" con alerta.</li>
            <li><strong className="text-blue-400">Boost boya 2x</strong> — las boyas preferidas dentro de 5km pesan el doble. Miden viento en el agua = lo que siente el navegante.</li>
            <li><strong className="text-emerald-400">Viento en costa</strong> — si una estación costera (aguas arriba) marca viento y el spot está en calma, indica viento frontal aproximándose.</li>
          </ul>
        </div>
      </div>

      {/* Environmental data */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">
          <WeatherIcon id="thermometer" size={14} className="inline-block mr-1.5 text-sky-400" />
          Datos ambientales
        </h3>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-[11px] text-slate-400 space-y-2 leading-relaxed">
          <p>
            El popup del spot muestra datos del entorno extraídos de la estación más cercana:
          </p>
          <ul className="space-y-1 pl-3">
            <li><strong className="text-slate-300">Temperatura aire</strong> — de la estación más próxima con dato válido.</li>
            <li><strong className="text-sky-400">Humedad</strong> — porcentaje relativo. Color: verde &lt;60%, azul &lt;80%, morado ≥80%.</li>
            <li><strong className="text-blue-400">Sensación térmica</strong> — wind chill (fórmula Environment Canada). Solo aparece cuando T&lt;10°C y viento&gt;4.8 km/h. Útil en invierno con norte.</li>
            <li><strong className="text-amber-400">Índice de calor</strong> — sensación térmica real cuando T&gt;27°C y HR&gt;40% (fórmula NWS). Amarillo &gt;27°C, naranja &gt;32°C, rojo &gt;35°C.</li>
            <li><strong className="text-slate-300">Flecha de dirección</strong> — flecha rotada según bearing real + cardinal (N, SW, etc.). Indica de dónde viene el viento.</li>
            <li><strong className="text-yellow-400">Spot favorito ★</strong> — pulsa ★ en el popup para marcar tu spot. Aparece primero en el ticker y selectores. Se guarda en localStorage.</li>
          </ul>
        </div>
      </div>

      {/* Thermal detail */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">
          <WeatherIcon id="thermometer" size={14} className="inline-block mr-1.5 text-orange-400" />
          Detalle térmico
        </h3>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-[11px] text-slate-400 space-y-2 leading-relaxed">
          <p>
            Los spots con <strong className="text-slate-300">detección térmica</strong> (Castrelo,
            Cesantes, Lourido) muestran filas adicionales al expandir la tarjeta:
          </p>
          <ul className="space-y-1 pl-3">
            <li><strong className="text-orange-400">ΔT diurno</strong> — diferencia entre Tmax y Tmin previstas. ≥16°C favorece térmicas.</li>
            <li><strong className="text-yellow-400">Prob. térmicas</strong> — estimación combinando ΔT + atmósfera + tendencia.</li>
            <li><strong className="text-sky-400">Ventana viento</strong> — horas previstas con viento ≥3kt (10h-20h).</li>
            <li><strong className="text-slate-300">Nubes / CAPE</strong> — cobertura nubosa + energía convectiva.</li>
            <li><strong className="text-amber-400">Tendencia</strong> — señales precursoras (activas, probables, en formación).</li>
            <li><strong className="text-red-400">Alerta térmica temprana</strong> — panel colapsable con 6 señales precursoras:
              terral matutino (25%), ΔT agua-aire desde boya (20%), rampa solar (20%),
              gradiente de humedad costa-interior (15%), divergencia de viento entre estaciones (10%)
              y previsión favorable (10%). Muestra probabilidad 0-100%, confianza y ETA.</li>
            <li><strong className="text-orange-400">Amplificación térmica</strong> — cuando se detecta térmica activa
              (probabilidad ≥40% + WSW + viento ≥3kt), el scoring aplica un factor de amplificación
              (hasta +50%) sobre el consenso de viento.
              Muestra aviso de "baja confianza" con el número de fuentes.</li>
          </ul>
          <p className="text-[11px] text-slate-500 italic">
            Estos datos proceden de Open-Meteo (previsión), análisis térmico en tiempo real y boyas marinas.
          </p>
        </div>
      </div>

      {/* Webcams */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">
          <WeatherIcon id="camera" size={14} className="inline-block mr-1.5 text-sky-400" />
          Webcams
        </h3>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-[11px] text-slate-400 space-y-2 leading-relaxed">
          <p>
            Algunos spots incluyen webcams accesibles desde el popup. Despliega la sección
            <strong className="text-slate-300"> Webcams</strong> en el popup del spot.
          </p>
          <ul className="space-y-1 pl-3">
            <li><strong className="text-slate-300">Cíes-Ría</strong> — Imagen estática de playa de Rodas (MeteoGalicia, cada 5 min). Se puede refrescar manualmente.</li>
            <li><strong className="text-slate-300">Cesantes</strong> — Enlace a stream en vivo de tmkites.com (se abre en nueva pestaña).</li>
            <li><strong className="text-slate-300">Bocana / Centro Ría</strong> — Vigo Móvil (G24): visión desde Porto de Vigo hacia la bocana y medio de la ría.</li>
            <li><strong className="text-slate-300">Lourido</strong> — KiteGalicia: enlace a página del centro KG Lourido con condiciones en vivo.</li>
          </ul>
          <p className="text-[11px] text-slate-500 italic">
            Las webcams son fuentes externas. La disponibilidad depende del proveedor.
          </p>
        </div>
      </div>

      {/* Tides in spots */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">
          <WeatherIcon id="anchor" size={14} className="inline-block mr-1.5 text-cyan-400" />
          Mareas en spots
        </h3>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-[11px] text-slate-400 space-y-2 leading-relaxed">
          <p>
            Cada spot Rías muestra un <strong className="text-slate-300">resumen de mareas</strong> integrado
            en el popup, con las pleamares (&blacktriangle;) y bajamares (&blacktriangledown;) del día.
            La próxima marea se resalta en color para referencia rápida.
          </p>
          <ul className="space-y-1 pl-3">
            <li><strong className="text-slate-300">Cesantes, Bocana, C. Ría</strong> — Mareas de Vigo (IHM).</li>
            <li><strong className="text-slate-300">Cíes-Ría</strong> — Mareas de Baiona (IHM).</li>
            <li><strong className="text-slate-300">Lourido</strong> — Mareas de Marín (IHM).</li>
          </ul>
        </div>
      </div>

      {/* Buoy wind arrows */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">
          <WeatherIcon id="wind" size={14} className="inline-block mr-1.5 text-emerald-400" />
          Viento en boyas
        </h3>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-[11px] text-slate-400 space-y-2 leading-relaxed">
          <p>
            Las boyas con anemómetro (REMPOR, CETMAR, REDEXT) muestran una
            <strong className="text-slate-300"> flecha de viento</strong> directamente sobre el marcador,
            más un <strong className="text-slate-300">badge con nudos</strong> (bottom-left).
          </p>
          <p className="text-[11px] text-slate-500 italic">
            Las boyas REDMAR (Vigo, Marín, Vilagarcía) son mareógrafos y <strong>no tienen anemómetro</strong>.
            La boya Rande (1251) tampoco mide viento — mide temperatura del agua y del aire,
            humedad y punto de rocío (vía Observatorio Costeiro). Es clave para detectar el patrón de
            bruma/térmica costera (precursor de humedad &gt;65%).
          </p>
        </div>
      </div>

      {/* Mobile */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">En móvil</h3>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Al tocar un spot en el mapa aparece un panel inferior deslizante con toda la info:
          veredicto, viento, oleaje y resumen. Solo un popup a la vez (spot, estación o boya).
        </p>
      </div>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────── */

function SpotRow({ name, desc, thermal }: { name: string; desc: string; thermal?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <WeatherIcon id="sailboat" size={11} className="text-slate-500 mt-0.5 flex-shrink-0" />
      <div>
        <span className="font-bold text-slate-300">{name}</span>
        {thermal && <span className="text-orange-400/70 ml-1 text-[11px]">térmico</span>}
        <span className="text-slate-500 ml-1">— {desc}</span>
      </div>
    </div>
  );
}

function SurfSpotRow({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <WeatherIcon id="waves" size={11} className="text-cyan-500 mt-0.5 flex-shrink-0" />
      <div>
        <span className="font-bold text-cyan-300">{name}</span>
        <span className="text-slate-500 ml-1">— {desc}</span>
      </div>
    </div>
  );
}

function VerdictRow({ color, label, wind, desc }: { color: string; label: string; wind: string; desc: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="font-bold w-[60px]" style={{ color }}>{label}</span>
      <span className="text-slate-300 font-mono w-[52px] text-[11px]">{wind}</span>
      <span className="text-slate-400 flex-1">{desc}</span>
    </div>
  );
}
