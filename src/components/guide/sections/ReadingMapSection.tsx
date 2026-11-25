/**
 * Guide: how to read the map. Short on purpose: what you see, what appears on its own, and one real
 * day to read a forecast against. Every line was checked against the code; a new layer or a change of
 * shape belongs here too.
 */
import { VERDICT_FILL, VERDICT_LINE } from '../../../config/verdictStyles';
import { temperatureColor } from '../../../services/windUtils';
import { MeasuredVsForecast, WindTonesStrip } from '../guideCharts';
import { Ico } from '../guideParts';

const SIZE = 28;

function Hexagon() {
  const pts = [0, 1, 2, 3, 4, 5].map((i) => { const a = (Math.PI / 3) * i - Math.PI / 6; return `${14 + 12 * Math.cos(a)},${14 + 12 * Math.sin(a)}`; }).join(' ');
  return <svg width={SIZE} height={SIZE} aria-hidden="true"><polygon points={pts} fill={VERDICT_FILL.sailing} stroke="var(--g-m-ring)" strokeWidth={1.5} /></svg>;
}
function Pentagon() {
  const pts = [0, 1, 2, 3, 4].map((i) => { const a = ((Math.PI * 2) / 5) * i - Math.PI / 2; return `${14 + 12 * Math.cos(a)},${14 + 12 * Math.sin(a)}`; }).join(' ');
  return <svg width={SIZE} height={SIZE} aria-hidden="true"><polygon points={pts} fill="none" stroke={VERDICT_LINE.sailing} strokeWidth={2.5} /></svg>;
}
function Dot() {
  return <svg width={SIZE} height={SIZE} aria-hidden="true"><circle cx={14} cy={14} r={8} fill={temperatureColor(10)} /></svg>;
}
function Diamond() {
  return <svg width={SIZE} height={SIZE} aria-hidden="true"><polygon points="14,4 24,14 14,24 4,14" fill="#0e7490" /></svg>;
}
function Arrow() {
  return <svg width={SIZE} height={SIZE} aria-hidden="true"><path d="M14 24V6M7 12l7-7 7 7" fill="none" stroke="var(--g-ink)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

const KEYS: [string, string][] = [
  ['P', 'Previsión'], ['C', 'Condiciones'], ['T', 'Temperatura, en avanzado'], ['W', 'Viento, radar o nada, en avanzado'],
  ['R', 'Refrescar'], ['G', 'Esta guía'], ['?', 'Ayuda de atajos'], ['Esc', 'Cerrar lo abierto'],
];

export function ReadingMapSection() {
  return (
    <div className="g-theme gg-page">
      <h2>Cómo leer el mapa</h2>
      <p>Empiezas en modo simple. El botón «Avanzado», en la cabecera o en el menú «Más» del móvil, añade el botón «Ver en el mapa», las listas de spots y estaciones, y el historial.</p>

      <section className="gg-section">
        <h3>Lo que ves</h3>
        <ul className="gg-list">
          <li><Hexagon /><span><b>Spot de vela</b><span className="gg-muted">Color y número: el viento en nudos. El aro se llena con el viento y la muesca marca de dónde viene. Si la punta del aro va punteada en otro color, el viento está a menos de un nudo de cambiar de nivel: ese color es el nivel de al lado. Tócalo para abrir la ficha.</span></span></li>
          <li><Pentagon /><span><b>Spot de surf (Rías)</b><span className="gg-muted">Manda la ola, calculada con un modelo: por eso va hueco y lleva «~». El aro se llena con la altura. Su color dice cómo está: gris, flat; azul, peque; verde, surf ok; ámbar, clásico; lila, grande.</span></span></li>
          <li><Dot /><span><b>Estación</b><span className="gg-muted">El centro es su temperatura: más azul cuanto más frío. En avanzado, el borde y las siglas dicen de qué red es. De lejos se agrupan en un círculo con cuántas hay, teñido por la temperatura de esa zona.</span></span></li>
          <li><Diamond /><span><b>Boya (Rías)</b><span className="gg-muted">El centro es la temperatura del agua. Encima, la altura de la ola si la mide.</span></span></li>
          <li><Arrow /><span><b>Flecha</b><span className="gg-muted">Apunta hacia donde va el viento: hacia arriba es viento del sur. Su color es la intensidad, de menos a más: la misma escala de los spots, que pasado Fuerte sigue en rojo desde 22 kt, magenta desde 34 (temporal), violeta desde 48 y violeta casi negro desde 56. La cifra y la racha de la ficha de estación van con los mismos colores.<WindTonesStrip /></span></span></li>
        </ul>
      </section>

      <section className="gg-section">
        <h3>Lo que sale solo</h3>
        <ul className="gg-list">
          <li><Ico id="zap" tone="storm" /><span><b>Rayos</b><span className="gg-muted gg-ages">
            <span><i className="gg-swatch" style={{ background: '#fbbf24' }} />Amarillo, menos de 15 min</span>
            <span><i className="gg-swatch" style={{ background: '#f97316' }} />Naranja, menos de 1 h</span>
            <span><i className="gg-swatch" style={{ background: '#ef4444' }} />Rojo, menos de 6 h</span>
            <span><i className="gg-swatch" style={{ background: '#6b7280' }} />Gris, más antiguos</span>
          </span></span></li>
          <li><Ico id="cloud-rain" tone="rain" /><span><b>Lluvia ahora</b><span className="gg-muted">Dónde llueve y hacia dónde va. El radar dibuja la zona y los pluviómetros confirman. La flecha de cada mancha llega hasta donde estaría en media hora; si viene hacia aquí, lleva en la punta la hora aproximada de llegada. El pluviómetro que late está midiendo lluvia ahora. Con tiempo seco no aparece.</span></span></li>
          <li><Ico id="fog" tone="fog" /><span><b>Niebla</b><span className="gg-muted">Se pinta con varias señales o con una medida oficial, nunca por una sola cámara.</span></span></li>
          <li><Ico id="flame" tone="fire" /><span><b>Incendios</b><span className="gg-muted">Lo que detectan los satélites y, cuando ya está consolidado, el incendio con su concello y sus hectáreas. Rojo si el satélite está seguro, naranja si menos; con aro morado, lo encendió un rayo.</span></span></li>
          <li><Ico id="alert-triangle" tone="danger" /><span><b>Aviso arriba del mapa</b><span className="gg-muted">Rojo o morado, para lo más grave. Que no salga no significa que no haya peligro.</span></span></li>
        </ul>
      </section>

      <section className="gg-section">
        <MeasuredVsForecast />
      </section>

      <details className="gg-more">
        <summary>Saber más</summary>
        <p><b className="gg-ink">Lo que enciendes tú.</b> En avanzado, el botón «Ver en el mapa» enciende viento, radar, temperatura y webcams; en las Rías también oleaje (modelo) y carta náutica. En simple, de eso solo queda el botón «Temperatura». El botón «Mapa» cambia el mapa base: Auto, Calles, Topo o Foto.</p>
        <p><b className="gg-ink">Atajos de teclado</b></p>
        <div className="gg-keys">
          {KEYS.map(([k, d]) => <span key={k} className="gg-small"><kbd>{k}</kbd>{d}</span>)}
        </div>
      </details>
    </div>
  );
}
