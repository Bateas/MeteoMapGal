import { useWeatherStore } from '../../store/weatherStore';

export function ErrorBanner() {
  const error = useWeatherStore((s) => s.error);

  if (!error) return null;

  return (
    <div className="bg-red-900/50 border border-red-700 text-red-200 text-xs px-3 py-2 rounded">
      {error}
    </div>
  );
}
