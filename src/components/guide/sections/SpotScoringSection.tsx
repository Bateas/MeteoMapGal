/**
 * Guide: the spots. The list reads the configuration, so a new spot appears here on its own; the
 * scale is the one a test keeps in step with the engine.
 */
import { WindScale } from '../guideCharts';
import { getSpotsForSector } from '../../../config/spots';
import { computeSurfVerdict } from '../../../services/surfVerdictEngine';
import { Def, H3 } from '../guideParts';
import { useSectorStore } from '../../../store/sectorStore';

/** The heights `surfVerdict` starts from. A test keeps them in step. */
const MID_HEIGHT = [0.2, 0.5, 1.2, 2, 3];

export const WAVE_SCALE: [string, string, string][] = [
  ['FLAT', 'menos de 0,3 m', 'Mar plano.'],
  ['PEQUE', '0,3 a 0,8 m', 'Olas pequeñas.'],
  ['SURF OK', '0,8 a 1,5 m', 'Olas surfeables. Desde 0,5 m si el viento o el periodo ayudan.'],
  ['CLÁSICO', '1,5 a 2,5 m', 'Olas limpias y constantes.'],
  ['GRANDE', 'más de 2,5 m', 'Mar grande.'],
];

function SpotList({ title, sector }: { title: string; sector: 'rias' | 'embalse' }) {
  const spots = getSpotsForSector(sector);
  return (
    <>
      <h4>{title}</h4>
      <dl className="gg-defs gg-defs-tight">
        {spots.map((s) => (
          <Def key={s.id} id={s.category === 'surf' ? 'waves' : 'sailboat'} tone={s.category === 'surf' ? 'sea' : 'wind'} name={s.name}>{s.description}</Def>
        ))}
      </dl>
    </>
  );
}

export function SpotScoringSection() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const lists = [
    <SpotList key="rias" title="Rías Baixas" sector="rias" />,
    <SpotList key="embalse" title="Interior" sector="embalse" />,
  ];
  return (
    <div className="g-theme gg-page">
      <h2>Spots de navegación</h2>
      <p>Un spot es una zona concreta con su propio veredicto. Lo calcula con las estaciones y boyas de alrededor, no con la media de la comarca.</p>

      <section className="gg-section">
        <H3 id="sailboat" tone="wind">Vela y kite: manda el viento</H3>
        <WindScale />
        <p className="gg-muted gg-small gg-gap">Si el viento pasa del límite de seguridad del spot, sale Fuerte con aviso. También sale con rachas de 30 kt en una estación cercana y 25 kt en otra, aunque la media sea menor. Si lo que pasa del límite es la ola, la ficha dice «Oleaje».</p>
      </section>

      <section className="gg-section">
        <H3 id="waves" tone="sea">Surf: manda la ola</H3>
        <table className="gg-levels">
          <caption className="gg-sr">Escala de olas en la playa</caption>
          <thead><tr><th scope="col">Veredicto</th><th scope="col">Altura</th><th scope="col">Qué significa</th></tr></thead>
          <tbody>
            {WAVE_SCALE.map(([name, range, text], i) => (
              <tr key={name}>
                <th scope="row"><span className="gg-row-head"><span className="gg-swatch" style={{ background: computeSurfVerdict(MID_HEIGHT[i], 6, false, false).color }} />{name}</span></th>
                <td className="gg-nums">{range}</td><td>{text}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="gg-muted gg-small gg-gap">La altura en la playa sale de un modelo: nadie la mide allí. Se corrige por lo abrigada que está cada playa y por dónde entra el mar de fondo. El viento y el periodo pueden mover el veredicto un nivel, pero no cambian la altura.</p>
      </section>

      <section className="gg-section">
        <H3 id="gauge" tone="air">Cómo se calcula</H3>
        <ul className="gg-bullets">
          <li>Cada estación pesa según su distancia, su fiabilidad y lo reciente que sea su dato.</li>
          <li>Las boyas de agua abierta pesan más: miden sobre el agua, sin obstáculos.</li>
          <li>Las que contradicen a sus vecinas pesan menos o no cuentan.</li>
        </ul>
      </section>

      <section className="gg-section">
        <H3 id="map-pin" tone="fire">Los spots</H3>
        {sectorId === 'embalse' ? [lists[1], lists[0]] : lists}
      </section>

      <details className="gg-more">
        <summary>Saber más</summary>
        <p><b className="gg-ink">Calculando…</b> Al abrir la app, el spot espera a tener datos suficientes en vez de dar una cifra que se corregiría sola.</p>
        <p><b className="gg-ink">Color estable.</b> Si el viento ronda el límite entre dos niveles, el color cambia cuando el viento pasa ese límite en 1 kt. Mientras tanto la ficha lo dice: «entre Navegable y Bueno». Un anemómetro no distingue 11 de 12 kt, así que ahí la respuesta honesta es esa. El peligro, la subida a Fuerte y la falta de datos se muestran al instante.</p>
        <p><b className="gg-ink">Posible brisa, sin confirmar.</b> En Cesantes, con la brisa de tarde, la ficha puede añadir «Posible brisa hasta ~N kt». No sube la cifra ni el veredicto.</p>
        <p><b className="gg-ink">Térmico.</b> En Castrelo, si el térmico es probable y el viento entra por algún rumbo del spot o la previsión da suroeste, la cifra puede subir hasta un 50 %, y hasta 3 kt más. La ficha lo avisa. Con frente en altura no se aplica.</p>
        <p><b className="gg-ink">Crear tu spot.</b> En modo avanzado, pulsa «Crear spot» en la barra inferior y toca el mapa. Es una estimación sin calibrar, no un spot oficial: se guarda en tu navegador y no entra en los avisos.</p>
        <p><b className="gg-ink">Favorito.</b> La estrella de la ficha lo marca como favorito.</p>
        <p><b className="gg-ink">Cámaras.</b> Son de sus titulares y dependen de ellos. Algunas solo se enlazan.</p>
      </details>
    </div>
  );
}
