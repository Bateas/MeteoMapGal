/**
 * «El parte» of the forecast panel in the V3 style: one sentence per day and a strip of its
 * daylight hours, one filled cell per hour in the tone of the word the map uses for a spot, so the
 * good hours light up and the calm ones recede (6-oct: the hollow bars read too poor to tell good
 * hours from bad ones). Model wind, said in the note under the strips.
 */
import { degreesToCardinal } from '../../services/windUtils';
import { useMemo, useState, type ReactNode } from 'react';
import type { HourlyForecast } from '../../types/forecast';
import { buildDayParts, buildHourCols, tempBand, TONES, type DayPart, type HourCol, type PartHour, type Tone } from '../../services/forecastParte';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';
import { useWarningsStore } from '../../hooks/useWarnings';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { dayNotices, type DayNotice } from '../../services/dayNotices';
import { bandLabel, bandRain, bandSky, bandTemp, buildDayBands, sunLine, BAND_RAIN_MIN_MM } from './dayBands';
import { useSectorStore } from '../../store/sectorStore';
import { mgWarningsAt, ipmaWarningsAt, type Place } from '../../services/warningReach';

/** Gusts from here are marked on their hour, whatever the mean wind. */
const GUST_WARN_KT = 25;

function bestTone(hours: PartHour[]): Tone {
  return hours.reduce<Tone>((best, h) => (TONES.indexOf(h.tone) > TONES.indexOf(best) ? h.tone : best), 'calma');
}

/**
 * Arrow pointing where the wind goes (the label says where it comes from). The head is drawn at the
 * TOP (north) and turned by from + 180. 6-oct: the head was drawn at the bottom
 * AND turned by +180, so every arrow pointed back into the wind.
 */
function DirArrow({ fromDeg }: { fromDeg: number }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" data-from={fromDeg} style={{ transform: `rotate(${(fromDeg + 180) % 360}deg)` }}>
      <path d="M12 21V3M12 3l-6 6M12 3l6 6" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function hourLabel(h: PartHour): string {
  const dir = h.dirDeg != null ? ` del ${degreesToCardinal(h.dirDeg)}` : '';
  const gust = h.gustKt != null ? `, rachas de ${Math.round(h.gustKt)}` : '';
  const rain = h.rainMm >= 0.1 ? `, ${h.rainMm.toFixed(1).replace('.', ',')} mm de lluvia` : '';
  return `${h.time.getHours()} h: ${h.tone}, ${Math.round(h.kt)} nudos${dir}${gust}${rain}`;
}

/** The warnings of a day, the same list in the parte and in the simple summary. */
function DayNotices({ notices }: { notices: DayNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <ul className="g-notices">
      {notices.map((n) => (
        <li key={n.text} className={`g-notice lv${n.level}`}>
          {n.level === 0 && <span className="g-zap"><WeatherIcon id="zap" size={16} /></span>}
          {n.text}
        </li>
      ))}
    </ul>
  );
}

function DayStrip({ day, nowHour, notices }: { day: DayPart; nowHour: number | null; notices: DayNotice[] }) {
  const anyRain = day.hours.some((h) => h.rainMm >= 0.1);
  const anyGust = day.hours.some((h) => h.gustKt != null); // WRF gives none
  return (
    <div className="g-day">
      <h4>{day.label}</h4>
      <DayNotices notices={notices} />
      <p className="g-sentence" style={{ ['--g-tone' as string]: `var(--g-s-${bestTone(day.hours)})` }}>{day.sentence}</p>
      <ol className="g-strip" aria-label={`Horas de luz, ${day.label.toLowerCase()}`}>
        {day.hours.map((h) => {
          const isNow = nowHour === h.time.getHours();
          const gusty = h.gustKt != null && h.gustKt >= GUST_WARN_KT;
          return (
            <li key={h.time.getTime()} className={`g-cell${isNow ? ' now' : ''}`} aria-label={hourLabel(h)}>
              <span className="g-hr">{isNow ? 'ahora' : h.time.getHours()}</span>
              <span className={`g-kt t-${h.tone}`}>{Math.round(h.kt)}</span>
              {anyGust && <span className={`g-gust${gusty ? ' warn' : ''}`}>{h.gustKt != null ? Math.round(h.gustKt) : '–'}</span>}
              <span className="g-arrow">{h.dirDeg != null && <DirArrow fromDeg={h.dirDeg} />}</span>
              {anyRain && <span className="g-mm">{h.rainMm >= 0.1 ? h.rainMm.toFixed(1).replace('.', ',') : ''}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Simple mode's first screen: today and tomorrow in three stretches, each with its sky, its
 * temperature, its rain and its strongest wind. The figure and its unit go together, and nothing
 * here needs a sideways scroll at 360 px.
 */
export function ForecastSimpleG({ hourly, place }: { hourly: HourlyForecast[]; place?: Place }) {
  const days = useMemo(() => buildDayBands(buildHourCols(hourly, new Date(), 48)), [hourly]);
  // The day's warnings stay in sight: folded with the hour table they would be one tap away from a reader
  // who came to know whether to go out.
  // A spot's forecast speaks only of the warnings that reach the spot (warningReach.ts).
  const mgWarnings = mgWarningsAt(useWarningsStore((st) => st.sectorWarnings), place);
  const ipmaWarnings = ipmaWarningsAt(useWarningsStore((st) => st.ipmaSectorWarnings), place);
  const convection = useForecastStore((st) => st.convectionData);
  const center = useSectorStore((st) => st.activeSector.center);
  const now = new Date();
  if (days.length === 0) return null;
  return (
    <section aria-label="Hoy y mañana" className="g-bands">
      {days.map((d) => {
        const sun = sunLine(d.from, now, center);
        return (
        <div key={d.key} className="g-bandday">
          {/* The comma is for the screen reader only: without it the heading read «Mañanasol de 8:27…» */}
          <h3>{d.label}{sun && <><span className="sr-only">, </span><small className="g-bandsun">{sun}</small></>}</h3>
          <DayNotices notices={dayNotices(d.from, now, mgWarnings, ipmaWarnings, convection)} />
          <ul>
            {d.bands.map((b) => {
              const sky = bandSky(b);
              const temp = bandTemp(b);
              return (
                <li key={b.id} aria-label={bandLabel(d.label, b)}>
                  <span className="g-bandname" aria-hidden="true">{b.label}<small>{b.span}</small></span>
                  <span className="g-bandsky" aria-hidden="true">{sky && <WeatherIcon id={sky} size={20} />}</span>
                  <span className={`g-bandtemp g-temp tb-${tempBand(b.tMin ?? b.tMax ?? 15)}`} aria-hidden="true">{temp ?? ''}</span>
                  <span className={b.rainMm >= BAND_RAIN_MIN_MM ? 'g-bandrain g-rain' : 'g-bandrain g-banddry'} aria-hidden="true">{bandRain(b)}</span>
                  <span className={`g-bandwind t-${b.tone}`} aria-hidden="true">{b.windKt} kt</span>
                </li>
              );
            })}
          </ul>
        </div>
        );
      })}
    </section>
  );
}

/**
 * The days hour by hour in daylight: one sentence and one strip per day. Its warnings show only when
 * nothing above already says them (`notices`): in simple mode the stretches above carry them, and a
 * day's warnings printed twice on one screen read as twice the danger (18-nov). No legend: each cell
 * prints its knots, and the colours are the map's, explained in the guide.
 */
export function ForecastPartG({ hourly, notices = true, place }: { hourly: HourlyForecast[]; notices?: boolean; place?: Place }) {
  const days = useMemo(() => buildDayParts(hourly, new Date(), 3), [hourly]);
  const mgWarnings = mgWarningsAt(useWarningsStore((s) => s.sectorWarnings), place);
  const ipmaWarnings = ipmaWarningsAt(useWarningsStore((s) => s.ipmaSectorWarnings), place);
  const convection = useForecastStore((s) => s.convectionData);
  const now = new Date();
  const anyGustWarn = days.some((d) => d.hours.some((h) => h.gustKt != null && h.gustKt >= GUST_WARN_KT));
  return (
    <section aria-label="El parte" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="g-section-head">
        <h3>El parte</h3>
      </div>
      {days.length === 0 ? (
        <p className="g-empty">Cargando la previsión…</p>
      ) : (
        <div className="g-days">
          {days.map((d) => (
            <DayStrip key={d.key} day={d} nowHour={d.label === 'Hoy' ? now.getHours() : null}
              notices={notices && d.hours.length ? dayNotices(d.hours[0].time, now, mgWarnings, ipmaWarnings, convection) : []} />
          ))}
        </div>
      )}
      {anyGustWarn && <p className="g-under">Racha marcada: {GUST_WARN_KT} kt o más.</p>}
    </section>
  );
}

/** Map sky_state to icon, fallback to cloudCover */
function skyIcon(skyState: string | null | undefined, cloudCover: number | null): IconId | null {
  if (skyState) {
    switch (skyState) {
      case 'SUNNY': case 'CLEAR': return 'sun';
      case 'CLEAR_NIGHT': return 'moon';
      case 'HIGH_CLOUDS': case 'MID_CLOUDS': case 'PARTLY_CLOUDY': return 'cloud-sun';
      case 'OVERCAST': case 'CLOUDY': case 'NIGHT_CLOUDS': case 'NIGHT_CLOUDY': return 'cloud';
      case 'DRIZZLE': case 'WEAK_RAIN': case 'RAIN': case 'SHOWERS':
      case 'WEAK_SHOWERS': case 'OVERCAST_AND_SHOWERS':
      case 'NIGHT_RAIN': case 'NIGHT_SHOWERS': return 'cloud-rain';
      case 'SNOW': case 'INTERMITENT_SNOW': case 'MELTED_SNOW': return 'snowflake';
      case 'STORMS': case 'STORM_THEN_CLOUDY': case 'NIGHT_STORMS': case 'RAIN_HAIL': return 'zap';
      case 'FOG': case 'FOG_BANK': case 'MIST': return 'fog';
    }
  }
  if (cloudCover === null) return null;
  if (cloudCover < 15) return 'sun';
  if (cloudCover < 70) return 'cloud-sun';
  return 'cloud';
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
            {/* With «Más datos» each arrow carries its bearing: two neighbouring arrows can look the same
                and be 20 degrees apart, which is the difference between entering a spot or not. */}
            {row('Dirección', more ? '°' : null, (c) => (c.dirDeg != null ? (
              <span className={`g-arrow${more ? ' g-arrow-deg' : ''}`} title={`del ${degreesToCardinal(c.dirDeg)} (${Math.round(c.dirDeg) % 360}°)`}>
                <DirArrow fromDeg={c.dirDeg} />
                {more && <span className="g-deg">{Math.round(c.dirDeg) % 360}</span>}
              </span>
            ) : null))}
            {anyGust && row('Rachas', 'kt', (c) => (c.gustKt != null ? <span className={c.gustKt >= GUST_WARN_KT ? 'g-warn' : ''}>{Math.round(c.gustKt)}</span> : null))}
            {row('Temp.', '°C', (c) => (c.temp != null ? <span className={`g-temp tb-${tempBand(c.temp)}`}>{Math.round(c.temp)}°</span> : null))}
            {anyRain && row('Lluvia', 'mm', (c) => (c.rainMm >= 0.1 ? <span className="g-rain">{num(c.rainMm, 1)}</span> : null))}
            {more && anyHum && row('Humedad', '%', (c) => (c.humidity != null ? Math.round(c.humidity) : null), 'g-more')}
            {more && anyPres && row('Presión', 'hPa', (c) => (c.pressure != null ? Math.round(c.pressure) : null), 'g-more')}
          </tbody>
        </table>
      </div>
    </section>
  );
}
