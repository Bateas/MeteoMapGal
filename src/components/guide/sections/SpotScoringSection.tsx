/**
 * Guide section: Spots de navegación — explains the 5-level spot scoring system.
 * Generic section (both sectors).
 */
import { WeatherIcon } from '../../icons/WeatherIcons';

export function SpotScoringSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Spots de navegaci&oacute;n</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        Cada sector tiene <strong className="text-slate-300">spots</strong>: zonas concretas
        de navegaci&oacute;n con su propio veredicto basado en estaciones
        cercanas, boyas y patrones de viento conocidos. El color del spot en el mapa
        te dice de un vistazo si merece la pena ir.
      </p>

      {/* What is a spot */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">
          <WeatherIcon id="sailboat" size={14} className="inline-block mr-1.5 text-emerald-400" />
          &iquest;Qu&eacute; es un spot?
        </h3>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-[11px] text-slate-400 space-y-2 leading-relaxed">
          <p>
            Un spot es una micro-zona de navegaci&oacute;n con radio definido (6-15 km). El sistema
            selecciona autom&aacute;ticamente las estaciones meteorol&oacute;gicas y boyas m&aacute;s cercanas
            para calcular un scoring espec&iacute;fico.
          </p>
          <p>
            <strong className="text-slate-300">Clica en el marcador del spot en el mapa</strong> para ver
            el popup con: veredicto, viento (kt + flecha de direcci&oacute;n), oleaje, temperatura
            aire/agua, humedad, sensaci&oacute;n t&eacute;rmica (wind chill), patr&oacute;n detectado y resumen.
            En m&oacute;vil aparece como panel inferior deslizante.
          </p>
        </div>
      </div>

      {/* Spots by sector */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Spots disponibles</h3>

        {/* Embalse */}
        <div className="bg-slate-900/50 rounded-lg p-3 border border-amber-500/20 space-y-1.5">
          <div className="text-[11px] font-bold text-amber-400">Embalse de Castrelo</div>
          <SpotRow name="Castrelo" desc="Valle del Mi&ntilde;o. Agua dulce, t&eacute;rmica WSW tardes." thermal />
          <p className="text-[11px] text-slate-500 italic pt-1">
            Pr&oacute;ximamente: m&aacute;s spots (vi&ntilde;edos, valles colindantes).
          </p>
        </div>

        {/* Rías */}
        <div className="bg-slate-900/50 rounded-lg p-3 border border-blue-500/20 space-y-1.5">
          <div className="text-[11px] font-bold text-blue-400">R&iacute;as Baixas</div>
          <SpotRow name="Cesantes" desc="Interior R&iacute;a, ensenada de San Sim&oacute;n. Agua plana, t&eacute;rmica WSW tardes." thermal />
          <SpotRow name="Bocana" desc="Estrecho de Rande, Vigo&ndash;San Sim&oacute;n. Terral matutino E/ENE." />
          <SpotRow name="Centro R&iacute;a" desc="Canido&ndash;Limens. Viraz&oacute;n SW tardes, oleaje moderado." />
          <SpotRow name="C&iacute;es-R&iacute;a" desc="Baiona&ndash;C&iacute;es. Condiciones oce&aacute;nicas, nortada verano." />
          <SpotRow name="Lourido" desc="Playa Lourido, R&iacute;a de Pontevedra. Kite/windsurf, viraz&oacute;n SW." thermal />
        </div>
      </div>

      {/* 5-level scoring scale */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Escala de viento (5 niveles)</h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-2 text-[11px]">
          <p className="text-slate-400 leading-relaxed">
            El veredicto se basa en el <strong className="text-slate-300">viento real medido</strong> por
            las estaciones cercanas al spot. El color del marcador en el mapa refleja directamente
            la intensidad del viento:
          </p>
          <div className="space-y-1.5 pt-1">
            <VerdictRow color="#94a3b8" label="Calma"     wind="< 6kt"   desc="Sin viento. No se navega." />
            <VerdictRow color="#4ade80" label="Flojo"     wind="6-7kt"   desc="Poco viento. No merece preparar el barco." />
            <VerdictRow color="#bef264" label="Navegable" wind="8-11kt"  desc="Regatistas motivados. Ocio escaso." />
            <VerdictRow color="#facc15" label="Buen d&iacute;a"  wind="12-17kt" desc="Regata y ocio. Merece la pena ir." />
            <VerdictRow color="#fb923c" label="Fuerte"    wind="18+ kt"  desc="Solo con experiencia. Viento potente." />
          </div>
          <p className="text-[11px] text-slate-500 italic pt-2">
            Las estaciones meteorol&oacute;gicas est&aacute;n en tierra, no en el agua. El viento real en la
            superficie del agua suele ser un 15-25% superior al que marca la estaci&oacute;n m&aacute;s cercana.
          </p>
        </div>
      </div>

      {/* Score nuance */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Matices del scoring</h3>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-[11px] text-slate-400 space-y-2 leading-relaxed">
          <p>
            Adem&aacute;s del viento, el score (0-100) incorpora factores que matizan:
          </p>
          <ul className="space-y-1 pl-3">
            <li><strong className="text-slate-300">Patr&oacute;n reconocido</strong> — t&eacute;rmica, nortada, terral, viraz&oacute;n. Umbral: &ge;5kt en spots t&eacute;rmicos, &ge;8kt en el resto.</li>
            <li><strong className="text-slate-300">Consenso</strong> — cu&aacute;ntas estaciones confirman viento (m&aacute;s = mayor fiabilidad).</li>
            <li><strong className="text-slate-300">Oleaje</strong> — cr&iacute;tico en C&iacute;es-R&iacute;a, moderado en Centro R&iacute;a, ignorado en Cesantes.</li>
            <li><strong className="text-slate-300">Norte en Cesantes</strong> — penaliza: el norte mata la t&eacute;rmica.</li>
            <li><strong className="text-slate-300">Canalizaci&oacute;n t&eacute;rmica</strong> — bonus si en Cesantes hay t&eacute;rmica WSW activa (amplifica viento).</li>
            <li><strong className="text-slate-300">Calibraci&oacute;n por spot</strong> — offset en nudos que compensa estaciones montadas a baja altura.</li>
            <li><strong className="text-amber-400">Precursor humedad (bruma)</strong> — si la boya cercana detecta humedad &gt;65% + direcci&oacute;n WSW + horario diurno, el sistema anticipa viento probable. Correlaci&oacute;n 96% en an&aacute;lisis hist&oacute;rico 3 a&ntilde;os.</li>
            <li><strong className="text-sky-400">Tendencia de viento</strong> — analiza los &uacute;ltimos 30 minutos. Si sube &gt;3kt marca &ldquo;viento subiendo&rdquo;, si sube &gt;6kt marca &ldquo;subida r&aacute;pida&rdquo; con alerta.</li>
            <li><strong className="text-blue-400">Boost boya 2x</strong> — las boyas preferidas dentro de 5km pesan el doble. Miden viento en el agua = lo que siente el navegante.</li>
            <li><strong className="text-emerald-400">Viento en costa</strong> — si una estaci&oacute;n costera (aguas arriba) marca viento y el spot est&aacute; en calma, indica viento frontal aproxim&aacute;ndose.</li>
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
            El popup del spot muestra datos del entorno extra&iacute;dos de la estaci&oacute;n m&aacute;s cercana:
          </p>
          <ul className="space-y-1 pl-3">
            <li><strong className="text-slate-300">Temperatura aire</strong> — de la estaci&oacute;n m&aacute;s pr&oacute;xima con dato v&aacute;lido.</li>
            <li><strong className="text-sky-400">Humedad</strong> — porcentaje relativo. Color: verde &lt;60%, azul &lt;80%, morado &ge;80%.</li>
            <li><strong className="text-blue-400">Sensaci&oacute;n t&eacute;rmica</strong> — wind chill (f&oacute;rmula Environment Canada). Solo aparece cuando T&lt;10&deg;C y viento&gt;4.8 km/h. &Uacute;til en invierno con norte.</li>
            <li><strong className="text-amber-400">&Iacute;ndice de calor</strong> — sensaci&oacute;n t&eacute;rmica real cuando T&gt;27&deg;C y HR&gt;40% (f&oacute;rmula NWS). Amarillo &gt;27&deg;C, naranja &gt;32&deg;C, rojo &gt;35&deg;C.</li>
            <li><strong className="text-slate-300">Flecha de direcci&oacute;n</strong> — flecha rotada seg&uacute;n bearing real + cardinal (N, SW, etc.). Indica de d&oacute;nde viene el viento.</li>
            <li><strong className="text-yellow-400">Spot favorito ★</strong> — pulsa ★ en el popup para marcar tu spot. Aparece primero en el ticker y selectores. Se guarda en localStorage.</li>
          </ul>
        </div>
      </div>

      {/* Thermal detail */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">
          <WeatherIcon id="thermometer" size={14} className="inline-block mr-1.5 text-orange-400" />
          Detalle t&eacute;rmico
        </h3>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-[11px] text-slate-400 space-y-2 leading-relaxed">
          <p>
            Los spots con <strong className="text-slate-300">detecci&oacute;n t&eacute;rmica</strong> (Castrelo,
            Cesantes, Lourido) muestran filas adicionales al expandir la tarjeta:
          </p>
          <ul className="space-y-1 pl-3">
            <li><strong className="text-orange-400">&Delta;T diurno</strong> — diferencia entre Tmax y Tmin previstas. &ge;16&deg;C favorece t&eacute;rmicas.</li>
            <li><strong className="text-yellow-400">Prob. t&eacute;rmicas</strong> — estimaci&oacute;n combinando &Delta;T + atm&oacute;sfera + tendencia.</li>
            <li><strong className="text-sky-400">Ventana viento</strong> — horas previstas con viento &ge;3kt (10h-20h).</li>
            <li><strong className="text-slate-300">Nubes / CAPE</strong> — cobertura nubosa + energ&iacute;a convectiva.</li>
            <li><strong className="text-amber-400">Tendencia</strong> — se&ntilde;ales precursoras (activas, probables, en formaci&oacute;n).</li>
            <li><strong className="text-red-400">Alerta t&eacute;rmica temprana</strong> — panel colapsable con 6 se&ntilde;ales precursoras:
              terral matutino (25%), &Delta;T agua-aire desde boya (20%), rampa solar (20%),
              gradiente de humedad costa-interior (15%), divergencia de viento entre estaciones (10%)
              y previsi&oacute;n favorable (10%). Muestra probabilidad 0-100%, confianza y ETA.</li>
            <li><strong className="text-orange-400">Amplificaci&oacute;n t&eacute;rmica</strong> — cuando se detecta t&eacute;rmica activa
              (probabilidad &ge;40% + WSW + viento &ge;3kt), el scoring aplica un factor de amplificaci&oacute;n
              (hasta +50%) sobre el consenso de viento.
              Muestra aviso de &ldquo;baja confianza&rdquo; con el n&uacute;mero de fuentes.</li>
          </ul>
          <p className="text-[11px] text-slate-500 italic">
            Estos datos proceden de Open-Meteo (previsi&oacute;n), an&aacute;lisis t&eacute;rmico en tiempo real y boyas marinas.
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
            Algunos spots incluyen webcams accesibles desde el popup. Despliega la secci&oacute;n
            <strong className="text-slate-300"> Webcams</strong> en el popup del spot.
          </p>
          <ul className="space-y-1 pl-3">
            <li><strong className="text-slate-300">C&iacute;es-R&iacute;a</strong> &mdash; Imagen est&aacute;tica de playa de Rodas (MeteoGalicia, cada 5 min). Se puede refrescar manualmente.</li>
            <li><strong className="text-slate-300">Cesantes</strong> &mdash; Enlace a stream en vivo de tmkites.com (se abre en nueva pesta&ntilde;a).</li>
            <li><strong className="text-slate-300">Bocana / Centro R&iacute;a</strong> &mdash; Vigo M&oacute;vil (G24): visi&oacute;n desde Porto de Vigo hacia la bocana y medio de la r&iacute;a.</li>
            <li><strong className="text-slate-300">Lourido</strong> &mdash; KiteGalicia: enlace a p&aacute;gina del centro KG Lourido con condiciones en vivo.</li>
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
            Cada spot R&iacute;as muestra un <strong className="text-slate-300">resumen de mareas</strong> integrado
            en el popup, con las pleamares (&blacktriangle;) y bajamares (&blacktriangledown;) del d&iacute;a.
            La pr&oacute;xima marea se resalta en color para referencia r&aacute;pida.
          </p>
          <ul className="space-y-1 pl-3">
            <li><strong className="text-slate-300">Cesantes, Bocana, C. R&iacute;a</strong> &mdash; Mareas de Vigo (IHM).</li>
            <li><strong className="text-slate-300">C&iacute;es-R&iacute;a</strong> &mdash; Mareas de Baiona (IHM).</li>
            <li><strong className="text-slate-300">Lourido</strong> &mdash; Mareas de Mar&iacute;n (IHM).</li>
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
            Las boyas con anem&oacute;metro (REMPOR, CETMAR, REDEXT) muestran una
            <strong className="text-slate-300"> flecha de viento</strong> directamente sobre el marcador,
            m&aacute;s un <strong className="text-slate-300">badge con nudos</strong> (bottom-left).
          </p>
          <p className="text-[11px] text-slate-500 italic">
            Las boyas REDMAR (Vigo, Mar&iacute;n, Vilagarc&iacute;a) son mare&oacute;grafos y <strong>no tienen anem&oacute;metro</strong>.
            La boya Rande (1251) tampoco mide viento &mdash; mide temperatura del agua y del aire,
            humedad y punto de roc&iacute;o (v&iacute;a Observatorio Costeiro). Es clave para detectar el patr&oacute;n de
            bruma/t&eacute;rmica costera (precursor de humedad &gt;65%).
          </p>
        </div>
      </div>

      {/* Mobile */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">En m&oacute;vil</h3>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Al tocar un spot en el mapa aparece un panel inferior deslizante con toda la info:
          veredicto, viento, oleaje y resumen. Solo un popup a la vez (spot, estaci&oacute;n o boya).
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
        {thermal && <span className="text-orange-400/70 ml-1 text-[11px]">t&eacute;rmico</span>}
        <span className="text-slate-500 ml-1">&mdash; {desc}</span>
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
