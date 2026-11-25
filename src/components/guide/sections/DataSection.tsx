/**
 * Guide: what comes in and what we do with it. Figures come from `networkStats`, never typed by hand:
 * every count written into this guide had already drifted.
 */
import { approxStationCount, BUOY_COUNT, SOURCES } from '../../../config/networkStats';
import { Def, H3, type Tone } from '../guideParts';
import type { IconId } from '../../icons/WeatherIcons';

const INVENTORY: [string, string, string, IconId, Tone][] = [
  ['Estaciones en tierra', 'Viento, racha, temperatura, humedad, presión, sol y lluvia. No todas miden todo.', SOURCES.map((s) => s.name).join(', '), 'thermometer', 'wind'],
  ['Boyas y mareógrafos', 'Olas, temperatura del agua, salinidad, corrientes, nivel del mar y viento sobre el agua.', 'Puertos del Estado, Observatorio Costeiro da Xunta (INTECMAR)', 'waves', 'sea'],
  ['Rayos', 'Cada rayo, con su posición, hora e intensidad.', 'MeteoGalicia', 'zap', 'storm'],
  ['Incendios', 'Detecciones por satélite e incendios ya consolidados, con concello y hectáreas.', 'NASA FIRMS, EFFIS (Copernicus)', 'flame', 'fire'],
  ['Previsión', 'Viento, lluvia, nubes, olas y la energía del aire para las tormentas.', 'MeteoSIX (MeteoGalicia), Open-Meteo', 'compass', 'air'],
  ['Aire, mar y avisos', 'Calidad del aire, temperatura del mar, mareas y avisos oficiales.', 'MeteoGalicia, Open-Meteo, CESGA, IHM', 'bell', 'rain'],
];

export function DataSection() {
  return (
    <div className="g-theme gg-page">
      <h2>Qué datos recogemos</h2>
      <p>
        {approxStationCount()} estaciones activas de varias redes y {BUOY_COUNT} boyas y mareógrafos. Guardamos la serie completa desde marzo de 2026, no solo el último valor.
      </p>

      <section className="gg-section">
        <h3>Qué entra</h3>
        <dl className="gg-defs">
          {INVENTORY.map(([name, what, from, id, tone]) => (
            <Def key={name} id={id} tone={tone} name={name}>{what}<span className="gg-muted gg-small gg-block">{from}</span></Def>
          ))}
        </dl>
      </section>

      <section className="gg-section">
        <H3 id="gauge" tone="wind">Qué hacemos con ello</H3>
        <p>Las estaciones están donde alguien pudo ponerlas. Una en un patio y otra en un cabo no miden lo mismo aunque estén a dos kilómetros.</p>
        <p>Por eso comparamos las estaciones de la costa con cuatro puntos expuestos, por dirección y por las tardes. Así sabemos cuánto se quedan cortas. En el interior aún no hay referencia. Las que contradicen a sus vecinas pesan menos, y un anemómetro parado se detecta y se excluye.</p>
      </section>

      <section className="gg-section">
        <H3 id="alert-triangle" tone="storm">Lo que no hacemos</H3>
        <ul className="gg-bullets">
          <li>No sacamos el viento de las cámaras. La imagen solo se usa para niebla y visibilidad.</li>
          <li>No medimos olas dentro de las rías: no hay boya que lo haga. Esa cifra sale de un modelo, y se dice.</li>
          <li>No sustituimos a los avisos de AEMET ni de Protección Civil.</li>
          <li>Una cámara o una estación de aficionado sueltas no disparan un aviso. Una visibilidad oficial sí.</li>
        </ul>
      </section>

      <details className="gg-more">
        <summary>Saber más</summary>
        <p>La visibilidad solo la miden ocho estaciones de AEMET en toda Galicia, más los partes METAR de los aeropuertos de Vigo, Santiago y A Coruña.</p>
        <p>Los incendios se archivan todos, también los que el mapa descarta al dibujar.</p>
        <p>El método está publicado en el repositorio, con licencia MIT. Lo que no es público es el archivo propio.</p>
        <p>El detalle por provincia y por red está en «Roadmap y fuentes».</p>
      </details>
    </div>
  );
}
