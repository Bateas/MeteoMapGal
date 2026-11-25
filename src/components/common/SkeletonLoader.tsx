/**
 * What a part of the app shows while its code arrives (a fraction of a second, a tab of the side panel).
 * Quiet hairlines in the place of the text, with no pulse: nothing has happened yet to show movement.
 *
 * Usage:
 *   <SkeletonLoader lines={3} />
 *   <SkeletonLoader lines={5} title />     wider bar at the top
 */

interface SkeletonLoaderProps {
  /** Number of placeholder lines */
  lines?: number;
  /** Show a wider title bar at top */
  title?: boolean;
}

export function SkeletonLoader({ lines = 3, title = false }: SkeletonLoaderProps) {
  return (
    <div className="gc-skeleton" role="status" aria-label="Cargando">
      {title && <i style={{ width: '40%', height: 16 }} />}
      {Array.from({ length: lines }, (_, i) => (
        <i key={i} style={{ width: `${75 - i * 8}%` }} />
      ))}
    </div>
  );
}
