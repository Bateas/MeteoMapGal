import { useEffect, useState } from 'react';
import { fetchMgAuxLatest, formatAux2mWind, type MgAuxLatest } from '../../api/mgAuxLatestClient';

/**
 * One small line in the popup of a MeteoGalicia station that has no 10 m wind: its 2 m wind, said
 * as what it is. Not validated data (see src/api/mgAuxLatestClient.ts): it is shown here and only
 * here, and it never reaches a verdict, the consensus, the arrows, the ticker or the alerts.
 * Renders nothing when there is no fresh reading.
 */
export function StationAux2mLine({ stationId }: { stationId: string }) {
  const [reading, setReading] = useState<MgAuxLatest | null>(null);

  useEffect(() => {
    let alive = true;
    setReading(null);
    fetchMgAuxLatest(stationId).then((r) => {
      if (alive) setReading(r);
    });
    return () => { alive = false; };
  }, [stationId]);

  const wind = reading ? formatAux2mWind(reading) : null;
  if (!wind) return null;

  return (
    <div className="text-[11px] text-slate-400 mt-1.5 leading-snug" data-testid="station-aux-2m">
      <span className="text-slate-300 font-semibold">Viento a 2 m:</span> {wind}
      {' · medido entre cultivos, no es el viento del agua · no entra en los veredictos'}
    </div>
  );
}
