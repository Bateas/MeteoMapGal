/**
 * Guide: legal notice. These sentences answer to licences and to the privacy policy, so they are not
 * summarised. A provider leaves only when the code no longer asks it for anything (grep first).
 */
import { APP_VERSION } from '../../../config/version';
import { H3 } from '../guideParts';

const EXT = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * The holder's identifying data (LSSI-CE art. 10) live in the company's own legal notice, kept there in one
 * place: the app names the holder and links to it instead of copying them.
 */
const HOLDER_NAME = 'Vortal XR, S.L.';
const HOLDER_LEGAL_URL = 'https://forxaxr.com/es/legal/aviso-legal/';

export function LegalSection() {
  return (
    <div className="g-theme gg-page">
      <h2>Aviso legal</h2>

      <section className="gg-section">
        <H3 id="info" tone="wind">Titular</H3>
        <p>
          MeteoMapGal es un servicio de <strong>{HOLDER_NAME}</strong>.
          Sus datos identificativos y de contacto están en el{' '}
          <a href={HOLDER_LEGAL_URL} {...EXT}>aviso legal de la empresa</a>.
        </p>
      </section>

      <section className="gg-section">
        <H3 id="alert-triangle" tone="storm">Descargo de responsabilidad</H3>
        <p>
          Los datos meteorológicos mostrados en MeteoMapGal son de carácter{' '}
          <strong>exclusivamente informativo</strong>.
          No deben utilizarse para tomar decisiones que comprometan la seguridad de personas o bienes.
        </p>
        <p>
          MeteoMapGal <strong>no sustituye</strong> los avisos oficiales de{' '}
          <strong>AEMET</strong>,{' '}
          <strong>Protección Civil</strong> ni ningún organismo competente.
          Ante situaciones de riesgo meteorológico, consulte siempre las fuentes oficiales.
        </p>
        <p>
          No se garantiza la precisión, disponibilidad ni continuidad de los datos. Las estaciones
          meteorológicas pueden presentar fallos, retrasos o lecturas erróneas. Los modelos numéricos
          son estimaciones, no observaciones.
        </p>
        <p>
          Las imágenes de <strong>webcams</strong> son de sus titulares
          (MeteoGalicia y DGT) y se muestran tal como las publican, sin archivarlas. Algunas se analizan
          de forma automática para detectar niebla; se guarda el resultado, no la imagen. Las de Waira Surf
          School, tmkites y Ría de Vigo Cam solo se enlazan. La disponibilidad depende de cada titular.
        </p>
      </section>

      <section className="gg-section">
        <H3 id="database" tone="rain">Atribución de datos</H3>
        <p>
          Los datos proceden de <strong>organismos públicos y de redes y servicios
          de terceros</strong>. Cada fuente conserva sus derechos. Donde el titular publica una licencia, se
          indica; «sus condiciones» quiere decir que el dato está sujeto a los términos de uso de ese servicio.
        </p>
        <h4>Observación y avisos</h4>
        <ul className="gg-attr">
          <AttrRow name="AEMET OpenData" license="Cita de la fuente" desc="© AEMET. Estaciones y visibilidad" />
          <AttrRow name="MeteoGalicia" license="CC BY-SA 4.0" desc="© Xunta de Galicia. Estaciones, avisos, rayos, calidad del aire y webcams" />
          <AttrRow name="Meteoclimatic" license="CC BY-NC-ND" desc="Red ciudadana de estaciones personales" />
          <AttrRow name="Weather Underground" license="Sus condiciones" desc="© The Weather Company. Estaciones personales" />
          <AttrRow name="Netatmo" license="Sus condiciones" desc="© Netatmo. Estaciones personales de su mapa público" />
          <AttrRow name="IPMA" license="Uso no lucrativo" desc="Instituto Português do Mar e da Atmosfera. Estaciones y avisos del norte de Portugal" />
          <AttrRow name="Puertos del Estado" license="Cita de la fuente" desc="Boyas y mareógrafos de PORTUS: viento, oleaje y nivel del mar" href="https://portus.puertos.es/" />
          <AttrRow name="Observatorio Costeiro da Xunta de Galicia" license="CC BY-SA 4.0" desc="Boyas de las rías, cedidas gratuitamente para su uso. El Observatorio no se hace responsable del uso de estos datos ni se vincula a las conclusiones sacadas con ellos; forma parte del Observatorio RAIA" href="https://observatoriocosteiro.gal/" />
          <AttrRow name="SkyX" license="Propia" desc="Estación portátil propia, mediante el servicio SkyX" />
        </ul>
        <h4>Previsión y modelos</h4>
        <ul className="gg-attr">
          <AttrRow name="MeteoSIX" license="CC BY-SA 4.0" desc="MeteoGalicia. Previsión WRF, oleaje costero y temperatura del mar" />
          <AttrRow name="Open-Meteo" license="CC BY 4.0" desc="Previsión de varios modelos, oleaje y previsión del día anterior" />
          <AttrRow name="CESGA" license="Sus condiciones" desc="Modelo de oleaje SWAN (capa de olas)" />
          <AttrRow name="IHM" license="Sus condiciones" desc="Instituto Hidrográfico de la Marina. Predicción de mareas y carta náutica" />
          <AttrRow name="NOAA" license="Dominio público" desc="Índices climáticos NAO y AO, y partes METAR de aviationweather.gov (visibilidad de los aeropuertos de Vigo, Santiago y A Coruña)" />
          <AttrRow name="RainViewer" license="Sus condiciones" desc="Radar de lluvia: animación de las 2 h pasadas y zona de «Lluvia ahora», leída en tu navegador" />
        </ul>
        <h4>Incendios y mapas</h4>
        <ul className="gg-attr">
          <AttrRow name="NASA FIRMS" license="Datos abiertos NASA" desc="Detección de incendios por satélite (VIIRS)" />
          <AttrRow name="EFFIS" license="CC BY 4.0" desc="© Unión Europea, Copernicus EMS. Superficie quemada y concello" />
          <AttrRow name="Esri" license="Sus condiciones" desc="Mapas base gris y callejero (con HERE y Garmin)" />
          <AttrRow name="OpenStreetMap" license="ODbL" desc="© colaboradores de OpenStreetMap. Parte de los mapas de Esri" />
          <AttrRow name="IGN" license="CC BY 4.0" desc="© Instituto Geográfico Nacional. Mapa topográfico y foto aérea (PNOA)" />
          <AttrRow name="Mapzen Terrain Tiles" license="Sus condiciones" desc="Relieve del mapa, en AWS Open Data" />
        </ul>
        <h4>Webcams</h4>
        <ul className="gg-attr">
          <AttrRow name="MeteoGalicia" license="CC BY-SA 4.0" desc="Cámaras de la costa y del interior" />
          <AttrRow name="DGT" license="Sus condiciones" desc="Cámaras de tráfico de Ribadavia (N-120) y Barbantes (A-52)" />
          <AttrRow name="Enlaces" license="Enlace" desc="Waira Surf School (Patos), tmkites (Cesantes) y Ría de Vigo Cam (YouTube)" />
        </ul>
        <p className="gg-gap">
          Si eres titular de alguno de estos datos y quieres que cambiemos cómo se muestra o se cita,
          escríbenos por el enlace de contacto de abajo.
        </p>
      </section>

      <section className="gg-section">
        <H3 id="eye" tone="air">Privacidad</H3>
        <p>
          MeteoMapGal <strong>no tiene registro de usuarios</strong>:
          no se pide nombre, ni correo, ni ubicación, y no hay cuentas ni inicio de sesión.
        </p>
        <p>
          Responsable de los pocos datos que se guardan, que se explican a continuación: {HOLDER_NAME}, el titular.
          Para cualquier cuestión sobre ellos, el contacto está en el{' '}
          <a href={HOLDER_LEGAL_URL} {...EXT}>aviso legal de la empresa</a>.
        </p>
        <p>
          La única excepción, y es voluntaria: si activas los avisos de rayo, el navegador genera
          un identificador anónimo de suscripción que se guarda en nuestro servidor junto con los
          spots que elijas, únicamente para poder enviarte ese aviso. Se borra al desactivar las
          notificaciones y no está asociado a ninguna identidad.
        </p>
        <p>
          Y otra, solo por invitación: algunos observadores tienen un enlace personal que les damos
          nosotros. Con él, sus reportes del agua se guardan con el nombre que nos dieron, para saber
          cuánto fiarnos de cada uno, y solo esa persona ve su lista. Si quieres que lo borremos,
          díselo a quien te dio el enlace.
        </p>
        <ul className="gg-bullets">
          <li>Sin cookies de seguimiento. Analítica anónima y agregada (Cloudflare Web Analytics)</li>
          <li>Sin registro de usuarios ni login</li>
          <li>
            No vendemos ni cedemos tus datos. Algunos mapas, modelos y webcams se cargan directamente
            desde sus proveedores (Esri, IGN, Protomaps, Amazon, Open-Meteo, RainViewer, el IHM para la carta náutica, IPMA, DGT, Cloudflare),
            que ven tu dirección IP como cualquier web que visitas
          </li>
          <li>
            Lo que se pide a través de nuestro servidor (MeteoGalicia, Meteoclimatic, las mareas del IHM, CESGA,
            SkyX) les llega sin tu IP, tu país, tus cookies ni los datos de tu navegador: solo ven
            a MeteoMapGal
          </li>
          <li>Caché local (PWA) para funcionamiento offline — datos solo en tu dispositivo</li>
        </ul>
      </section>

      <section className="gg-section">
        <H3 id="info" tone="wind">Licencia del software</H3>
        <p>
          MeteoMapGal es software libre distribuido bajo licencia{' '}
          <strong>MIT</strong>. Puedes usar, modificar y redistribuir
          el código sin restricciones. El código fuente está disponible en{' '}
          <a href="https://github.com/Bateas/MeteoMapGal" {...EXT}>GitHub</a>.
        </p>
        <p>Todas las dependencias del proyecto utilizan licencias compatibles (MIT, BSD-3, Apache-2.0).</p>
        <p className="gg-muted gg-small gg-nums">Versión {APP_VERSION}</p>
      </section>

      <section className="gg-section">
        <H3 id="bell" tone="sea">Contacto</H3>
        <p>
          Para reportar errores, sugerencias o contribuir al proyecto, abre un{' '}
          <a href="https://github.com/Bateas/MeteoMapGal/issues" {...EXT}>issue en GitHub</a>.
        </p>
      </section>
    </div>
  );
}

/** `href`, when the provider asks for its address next to its name, is shown as text. */
function AttrRow({ name, license, desc, href }: { name: string; license: string; desc: string; href?: string }) {
  return (
    <li>
      <b>{name}</b>
      <span>
        {desc}
        {href && (
          <>
            {'. '}
            <a href={href} {...EXT}>{href.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>
          </>
        )}
      </span>
      <span className="gg-muted">{license}</span>
    </li>
  );
}
