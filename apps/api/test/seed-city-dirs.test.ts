import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedCityProbe, listSeedCityDirs } from "../../../data/seeds/seed-helpers";

// Builds a real temp directory that mirrors the shape of data/seeds/<city>/:
//   lucknow/landmarks.json          — a city dir with only landmarks
//   noida/micro-localities.json     — a city dir with only micro-localities
//   emptycity/                      — an empty dir (no seed files) — must be excluded
//   cities.json                     — a stray top-level file, not a directory — must be excluded
describe("listSeedCityDirs (real fs fixture)", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "cribliv-seed-city-dirs-"));

  mkdirSync(join(tmpDir, "lucknow"));
  writeFileSync(join(tmpDir, "lucknow", "landmarks.json"), "[]");

  mkdirSync(join(tmpDir, "noida"));
  writeFileSync(join(tmpDir, "noida", "micro-localities.json"), "[]");

  mkdirSync(join(tmpDir, "emptycity"));

  writeFileSync(join(tmpDir, "cities.json"), "[]");

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns exactly the city dirs that hold micro-localities.json or landmarks.json", () => {
    const result = listSeedCityDirs(
      tmpDir,
      ["lucknow", "noida", "emptycity", "cities.json"],
      seedCityProbe
    );
    expect(result).toEqual(["lucknow", "noida"]);
  });

  it("defaults to the real seedCityProbe when no probe is passed", () => {
    const result = listSeedCityDirs(tmpDir, ["lucknow", "noida", "emptycity", "cities.json"]);
    expect(result).toEqual(["lucknow", "noida"]);
  });
});
