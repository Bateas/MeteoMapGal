/**
 * Guide section: Legal — disclaimer, data attribution, privacy, license.
 */
import { WeatherIcon } from '../../icons/WeatherIcons';

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
            (Open-Meteo) son estimaciones, no observaciones.
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
            Todos los datos provienen de <strong className="text-slate-300">fuentes públicas y abiertas</strong>.
            Se citan conforme a sus respectivas licencias:
          </p>
          <ul className="space-y-1.5 text-[10px] text-slate-400">
            <AttrRow name="AEMET OpenData" license="CC BY 4.0" desc="Agencia Estatal de Meteorología — datos abiertos" />
            <AttrRow name="MeteoGalicia" license="Datos abiertos Xunta" desc="Xunta de Galicia — red de estaciones" />
            <AttrRow name="Meteoclimatic" license="Uso libre" desc="Red ciudadana — estaciones personales" />
            <AttrRow name="Open-Meteo" license="CC BY 4.0" desc="Modelo numérico ECMWF/GFS" />
            <AttrRow name="IHM / Puertos del Estado" license="Datos públicos" desc="Predicciones de mareas" />
            <AttrRow name="EUMETSAT" license="Uso no comercial" desc="Imagen satelital infrarroja Meteosat" />
            <AttrRow name="ENAIRE" license="Datos públicos" desc="Espacio aéreo y NOTAMs" />
          </ul>
        </div>
      </div>

      {/* Privacy */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
          <WeatherIcon id="eye" size={14} /> Privacidad
        </h3>
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800 space-y-2">
          <p className="text-xs text-slate-400 leading-relaxed">
            MeteoMapGal <strong className="text-emerald-400">no recopila datos personales</strong>.
          </p>
          <ul className="space-y-1 text-[10px] text-slate-400">
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
              Sin cookies de seguimiento ni analítica
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
              Sin registro de usuarios ni login
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
              Sin envío de datos a terceros
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
            el código sin restricciones. El código fuente está disponible en GitHub.
          </p>
          <p className="text-[10px] text-slate-500">
            Todas las dependencias del proyecto utilizan licencias compatibles (MIT, BSD-3, Apache-2.0).
          </p>
        </div>
      </div>

      {/* Contact */}
      <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
        <p className="text-[10px] text-slate-500">
          <strong className="text-slate-400">Contacto:</strong> Para reportar errores, sugerencias
          o contribuir al proyecto, abre un issue en el repositorio de GitHub.
        </p>
      </div>
    </div>
  );
}

/* ─── Sub-components ──────────────────────────── */

function AttrRow({ name, license, desc }: { name: string; license: string; desc: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="text-slate-300 font-bold shrink-0 w-28">{name}</span>
      <span className="text-slate-500 flex-1">{desc}</span>
      <span className="text-slate-600 font-mono text-[9px] shrink-0">{license}</span>
    </li>
  );
}
