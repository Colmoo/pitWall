const TEAM_COLORS: Record<string, string> = {
  "Red Bull Racing": "#3671C6",
  "Red Bull": "#3671C6",
  Mercedes: "#27F4D2",
  Ferrari: "#E8002D",
  McLaren: "#FF8000",
  "Aston Martin": "#229971",
  Alpine: "#FF87BC",
  "Alpine F1 Team": "#FF87BC",
  Williams: "#64C4FF",
  RB: "#6692FF",
  AlphaTauri: "#6692FF",
  "RB F1 Team": "#6692FF",
  "Kick Sauber": "#52E252",
  "Alfa Romeo": "#52E252",
  Sauber: "#52E252",
  "Haas F1 Team": "#B6BABD",
  Haas: "#B6BABD",
};

export function teamColor(team: string): string {
  return TEAM_COLORS[team] ?? "#4b5563";
}

const TIRE_COLORS: Record<string, string> = {
  SOFT: "#e10600",
  MEDIUM: "#f7d417",
  HARD: "#f0f0f0",
  INTERMEDIATE: "#43b02a",
  WET: "#0067ad",
};

export function tireColor(compound: string): string {
  return TIRE_COLORS[compound.toUpperCase()] ?? "#6b7280";
}

const COMPARISON_COLORS = ["#3ecbff", "#facc15", "#4ade80", "#f87171", "#a78bfa", "#fb923c"];

export function comparisonColor(index: number): string {
  return COMPARISON_COLORS[index % COMPARISON_COLORS.length];
}

export function formatGap(gap: number | null): string {
  if (gap === null) return "-";
  return gap >= 0 ? `+${gap.toFixed(3)}` : gap.toFixed(3);
}
