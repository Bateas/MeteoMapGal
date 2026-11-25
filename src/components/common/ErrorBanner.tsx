import { useWeatherStore } from '../../store/weatherStore';

export function ErrorBanner() {
  const error = useWeatherStore((s) => s.error);

  if (!error) return null;

  return (
    <div className="gc-errorline" role="alert">
      {error}
    </div>
  );
}
