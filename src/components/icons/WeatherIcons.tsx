/**
 * WeatherIcons — Central icon registry for MeteoMapGal.
 *
 * Replaces all emoji characters with consistent SVG icons:
 * - Lucide React for standard icons (stroke-based, currentColor, tree-shakeable)
 * - Custom inline SVGs for domain-specific icons Lucide doesn't cover
 *
 * All icons inherit text color via `currentColor` and share the same visual weight.
 */
import type { LucideProps } from 'lucide-react';
import {
  Wind,
  Droplets,
  Satellite,
  Radar,
  Thermometer,
  Sun,
  Moon,
  Cloud,
  CloudSun,
  CloudRain,
  Snowflake,
  Zap,
  AlertTriangle,
  Ban,
  CheckCircle2,
  XCircle,
  Info,
  BookOpen,
  Download,
  MapPin,
  Waves,
  Flame,
  Tag,
  CloudDrizzle,
  Map,
  Leaf,
  Clock,
  X,
  ClipboardList,
  Anchor,
  Database,
  Gauge,
  Check,
  Sprout,
  Compass,
  Navigation,
  Layers,
  Eye,
  Camera,
  ThumbsUp,
  ThumbsDown,
  Bell,
  BellOff,
} from 'lucide-react';

// ── Icon ID type ──────────────────────────────────────────────
export type IconId =
  | 'sailboat' | 'wind' | 'droplets' | 'satellite' | 'radar'
  | 'thermometer' | 'sun' | 'moon' | 'cloud' | 'cloud-sun' | 'cloud-rain'
  | 'snowflake' | 'zap' | 'fog' | 'alert-triangle' | 'ban' | 'sleep'
  | 'check-circle' | 'x-circle' | 'info' | 'book-open' | 'download'
  | 'map-pin' | 'drone' | 'waves' | 'flame' | 'hail' | 'thermal-wind'
  | 'mountain' | 'beach' | 'tag' | 'cloud-drizzle' | 'map'
  | 'leaf' | 'clock' | 'x' | 'clipboard-list' | 'anchor'
  | 'database' | 'gauge' | 'check' | 'sprout'
  | 'compass' | 'navigation' | 'layers' | 'eye' | 'camera'
  | 'thumbs-up' | 'thumbs-down' | 'bell' | 'bell-off';

// ── Custom SVG icons (not in Lucide) ──────────────────────────

/** Sailboat — simplified side view, stroke-based */
function SailboatIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 2L12 20" />
      <path d="M12 4L19 15H12" />
      <path d="M12 6L6 15H12" />
      <path d="M4 20C4 20 8 17 12 17C16 17 20 20 20 20" />
    </svg>
  );
}

/** Drone — quadcopter top view */
function DroneIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="2" />
      <line x1="10" y1="10" x2="6" y2="6" />
      <line x1="14" y1="10" x2="18" y2="6" />
      <line x1="10" y1="14" x2="6" y2="18" />
      <line x1="14" y1="14" x2="18" y2="18" />
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
    </svg>
  );
}

/** Fog — horizontal dashed lines */
function FogIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" className={className}>
      <path d="M4 8h16" />
      <path d="M6 12h12" opacity="0.7" />
      <path d="M3 16h8" opacity="0.5" />
      <path d="M14 16h7" opacity="0.5" />
      <path d="M5 20h6" opacity="0.3" />
      <path d="M15 20h4" opacity="0.3" />
    </svg>
  );
}

/** Hail — cloud with dots falling */
function HailIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 16.2A4.5 4.5 0 0017.5 8h-1.2A7 7 0 104 14.9" />
      <circle cx="8" cy="18" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="18" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="16" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="14" cy="16" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Thermal wind — wavy upward arrows */
function ThermalWindIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8 20C8 20 6 16 6 12C6 8 8 4 8 4" />
      <path d="M8 4L5 7" />
      <path d="M8 4L11 7" />
      <path d="M16 20C16 20 14 16 14 12C14 8 16 4 16 4" />
      <path d="M16 4L13 7" />
      <path d="M16 4L19 7" />
    </svg>
  );
}

/** Mountain — simple peak */
function MountainIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 20L8.5 8L12 14L15.5 8L22 20H2Z" />
      <path d="M8.5 8L10 10.5L12 14" />
    </svg>
  );
}

/** Beach — wave + shore line */
function BeachIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17 20L21 12H14L17 4" />
      <path d="M2 16C4 14 6 14 8 16C10 18 12 18 14 16C16 14 18 14 20 16" />
      <path d="M2 20C4 18 6 18 8 20C10 22 12 22 14 20C16 18 18 18 20 20" />
    </svg>
  );
}

/** Sleep/ZZZ — for calm conditions */
function SleepIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 4H20L15 10H20" />
      <path d="M9 10H13L9 15H13" />
      <path d="M4 15H7L4 19H7" />
    </svg>
  );
}

// ── Lucide icon map ───────────────────────────────────────────
const LUCIDE_MAP: Record<string, React.ComponentType<LucideProps>> = {
  'wind': Wind,
  'droplets': Droplets,
  'satellite': Satellite,
  'radar': Radar,
  'thermometer': Thermometer,
  'sun': Sun,
  'moon': Moon,
  'cloud': Cloud,
  'cloud-sun': CloudSun,
  'cloud-rain': CloudRain,
  'cloud-drizzle': CloudDrizzle,
  'snowflake': Snowflake,
  'zap': Zap,
  'alert-triangle': AlertTriangle,
  'ban': Ban,
  'check-circle': CheckCircle2,
  'x-circle': XCircle,
  'info': Info,
  'book-open': BookOpen,
  'download': Download,
  'map-pin': MapPin,
  'waves': Waves,
  'flame': Flame,
  'tag': Tag,
  'map': Map,
  'leaf': Leaf,
  'clock': Clock,
  'x': X,
  'clipboard-list': ClipboardList,
  'anchor': Anchor,
  'database': Database,
  'gauge': Gauge,
  'check': Check,
  'sprout': Sprout,
  'compass': Compass,
  'navigation': Navigation,
  'layers': Layers,
  'eye': Eye,
  'camera': Camera,
  'thumbs-up': ThumbsUp,
  'thumbs-down': ThumbsDown,
  'bell': Bell,
  'bell-off': BellOff,
};

// ── WeatherIcon component ─────────────────────────────────────

interface WeatherIconProps {
  id: IconId;
  size?: number;
  className?: string;
  /** Stroke width override (default 1.75) */
  strokeWidth?: number;
}

/**
 * Unified icon component. Renders Lucide icons for standard IDs,
 * custom SVGs for domain-specific ones.
 */
export function WeatherIcon({ id, size = 16, className, strokeWidth = 1.75 }: WeatherIconProps) {
  // Custom SVG icons
  switch (id) {
    case 'sailboat': return <SailboatIcon size={size} className={className} />;
    case 'drone': return <DroneIcon size={size} className={className} />;
    case 'fog': return <FogIcon size={size} className={className} />;
    case 'hail': return <HailIcon size={size} className={className} />;
    case 'thermal-wind': return <ThermalWindIcon size={size} className={className} />;
    case 'mountain': return <MountainIcon size={size} className={className} />;
    case 'beach': return <BeachIcon size={size} className={className} />;
    case 'sleep': return <SleepIcon size={size} className={className} />;
  }

  // Lucide icons
  const LucideIcon = LUCIDE_MAP[id];
  if (LucideIcon) {
    return <LucideIcon size={size} strokeWidth={strokeWidth} className={className} />;
  }

  // Fallback: render id text (should never happen in production)
  return <span className={className} style={{ fontSize: size }}>{id}</span>;
}

// ── Text label utility (for non-React contexts like notifications) ──

const ICON_LABELS: Record<IconId, string> = {
  'sailboat': 'Navegación',
  'wind': 'Viento',
  'droplets': 'Humedad',
  'satellite': 'Satélite',
  'radar': 'Radar',
  'thermometer': 'Temperatura',
  'sun': 'Sol',
  'moon': 'Noche',
  'cloud': 'Nublado',
  'cloud-sun': 'Parcial',
  'cloud-rain': 'Lluvia',
  'cloud-drizzle': 'Llovizna',
  'snowflake': 'Helada',
  'zap': 'Tormenta',
  'fog': 'Niebla',
  'alert-triangle': 'Alerta',
  'ban': 'Prohibido',
  'sleep': 'Calma',
  'check-circle': 'OK',
  'x-circle': 'Error',
  'info': 'Info',
  'book-open': 'Guía',
  'download': 'Descargar',
  'map-pin': 'Ubicación',
  'drone': 'Dron',
  'waves': 'Oleaje',
  'flame': 'Calor',
  'hail': 'Granizo',
  'thermal-wind': 'Térmico',
  'mountain': 'Montaña',
  'beach': 'Costa',
  'tag': 'Etiqueta',
  'map': 'Mapa',
  'leaf': 'Cultivo',
  'clock': 'Tiempo',
  'x': 'Cerrar',
  'clipboard-list': 'Lista',
  'anchor': 'Mareas',
  'database': 'Base de datos',
  'gauge': 'Indicador',
  'check': 'Completado',
  'sprout': 'Crecimiento',
  'compass': 'Brújula',
  'navigation': 'Navegación',
  'layers': 'Batimetría',
  'eye': 'Privacidad',
  'camera': 'Webcam',
  'thumbs-up': 'Correcto',
  'thumbs-down': 'Incorrecto',
  'bell': 'Notificaciones',
  'bell-off': 'Sin notificaciones',
};

/** Get a text label for an icon ID (for non-React contexts) */
export function iconLabel(id: IconId): string {
  return ICON_LABELS[id] ?? id;
}
