/**
 * Guide: what exists, what is next, and where the data comes from. The attributions and the
 * «not for navigation» notice are obligations: keep them word for word.
 */
import { NetworkCoverage } from '../NetworkCoverage';
import { SPOT_COUNT, SURF_SPOT_COUNT, SAILING_SPOT_COUNT, WEBCAM_COUNT, MG_WEBCAM_COUNT, DGT_WEBCAM_COUNT, BUOY_COUNT, SOURCES, approxStationCount } from '../../../config/networkStats';
import { useUIStore } from '../../../store/uiStore';
import { Def, H3 } from '../guideParts';

const SUPPLEMENTARY: [string, string][] = [
  ['MeteoSIX (MeteoGalicia)', 'Previsión WRF a 1 km, oleaje costero y temperatura del mar.'],
  ['Open-Meteo', 'Energía del aire para las tormentas, rachas, visibilidad y previsión de oleaje.'],
  ['RainViewer', 'Radar de lluvia.'],
  ['MeteoGalicia', 'Rayos, avisos oficiales, calidad del aire y cámaras.'],
  ['DGT', 'Cámaras de tráfico de Ribadavia y Barbantes, para la niebla.'],
  ['IHM', 'Predicción de mareas de 5 puertos.'],
  ['Puertos del Estado y Observatorio Costeiro', `${BUOY_COUNT} boyas y mareógrafos.`],
  ['CESGA', 'Modelo de oleaje SWAN.'],
  ['NOAA', 'Índices NAO y AO, y partes METAR de los aeropuertos.'],
  ['IGN', 'Mapa topográfico y foto aérea.'],
  ['NASA FIRMS y EFFIS', 'Incendios por satélite.'],
];

export function RoadmapSection() {
  const alphaMode = useUIStore((s) => s.alphaMode);
  const toggleAlphaMode = useUIStore((s) => s.toggleAlphaMode);
  return (
    <div className="g-theme gg-page">
      <h2>Roadmap y fuentes</h2>
      <p>Qué hay hoy, qué viene y de dónde sale cada dato.</p>

      <section className="gg-section">
        <H3 id="check-circle" tone="wind">Qué hay hoy</H3>
        <ul className="gg-bullets">
          <li>{SPOT_COUNT} spots con veredicto automático: {SAILING_SPOT_COUNT} de vela y {SURF_SPOT_COUNT} de surf.</li>
          <li>Rayos y tormentas, con aviso desde cada spot. Aviso al móvil si lo activas.</li>
          <li>Lluvia ahora, niebla, incendios y calidad del aire, que salen solos cuando hace falta.</li>
          <li>Previsión por horas, olas de las próximas 24 horas y mareas.</li>
          <li>Avisos oficiales de MeteoGalicia.</li>
          <li>{WEBCAM_COUNT} cámaras enlazadas a sus spots: {MG_WEBCAM_COUNT} de MeteoGalicia y {DGT_WEBCAM_COUNT} de la DGT.</li>
          <li>Favoritos y compartir por enlace.</li>
        </ul>
      </section>

      <section className="gg-section">
        <H3 id="compass" tone="sea">Qué viene</H3>
        <dl className="gg-defs">
          <Def id="map-pin" tone="sea" name="Más zonas">La costa norte: Costa da Morte y Ferrol. Después de validar bien las actuales.</Def>
          <Def id="bell" tone="storm" name="Avisos con antelación">Hay modelos en prueba. Solo se publican si aprueban el examen contra lo que pasó de verdad.</Def>
          <Def id="eye" tone="air" name="Ideas, sin fecha">Alertas a tu medida y seguimiento de embarcaciones.</Def>
        </dl>
      </section>

      <section className="gg-section">
        <H3 id="database" tone="rain">Estaciones</H3>
        <p>{approxStationCount()} estaciones de redes públicas y ciudadanas en toda Galicia. El reparto cambia cada semana.</p>
        <dl className="gg-defs gg-defs-tight">
          {SOURCES.map((s) => <div key={s.key}><dt>{s.name}</dt><dd>{s.what}</dd></div>)}
        </dl>
        <h4>La red, ahora mismo</h4>
        <NetworkCoverage />
      </section>

      <section className="gg-section">
        <H3 id="satellite" tone="air">Otras fuentes</H3>
        <dl className="gg-defs gg-defs-tight">
          {SUPPLEMENTARY.map(([name, what]) => <div key={name}><dt>{name}</dt><dd>{what}</dd></div>)}
        </dl>
      </section>

      <section className="gg-section gg-small">
        <H3 id="info" tone="fog">Atribuciones</H3>
        <p>
          © AEMET · © MeteoGalicia – Xunta de Galicia (CC BY-SA 4.0) ·{' '}
          Fuente: <a href="https://www.ipma.pt" target="_blank" rel="noopener noreferrer">IPMA — Instituto Português do Mar e da Atmosfera</a> (uso sin ánimo de lucro) ·{' '}
          Datos de Puertos del Estado (portus.puertos.es) · Observatorio Costeiro da Xunta de Galicia (CC BY-SA 4.0) ·{' '}
          © Instituto Hidrográfico de la Marina ·{' '}
          Modelo SWAN — CESGA ·{' '}
          © Meteoclimatic · Powered by Weather Underground® · Powered by Netatmo ·{' '}
          Open-Meteo.com (CC BY 4.0) · RainViewer.com ·{' '}
          Esri, HERE, Garmin · © OpenStreetMap contributors · © IGN España (CC BY 4.0) ·{' '}
          AWS Open Data (Mapzen Terrarium) · Noto Sans © Google (OFL) · Archivo © The Archivo Project Authors (OFL).
        </p>
        <p className="gg-notice">
          <strong>NO APTO PARA NAVEGACIÓN MARÍTIMA NI AÉREA.</strong>{' '}
          Cartas náuticas, mareas y boyas son visualización ilustrativa.
          Use siempre datos oficiales para decisiones operativas.
        </p>
        <p>
          <strong>Licencia software:</strong>{' '}
          <a href="https://github.com/Bateas/MeteoMapGal" target="_blank" rel="noopener noreferrer">MIT (código)</a>. Cada fuente de datos retiene su propia licencia — algunas
          requieren autorización para uso comercial. Proyecto sin ánimo de lucro.
          {' · '}
          <a href="https://github.com/Bateas/MeteoMapGal/issues" target="_blank" rel="noopener noreferrer">Reportar bug</a>
        </p>
      </section>

      <section className="gg-section">
        <H3 id="alert-triangle" tone="storm">Modo Alpha</H3>
        <label className="gg-check">
          <input type="checkbox" checked={alphaMode} onChange={toggleAlphaMode} />
          <span>
            <b>Activar funciones en prueba</b>
            <span className="gg-muted gg-small gg-block">Ahora mismo no hay ninguna abierta. Cuando la haya, se dirá aquí. Pueden fallar o cambiar sin aviso.</span>
          </span>
        </label>
        {alphaMode && <TeamDeviceRow />}
      </section>
    </div>
  );
}

/**
 * Marks this device as one of the team's, so its visits stay out of the audience
 * panels. The server sets and removes the cookie (/equipo, /equipo/fuera) and sends
 * the device back here; the page only reads it. A plain link on purpose: the
 * installed app on iPhone keeps its own cookies and has no address bar.
 */
function TeamDeviceRow() {
  const marked = document.cookie.split('; ').includes('mmg_equipo=1');
  return (
    <div className="gg-gap">
      <p><b className="gg-ink">Dispositivo del equipo.</b>{' '}
        {marked
          ? 'Este dispositivo está marcado: sus visitas no cuentan en la audiencia.'
          : 'Márcalo solo si es del equipo: sus visitas dejarán de contar en la audiencia.'}
      </p>
      <a href={marked ? '/equipo/fuera' : '/equipo'}>
        {marked ? 'Quitar la marca' : 'Marcar este dispositivo'}
      </a>
    </div>
  );
}
