/**
 * Guide: the panels. The parts of Condiciones are the ones in FieldDrawer and conditionsList; the alert
 * levels, the ones in fieldAlertEngine and dewPointService: a test keeps frost and rain in step with the engine.
 */
import { Def, H3, Ico, Level, type Tone } from '../guideParts';
import type { IconId } from '../../icons/WeatherIcons';

const PARTS: [string, string, IconId, Tone][] = [
  ['Ahora', 'Lo que pasa ya: avisos oficiales, rayos, lluvia, niebla, incendios y calidad del aire.', 'activity', 'wind'],
  ['Hoy y mañana', 'Lo que da la previsión: lluvia, tormenta, niebla y calima. Debajo, plegado, «Por horas, 48 h».', 'clock', 'rain'],
  ['Mareas', 'En las Rías: próxima pleamar y bajamar, curva y tabla.', 'anchor', 'sea'],
  ['En el campo', 'Plegado: helada y luna.', 'leaf', 'field'],
];

const LEVELS: [string, IconId, Tone, string, string, string][] = [
  ['Helada', 'snowflake', 'cold', '2 °C o menos', '0 °C o menos', '0 °C o menos, con cielo despejado y sin viento'],
  ['Lluvia', 'cloud-rain', 'rain', 'Más de 1 mm/h, o probabilidad de más del 70 %', 'Más de 10 mm/h, o más de 2 mm/h con más del 70 %', 'Granizo probable'],
  ['Niebla', 'fog', 'fog', 'Hasta 4 °C de diferencia y bajando', 'Hasta 2,5 °C de diferencia', 'No se usa sin una medida que lo confirme'],
];

const SIDE: [string, string, IconId, Tone][] = [
  ['Spots', 'Todos los spots de la zona, de mejor a peor.', 'map-pin', 'sea'],
  ['Previsión', 'Previsión por horas. La tecla P la abre a pantalla completa.', 'compass', 'wind'],
  ['Estaciones', 'Cada estación con su lectura, y las boyas. En Avanzado.', 'wind', 'air'],
  ['Historial', 'Lo guardado de cada estación. En Avanzado.', 'database', 'rain'],
];

export function CampoPanelSection() {
  return (
    <div className="g-theme gg-page">
      <h2>Paneles y alertas</h2>
      <p>Condiciones dice qué puede cambiarte el plan, aparte del viento de tu spot. El panel lateral da los datos.</p>

      <section className="gg-section">
        <h3>Condiciones <kbd className="gg-kbd">C</kbd></h3>
        <dl className="gg-defs">
          {PARTS.map(([name, text, id, tone]) => <Def key={name} id={id} tone={tone} name={name}>{text}</Def>)}
        </dl>
        <p className="gg-muted gg-small gg-gap">
          Cada línea dice de dónde sale: oficial, medido o modelo. Y los números van plegados debajo de ella. En la tira por horas, la tormenta sale en morado si el modelo da energía, y la lluvia va por niveles:{' '}
          <Level level="riesgo">riesgo</Level> <Level level="alto">alto</Level> <Level level="critico">crítico</Level>
        </p>
      </section>

      <section className="gg-section">
        <h3>Cuándo salta cada nivel</h3>
        <div className="gg-scroll">
          <table className="gg-levels">
            <caption className="gg-sr">Umbrales de los avisos de helada, lluvia y niebla</caption>
            <thead>
              <tr>
                <th scope="col">Aviso</th>
                <th scope="col"><Level level="riesgo">Riesgo</Level></th>
                <th scope="col"><Level level="alto">Alto</Level></th>
                <th scope="col"><Level level="critico">Crítico</Level></th>
              </tr>
            </thead>
            <tbody>
              {LEVELS.map(([name, id, tone, risk, high, critical]) => (
                <tr key={name}>
                  <th scope="row"><span className="gg-row-head"><Ico id={id} tone={tone} />{name}</span></th>
                  <td>{risk}</td><td>{high}</td><td>{critical}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="gg-muted gg-small gg-gap">Con cielo despejado y sin viento, la helada sube un nivel antes: riesgo desde 4 °C y alto desde 2 °C. En la niebla, la diferencia es entre la temperatura y el punto de rocío, y de noche baja un nivel, porque en los valles la humedad alta es normal. También sale como riesgo si la previsión da menos de 1 km de visibilidad. Con más de 6 kt baja un nivel; con rachas de 10 kt o sol fuerte, no sale.</p>
      </section>

      <section className="gg-section">
        <H3 id="zap" tone="storm">Tormentas</H3>
        <p>Se enseña lo medido: a qué distancia cayó el rayo más cercano, cuántos han caído y hace cuánto fue el último. No hay porcentaje de tormenta ni minutos de llegada: comparados con los rayos de una temporada entera, no se cumplían.</p>
        <p>Los avisos de rayo se miden desde cada spot: están en «En 1 minuto».</p>
      </section>

      <section className="gg-section">
        <h3>Panel lateral</h3>
        <dl className="gg-defs gg-defs-tight">
          {SIDE.map(([name, text, id, tone]) => <Def key={name} id={id} tone={tone} name={name}>{text}</Def>)}
        </dl>
      </section>

      <details className="gg-more">
        <summary>Mareas, luna y perfil atmosférico</summary>
        <dl className="gg-defs">
          <Def id="anchor" tone="sea" name="Mareas (Rías)">Próxima pleamar y bajamar, curva y tabla de 48 horas, con los datos del IHM para Vigo, Marín, Vilagarcía, Baiona y Sanxenxo. Si el IHM no responde, la última tabla guardada o la de MeteoGalicia.</Def>
          <Def id="moon" tone="air" name="Luna">Fase e iluminación de hoy, y un calendario de 30 días, en «En el campo».</Def>
          <Def id="cloud" tone="air" name="Perfil atmosférico (interior)">En la pestaña Previsión, plegado y en Avanzado. Estabilidad del aire para el térmico: altura de la capa de mezcla, energía para subir el aire (CAPE) y lo que lo frena (CIN). Los términos están en el glosario.</Def>
        </dl>
      </details>
    </div>
  );
}
