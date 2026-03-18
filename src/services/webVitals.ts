/**
 * Web Vitals performance reporting.
 * Logs Core Web Vitals (LCP, INP, CLS) to console in development.
 * Lightweight — web-vitals is ~1.5KB gzip.
 */
import { onLCP, onINP, onCLS } from 'web-vitals';

const THRESHOLDS = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
};

function ratingColor(rating: string): string {
  return rating === 'good' ? '#22c55e' : rating === 'needs-improvement' ? '#eab308' : '#ef4444';
}

export function initWebVitals() {
  const report = ({ name, value, rating }: { name: string; value: number; rating: string }) => {
    const color = ratingColor(rating);
    const unit = name === 'CLS' ? '' : 'ms';
    const display = name === 'CLS' ? value.toFixed(3) : `${Math.round(value)}${unit}`;
    console.log(
      `%c[WebVitals] ${name}: ${display} (${rating})`,
      `color: ${color}; font-weight: bold;`
    );
  };

  onLCP(report);
  onINP(report);
  onCLS(report);
}
