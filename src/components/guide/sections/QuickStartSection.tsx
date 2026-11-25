/**
 * Guide, first page: what someone needs in a minute. Only what the app does today; the detail is in
 * the other sections or folded in «Saber más».
 */
import { LightningRings, WindScale } from '../guideCharts';
import { H3 } from '../guideParts';
import { useSectorStore } from '../../../store/sectorStore';
import { approxStationCount, SPOT_COUNT, BUOY_COUNT } from '../../../config/networkStats';

export function QuickStartSection() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const coastal = useSectorStore((s) => s.activeSector.coastal);
  return (
    <div className="g-theme gg-page">
      <h2>En 1 minuto</h2>
      <p>Qué viento hay ahora en cada spot y si hay peligro cerca, con las estaciones y boyas de Galicia.</p>

      <section className="gg-section">
        <h3>1. Mira el color del spot</h3>
        <WindScale />
        {coastal && <p className="gg-muted gg-small" style={{ marginTop: 12 }}>Los spots de surf van con otra forma, de cinco lados, y mandan las olas: FLAT, PEQUE, SURF OK, CLÁSICO o GRANDE. La ola en la playa sale de un modelo, no de una medida.</p>}
        <p className="gg-muted gg-small" style={{ marginTop: coastal ? 0 : 12 }}>La misma escala vale para todo: spots, flechas, estaciones y previsión. Si el mar cierra un spot, la ficha dice «Oleaje» aunque haya poco viento.</p>
      </section>

      <section className="gg-section">
        <H3 id="map-pin" tone="sea">2. Toca el spot</H3>
        <p>La ficha da el viento, la racha y de dónde sopla, cuántas estaciones lo miden y la cámara, si la hay.</p>
      </section>

      <section className="gg-section">
        <LightningRings title="3. Los rayos se miden desde tu spot, no desde la comarca" />
      </section>

      <section className="gg-section">
        <H3 id="eye" tone="storm">La decisión es tuya</H3>
        <p>La app informa. Mira también el cielo y el mar antes de salir.</p>
      </section>

      <details className="gg-more">
        <summary>Saber más</summary>
        <p>
          MeteoMapGal junta {approxStationCount()} estaciones activas de varias redes (AEMET, MeteoGalicia, Meteoclimatic, Weather Underground, Netatmo, SkyX e IPMA), {BUOY_COUNT} boyas y modelos de previsión, en {SPOT_COUNT} spots.
          {sectorId === 'embalse' ? ' Este sector es el interior: el embalse de Castrelo y, en prueba, Belesar y Velle.' : ' Este sector es la costa de las Rías Baixas, de Vigo a Arousa.'}
        </p>
        <p>Cada red y lo que guardamos está en «Qué datos recogemos».</p>
      </details>
    </div>
  );
}
