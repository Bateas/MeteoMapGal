/**
 * Guide: the thermal wind of Castrelo. The figures come from the validation of the old rule scoring (1.412
 * records of AEMET Ribadavia, 2022-2025, sunshine from Ourense; removed with the V3); directions from the
 * spot's windPatterns.
 */
import { AFTERNOON_RIBADAVIA, TypicalAfternoon } from '../guideCharts';
import { Def, H3, type Tone } from '../guideParts';
import type { IconId } from '../../icons/WeatherIcons';

const DAY: [string, string, IconId, Tone][] = [
  ['8 a 12 h', 'Calma o brisa suave. El valle se calienta.', 'sun', 'storm'],
  ['12 a 14 h', 'Empieza a rolar y entran las primeras rachas.', 'wind', 'wind'],
  ['14 a 18 h', 'Sube el viento: 8 a 15 kt en un buen día.', 'sailboat', 'sea'],
  ['18 a 21 h', 'Baja poco a poco. Últimos ratos navegables.', 'cloud-sun', 'fire'],
  ['Noche', 'Aire frío que baja por el valle. Sin navegación.', 'moon', 'air'],
];

/** Share of days with thermal wind, AEMET Ribadavia (monthThermalScore). */
const THERMAL_MONTHS: [string, number][] = [['Junio', 22.5], ['Julio', 32.5], ['Agosto', 39.5], ['Septiembre', 31.7]];

const CHECKS: [string, string, IconId, Tone][] = [
  ['Máxima de 28 a 32 °C', 'Por debajo de 28 °C no hubo ningún día térmico limpio. Por encima de 36 °C hay más días, pero con menos viento.', 'thermometer', 'fire'],
  ['Humedad de 40 a 60 %', 'Con 40-50 %, 43 % de los días. Con 60-70 % cae a 18 %. Por encima de 80 %, ninguno.', 'droplets', 'rain'],
  ['Mucha diferencia entre día y noche', 'Con 16-18 °C de diferencia, 33 %. Por debajo de 12 °C, ninguno.', 'activity', 'air'],
  ['Más de 10 horas de sol', '35 % de los días. Con menos de 4 horas, ninguno.', 'sun', 'storm'],
];

export function ThermalCastreloSection() {
  return (
    <div className="g-theme gg-page">
      <h2>El térmico de Castrelo</h2>
      <p>El sol calienta el valle y entra viento del suroeste por las tardes. Es local y se repite cuando se dan las condiciones.</p>

      <section className="gg-section">
        <TypicalAfternoon data={AFTERNOON_RIBADAVIA} title="En agosto, el viento llega tarde: máximo hacia las 18 h" />
      </section>

      <section className="gg-section">
        <h3>Cómo va el día</h3>
        <dl className="gg-defs gg-defs-tight">
          {DAY.map(([hours, text, id, tone]) => <Def key={hours} id={id} tone={tone} name={<span className="gg-nums">{hours}</span>}>{text}</Def>)}
        </dl>
      </section>

      <section className="gg-section">
        <H3 id="sun" tone="storm">Qué meses</H3>
        <ul className="gg-bars" aria-label="Porcentaje de días con térmico por mes">
          {THERMAL_MONTHS.map(([month, pct]) => (
            <li key={month}>
              <span>{month}</span>
              <span className="gg-bar-track" aria-hidden="true"><span className="gg-bar" style={{ width: `${pct * 2}%` }} /></span>
              <b className="gg-nums">{String(pct).replace('.', ',')} %</b>
            </li>
          ))}
        </ul>
        <p className="gg-muted gg-small gg-gap">Días con térmico en Ribadavia. Mayo y octubre son mucho menos frecuentes.</p>
      </section>

      <section className="gg-section">
        <h3>Qué busca un buen día</h3>
        <dl className="gg-defs">
          {CHECKS.map(([name, text, id, tone]) => <Def key={name} id={id} tone={tone} name={name}>{text}</Def>)}
        </dl>
        <p className="gg-muted gg-small gg-gap">Sale de 1.412 registros diarios de AEMET (2022-2025), con 119 días térmicos. Los días de frente se quitan para no confundirlos con la brisa.</p>
      </section>

      <section className="gg-section">
        <H3 id="compass" tone="wind">Otros vientos que valen</H3>
        <p>El nordeste entra alineado con el embalse y es de los más limpios. El noroeste baja por el brazo alto y también entra bien. El norte entra, pero con algunos rumbos da roles, porque cruza el relieve de la orilla.</p>
      </section>

      <details className="gg-more">
        <summary>Saber más</summary>
        <p>La app cruza las estaciones cercanas con la previsión: dirección del viento, diferencia de temperatura, sol y humedad. Si el térmico es probable y el viento entra por algún rumbo del spot o la previsión da suroeste, la cifra puede subir hasta un 50 %, y hasta 3 kt más. La ficha lo avisa. Con frente en altura no se aplica.</p>
        <p>Está en beta. Es una orientación: mira las condiciones reales antes de salir.</p>
      </details>
    </div>
  );
}
