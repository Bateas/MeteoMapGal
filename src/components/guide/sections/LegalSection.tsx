/**
 * Guide section: Legal — disclaimer, data attribution, privacy, license.
 */
import { WeatherIcon } from '../../icons/WeatherIcons';
import { APP_VERSION } from '../../../config/version';

export function LegalSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Aviso legal</h2>

      {/* Disclaimer */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
          <WeatherIcon id="alert-triangle" size={14} /> Descargo de responsabilidad
        </h3>
        <div className="bg-amber-900/10 rounded-lg p-4 border border-amber-700/30 space-y-2">
          <p className="text-xs text-slate-400 leading-relaxed">
            Los datos meteorológicos mostrados en MeteoMapGal son de carácter{' '}
            <strong className="text-amber-400">exclusivamente informativo</strong>.
            No deben utilizarse para tomar decisiones que comprometan la seguridad de personas o bienes.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            MeteoMapGal <strong className="text-slate-300">no sustituye</strong> los avisos oficiales de{' '}
            <strong className="text-slate-300">AEMET</strong>,{' '}
            <strong className="text-slate-300">Protección Civil</strong> ni ningún organismo competente.
            Ante situaciones de riesgo meteorológico, consulte siempre las fuentes oficiales.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            No se garantiza la precisión, disponibilidad ni continuidad de los datos. Las estaciones
            meteorológicas pueden presentar fallos, retrasos o lecturas erróneas. Los modelos numéricos
            son estimaciones, no observaciones.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            Las imágenes de <strong className="text-slate-300">webcams</strong> son de sus titulares
            (MeteoGalicia y DGT) y se muestran tal como las publican, sin archivarlas. Algunas se analizan
            de forma automática para detectar niebla; se guarda el resultado, no la imagen. Las de Waira Surf
            School, tmkites y Ría de Vigo Cam solo se enlazan. La disponibilidad depende de cada titular.
          </p>
        </div>
      </div>

      {/* Data attribution */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
          <WeatherIcon id="database" size={14} /> Atribución de datos
        </h3>
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800 space-y-2">
          <p className="text-xs text-slate-400 leading-relaxed">
            Los datos proceden de <strong className="text-slate-300">organismos públicos y de redes y servicios
            de terceros</strong>. Cada fuente conserva sus derechos. Donde el titular publica una licencia, se
            indica; «sus condiciones» quiere decir que el dato está sujeto a los términos de uso de ese servicio.
          </p>
          <p className="text-[11px] font-bold text-slate-400 pt-1">Observación y avisos</p>
          <ul className="space-y-1.5 text-[11px] text-slate-400">
            <AttrRow name="AEMET OpenData" license="Cita de la fuente" desc="© AEMET. Estaciones, visibilidad y radar" />
            <AttrRow name="MeteoGalicia" license="CC BY-SA 4.0" desc="© Xunta de Galicia. Estaciones, avisos, rayos, calidad del aire y webcams" />
            <AttrRow name="Meteoclimatic" license="CC BY-NC-ND" desc="Red ciudadana de estaciones personales" />
            <AttrRow name="Weather Underground" license="Sus condiciones" desc="© The Weather Company. Estaciones personales" />
            <AttrRow name="Netatmo" license="Sus condiciones" desc="© Netatmo. Estaciones personales de su mapa público" />
            <AttrRow name="IPMA" license="Uso no lucrativo" desc="Instituto Português do Mar e da Atmosfera. Estaciones y avisos del norte de Portugal" />
            <AttrRow name="PORTUS" license="Sus condiciones" desc="© Puertos del Estado. Boyas y mareógrafos: viento, oleaje y nivel del mar" />
            <AttrRow name="Observatorio Costeiro" license="Sus condiciones" desc="© Xunta de Galicia. Boyas de las rías" />
            <AttrRow name="SkyX" license="Propia" desc="Estación portátil propia, mediante el servicio SkyX" />
          </ul>
          <p className="text-[11px] font-bold text-slate-400 pt-1">Previsión y modelos</p>
          <ul className="space-y-1.5 text-[11px] text-slate-400">
            <AttrRow name="MeteoSIX" license="Sus condiciones" desc="MeteoGalicia. Previsión WRF, oleaje costero y temperatura del mar" />
            <AttrRow name="Open-Meteo" license="CC BY 4.0" desc="Previsión de varios modelos, oleaje y previsión del día anterior" />
            <AttrRow name="CESGA" license="Sus condiciones" desc="Modelo de oleaje SWAN (capa de olas)" />
            <AttrRow name="IHM" license="Sus condiciones" desc="Instituto Hidrográfico de la Marina. Predicción de mareas" />
            <AttrRow name="Copernicus Marine" license="Licencia Copernicus" desc="Temperatura superficial del mar" />
            <AttrRow name="NOAA" license="Dominio público" desc="Índices climáticos NAO y AO" />
            <AttrRow name="RainViewer" license="Sus condiciones" desc="Animación del radar de lluvia (2 h pasadas)" />
          </ul>
          <p className="text-[11px] font-bold text-slate-400 pt-1">Incendios, espacio aéreo y mapas</p>
          <ul className="space-y-1.5 text-[11px] text-slate-400">
            <AttrRow name="NASA FIRMS" license="Datos abiertos NASA" desc="Detección de incendios por satélite (VIIRS)" />
            <AttrRow name="EFFIS" license="CC BY 4.0" desc="© Unión Europea, Copernicus EMS. Superficie quemada y concello" />
            <AttrRow name="ENAIRE" license="Sus condiciones" desc="Espacio aéreo y NOTAM" />
            <AttrRow name="OpenSky Network" license="Sus condiciones" desc="Posición de aeronaves" />
            <AttrRow name="Esri" license="Sus condiciones" desc="Mapas base gris y callejero (con HERE y Garmin)" />
            <AttrRow name="OpenStreetMap" license="ODbL" desc="© colaboradores de OpenStreetMap. Mapa base, y parte de los mapas de Esri" />
            <AttrRow name="IGN" license="CC BY 4.0" desc="© Instituto Geográfico Nacional. Mapas, ortofoto, relieve y curvas de nivel" />
            <AttrRow name="EMODnet" license="Datos abiertos UE" desc="Batimetría" />
            <AttrRow name="OpenSeaMap" license="CC BY-SA" desc="Marcas y señales de navegación" />
          </ul>
          <p className="text-[11px] font-bold text-slate-400 pt-1">Webcams</p>
          <ul className="space-y-1.5 text-[11px] text-slate-400">
            <AttrRow name="MeteoGalicia" license="CC BY-SA 4.0" desc="Cámaras de la costa y del interior" />
            <AttrRow name="DGT" license="Sus condiciones" desc="Cámaras de tráfico de Ribadavia (N-120) y Barbantes (A-52)" />
            <AttrRow name="Enlaces" license="Enlace" desc="Waira Surf School (Patos), tmkites (Cesantes) y Ría de Vigo Cam (YouTube)" />
            <AttrRow name="ESP32-CAM" license="Propia" desc="Webcam propia en el embalse de Castrelo de Miño" />
          </ul>
          <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
            Si eres titular de alguno de estos datos y quieres que cambiemos cómo se muestra o se cita,
            escríbenos por el enlace de contacto de abajo.
          </p>
        </div>
      </div>

      {/* Privacy */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
          <WeatherIcon id="eye" size={14} /> Privacidad
        </h3>
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800 space-y-2">
          <p className="text-xs text-slate-400 leading-relaxed">
            MeteoMapGal <strong className="text-emerald-400">no tiene registro de usuarios</strong>:
            no se pide nombre, ni correo, ni ubicación, y no hay cuentas ni inicio de sesión.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            La única excepción, y es voluntaria: si activas los avisos de rayo, el navegador genera
            un identificador anónimo de suscripción que se guarda en nuestro servidor junto con los
            spots que elijas, únicamente para poder enviarte ese aviso. Se borra al desactivar las
            notificaciones y no está asociado a ninguna identidad.
          </p>
          <ul className="space-y-1 text-[11px] text-slate-400">
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
              Sin cookies de seguimiento. Analítica anónima y agregada (Cloudflare Web Analytics)
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
              Sin registro de usuarios ni login
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
              No vendemos ni cedemos tus datos. Algunos mapas, modelos y webcams se cargan directamente
              desde sus proveedores (Esri, IGN, OpenStreetMap, Open-Meteo, RainViewer, Copernicus, IPMA, DGT, Cloudflare),
              que ven tu dirección IP como cualquier web que visitas
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
              Caché local (PWA) para funcionamiento offline — datos solo en tu dispositivo
            </li>
          </ul>
        </div>
      </div>

      {/* License */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
          <WeatherIcon id="info" size={14} /> Licencia del software
        </h3>
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800 space-y-2">
          <p className="text-xs text-slate-400 leading-relaxed">
            MeteoMapGal es software libre distribuido bajo licencia{' '}
            <strong className="text-blue-400">MIT</strong>. Puedes usar, modificar y redistribuir
            el código sin restricciones. El código fuente está disponible en{' '}
            <a
              href="https://github.com/Bateas/MeteoMapGal"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
            >GitHub</a>.
          </p>
          <p className="text-[11px] text-slate-500">
            Todas las dependencias del proyecto utilizan licencias compatibles (MIT, BSD-3, Apache-2.0).
          </p>
          <p className="text-[11px] text-slate-600 font-mono mt-1">
            Versión {APP_VERSION}
          </p>
        </div>
      </div>

      {/* Contact */}
      <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
        <p className="text-[11px] text-slate-500">
          <strong className="text-slate-400">Contacto:</strong> Para reportar errores, sugerencias
          o contribuir al proyecto, abre un{' '}
          <a
            href="https://github.com/Bateas/MeteoMapGal/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
          >issue en GitHub</a>.
        </p>
      </div>
    </div>
  );
}

/* ─── Sub-components ──────────────────────────── */

// On a phone the licence goes under the description: as a third column it ran into the edge.
function AttrRow({ name, license, desc }: { name: string; license: string; desc: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="text-slate-300 font-bold shrink-0 w-28 sm:w-40">{name}</span>
      <span className="text-slate-500 flex-1 min-w-0">
        {desc}
        <span className="sm:hidden block text-slate-600 font-mono text-[11px]">{license}</span>
      </span>
      <span className="hidden sm:inline text-slate-600 font-mono text-[11px] shrink-0">{license}</span>
    </li>
  );
}
