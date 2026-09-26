import { button, text, rows, columns, grid, rect, inset } from './layout.js';

// Live data from Open-Meteo (no API key; needs internet). Data is licensed CC BY 4.0,
// so the window credits the source.

const REFRESH_MS = 15 * 60 * 1000;

// WMO weather interpretation codes used by Open-Meteo.
export function describeWeather(code) {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Unknown';
}

export function forecastUrl({ latitude, longitude }) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    forecast_days: '5',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

function create(ctx) {
  const place = ctx.services.weather;
  let data = null;
  let error = '';
  let loading = false;
  let fetchedAt = null;

  async function load() {
    if (loading) return;
    loading = true;
    error = '';
    ctx.update();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(forecastUrl(place), { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
      fetchedAt = new Date();
    } catch {
      error = data ? 'Could not refresh. Showing the last update.' : 'Could not load weather. Check the internet connection.';
    } finally {
      loading = false;
      ctx.update();
    }
  }

  load();
  ctx.every(REFRESH_MS, load);

  return {
    widgets() {
      const [header, now, details, forecast, footer] = rows(inset(rect(0, 0, 1, 1), 0.035), [0.9, 2, 0.8, 2.4, 0.8], 0.025);
      const [placeCell, refreshCell] = columns(header, [3, 1]);
      const widgets = [
        text('place', placeCell, place.name, ['left', 'bare', 'title']),
        button('refresh', refreshCell, loading ? 'Loading' : 'Refresh', 'ghost', { disabled: loading }),
      ];
      if (!data) {
        widgets.push(text('message', rect(now.x, now.y, now.width, forecast.y + forecast.height - now.y), error || 'Loading weather...', [error ? 'error' : 'muted']));
        return widgets;
      }

      const current = data.current;
      const [temperature, condition] = columns(now, [1, 1.3], 0.02);
      widgets.push(
        text('temperature', temperature, `${Math.round(current.temperature_2m)}°`, ['huge', 'bare']),
        text('condition', condition, describeWeather(current.weather_code), ['large', 'bare', 'left']),
        text('details', details, `Feels ${Math.round(current.apparent_temperature)}°   Humidity ${current.relative_humidity_2m}%   Wind ${Math.round(current.wind_speed_10m)} mph`, ['small', 'muted', 'bare']),
      );

      const daily = data.daily;
      const days = daily.time.length;
      const cell = grid(forecast, 1, days, 0.012);
      daily.time.forEach((isoDate, i) => {
        const [y, m, d] = isoDate.split('-').map(Number);
        const label = i === 0 ? 'Today' : new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
        const rain = daily.precipitation_probability_max?.[i];
        const lines = [
          label,
          describeWeather(daily.weather_code[i]),
          `${Math.round(daily.temperature_2m_max[i])}° / ${Math.round(daily.temperature_2m_min[i])}°`,
          rain === null || rain === undefined ? '' : `Rain ${rain}%`,
        ];
        widgets.push(text(`day-${i}`, cell(0, i), lines.join('\n').trim(), ['pre', 'small']));
      });

      const updated = fetchedAt ? `Updated ${fetchedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
      widgets.push(text('footer', footer, [error || updated, 'Weather data by Open-Meteo.com'].filter(Boolean).join('   '), ['small', 'bare', error ? 'error' : 'muted']));
      return widgets;
    },
    handleAction({ widget_id: id }) {
      if (id === 'refresh') load();
    },
  };
}

export default { title: 'Weather', create };
