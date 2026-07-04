// Pure, importable helpers for data/seeds/seed.ts (which runs on import).
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/** Production probe: is <dir> a directory with micro-localities.json or landmarks.json? */
export function seedCityProbe(dir: string): boolean {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  return existsSync(join(dir, "micro-localities.json")) || existsSync(join(dir, "landmarks.json"));
}

/** City-slug dirs to iterate. candidates are the known slugs from cities.json. */
export function listSeedCityDirs(
  seedDir: string,
  candidates: string[],
  probe: (dir: string) => boolean = seedCityProbe
): string[] {
  return candidates.filter((slug) => probe(join(seedDir, slug)));
}
