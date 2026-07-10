import { teamColor, tireColor } from "./constants";

test("returns known team colors", () => {
  expect(teamColor("Ferrari")).toBe("#E8002D");
  expect(teamColor("Mercedes")).toBe("#27F4D2");
});

test("falls back to a neutral gray for unknown teams", () => {
  expect(teamColor("Some New Team")).toBe("#4b5563");
});

test("returns known tire compound colors", () => {
  expect(tireColor("SOFT")).toBe("#e10600");
  expect(tireColor("medium")).toBe("#f7d417"); // case-insensitive
});

test("falls back to a neutral gray for unknown compounds", () => {
  expect(tireColor("UNKNOWN")).toBe("#6b7280");
});
