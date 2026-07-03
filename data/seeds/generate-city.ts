/**
 * CLI: draft -> verify -> emit city seed data (localities, micro-localities,
 * landmarks) using Azure OpenAI + Google Geocoding.
 *
 * Usage: generate-city --city <slug>
 *
 * Safety:
 *  - NEVER touches the DB or seo_city_config. Only reads/writes JSON files
 *    under data/seeds/.
 *  - Aborts (exit 1, no file writes) on GeocodeAbortError (Google key denied
 *    or throttled) so a bad key never silently produces empty output.
 *  - Aborts (exit 1, no file writes) if more than 30% of drafted candidates
 *    were dropped as unverifiable, so a throttled/misconfigured run never
 *    overwrites good committed JSON with a mostly-empty result.
 */

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");
const { createRequire } = require("module") as typeof import("module");

const seedDir = __dirname;
const repoRoot = path.resolve(seedDir, "../..");
const requireFromApi = createRequire(path.resolve(repoRoot, "apps/api/package.json"));

const dotenv = requireFromApi("dotenv");
dotenv.config({ path: path.resolve(repoRoot, ".env") });
dotenv.config({ path: path.resolve(repoRoot, "apps/api/.env") });

import {
  readAiConfig,
  draftCity,
  buildCityFiles,
  verifyPlace,
  GeocodeAbortError,
  type VerifiedPlace,
  type LocalityOut,
  type MicroLocalityOut,
  type LandmarkOut,
} from "./generate-city-helpers";

const DROP_RATIO_ABORT_THRESHOLD = 0.3;

interface CityMeta {
  slug: string;
  name_en: string;
  name_hi: string;
  state_en: string;
  state_hi: string;
}

function parseArgs(argv: string[]): { city: string | null } {
  let city: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--city") {
      city = argv[i + 1] ?? null;
      i++;
    } else if (argv[i]?.startsWith("--city=")) {
      city = argv[i].slice("--city=".length);
    }
  }
  return { city };
}

function printUsage(): void {
  console.error("Usage: generate-city --city <slug>");
  console.error("  e.g. pnpm generate:city --city noida");
}

function loadCityMeta(citySlug: string): CityMeta | null {
  const citiesPath = path.join(seedDir, "cities.json");
  const cities = JSON.parse(fs.readFileSync(citiesPath, "utf8")) as CityMeta[];
  return cities.find((c) => c.slug === citySlug) ?? null;
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** Replaces only rows whose city_slug === citySlug; leaves all other cities' rows untouched. */
function mergeLocalities(
  existing: LocalityOut[],
  citySlug: string,
  fresh: LocalityOut[]
): LocalityOut[] {
  const others = existing.filter((row) => row.city_slug !== citySlug);
  return [...others, ...fresh];
}

async function main(): Promise<void> {
  const { city: citySlug } = parseArgs(process.argv.slice(2));
  if (!citySlug) {
    printUsage();
    process.exit(1);
    return;
  }

  const cityMeta = loadCityMeta(citySlug);
  if (!cityMeta) {
    console.error(`City "${citySlug}" not found in data/seeds/cities.json`);
    process.exit(1);
    return;
  }

  const aiConfig = readAiConfig();
  if (!aiConfig.endpoint || !aiConfig.apiKey || !aiConfig.deployment) {
    console.error(
      "Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and " +
        "AZURE_OPENAI_CHAT_DEPLOYMENT (or AZURE_OPENAI_EXTRACT_DEPLOYMENT)."
    );
    process.exit(1);
    return;
  }

  const googleKey = process.env.GOOGLE_MAPS_APIKEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!googleKey) {
    console.error("Google Maps is not configured. Set GOOGLE_MAPS_APIKEY (or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).");
    process.exit(1);
    return;
  }

  console.log(`Drafting candidates for ${cityMeta.name_en}, ${cityMeta.state_en} via Azure OpenAI...`);
  const draft = await draftCity(cityMeta.name_en, cityMeta.state_en, aiConfig);

  const totalCandidates =
    draft.localities.length + draft.micro_localities.length + draft.landmarks.length;
  if (totalCandidates === 0) {
    console.error("AI draft returned zero candidates. Aborting without writing any files.");
    process.exit(1);
    return;
  }

  console.log(
    `Draft: ${draft.localities.length} localities, ${draft.micro_localities.length} micro-localities, ${draft.landmarks.length} landmarks. Verifying against Google Geocoding...`
  );

  const verify = (query: string): Promise<VerifiedPlace | null> => verifyPlace(query, googleKey);

  let result: { localities: LocalityOut[]; micro_localities: MicroLocalityOut[]; landmarks: LandmarkOut[]; dropped: string[] };
  try {
    result = await buildCityFiles(cityMeta.name_en, cityMeta.state_en, citySlug, draft, verify);
  } catch (err) {
    if (err instanceof GeocodeAbortError) {
      console.error(`Google Geocoding aborted (status: ${err.status}). Aborting without writing any files.`);
      process.exit(1);
      return;
    }
    throw err;
  }

  for (const key of result.dropped) {
    console.log(`Dropped (unverified): ${key}`);
  }

  const dropRatio = result.dropped.length / totalCandidates;
  if (dropRatio > DROP_RATIO_ABORT_THRESHOLD) {
    console.error(
      `Drop ratio ${(dropRatio * 100).toFixed(1)}% exceeds ${DROP_RATIO_ABORT_THRESHOLD * 100}% threshold ` +
        `(${result.dropped.length}/${totalCandidates} dropped). Aborting without writing any files — ` +
        "this usually means the Google key is throttled/misconfigured or the AI draft was low quality."
    );
    process.exit(1);
    return;
  }

  const cityDir = path.join(seedDir, citySlug);
  writeJsonFile(path.join(cityDir, "micro-localities.json"), result.micro_localities);
  writeJsonFile(path.join(cityDir, "landmarks.json"), result.landmarks);

  const localitiesPath = path.join(seedDir, "localities.json");
  const existingLocalities = fs.existsSync(localitiesPath)
    ? (JSON.parse(fs.readFileSync(localitiesPath, "utf8")) as LocalityOut[])
    : [];
  const mergedLocalities = mergeLocalities(existingLocalities, citySlug, result.localities);
  writeJsonFile(localitiesPath, mergedLocalities);

  console.log(
    `Wrote ${result.localities.length} localities, ${result.micro_localities.length} micro-localities, ${result.landmarks.length} landmarks for "${citySlug}".`
  );
  console.log("REVIEW THE GIT DIFF before committing.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
