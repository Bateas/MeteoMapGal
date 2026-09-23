/**
 * The lightning map is the heaviest thing we ask the database for — thirty
 * days of strikes — and it used to be asked for with a url that no two
 * visitors ever shared, so nothing could cache it and each person opening the
 * tab paid the whole sweep. What matters here is that the window is the same
 * for everyone within the hour.
 */
import { describe, it, expect } from 'vitest';
import { heatmapWindow } from './analyticsClient';

const at = (iso: string, days = 30) => heatmapWindow(Date.parse(iso), days);

describe('heatmapWindow', () => {
  it('da la misma ventana a todo el que pregunte dentro de la misma hora', () => {
    expect(at('2026-09-23T10:00:04.118Z')).toEqual(at('2026-09-23T10:59:59.999Z'));
  });

  it('pasa a la siguiente cuando cambia la hora', () => {
    expect(at('2026-09-23T10:59:59.999Z')).not.toEqual(at('2026-09-23T11:00:00.001Z'));
  });

  it('no lleva minutos ni milisegundos', () => {
    const w = at('2026-09-23T10:37:12.914Z');
    expect(w.to).toBe('2026-09-23T10:00:00.000Z');
    expect(w.from).toBe('2026-08-24T10:00:00.000Z');
  });

  it('mantiene los dias pedidos', () => {
    const w = at('2026-09-23T10:37:12.914Z', 7);
    expect(Date.parse(w.to) - Date.parse(w.from)).toBe(7 * 86_400_000);
  });

  it('redondea hacia atras, nunca a un futuro sin rayos', () => {
    const now = Date.parse('2026-09-23T10:59:59.999Z');
    expect(Date.parse(heatmapWindow(now, 30).to)).toBeLessThanOrEqual(now);
  });
});
