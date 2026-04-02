import { memo, useEffect, useState } from 'react';
import { useRegattaStore } from '../../store/regattaStore';
import { fetchOpenMeteoForecast } from '../../api/openMeteoClient';
import { msToKnots } from '../../services/windUtils';
import type { ForecastPoint } from '../../api/openMeteoClient';

interface TimeSlot {
  hour: string; // "14h"
  windKt: number;
  gustKt: number;
  dir: number;
  temp: number;
  clouds: number;
  visibility: number | null;
  level: 'green' | 'yellow' | 'red';
  label: string;
}

function classifySlot(windKt: number, gustKt: number, visibility: number | null): { level: TimeSlot['level']; label: string } {
  if (windKt > 25 || gustKt > 35) return { level: 'red', label: 'Peligro' };
  if (windKt > 15 || gustKt > 25) return { level: 'yellow', label: 'Precaucion' };
  if (visibility != null && visibility < 1000) return { level: 'yellow', label: 'Niebla' };
  if (windKt > 8) return { level: 'green', label: 'Navegable' };
  if (windKt > 4) return { level: 'green', label: 'Flojo' };
  return { level: 'green', label: 'Calma' };
}

const LEVEL_COLORS = {
  green: { bg: 'bg-green-500/30', border: 'border-green-500/50', text: 'text-green-400' },
  yellow: { bg: 'bg-amber-500/30', border: 'border-amber-400/50', text: 'text-amber-400' },
  red: { bg: 'bg-red-500/30', border: 'border-red-500/50', text: 'text-red-400' },
};

/**
 * Activity timeline for the next 6 hours.
 * Shows color-coded time slots with wind/conditions forecast.
 */
export const RegattaTimeline = memo(function RegattaTimeline() {
  const { active, zone } = useRegattaStore();
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active || !zone) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const centerLat = (zone.ne[1] + zone.sw[1]) / 2;
      const centerLon = (zone.ne[0] + zone.sw[0]) / 2;

      try {
        const forecast = await fetchOpenMeteoForecast(centerLat, centerLon, 8);
        if (cancelled) return;

        // Take next 6 hours (skip current hour if partial)
        const now = new Date();
        const upcoming = forecast.filter((p) => p.timestamp > now).slice(0, 6);

        const newSlots: TimeSlot[] = upcoming.map((p) => {
          const windKt = msToKnots(p.windSpeed ?? 0);
          // Estimate gust as 1.5x wind (Open-Meteo doesn't give gusts in basic forecast)
          const gustKt = windKt * 1.5;
          const { level, label } = classifySlot(windKt, gustKt, p.visibility);

          return {
            hour: `${p.timestamp.getHours()}h`,
            windKt: Math.round(windKt),
            gustKt: Math.round(gustKt),
            dir: Math.round(p.windDirection ?? 0),
            temp: Math.round(p.temperature ?? 0),
            clouds: Math.round(p.cloudCover ?? 0),
            visibility: p.visibility,
            level,
            label,
          };
        });

        setSlots(newSlots);
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    // Refresh every 10 minutes
    const iv = setInterval(load, 10 * 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [active, zone]);

  if (!active || !zone || slots.length === 0) return null;

  return (
    <div className="absolute bottom-14 left-14 z-40 rounded-xl bg-slate-900/95 border border-slate-700/50 backdrop-blur-md shadow-xl overflow-hidden">
      <div className="px-3 py-1.5 bg-slate-800/50 border-b border-slate-700/40">
        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Ventana de actividad — proximas {slots.length}h</span>
      </div>
      <div className="flex">
        {slots.map((slot, i) => {
          const c = LEVEL_COLORS[slot.level];
          return (
            <div key={i} className={`flex flex-col items-center px-2.5 py-1.5 ${c.bg} ${i > 0 ? 'border-l border-slate-700/30' : ''}`}>
              <span className="text-[10px] text-white font-bold">{slot.hour}</span>
              <span className={`text-[11px] font-black ${c.text}`}>{slot.windKt}kt</span>
              <span className="text-[8px] text-slate-500">{slot.dir}°</span>
              <span className="text-[8px] text-slate-500">{slot.temp}°C</span>
              <span className={`text-[7px] font-bold mt-0.5 ${c.text}`}>{slot.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
