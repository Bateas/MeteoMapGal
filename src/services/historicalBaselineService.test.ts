import { describe, it, expect } from 'vitest';
import { describeVsBaseline, severityToBadgeClass,
  fetchHistoricalBaseline,
} from './historicalBaselineService';

describe('describeVsBaseline', () => {
  const baseline = {
    avg: 8,
    p50: 7,
    p75: 12,
    p90: 16,
    maxGust: 24,
    hoursSampled: 720, // 30 days × 24 h
  };

  it('returns null when baseline is null', () => {
    expect(describeVsBaseline(12, null, 'kt')).toBe(null);
  });

  it('returns null when sample size is too small', () => {
    expect(describeVsBaseline(12, { ...baseline, hoursSampled: 10 }, 'kt')).toBe(null);
  });

  it('returns null when current value is essentially zero', () => {
    expect(describeVsBaseline(0, baseline, 'kt')).toBe(null);
  });

  it('returns null when baseline avg is near zero (divide-by-zero protection)', () => {
    expect(describeVsBaseline(5, { ...baseline, avg: 0.05 }, 'kt')).toBe(null);
  });

  it('flags top 10% as rare', () => {
    const result = describeVsBaseline(18, baseline, 'kt');
    expect(result?.severity).toBe('rare');
    expect(result?.phrase).toContain('top 10%');
  });

  it('flags top 25% as high', () => {
    const result = describeVsBaseline(13, baseline, 'kt');
    expect(result?.severity).toBe('high');
    expect(result?.phrase).toContain('top 25%');
  });

  it('flags noticeably below average as low', () => {
    // p50 * 0.5 = 3.5 → current 3 should trigger low
    const result = describeVsBaseline(3, baseline, 'kt');
    expect(result?.severity).toBe('low');
    expect(result?.phrase).toContain('flojo');
  });

  it('shows percentage delta when significantly above/below avg but not p75/p90', () => {
    // avg=8, current=11 → +37.5% → above 25% threshold, below p75=12
    const result = describeVsBaseline(11, baseline, 'kt');
    expect(result?.severity).toBe('typical');
    expect(result?.phrase).toContain('+38%');
  });

  it('returns null when within ±25% of average (not actionable)', () => {
    // avg=8, current=9 → +12.5% → suppressed
    expect(describeVsBaseline(9, baseline, 'kt')).toBe(null);
  });

  it('uses the provided unit and window label', () => {
    const result = describeVsBaseline(18, baseline, 'kt', 'mes de abril');
    expect(result?.phrase).toContain('kt');
    expect(result?.phrase).toContain('mes de abril');
  });
});

describe('severityToBadgeClass', () => {
  it('returns rose tint for rare', () => {
    expect(severityToBadgeClass('rare')).toContain('rose');
  });
  it('returns amber tint for high', () => {
    expect(severityToBadgeClass('high')).toContain('amber');
  });
  it('returns sky tint for low', () => {
    expect(severityToBadgeClass('low')).toContain('sky');
  });
  it('returns slate tint for typical', () => {
    expect(severityToBadgeClass('typical')).toContain('slate');
  });
});

describe('fetchHistoricalBaseline - unidades en la frontera', () => {
  const respuesta = (avg: number) => ({
    ok: true,
    json: async () => ({
      stationId: 'mg_test', metric: 'wind', days: 30,
      baseline: { avg, p50: avg, p75: avg * 1.5, p90: avg * 2, maxGust: avg * 3, hoursSampled: 500 },
    }),
  });

  it('convierte el viento de m/s a nudos', async () => {
    // La API responde en las unidades que guarda la base (m/s). Todo lo que
    // el usuario lee esta en nudos. 5 m/s son 9,7 kt.
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => respuesta(5)) as unknown as typeof fetch;
    try {
      const r = await fetchHistoricalBaseline('mg_test', 'wind', 30);
      expect(r.baseline!.avg).toBeCloseTo(9.72, 1);
      expect(r.baseline!.p90).toBeCloseTo(19.44, 1);
      expect(r.baseline!.maxGust).toBeCloseTo(29.16, 1);
    } finally { globalThis.fetch = orig; }
  });

  it('el bug que motivo esto: 12 kt contra una media de 5 m/s NO es excepcional', async () => {
    // Antes se comparaba 12 (nudos) contra 5 (m/s) y salia "top 10%" en una
    // tarde del monton. Con la media real de 9,7 kt, 12 kt es normalito.
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => respuesta(5)) as unknown as typeof fetch;
    try {
      const r = await fetchHistoricalBaseline('mg_test', 'wind', 30);
      const insight = describeVsBaseline(12, r.baseline, 'kt');
      expect(insight?.severity).not.toBe('rare');
    } finally { globalThis.fetch = orig; }
  });

  it('no toca la temperatura, que ya viene en grados', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => respuesta(20)) as unknown as typeof fetch;
    try {
      const r = await fetchHistoricalBaseline('mg_test', 'temp', 30);
      expect(r.baseline!.avg).toBe(20);
    } finally { globalThis.fetch = orig; }
  });
});
