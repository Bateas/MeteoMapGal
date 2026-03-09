/**
 * Lunar Phase Service — algorithmic moon phase calculation.
 *
 * Uses the Jean Meeus algorithm (Astronomical Algorithms, 1991) to compute
 * the moon's synodic phase without any external API.
 *
 * Key outputs:
 *   - Current phase name (8 phases in Spanish)
 *   - Illumination percentage (0-100)
 *   - Moon age in days (0-29.53)
 *   - Next significant phase (new/full/quarter) with date
 *   - Agricultural recommendations for Galician crops
 *
 * Reference lunar cycle: 29.53058770576 days (synodic month).
 */

// ── Types ────────────────────────────────────────────────────

export type LunarPhaseName =
  | 'nueva'          // 🌑 New Moon
  | 'creciente'      // 🌒 Waxing Crescent
  | 'cuarto-creciente' // 🌓 First Quarter
  | 'gibosa-creciente' // 🌔 Waxing Gibbous
  | 'llena'          // 🌕 Full Moon
  | 'gibosa-menguante' // 🌖 Waning Gibbous
  | 'cuarto-menguante' // 🌗 Last Quarter
  | 'menguante';     // 🌘 Waning Crescent

export interface LunarPhase {
  /** Phase name in Spanish */
  name: LunarPhaseName;
  /** Display label in Spanish */
  label: string;
  /** Moon emoji for the phase */
  emoji: string;
  /** Illumination percentage (0-100) */
  illumination: number;
  /** Moon age in days since last new moon (0-29.53) */
  ageDays: number;
  /** Is the moon waxing (growing)? */
  isWaxing: boolean;
  /** Next significant phase */
  nextPhase: {
    name: string;
    date: Date;
    daysUntil: number;
  };
  /** Agricultural recommendations for Galicia */
  agriculture: {
    /** General recommendation */
    summary: string;
    /** Sowing advice */
    sowing: string;
    /** Pruning/harvest advice */
    pruning: string;
    /** Pest treatment advice */
    treatments: string;
  };
}

// ── Constants ────────────────────────────────────────────────

/** Synodic month in days (new moon to new moon) */
const SYNODIC_MONTH = 29.53058770576;

/** Known new moon reference: Jan 6, 2000 18:14 UTC */
const KNOWN_NEW_MOON = new Date('2000-01-06T18:14:00Z').getTime();

/** Phase definitions with angular ranges (0-360°) */
const PHASE_DEFS: {
  name: LunarPhaseName;
  label: string;
  emoji: string;
  minAngle: number;
  maxAngle: number;
}[] = [
  { name: 'nueva',             label: 'Luna Nueva',         emoji: '🌑', minAngle: 0,     maxAngle: 22.5  },
  { name: 'nueva',             label: 'Luna Nueva',         emoji: '🌑', minAngle: 337.5, maxAngle: 360   },
  { name: 'creciente',         label: 'Creciente',          emoji: '🌒', minAngle: 22.5,  maxAngle: 67.5  },
  { name: 'cuarto-creciente',  label: 'Cuarto Creciente',   emoji: '🌓', minAngle: 67.5,  maxAngle: 112.5 },
  { name: 'gibosa-creciente',  label: 'Gibosa Creciente',   emoji: '🌔', minAngle: 112.5, maxAngle: 157.5 },
  { name: 'llena',             label: 'Luna Llena',         emoji: '🌕', minAngle: 157.5, maxAngle: 202.5 },
  { name: 'gibosa-menguante',  label: 'Gibosa Menguante',   emoji: '🌖', minAngle: 202.5, maxAngle: 247.5 },
  { name: 'cuarto-menguante',  label: 'Cuarto Menguante',   emoji: '🌗', minAngle: 247.5, maxAngle: 292.5 },
  { name: 'menguante',         label: 'Menguante',          emoji: '🌘', minAngle: 292.5, maxAngle: 337.5 },
];

// ── Core calculation ─────────────────────────────────────────

/**
 * Calculate the moon's age in days since the last new moon.
 * Uses the known-epoch method with synodic month period.
 */
function getMoonAgeDays(date: Date): number {
  const diffMs = date.getTime() - KNOWN_NEW_MOON;
  const diffDays = diffMs / (24 * 60 * 60 * 1000);
  const age = diffDays % SYNODIC_MONTH;
  return age < 0 ? age + SYNODIC_MONTH : age;
}

/**
 * Calculate illumination percentage from moon age.
 * Uses cosine approximation of the illumination curve.
 */
function getIllumination(ageDays: number): number {
  // Phase angle: 0° at new moon, 180° at full moon
  const phaseAngle = (ageDays / SYNODIC_MONTH) * 360;
  // Illumination follows a cosine curve: 0% at new, 100% at full
  const illumination = (1 - Math.cos(phaseAngle * Math.PI / 180)) / 2 * 100;
  return Math.round(illumination * 10) / 10;
}

/**
 * Find the phase definition for a given angular position.
 */
function getPhaseForAngle(angleDeg: number): typeof PHASE_DEFS[0] {
  const normalized = ((angleDeg % 360) + 360) % 360;
  const found = PHASE_DEFS.find(
    (p) => normalized >= p.minAngle && normalized < p.maxAngle,
  );
  return found ?? PHASE_DEFS[0]; // fallback to new moon
}

/**
 * Find the next occurrence of a specific phase angle (0=new, 90=Q1, 180=full, 270=Q3).
 */
function getNextPhaseDate(currentAge: number, targetAngle: number, now: Date): Date {
  const targetAge = (targetAngle / 360) * SYNODIC_MONTH;
  let daysUntil = targetAge - currentAge;
  if (daysUntil <= 0.5) daysUntil += SYNODIC_MONTH; // next cycle
  return new Date(now.getTime() + daysUntil * 24 * 60 * 60 * 1000);
}

// ── Agricultural recommendations ─────────────────────────────

/**
 * Get agricultural advice based on lunar phase.
 * Traditional Galician agricultural calendar (calendario agrícola).
 *
 * Key principles:
 * - Luna creciente (waxing): savia sube → siembra de cultivos aéreos, injertos
 * - Luna menguante (waning): savia baja → poda, cosecha, tratamientos
 * - Luna nueva: descanso, preparar terreno
 * - Luna llena: máxima luminosidad → trasplantes, cosecha de fruto
 */
function getAgricultureAdvice(phaseName: LunarPhaseName): LunarPhase['agriculture'] {
  switch (phaseName) {
    case 'nueva':
      return {
        summary: 'Período de descanso. Preparar terreno y planificar.',
        sowing: 'Evitar siembras. Buen momento para preparar semilleros.',
        pruning: 'Poda sanitaria de ramas secas o enfermas.',
        treatments: 'Aplicar tratamientos al suelo (encalado, abonado de fondo).',
      };
    case 'creciente':
      return {
        summary: 'Savia ascendente. Ideal para cultivos de hoja y fruto aéreo.',
        sowing: 'Sembrar lechugas, espinacas, acelgas, cereales, hierbas aromáticas.',
        pruning: 'Evitar poda. Hacer injertos de púa y escudete.',
        treatments: 'Tratamientos foliares preventivos (caldo bordelés para viña).',
      };
    case 'cuarto-creciente':
      return {
        summary: 'Máxima actividad de savia. Vigor y crecimiento rápido.',
        sowing: 'Sembrar tomates, pimientos, judías, guisantes, maíz.',
        pruning: 'NO podar — savia en máximo movimiento, sangrado excesivo.',
        treatments: 'Tratamientos preventivos contra mildiu (viñedo Ribeiro).',
      };
    case 'gibosa-creciente':
      return {
        summary: 'Transición hacia luna llena. Buena actividad vegetal.',
        sowing: 'Plantar frutales, fresas, frambuesas. Trasplantar plantones.',
        pruning: 'Evitar poda. Atar y entutorar plantas trepadoras.',
        treatments: 'Control de pulgón y araña roja (jabón potásico).',
      };
    case 'llena':
      return {
        summary: 'Máxima luminosidad. Cosecha de fruto, trasplantes exitosos.',
        sowing: 'Trasplantar hortalizas de fruto. Plantar patatas de siembra tardía.',
        pruning: 'Cosecha de frutos maduros (uva, manzana, pera).',
        treatments: 'Recoger plantas medicinales (máxima concentración de principios activos).',
      };
    case 'gibosa-menguante':
      return {
        summary: 'Savia empieza a descender. Transición a labores de raíz.',
        sowing: 'Sembrar cultivos de raíz: zanahorias, remolachas, nabos, rábanos.',
        pruning: 'Iniciar poda de formación en frutales jóvenes.',
        treatments: 'Aplicar azufre contra oídio en viña (tarde/noche).',
      };
    case 'cuarto-menguante':
      return {
        summary: 'Savia en raíces. Mejor momento para poda y cosecha de raíz.',
        sowing: 'Sembrar ajos, cebollas, puerros. Plantar bulbos de flor.',
        pruning: 'Poda de producción en viña y frutales. Mejor cicatrización.',
        treatments: 'Tratamientos sistémicos contra hongos. Desbroce de malas hierbas.',
      };
    case 'menguante':
      return {
        summary: 'Mínima actividad aérea. Labores de conservación y almacenaje.',
        sowing: 'Última ventana para tubérculos. Preparar terreno para siguiente ciclo.',
        pruning: 'Poda invernal de vid (si temperatura >5°C). Cortar leña.',
        treatments: 'Encalar troncos de frutales (protección invernal).',
      };
  }
}

// ── Public API ────────────────────────────────────────────────

/**
 * Calculate complete lunar phase information for a given date.
 * Defaults to current date/time.
 */
export function getLunarPhase(date: Date = new Date()): LunarPhase {
  const ageDays = getMoonAgeDays(date);
  const angleDeg = (ageDays / SYNODIC_MONTH) * 360;
  const phaseDef = getPhaseForAngle(angleDeg);
  const illumination = getIllumination(ageDays);
  const isWaxing = ageDays < SYNODIC_MONTH / 2;

  // Find next significant phase
  const phases = [
    { angle: 0,   name: 'Luna Nueva' },
    { angle: 90,  name: 'Cuarto Creciente' },
    { angle: 180, name: 'Luna Llena' },
    { angle: 270, name: 'Cuarto Menguante' },
  ];

  let nearestPhase = phases[0];
  let nearestDays = Infinity;

  for (const p of phases) {
    const targetAge = (p.angle / 360) * SYNODIC_MONTH;
    let daysUntil = targetAge - ageDays;
    if (daysUntil <= 0.5) daysUntil += SYNODIC_MONTH;
    if (daysUntil < nearestDays) {
      nearestDays = daysUntil;
      nearestPhase = p;
    }
  }

  const nextPhaseDate = getNextPhaseDate(ageDays, nearestPhase.angle, date);

  return {
    name: phaseDef.name,
    label: phaseDef.label,
    emoji: phaseDef.emoji,
    illumination,
    ageDays: Math.round(ageDays * 10) / 10,
    isWaxing,
    nextPhase: {
      name: nearestPhase.name,
      date: nextPhaseDate,
      daysUntil: Math.round(nearestDays * 10) / 10,
    },
    agriculture: getAgricultureAdvice(phaseDef.name),
  };
}

/**
 * Get a compact monthly lunar calendar (array of 30 days from start date).
 * Useful for planning ahead.
 */
export function getLunarCalendar(startDate: Date = new Date(), days: number = 30): {
  date: Date;
  emoji: string;
  name: LunarPhaseName;
  illumination: number;
}[] {
  const calendar: ReturnType<typeof getLunarCalendar> = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    d.setHours(12, 0, 0, 0); // noon for consistent calculation
    const phase = getLunarPhase(d);
    calendar.push({
      date: d,
      emoji: phase.emoji,
      name: phase.name,
      illumination: phase.illumination,
    });
  }
  return calendar;
}
