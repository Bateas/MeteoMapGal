/** Guide: the History tab of the side panel. */
import { Def } from '../guideParts';

export function HistorySection() {
  return (
    <div className="g-theme gg-page">
      <h2>Historial</h2>
      <p>Lo que han medido las estaciones, guardado cada 5 minutos. Está en el panel lateral, en modo Avanzado.</p>

      <section className="gg-section">
        <h3>En tres pasos</h3>
        <ol className="gg-steps">
          <li><b>Elige la estación</b> por su nombre. En el ordenador, también se marca en el mapa.</li>
          <li><b>Elige el periodo:</b> 24 horas, 7 días, 30 días o unas fechas a tu medida.</li>
          <li><b>Elige el dato:</b> temperatura, viento, racha, humedad, presión, punto de rocío o radiación.</li>
        </ol>
      </section>

      <section className="gg-section">
        <h3>Dos extras</h3>
        <dl className="gg-defs">
          <Def id="compass" tone="wind" name="Rosa">De dónde sopla más el viento y con qué fuerza.</Def>
          <Def id="activity" tone="air" name="Comparar estaciones">Dos estaciones en la misma gráfica.</Def>
        </dl>
      </section>

      <details className="gg-more">
        <summary>Qué periodo usar</summary>
        <ul>
          <li>24 horas, para ver el ciclo del día: el térmico o la bajada de la noche.</li>
          <li>7 días, para comparar días y ver tendencias.</li>
          <li>30 días, para ver el mes: olas de calor, temporales o sequías.</li>
        </ul>
      </details>
    </div>
  );
}
