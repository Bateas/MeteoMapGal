/**
 * Shared skeleton loader for consistent loading states across the app.
 * Replaces ad-hoc "Cargando..." text and empty states.
 *
 * Usage:
 *   <SkeletonLoader lines={3} />           — 3 shimmering lines
 *   <SkeletonLoader lines={5} title />     — title bar + 5 lines
 *   <SkeletonLoader lines={2} compact />   — smaller spacing
 */

interface SkeletonLoaderProps {
  /** Number of placeholder lines */
  lines?: number;
  /** Show a wider title bar at top */
  title?: boolean;
  /** Compact mode with less spacing */
  compact?: boolean;
}

export function SkeletonLoader({ lines = 3, title = false, compact = false }: SkeletonLoaderProps) {
  const gap = compact ? 'gap-1.5' : 'gap-2.5';
  const lineH = compact ? 'h-2.5' : 'h-3';

  return (
    <div className={`flex flex-col ${gap} animate-pulse py-2`} role="status" aria-label="Cargando...">
      {title && (
        <div className="h-4 bg-slate-700/50 rounded w-2/5 mb-1" />
      )}
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className={`${lineH} bg-slate-700/40 rounded`}
          style={{ width: `${75 - i * 8}%` }}
        />
      ))}
    </div>
  );
}
