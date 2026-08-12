/**
 * Guide section: what data we ingest, and what we do with it.
 *
 * Added because the guide had no place that answered the plainest question
 * anyone asks first — "what do you actually collect?" — and the honest answer
 * is much broader than the temperature and wind people assume.
 *
 * Figures come from `networkStats`, never typed in by hand: the network grew
 * from ~260 to ~500 stations in weeks, and every hardcoded count in this guide
 * had already drifted.
 */
import { WeatherIcon } from '../../icons/WeatherIcons';
import type { IconId } from '../../icons/WeatherIcons';
import {
  approxStationCount,
  STATION_COUNT_MEASURED_ON,
  BUOY_COUNT,
  SOURCES,
} from '../../../config/networkStats';

function VarGroup({
  icon, title, source, vars, note,
}: {
  icon: IconId;
  title: string;
  source: string;
  vars: string[];
  note?: string;
}) {
  return (
    <div className="bg-slate-900/50 rounded-lg p-3.5 border border-slate-800">
      <h4 className="text-xs font-bold text-white flex items-center gap-1.5 mb-1">
        <WeatherIcon id={icon} size={13} /> {title}
      </h4>
      <p className="text-[11px] text-slate-500 mb-2">{source}</p>
      <div className="flex flex-wrap gap-1">
        {vars.map((v) => (
          <span
            key={v}
            className="text-[11px] text-slate-300 bg-slate-800/70 border border-slate-700 rounded px-1.5 py-0.5"
          >
            {v}
          </span>
        ))}
      </div>
      {note && <p className="text-[11px] text-slate-500 leading-relaxed mt-2">{note}</p>}
    </div>
  );
}

export function DataSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Qué datos recogemos</h2>

      <p className="text-xs text-slate-400 leading-relaxed">
        La pregunta habitual es si esto es «temperatura y viento». No lo es. Debajo está el
        inventario completo de lo que entra, agrupado por tipo de fuente. Todo se archiva con
        su marca de tiempo: no guardamos solo el último valor, sino la serie.
      </p>

      {/* ── Volume ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat value={approxStationCount()} label="estaciones" />
        <Stat value={String(BUOY_COUNT)} label="boyas y mareógrafos" />
        <Stat value={String(SOURCES.length)} label="redes de observación" />
        <Stat value="mar. 2026" label="inicio del archivo" />
      </div>
      <p className="text-[11px] text-slate-500 -mt-4">
        Cifras de red medidas el {STATION_COUNT_MEASURED_ON}. El detalle vivo por provincia y por red
        está en «Roadmap y fuentes».
      </p>

      {/* ── The inventory ── */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
          <WeatherIcon id="database" size={14} /> Inventario por tipo de fuente
        </h3>

        <div className="grid gap-2 sm:grid-cols-2">
          <VarGroup
            icon="thermometer"
            title="Estaciones en tierra"
            source="AEMET · MeteoGalicia · Meteoclimatic · Weather Underground · Netatmo · SkyX"
            vars={[
              'viento medio', 'racha', 'dirección', 'temperatura', 'humedad',
              'presión', 'punto de rocío', 'radiación solar', 'precipitación', 'visibilidad',
            ]}
            note="No todas las estaciones miden todo: la visibilidad, por ejemplo, solo la reportan ocho estaciones de AEMET en toda Galicia."
          />

          <VarGroup
            icon="waves"
            title="Boyas y mareógrafos"
            source="Puertos del Estado · Observatorio Costeiro da Xunta"
            vars={[
              'altura de ola', 'ola máxima', 'periodo', 'dirección del oleaje',
              'temperatura del agua', 'salinidad', 'corrientes', 'nivel del mar',
              'viento sobre agua', 'presión', 'punto de rocío',
            ]}
            note="Es la parte que más sorprende: una sola boya aporta salinidad y corrientes, no solo oleaje. Y el viento medido sobre el agua es la referencia contra la que se calibra la red de tierra."
          />

          <VarGroup
            icon="activity"
            title="Atmósfera y convección"
            source="Open-Meteo · MeteoSIX (WRF 1 km, MeteoGalicia) · sondeos"
            vars={[
              'CAPE', 'CIN', 'índice de elevación', 'altura de capa límite',
              'viento en 850/700/500 hPa', 'temperatura en altura', 'geopotencial',
            ]}
            note="Es lo que permite distinguir una tarde de nubes de una tarde de tormenta antes de que haya un solo rayo."
          />

          <VarGroup
            icon="zap"
            title="Descargas eléctricas"
            source="MeteoGalicia"
            vars={['posición', 'hora', 'amperaje', 'polaridad']}
            note="Cada rayo se archiva individualmente. Sobre esa serie se agrupan las tormentas, se calcula hacia dónde van y se avisa por proximidad a un punto concreto."
          />

          <VarGroup
            icon="flame"
            title="Incendios"
            source="NASA FIRMS · EFFIS (Copernicus)"
            vars={['posición', 'potencia radiativa', 'confianza', 'satélite y pasada', 'concello', 'hectáreas']}
            note="FIRMS da detecciones de satélite; EFFIS da el incendio ya consolidado como evento. Se archiva TODO lo que entra, también lo que el filtro de visualización descarta."
          />

          <VarGroup
            icon="wind"
            title="Aire, mar y avisos"
            source="MeteoGalicia · CESGA · Copernicus Marine · IHM"
            vars={[
              'índice de calidad del aire', 'oleaje modelado (SWAN)',
              'temperatura superficial del mar', 'mareas astronómicas', 'avisos oficiales',
            ]}
          />
        </div>
      </div>

      {/* ── The method: what we DO with it ── */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
          <WeatherIcon id="compass" size={14} /> Qué hacemos con todo esto
        </h3>
        <div className="bg-blue-900/10 rounded-lg p-4 border border-blue-700/30 space-y-2.5">
          <p className="text-xs text-slate-300 leading-relaxed">
            El dato en bruto no es el producto. En Galicia hay cientos de estaciones, pero están
            donde alguien pudo ponerlas, no donde hace falta: una estación en un patio interior y
            otra en un cabo expuesto no miden lo mismo aunque estén a dos kilómetros.
          </p>
          <p className="text-xs text-slate-300 leading-relaxed">
            Por eso <strong className="text-blue-300">medimos cuánto se equivoca cada estación</strong>:
            se compara su viento con el de la boya de su ría, por sectores de dirección y a lo largo
            de meses, y de ahí sale su factor de abrigo. Con esos factores el motor pondera qué
            estaciones pesan más para cada punto, descarta las que contradicen a sus vecinas y da un
            veredicto para ese punto concreto.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            El mismo procedimiento detecta sensores averiados: un anemómetro parado marca calma
            perfecta y arrastraría la media hacia abajo, así que se identifica y se excluye.
          </p>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            El método está publicado en el repositorio, bajo licencia MIT. Lo que no es público es
            la medición: el archivo propio y la tabla calibrada que sale de él.
          </p>
        </div>
      </div>

      {/* ── Honesty about limits ── */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
          <WeatherIcon id="alert-triangle" size={14} /> Lo que NO hacemos
        </h3>
        <ul className="space-y-1.5 text-xs text-slate-400">
          <li className="flex gap-2">
            <span className="text-slate-600 shrink-0">·</span>
            <span>
              No estimamos viento a partir de las cámaras. El análisis de imagen solo se usa para
              niebla y visibilidad gruesa, que es para lo único que resulta fiable.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-slate-600 shrink-0">·</span>
            <span>
              No medimos oleaje dentro de las rías: no existe una boya que lo haga. Lo que se
              muestra en costa abierta procede de modelo, y se dice.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-slate-600 shrink-0">·</span>
            <span>
              No sustituimos a los avisos oficiales de AEMET ni de Protección Civil, y ninguna
              alerta se dispara desde una sola fuente: se exigen al menos dos señales
              independientes más un discriminador físico.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-center">
      <div className="text-lg font-bold text-white leading-tight">{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}
