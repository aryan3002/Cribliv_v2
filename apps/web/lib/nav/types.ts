/**
 * Type-only re-exports for the nav's client components.
 *
 * Client components may import these freely — `export type` emits no runtime
 * code. They must NOT value-import nav-model.ts or any of its data sources
 * (rent-city-content, pg-city-content, intents.json, micro-localities.json):
 * the header renders on every route, so that would pull ~46 KB of city prose
 * and FAQs into the client bundle site-wide.
 */
export type { NavLink } from "./localities";
export type { NavColumn, NavPanel, NavLocale } from "./nav-model";
