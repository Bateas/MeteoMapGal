/**
 * The one list of Condiciones: «is there anything here, today or tomorrow, that would change my
 * plan, apart from the wind at my spot?». The drawer, the strip on the map and the dot in the header
 * all read it, so they cannot disagree. Pure: the caller passes what the stores hold.
 *
 * Each line says where it comes from: official, measured or model. That replaces the «Beta» labels,
 * which followed no rule (frost, 23 % of the frosts, had none; measured wind had one).
 *
 * Numbers and jargon stay folded in `detail`: the first view is one sentence. With nothing to say it
 * says so without reassuring: never «sin riesgo», «el modelo no da».
 */
import type { AlertLevel } from '../../types/campo';
import type { HourlyForecast } from '../../types/forecast';
import type { MGWarning } from '../../api/mgWarningsClient';
import type { IpmaWarning } from '../../api/ipmaWarningsClient';
import type { IcaReading } from '../../api/meteoGaliciaIcaClient';
import { icaCategory } from '../../api/meteoGaliciaIcaClient';
import type { HazeAssessment } from '../hazeService';
import { formatFireAge, type aggregateFiresForSector } from '../fireService';
import { describeFireLocation, fireDisclaimer } from '../fireRegion';
import type { AlertCategory, AlertSeverity, UnifiedAlert } from './types';
import { checkFrost, rainLevelForHours } from '../fieldAlertEngine';
import { isStormRiskHour } from '../stormRiskRule';
import { warningTypeEs, zonesInForce } from '../dayNotices';
import { haversineDistance } from '../geoUtils';
import { spanWords } from './whenText';

export type LineOrigin = 'oficial' | 'medido' | 'modelo';
/** Colour of the icon only: the words stay in ink. null = no alert colour. */
export type LineTone = 'critico' | 'alto' | 'moderado' | 'riesgo' | null;

export interface ConditionLine {
  id: string;
  /** IconId of WeatherIcons */
  icon: string;
  tone: LineTone;
  origin: LineOrigin;
  /** What happens, in one sentence */
  text: string;
  /** Where and until when: always visible */
  sub?: string;
  /** The numbers: folded until asked for */
  detail?: string;
}

export interface ConditionsList {
  /** Ahora */
  now: ConditionLine[];
  /** Hoy y mañana */
  ahead: ConditionLine[];
  /** En el campo: folded, without alert colours */
  campo: ConditionLine[];
  /** What we could not ask: said, never read as «nothing» */
  unknown: string[];
  /** The same, in the two words the strip has room for */
  unknownShort: string | null;
  emptyNow: string;
  emptyAhead: string;
  emptyCampo: string;
  /** The dot: the worst colour of the list */
  level: AlertLevel;
  /** Lines with an alert colour (the number on the strip) */
  activeCount: number;
}

export interface ConditionsInput {
  alerts: UnifiedAlert[];
  mg: MGWarning[];
  ipma: IpmaWarning[];
  /** False when MeteoGalicia stopped answering: no warnings is not «there are none» */
  officialKnown: boolean;
  /** False when our lightning feed never answered */
  lightningKnown: boolean;
  /** WRF hours, the ones the forecast panel shows */
  hourly: HourlyForecast[];
  /** Hours with CAPE/LI/CIN (Open-Meteo), or hourly when there are none */
  convection: HourlyForecast[];
  haze: HazeAssessment | null;
  dust?: number | null;
  aod?: number | null;
  ica: IcaReading[];
  /** Fires grouped and gated by distance: beyond the mention range it says none */
  fires?: ReturnType<typeof aggregateFiresForSector>;
  center: [number, number];
  radiusKm: number;
  sectorName: string;
  now: Date;
}

/**
 * A fire names the zone, never a distance from an unnamed centre. Coloured only when near: one 60 km away is
 * worth a line, not a dot. Satellite detection: it can be an authorised burn, and the detail says so.
 */
export function fireLine(fires: ReturnType<typeof aggregateFiresForSector>): ConditionLine | null {
  if (fires.severity === 'none' || !fires.nearest) return null;
  const { distanceKm, bearing, cluster } = fires.nearest;
  const place = describeFireLocation(cluster.lat, cluster.lon, distanceKm, bearing);
  const lower = place.charAt(0).toLowerCase() + place.slice(1);
  return {
    id: 'active-fires',
    icon: 'flame',
    tone: fires.severity === 'alerta' ? 'alto' : null,
    origin: 'medido',
    text: fires.fireCount === 1 ? `Incendio ${lower}` : `${fires.fireCount} incendios cerca, el más próximo ${lower}`,
    sub: `Satélite, ${formatFireAge(cluster.latestAt)}`,
    detail: fireDisclaimer(cluster.frpMw),
  };
}

// ── From the alert store ─────────────────────────────────────

function toneOf(severity: AlertSeverity): LineTone {
  switch (severity) {
    case 'critical': return 'critico';
    case 'high': return 'alto';
    case 'moderate': return 'moderado';
    default: return null;
  }
}

const TONE_RANK: Record<NonNullable<LineTone>, number> = { riesgo: 1, moderado: 2, alto: 3, critico: 4 };

function worstTone(a: LineTone, b: LineTone): LineTone {
  if (!a) return b;
  if (!b) return a;
  return TONE_RANK[a] >= TONE_RANK[b] ? a : b;
}

/** Measured rain keeps the id of the forecast alert it replaced (rainNowAlerts.ts). */
function isMeasuredRain(a: UnifiedAlert): boolean {
  return a.category === 'rain' && (a.id === 'rain-now' || / ahora$/.test(a.title));
}

export function alertOrigin(a: UnifiedAlert): LineOrigin {
  switch (a.category) {
    case 'rain': return isMeasuredRain(a) ? 'medido' : 'modelo';
    // AEMET sensors and cameras: seen. The other two are a rule over readings: an estimate.
    case 'fog': return a.id === 'maritime-fog-webcam' ? 'medido' : 'modelo';
    case 'frost': return 'modelo';
    // A measured gust, but what it warns of comes from the model's atmosphere.
    case 'downburst': return 'modelo';
    case 'inversion': return a.id === 'inversion-forecast' ? 'modelo' : 'medido';
    default: return 'medido';
  }
}

/** Order of «Ahora»: rain and sea after what endangers a person now. */
const NOW_ORDER: Partial<Record<AlertCategory, number>> = {
  storm: 0, fog: 1, rain: 2, marine: 3, 'wind-front': 4, downburst: 4, pressure: 5, inversion: 6, thermal: 7,
};

function alertLine(a: UnifiedAlert): ConditionLine {
  return {
    id: a.id,
    icon: a.icon,
    tone: toneOf(a.severity),
    origin: alertOrigin(a),
    text: a.title.replace(/\s*\(modelo\)$/, ''),
    detail: a.detail || undefined,
  };
}

// ── Official warnings ────────────────────────────────────────

const LEVEL_WORD = ['', 'amarillo', 'naranja', 'rojo'];
const LEVEL_TONE: LineTone[] = [null, 'moderado', 'alto', 'critico'];

export function officialLines(mg: MGWarning[], ipma: IpmaWarning[], now: Date): ConditionLine[] {
  return officialLinesTimed(mg, ipma, now).map(({ startsMs: _s, ...line }) => line);
}

/** The official lines with when each one starts, so the list can say a later one under «Hoy y mañana». */
function officialLinesTimed(mg: MGWarning[], ipma: IpmaWarning[], now: Date): (ConditionLine & { startsMs: number })[] {
  const lines: (ConditionLine & { level: number; startsMs: number })[] = [];
  mg.forEach((w, i) => {
    const zones = zonesInForce(w);
    if (zones.length === 0) return;
    const from = new Date(Math.min(...zones.map((z) => z.startTime.getTime())));
    const to = new Date(Math.max(...zones.map((z) => z.endTime.getTime())));
    const level = Math.min(3, Math.max(...zones.map((z) => z.level)));
    const comment = zones.map((z) => z.comment).find(Boolean);
    lines.push({
      id: `official-mg-${w.typeId}-${i}`,
      icon: 'alert-triangle',
      tone: LEVEL_TONE[level],
      origin: 'oficial',
      level,
      startsMs: from.getTime(),
      text: `Aviso ${LEVEL_WORD[level]} de MeteoGalicia por ${warningTypeEs(w.type)}`,
      sub: `${spanWords(from, to, now)} · ${[...new Set(zones.map((z) => z.name))].join(', ')}`,
      detail: comment || undefined,
    });
  });
  // IPMA only speaks of what MeteoGalicia does not: the same sea warned by both agencies was two
  // lines here and the IPMA one went to the strip under the map as if it were news (18-nov).
  const mgTypes = new Set(mg.filter((w) => zonesInForce(w).length > 0).map((w) => warningTypeEs(w.type)));
  ipma.forEach((w, i) => {
    if (w.level < 1 || mgTypes.has(warningTypeEs(w.type))) return;
    const level = Math.min(3, Math.max(0, w.level));
    lines.push({
      id: `official-ipma-${i}`,
      icon: 'alert-triangle',
      tone: LEVEL_TONE[level],
      origin: 'oficial',
      level,
      startsMs: w.startTime.getTime(),
      text: `Aviso ${LEVEL_WORD[level]} de IPMA por ${warningTypeEs(w.type)}`,
      sub: `${spanWords(w.startTime, w.endTime, now)} · ${w.districtName}`,
      detail: w.description || undefined,
    });
  });
  return lines.sort((a, b) => b.level - a.level).map(({ level: _l, ...line }) => line);
}

// ── Storm: measured lightning only ──────────────

/**
 * The storm line is the measured alert and nothing else. The predictor's percentage, horizon and
 * signals are no longer said: against the strikes that followed a whole stored season they did not
 * hold up (with «30-44 %» there was a storm at the point 1 time in 7). No measured alert, no line.
 */
function stormLine(alert: UnifiedAlert | undefined): ConditionLine | null {
  if (!alert) return null;
  const line = alertLine(alert);
  // Distance and strikes are what this line is for: visible, not folded.
  line.sub = alert.detail;
  line.detail = undefined;
  return line;
}

// ── Air quality: one line, only from a station near the sector ──

const POLLUTANT_ES: Record<string, string> = {
  O3: 'ozono', NO2: 'NO₂', PM10: 'partículas PM10', PM25: 'PM2.5', 'PM2.5': 'PM2.5', SO2: 'SO₂', CO: 'CO',
};

/** Worst station at or above «deficiente» inside the sector radius, with its distance. */
export function worstIcaNear(
  readings: IcaReading[],
  center: [number, number],
  radiusKm: number,
): { reading: IcaReading; km: number } | null {
  let best: { reading: IcaReading; km: number } | null = null;
  for (const r of readings) {
    if (r.ica < 2.5) continue;
    const km = haversineDistance(center[1], center[0], r.lat, r.lon);
    if (km > radiusKm) continue;
    if (!best || r.ica > best.reading.ica) best = { reading: r, km };
  }
  return best;
}

/** «Calidad del aire mala en Coia, a 12 km del centro de la zona». */
export function icaSentence({ reading, km }: { reading: IcaReading; km: number }): string {
  const cat = icaCategory(reading.ica);
  const label = (reading.categoryEs || (cat === 'muy_mala' ? 'Muy mala' : cat === 'mala' ? 'Mala' : 'Deficiente')).toLowerCase();
  return `Calidad del aire ${label} en ${reading.station}, a ${Math.round(km)} km del centro de la zona`;
}

function icaLine(found: { reading: IcaReading; km: number }): ConditionLine {
  const cat = icaCategory(found.reading.ica);
  const pollutant = POLLUTANT_ES[found.reading.dominantPollutant] ?? found.reading.dominantPollutant;
  return {
    id: 'air-quality',
    icon: 'wind',
    // Deficient stays without colour: it does not light the dot on its own.
    tone: cat === 'muy_mala' ? 'alto' : cat === 'mala' ? 'moderado' : null,
    origin: 'medido',
    text: icaSentence(found),
    detail: pollutant ? `Contaminante principal: ${pollutant} · Red de la Xunta` : 'Red de la Xunta',
  };
}

// ── Today and tomorrow, from the forecast ────────────────────

const FOG_SKY = new Set(['FOG', 'FOG_BANK', 'MIST']);
const STORM_SKY = new Set(['STORMS', 'STORM_THEN_CLOUDY', 'NIGHT_STORMS', 'RAIN_HAIL']);
/** Storm risk is named from the hours the 9 h summary looks at (dayNotices.ts). */
const STORM_FROM_HOUR = 8;
const STORM_TO_HOUR = 21;
/** AEMET's intensity scale, as in rainAlerts.ts */
const RAIN_MODERATE_MM = 2;
const RAIN_HEAVY_MM = 15;

interface Span { from: number; to: number }

const mm = (v: number) => v.toFixed(1).replace('.', ',');

/** Hours of one day that pass the test, as contiguous spans; a one-hour gap does not cut a span. */
function daySpans(hours: HourlyForecast[], day: Date, now: Date, test: (h: HourlyForecast) => boolean): Span[] {
  const d0 = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  // The next midnight by the calendar, not «+24 h»: the two days a year the clock changes have 23 and 25 hours
  const d1 = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const fromMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
  const spans: Span[] = [];
  for (const h of hours) {
    const t = h.time.getTime();
    if (t < d0 || t >= d1 || t < fromMs || !test(h)) continue;
    const hour = h.time.getHours();
    const last = spans[spans.length - 1];
    if (last && hour <= last.to + 1) last.to = hour + 1;
    else spans.push({ from: hour, to: hour + 1 });
  }
  return spans;
}

function spansWords(spans: Span[], isToday: boolean, now: Date): string {
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (spans.length > 2) return `a ratos, de ${first.from} a ${last.to} h`;
  const one = (s: Span) => {
    if (s.from === 0 && s.to >= 24) return 'todo el día';
    if (isToday && s.from <= now.getHours()) return `hasta las ${s.to} h`;
    return `de ${s.from} a ${s.to} h`;
  };
  return spans.map(one).join(' y ');
}

/** «Lluvia hoy de 14 a 20 h; mañana de 6 a 9 h». One sentence per thing, null when nothing. */
function sentence(thing: string, hours: HourlyForecast[], now: Date, test: (h: HourlyForecast) => boolean): string | null {
  const today = now;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const parts: string[] = [];
  const spansToday = daySpans(hours, today, now, test);
  if (spansToday.length > 0) parts.push(`hoy ${spansWords(spansToday, true, now)}`);
  const spansTomorrow = daySpans(hours, tomorrow, now, test);
  if (spansTomorrow.length > 0) parts.push(`mañana ${spansWords(spansTomorrow, false, now)}`);
  return parts.length > 0 ? `${thing} ${parts.join('; ')}` : null;
}

function isRainyHour(h: HourlyForecast): boolean {
  // The block rule of the frost-and-rain table, on one hour. It has to rain in the model too: the
  // probability alone reads 25-40 % on clear days and is not a sentence about rain.
  return rainLevelForHours([h]) !== 'none' && (h.precipitation ?? 0) > 0.1;
}

function endOfTomorrow(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).getTime();
}

function rainLine(hours: HourlyForecast[], now: Date): ConditionLine | null {
  const within = hours.filter((h) => h.time.getTime() < endOfTomorrow(now) && h.time.getTime() >= now.getTime() - 3_600_000 && isRainyHour(h));
  if (within.length === 0) return null;
  const maxMm = Math.max(...within.map((h) => h.precipitation ?? 0));
  const totalMm = within.reduce((sum, h) => sum + (h.precipitation ?? 0), 0);
  const maxProb = Math.max(...within.map((h) => h.precipProbability ?? 0));
  const hail = within.some((h) => (h.cape ?? 0) > 1000 && (h.precipitation ?? 0) > 5);
  const word = maxMm >= RAIN_HEAVY_MM ? 'Lluvia fuerte' : maxMm >= RAIN_MODERATE_MM ? 'Lluvia moderada' : 'Lluvia';
  const text = sentence(word, hours, now, isRainyHour);
  if (!text) return null;
  const detail = [`Hasta ${mm(maxMm)} mm/h`, `${mm(totalMm)} mm en total`, maxProb > 0 ? `probabilidad ${maxProb} %` : ''].filter(Boolean).join(' · ');
  return { id: 'ahead-rain', icon: hail ? 'hail' : 'cloud-rain', tone: null, origin: 'modelo', text: hail ? `${text}, con posible granizo` : text, detail };
}

function stormRiskLine(hourly: HourlyForecast[], convection: HourlyForecast[], now: Date): ConditionLine | null {
  const atHour = (h: HourlyForecast) => { const x = h.time.getHours(); return x >= STORM_FROM_HOUR && x <= STORM_TO_HOUR; };
  // Instability (Open-Meteo) or the sky of the WRF: each only exists in its own array.
  const fromRule = sentence('Riesgo de tormenta', convection, now, (h) => atHour(h) && isStormRiskHour(h));
  const fromSky = sentence('Riesgo de tormenta', hourly, now, (h) => !!h.skyState && STORM_SKY.has(h.skyState));
  const text = fromRule ?? fromSky;
  if (!text) return null;
  return { id: 'ahead-storm', icon: 'zap', tone: null, origin: 'modelo', text };
}

function fogLine(hourly: HourlyForecast[], now: Date): ConditionLine | null {
  const text = sentence('Niebla', hourly, now, (h) => !!h.skyState && FOG_SKY.has(h.skyState));
  return text ? { id: 'ahead-fog', icon: 'fog', tone: null, origin: 'modelo', text } : null;
}

/** Lines of what the model expects: shared with the line under the header. */
export function forecastLines(hourly: HourlyForecast[], convection: HourlyForecast[], now: Date): ConditionLine[] {
  const hours = hourly.length > 0 ? hourly : convection;
  return [stormRiskLine(hourly, convection, now), rainLine(hours, now), fogLine(hours, now)]
    .filter((l): l is ConditionLine => l != null);
}

function hazeLine(haze: HazeAssessment, dust?: number | null, aod?: number | null): ConditionLine {
  const word = haze.severity === 'fuerte' ? 'Calima fuerte prevista' : haze.severity === 'moderada' ? 'Calima moderada prevista' : 'Calima prevista';
  const numbers = [
    dust != null ? `Polvo ${Math.round(dust)} µg/m³` : '',
    aod != null ? `aerosoles ${aod.toFixed(2).replace('.', ',')}` : '',
  ].filter(Boolean).join(' · ');
  return { id: 'ahead-haze', icon: 'cloud', tone: null, origin: 'modelo', text: word, detail: numbers || undefined };
}

// ── The list ─────────────────────────────────────────────────

const LEVEL_OF_TONE: Record<NonNullable<LineTone>, AlertLevel> = {
  riesgo: 'riesgo', moderado: 'riesgo', alto: 'alto', critico: 'critico',
};

export function buildConditionsList(i: ConditionsInput): ConditionsList {
  const now: ConditionLine[] = [];
  const ahead: ConditionLine[] = [];
  const campo: ConditionLine[] = [];

  // ── Ahora ──
  // A warning in force is «now»; one that starts later heads «Hoy y mañana» (18-nov: a wind warning from
  // 18 h sat under «Ahora» at 15 h).
  const timed = officialLinesTimed(i.mg, i.ipma, i.now);
  const official: ConditionLine[] = timed.map(({ startsMs: _s, ...line }) => line);
  const startsLater = new Set(timed.filter((l) => l.startsMs > i.now.getTime()).map((l) => l.id));
  now.push(...official.filter((l) => !startsLater.has(l.id)));

  const storm = stormLine(i.alerts.find((a) => a.category === 'storm'));
  if (storm) now.push(storm);

  const rest = i.alerts
    .filter((a) => a.category !== 'storm' && a.category !== 'frost' && a.id !== 'inversion-forecast'
      && (a.category !== 'rain' || isMeasuredRain(a)))
    .sort((a, b) => (NOW_ORDER[a.category] ?? 9) - (NOW_ORDER[b.category] ?? 9) || b.score - a.score);
  now.push(...rest.map(alertLine));

  const ica = worstIcaNear(i.ica, i.center, i.radiusKm);
  if (ica) now.push(icaLine(ica));

  const fire = i.fires && fireLine(i.fires);
  if (fire) now.push(fire);

  // ── Hoy y mañana ──
  const modelLines = forecastLines(i.hourly, i.convection, i.now);
  // An official storm warning already says it; the model risk would repeat it (dayNotices.ts).
  const officialStorm = official.some((l) => l.text.endsWith('por tormenta'));
  ahead.push(...official.filter((l) => startsLater.has(l.id)));
  ahead.push(...modelLines.filter((l) => !(l.id === 'ahead-storm' && officialStorm)));

  // The rain alert of the next hours gives its level to the sentence; if the WRF hours say nothing
  // (the alert may come from the other model) it speaks for itself.
  const rainAlert = i.alerts.find((a) => a.category === 'rain' && !isMeasuredRain(a));
  if (rainAlert) {
    const line = ahead.find((l) => l.id === 'ahead-rain');
    if (line) line.tone = toneOf(rainAlert.severity);
    else ahead.unshift(alertLine(rainAlert));
  }

  const inversion = i.alerts.find((a) => a.id === 'inversion-forecast');
  if (inversion) ahead.push(alertLine(inversion));

  if (i.haze && i.haze.severity !== 'none') ahead.push(hazeLine(i.haze, i.dust, i.aod));

  // ── En el campo: no alert colours ──
  const frost = i.alerts.find((a) => a.category === 'frost');
  if (frost) campo.push({ ...alertLine(frost), tone: null, sub: frost.detail, detail: undefined });

  // ── What we do not know ──
  const unknown: string[] = [];
  if (!i.officialKnown) unknown.push('No sabemos de avisos oficiales: MeteoGalicia no responde.');
  if (!i.lightningKnown) unknown.push('No sabemos de rayos: nuestro servidor no responde.');

  // ── The dot: the worst colour of the list ──
  let worst: LineTone = null;
  let activeCount = 0;
  for (const l of [...now, ...ahead]) {
    if (!l.tone) continue;
    activeCount++;
    worst = worstTone(worst, l.tone);
  }

  const hasForecast = i.hourly.length > 0 || i.convection.length > 0;
  return {
    now,
    ahead,
    campo,
    unknown,
    unknownShort: !i.lightningKnown ? 'Sin datos de rayos' : !i.officialKnown ? 'Sin dato de avisos' : null,
    emptyNow: `${unknown.length > 0 ? 'Nada más que decir' : 'Nada que avisar'} ahora en ${i.sectorName}.`,
    emptyAhead: hasForecast
      ? 'Nada que avisar hoy ni mañana.'
      : 'Aún sin previsión: no sabemos qué viene hoy ni mañana.',
    // No frost, no frost line (18-nov): the fold then names what it holds.
    emptyCampo: 'Luna y avisos de plagas',
    level: worst ? LEVEL_OF_TONE[worst] : 'none',
    activeCount,
  };
}

// ── The strip by hours (folded): only the rows with something ──

export interface HourCell {
  /** 'none' draws an empty cell */
  level: AlertLevel | 'storm' | 'frost';
  label: string;
}

export interface HourRow {
  id: 'rain' | 'storm' | 'frost';
  name: string;
  /** The row in words, for screen readers and for a phone, which has no hover */
  summary: string;
  cells: HourCell[];
}

export interface HourStrip {
  /** Hour label of every cell; the strip shows one of each four */
  labels: string[];
  rows: HourRow[];
}

const RAIN_WORD: Record<AlertLevel, string> = { none: 'sin lluvia', riesgo: 'posible', alto: 'probable', critico: 'fuerte o granizo' };
const MEASURED_RAIN_WORD: Record<AlertLevel, string> = { none: 'sin lluvia', riesgo: 'débil, medida ahora', alto: 'moderada, medida ahora', critico: 'fuerte, medida ahora' };
const LEVEL_RANK: Record<AlertLevel, number> = { none: 0, riesgo: 1, alto: 2, critico: 3 };

/** «15 h» or, on the first hours of a day, «mié 3 h». */
function hourLabel(t: Date, now: Date): string {
  const sameDay = t.getDate() === now.getDate() && t.getMonth() === now.getMonth();
  if (sameDay) return `${t.getHours()} h`;
  return `${t.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')} ${t.getHours()} h`;
}

/**
 * 3-hour blocks over the next 48 h. Rain from the same rule as the table of the guide; storm risk
 * with the one rule of the 9 h summary and the forecast panel (isStormRiskHour), not CAPE alone.
 * While the rain layer measures rain, the block that holds now shows the measured level.
 */
export function buildHourStrip(
  hourly: HourlyForecast[],
  convection: HourlyForecast[],
  now: Date,
  measuredRain: AlertLevel | null,
): HourStrip {
  const hours = hourly.length > 0 ? hourly : convection;
  const nowMs = now.getTime();
  const labels: string[] = [];
  const rain: HourCell[] = [];
  const storm: HourCell[] = [];
  // The blocks start at the hour in course, not at the first hour of the list: aligned to the list, at
  // 13:10 the strip began at «15 h» and the rain measured now had no block to go in (review, 18-nov).
  const first = hours.findIndex((h) => h.time.getTime() > nowMs - 3_600_000);
  for (let i = Math.max(0, first); first >= 0 && i < hours.length && labels.length < 16; i += 3) {
    const chunk = hours.slice(i, i + 3);
    const start = chunk[0].time.getTime();
    const label = hourLabel(chunk[0].time, now);
    // The sentence's own rule: the model has to give rain, the probability alone does not (it read
    // «posible» in the strip under a list that said nothing was coming).
    let level = rainLevelForHours(chunk.filter(isRainyHour));
    const holdsNow = labels.length === 0 && start <= nowMs + 3_600_000;
    const useMeasured = holdsNow && measuredRain != null && LEVEL_RANK[measuredRain] > LEVEL_RANK[level];
    if (useMeasured) level = measuredRain!;
    rain.push({ level, label: `${label}: ${(useMeasured ? MEASURED_RAIN_WORD : RAIN_WORD)[level]}` });
    const end = start + 3 * 3_600_000;
    const risk = convection.some((h) => {
      const t = h.time.getTime();
      return t >= start && t < end && isStormRiskHour(h);
    });
    storm.push({ level: risk ? 'storm' : 'none', label: `${label}: ${risk ? 'riesgo de tormenta' : 'el modelo no da tormenta'}` });
    labels.push(label);
  }
  const rows: HourRow[] = [];
  const said = (cells: HourCell[]) => cells.filter((c) => c.level !== 'none').map((c) => c.label).join(', ');
  if (rain.some((c) => c.level !== 'none')) rows.push({ id: 'rain', name: 'Lluvia', summary: said(rain), cells: rain });
  if (storm.some((c) => c.level !== 'none')) rows.push({ id: 'storm', name: 'Tormenta', summary: said(storm), cells: storm });
  return { labels, rows };
}

/** Frost by blocks, for the folded «En el campo»: one neutral colour, it is not an alert there. */
export function buildFrostStrip(hours: HourlyForecast[], now: Date, center?: [number, number]): HourStrip {
  const nowMs = now.getTime();
  const labels: string[] = [];
  const cells: HourCell[] = [];
  for (let i = 0; i < hours.length && labels.length < 16; i += 3) {
    const chunk = hours.slice(i, i + 3);
    if (chunk[0].time.getTime() < nowMs - 3_600_000) continue;
    const label = hourLabel(chunk[0].time, now);
    const frost = checkFrost(chunk, center).level !== 'none';
    cells.push({ level: frost ? 'frost' : 'none', label: `${label}: ${frost ? 'puede helar' : 'el modelo no da helada'}` });
    labels.push(label);
  }
  const said = cells.filter((c) => c.level !== 'none').map((c) => c.label).join(', ');
  return { labels, rows: said ? [{ id: 'frost', name: 'Helada', summary: said, cells }] : [] };
}
