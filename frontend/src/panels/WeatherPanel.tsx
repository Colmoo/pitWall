import type { SessionState } from "../types";

export function WeatherPanel({ state }: { state: SessionState | null }) {
  const weather = state?.weather ?? null;

  if (!weather) {
    return <p>No weather data yet.</p>;
  }

  return (
    <div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Air Temp</div>
        <div className="pitwall-stat-value">{weather.air_temp.toFixed(1)}°C</div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Track Temp</div>
        <div className="pitwall-stat-value">{weather.track_temp.toFixed(1)}°C</div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Humidity</div>
        <div className="pitwall-stat-value">{weather.humidity.toFixed(1)}%</div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Wind</div>
        <div className="pitwall-stat-value">{weather.wind_speed.toFixed(1)} km/h</div>
      </div>
      <div className="pitwall-stat">
        <div className="pitwall-stat-label">Rain</div>
        <div className={`pitwall-stat-value ${weather.rainfall ? "cyan" : ""}`}>
          {weather.rainfall ? "YES" : "NO"}
        </div>
      </div>
    </div>
  );
}
