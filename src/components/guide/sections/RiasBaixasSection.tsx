/**
 * Guide: the winds of the Rías. Each spot's own wind is in its card (windPatterns in spots.ts); this
 * page gives the general picture.
 */
import { AFTERNOON_REDONDELA, TypicalAfternoon } from '../guideCharts';
import { Def, type Tone } from '../guideParts';
import type { IconId } from '../../icons/WeatherIcons';

const WINDS: [string, string, string, IconId, Tone][] = [
  ['Nortada (NW)', 'Verano, 12 a 20 kt', 'El viento del verano gallego, constante en los spots de fuera. Trae agua fría y puede traer niebla en las bocas.', 'wind', 'sea'],
  ['Virazón (SW)', 'Primavera a otoño, tardes, 8 a 15 kt', 'Brisa de mar que entra cuando el sol calienta la tierra. Mejor en días claros y sin norte.', 'sun', 'wind'],
  ['Suroeste de frente', 'Otoño e invierno, fuerte', 'Temporales con lluvia y mar grande fuera. Dentro de las rías se nota menos el mar, no el viento.', 'alert-triangle', 'danger'],
  ['Terral (E/NE)', 'Mañanas, 5 a 10 kt', 'Tras una noche fría y despejada, el aire baja de tierra a la ría. Se para cuando el sol calienta, hacia las 11 h.', 'moon', 'air'],
];

const ZONES: [string, string, IconId, Tone][] = [
  ['Fuera (Cíes, Lanzada)', 'Mar abierto: mar de fondo y nortada directa.', 'anchor', 'sea'],
  ['Media ría (Centro Ría, Lourido)', 'Algo de abrigo del mar de fondo. La brisa entra bien, con ola corta de viento.', 'sailboat', 'wind'],
  ['Interior (Cesantes, Bocana)', 'Sin mar de fondo. Brisa de tarde y norte racheado por Rande.', 'map-pin', 'field'],
];

const WATCH: [string, string, IconId, Tone][] = [
  ['Afloramiento', 'Con norte sostenido, el agua de arriba se va mar adentro y sube agua fría del fondo.', 'thermometer', 'cold'],
  ['Niebla de mar', 'Aire cálido sobre agua fría: niebla densa en las bocas, a menudo con la ría interior despejada.', 'fog', 'fog'],
  ['Mar cruzado', 'El viento cambia y las olas viejas siguen. Mar confuso, sobre todo fuera y con mar de fondo.', 'waves', 'danger'],
  ['Corrientes de marea', 'En los estrechos como Rande son fuertes. Con viento en contra levantan mar corto. Mira la marea antes de salir.', 'anchor', 'sea'],
];

const SEASONS: [string, string][] = [
  ['Primavera', 'Virazón y días variables.'],
  ['Verano', 'Nortada estable y brisas de tarde. La mejor época.'],
  ['Otoño', 'Suroeste de frente y terral por la mañana. Días sueltos.'],
  ['Invierno', 'Temporales del suroeste y días de norte.'],
];

export function RiasBaixasSection() {
  return (
    <div className="g-theme gg-page">
      <h2>Vientos de las Rías</h2>
      <p>Las rías son embudos: canalizan el viento y lo cambian. Una estación a 2 km puede marcar otra cosa, y por eso cada spot cruza varias.</p>

      <section className="gg-section">
        <TypicalAfternoon data={AFTERNOON_REDONDELA} title="En agosto, la brisa sube por la tarde: máximo hacia las 17 h" />
      </section>

      <section className="gg-section">
        <h3>Los cuatro vientos</h3>
        <dl className="gg-defs">
          {WINDS.map(([name, when, text, id, tone]) => (
            <Def key={name} id={id} tone={tone} name={name}>{text}<span className="gg-muted gg-small gg-block">{when}</span></Def>
          ))}
        </dl>
      </section>

      <section className="gg-section">
        <h3>Según dónde estés</h3>
        <dl className="gg-defs">
          {ZONES.map(([name, text, id, tone]) => <Def key={name} id={id} tone={tone} name={name}>{text}</Def>)}
        </dl>
      </section>

      <section className="gg-section">
        <h3>A tener en cuenta</h3>
        <dl className="gg-defs">
          {WATCH.map(([name, text, id, tone]) => <Def key={name} id={id} tone={tone} name={name}>{text}</Def>)}
        </dl>
      </section>

      <details className="gg-more">
        <summary>Saber más</summary>
        <p><b className="gg-ink">Por épocas</b></p>
        <dl className="gg-defs gg-defs-tight">
          {SEASONS.map(([name, text]) => <div key={name}><dt>{name}</dt><dd>{text}</dd></div>)}
        </dl>
        <p className="gg-gap"><b className="gg-ink">Terral en la Bocana.</b> Entre las 6 y las 11 h, las boyas lo notan mientras las estaciones de tierra casi no marcan nada. La app lo nombra si el agua de Rande está al menos 1,5 °C más caliente que el aire. Con una boya que sople de tierra lo da por detectado; sin ella, «probable». La cifra sigue siendo la medida: el terral no le suma viento.</p>
      </details>
    </div>
  );
}
