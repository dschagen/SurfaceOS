import { button, text, rows, columns, grid, rect, inset } from './layout.js';

// Live data from Open-Meteo (no API key; needs internet). Data is licensed CC BY 4.0,
// so the window credits the source.

const REFRESH_MS = 15 * 60 * 1000;

export function weatherIcon(code) {
  if (code <= 1) return 'sun';
  if (code === 2) return 'cloud-sun';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'rain';
}

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

function forecastUrl({ latitude, longitude }) {
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
      const area = inset(rect(0, 0, 1, 1), 0.04);
      const [header, now, forecast, footer] = rows(area, [0.85, 2.6, 2.3, 0.55], 0.035);
      const [placeCell, refreshCell] = columns(header, [3, 1.1], 0.02);
      const widgets = [
        text('place', placeCell, place.name, ['title', 'left']),
        button('refresh', refreshCell, loading ? 'Loading' : 'Refresh', 'ghost', { icon: 'refresh', disabled: loading }),
      ];
      if (!data) {
        widgets.push(text('message', rect(now.x, now.y, now.width, forecast.y + forecast.height - now.y), error || 'Loading weather...', [error ? 'error' : 'muted', 'card']));
        return widgets;
      }

      const current = data.current;
      const [iconCell, temperature, detailsCell] = columns(now, [1, 1.3, 1.6], 0.02);
      const [condition, details] = rows(detailsCell, [1, 1.3], 0.02);
      widgets.push(
        text('now-card', now, '', 'hero'),
        text('now-icon', iconCell, '', 'glyph', { icon: weatherIcon(current.weather_code) }),
        text('temperature', temperature, `${Math.round(current.temperature_2m)}°`, 'huge'),
        text('condition', condition, describeWeather(current.weather_code), ['title', 'left']),
        text('details', details, `Feels like ${Math.round(current.apparent_temperature)}°\nHumidity ${current.relative_humidity_2m}%  ·  Wind ${Math.round(current.wind_speed_10m)} mph`, ['small', 'muted', 'left', 'pre']),
      );

      const daily = data.daily;
      const cell = grid(forecast, 1, daily.time.length, 0.015);
      daily.time.forEach((isoDate, i) => {
        const [y, m, d] = isoDate.split('-').map(Number);
        const label = i === 0 ? 'Today' : new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
        const rain = daily.precipitation_probability_max?.[i];
        const lines = [
          label,
          `${Math.round(daily.temperature_2m_max[i])}° / ${Math.round(daily.temperature_2m_min[i])}°`,
          rain === null || rain === undefined ? '' : `Rain ${rain}%`,
        ].filter(Boolean);
        widgets.push(text(`day-${i}`, cell(0, i), lines.join('\n'), ['forecast', 'small'], { icon: weatherIcon(daily.weather_code[i]) }));
      });

      const updated = fetchedAt ? `Updated ${fetchedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
      widgets.push(text('footer', footer, [error || updated, 'Weather data by Open-Meteo.com'].filter(Boolean).join('   ·   '), ['small', error ? 'error' : 'faint']));
      return widgets;
    },
    handleAction({ widget_id: id }) {
      if (id === 'refresh') load();
    },
  };
}

export default { title: 'Weather', create };
