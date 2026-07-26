import {
  buildOwnersPanel,
  buildPgPanel,
  buildRentPanel,
  buildTimesPanel,
  cityChipLinks,
  type NavLocale,
  type NavPanel
} from "./nav-model";
import type { NavLink } from "./localities";

/**
 * SERVER-SIDE ONLY. This module value-imports nav-model.ts, and behind that
 * sit the intent registry, the rent/PG city prose and the Lucknow
 * micro-locality seed — roughly 46 KB. The header renders in the root layout,
 * so a client component importing this would put all of it in the bundle for
 * every route on the site. `app/[locale]/layout.tsx` (a Server Component) is
 * the only place that may call buildNavData; the result travels to the header
 * as a plain serializable prop. Client components import lib/nav/types.ts
 * instead, which is type-only and therefore erased.
 */

/**
 * The city the nav assumes when nobody says otherwise.
 *
 * A root layout cannot know the current city without headers(), which would
 * opt every page out of static rendering — the exact cost this whole design
 * exists to avoid. Lucknow is right for the homepage, /search, /pg and every
 * Lucknow route, which is where essentially all inventory and traffic are.
 * Per-city panels on /city/{other} are a follow-up: those pages pass an
 * override down rather than the layout turning dynamic.
 */
export const DEFAULT_NAV_CITY = "lucknow";

export interface NavData {
  rent: NavPanel;
  pg: NavPanel;
  owners: NavPanel;
  times: NavPanel;
  cities: NavLink[];
}

/** Everything the header needs, assembled in one synchronous pass. */
export function buildNavData(locale: NavLocale, citySlug: string = DEFAULT_NAV_CITY): NavData {
  return {
    rent: buildRentPanel(locale, citySlug),
    pg: buildPgPanel(locale, citySlug),
    owners: buildOwnersPanel(locale),
    times: buildTimesPanel(locale),
    cities: cityChipLinks(locale)
  };
}
