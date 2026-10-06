/**
 * «El parte» of the forecast panel in the V3 style: one sentence per day and a strip of its
 * daylight hours, one filled cell per hour in the tone of the word the map uses for a spot, so the
 * good hours light up and the calm ones recede (6-oct: the hollow bars read too poor to tell good
 * hours from bad ones). Model wind, said in the note under the strips.
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { HourlyForecast } from '../../types/forecast';
import { buildDayParts, buildHourCols, cardinalEs, TONES, type DayPart, type HourCol, type PartHour, type Tone } from '../../services/forecastParte';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';
import { skyIcon } from './ForecastTable';
import { useWarningsStore } from '../../hooks/useWarnings';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { dayNotices, type DayNotice } from '../../services/dayNotices';

/** The knots behind each word (forecastParte windTone), said once in the legend. */
const TONE_RANGE: Record<Tone, string> = { calma: 'menos de 6', flojo: '6-8', navegable: '8-12', bueno: '12-18', fuerte: '18 o más' };

/** Gusts from here are marked on their hour, whatever the mean wind. */
const GUST_WARN_KT = 25;

function bestTone(hours: PartHour[]): Tone {
  return hours.reduce<Tone>((best, h) => (TONES.indexOf(h.tone) > TONES.indexOf(best) ? h.tone : best), 'calma');
}

/** Arrow pointing where the wind goes (the label says where it comes from). */
function DirArrow({ fromDeg }: { fromDeg: number }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${fromDeg + 180}deg)` }}>
      <path d="M12 3v18M12 21l-6-6M12 21l6-6" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function hourLabel(h: PartHour): string {
  const dir = h.dirDeg != null ? ` del ${cardinalEs(h.dirDeg)}` : '';
  const gust = h.gustKt != null ? `, rachas de ${Math.round(h.gustKt)}` : '';
  const rain = h.rainMm >= 0.1 ? `, ${h.rainMm.toFixed(1).replace('.', ',')} mm de lluvia` : '';
  return `${h.time.getHours()} h: ${h.tone}, ${Math.round(h.kt)} nudos${dir}${gust}${rain}`;
}

function DayStrip({ day, nowHour, notices }: { day: DayPart; nowHour: number | null; notices: DayNotice[] }) {
  const anyRain = day.hours.some((h) => h.rainMm >= 0.1);
  const anyGust = day.hours.some((h) => h.gustKt != null); // WRF gives none
  return (
    <div className="g-day">
      <h4>{day.label}</h4>
      {notices.length > 0 && (
        <ul className="g-notices">
          {notices.map((n) => (
            <li key={n.text} className={`g-notice lv${n.level}`}>
              {n.level === 0 && <span className="g-zap"><WeatherIcon id="zap" size={16} /></span>}
              {n.text}
            </li>
          ))}
        </ul>
      )}
      <p className="g-sentence" style={{ ['--g-tone' as string]: `var(--g-s-${bestTone(day.hours)})` }}>{day.sentence}</p>
      <ol className="g-strip" aria-label={`Horas de luz, ${day.label.toLowerCase()}`}>
        {day.hours.map((h) => {
          const isNow = nowHour === h.time.getHours();
          const gusty = h.gustKt != null && h.gustKt >= GUST_WARN_KT;
          return (
            <li key={h.time.getTime()} className={`g-cell${isNow ? ' now' : ''}`} aria-label={hourLabel(h)}>
              <span className="g-hr">{isNow ? 'ahora' : h.time.getHours()}</span>
              <span className={`g-kt t-${h.tone}`}>{Math.round(h.kt)}</span>
              {anyGust && <span className={`g-gust${gusty ? ' warn' : ''}`}>{h.gustKt != null ? Math.round(h.gustKt) : ''}</span>}
              <span className="g-arrow">{h.dirDeg != null && <DirArrow fromDeg={h.dirDeg} />}</span>
              {anyRain && <span className="g-mm">{h.rainMm >= 0.1 ? h.rainMm.toFixed(1).replace('.', ',') : ''}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function ForecastPartG({ hourly, source }: { hourly: HourlyForecast[]; source: string }) {
  const days = useMemo(() => buildDayParts(hourly, new Date(), 3), [hourly]);
  const mgWarnings = useWarningsStore((s) => s.sectorWarnings);
  const ipmaWarnings = useWarningsStore((s) => s.ipmaSectorWarnings);
  const convection = useForecastStore((s) => s.convectionData);
  const now = new Date();
  return (
    <section aria-label="El parte" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="g-section-head">
        <h3>El parte</h3>
        <span className="g-note">horas de luz · nudos</span>
      </div>
      {days.length === 0 ? (
        <p className="g-empty">Cargando la previsión…</p>
      ) : (
        <div className="g-days">
          {days.map((d) => (
            <DayStrip key={d.key} day={d} nowHour={d.label === 'Hoy' ? now.getHours() : null}
              notices={d.hours.length ? dayNotices(d.hours[0].time, now, mgWarnings, ipmaWarnings, convection) : []} />
          ))}
        </div>
      )}
      <div className="g-legend" aria-label="Leyenda">
        {TONES.map((t) => (
          <span key={t}><i className={`t-${t}`} />{t} <span className="g-range">{TONE_RANGE[t]}</span></span>
        ))}
        {days.some((d) => d.hours.some((h) => h.gustKt != null)) && <span><b className="g-gust-key">25</b> racha de 25 kt o más</span>}
      </div>
      <p className="g-how"><strong>Cómo lo sabemos:</strong> {source}. Es el viento que da el modelo en un punto, sin corregir con lo medido; el de cada spot puede ser distinto (abrigo, canalización, térmica), y eso lo dice el mapa con las estaciones.</p>
    </section>
  );
}

/** The model's sky at night: the sun icons swap for the moon or a plain cloud. */
function nightSky(id: IconId | null, light: boolean): IconId | null {
  if (light || !id) return id;
  if (id === 'sun') return 'moon';
  if (id === 'cloud-sun') return 'cloud';
  return id;
}

const num = (v: number, digits = 0) => v.toFixed(digits).replace('.', ',');

/**
 * Hour by hour for the next 48 h, the same colours as the parte. Night hours stay (the wind does
 * not stop at sunset) but recede. Gusts and rain only get a row when the model gives any; humidity
 * and pressure wait behind «Más datos».
 */
export function ForecastHoursG({ hourly }: { hourly: HourlyForecast[] }) {
  const [more, setMore] = useState(false);
  const cols = useMemo(() => buildHourCols(hourly, new Date(), 48), [hourly]);
  if (cols.length === 0) return null;

  const days: { key: string; label: string; span: number }[] = [];
  for (const c of cols) {
    const last = days[days.length - 1];
    if (last && last.key === c.dayKey) last.span++;
    else days.push({ key: c.dayKey, label: c.dayLabel, span: 1 });
  }
  const nowHour = new Date().getHours();
  const anyGust = cols.some((c) => c.gustKt != null);
  const anyRain = cols.some((c) => c.rainMm >= 0.1);
  const anyHum = cols.some((c) => c.humidity != null);
  const anyPres = cols.some((c) => c.pressure != null);
  const cls = (c: HourCol, i: number) =>
    `${c.light ? '' : 'g-night'}${i > 0 && cols[i - 1].dayKey !== c.dayKey ? ' g-dstart' : ''}${i === 0 && c.time.getHours() === nowHour ? ' g-nowcol' : ''}`;

  const row = (label: string, unit: string | null, cell: (c: HourCol) => ReactNode, extra = '') => (
    <tr className={extra}>
      <th scope="row" className="g-rowh">{label}{unit && <span className="g-unit">{unit}</span>}</th>
      {cols.map((c, i) => <td key={c.time.getTime()} className={cls(c, i)}>{cell(c)}</td>)}
    </tr>
  );

  return (
    <section aria-label="Hora a hora" className="g-hours">
      <div className="g-section-head">
        <h3>Hora a hora</h3>
        <button type="button" className="g-tbtn" aria-pressed={more} onClick={() => setMore((v) => !v)}>
          {more ? 'Menos datos' : 'Más datos'}
        </button>
      </div>
      <div className="g-scroll" tabIndex={0} role="region" aria-label="Tabla hora a hora, desplazable a los lados">
        <table className="g-table">
          <thead>
            <tr>
              <th scope="col" className="g-rowh"><span className="sr-only">Dato</span></th>
              {days.map((d, i) => (
                <th key={d.key} scope="colgroup" colSpan={d.span} className={`g-dayh${i > 0 ? ' g-dstart' : ''}`}>{d.label}</th>
              ))}
            </tr>
            <tr>
              <th scope="row" className="g-rowh">Hora</th>
              {cols.map((c, i) => (
                <th key={c.time.getTime()} scope="col" className={`g-hh ${cls(c, i)}`}>{c.time.getHours()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row('Cielo', null, (c) => {
              const id = nightSky(skyIcon(c.skyState, c.cloudCover), c.light);
              return id ? <span className="g-sky"><WeatherIcon id={id} size={16} /></span> : null;
            })}
            {row('Viento', 'kt', (c) => <span className={`g-kt g-kt-sm t-${c.tone}`}>{Math.round(c.kt)}</span>, 'g-windrow')}
            {row('Dirección', null, (c) => (c.dirDeg != null ? <span className="g-arrow" title={`del ${cardinalEs(c.dirDeg)}`}><DirArrow fromDeg={c.dirDeg} /></span> : null))}
            {anyGust && row('Rachas', 'kt', (c) => (c.gustKt != null ? <span className={c.gustKt >= GUST_WARN_KT ? 'g-warn' : ''}>{Math.round(c.gustKt)}</span> : null))}
            {row('Temp.', '°C', (c) => (c.temp != null ? `${Math.round(c.temp)}°` : null))}
            {anyRain && row('Lluvia', 'mm', (c) => (c.rainMm >= 0.1 ? <span className="g-rain">{num(c.rainMm, 1)}</span> : null))}
            {more && anyHum && row('Humedad', '%', (c) => (c.humidity != null ? Math.round(c.humidity) : null), 'g-more')}
            {more && anyPres && row('Presión', 'hPa', (c) => (c.pressure != null ? Math.round(c.pressure) : null), 'g-more')}
          </tbody>
        </table>
      </div>
    </section>
  );
}
