export * from "./types";
export * from "./events";
export * from "./voice-agent";
export * from "./pg-operator";
export * from "./voice-agent-pg";
export * from "./pg-listing-score";
export * from "./pg-operations";
export * from "./admin-leads";
export * from "./admin-homes";
export * from "./user-name";

// ── Bundler-safe explicit re-exports for RUNTIME (value) exports ──────────────
// A barrel `export *` compiles (CommonJS) to TypeScript's `__exportStar`, a
// runtime loop that bundlers (webpack/SWC, used by Next.js via transpilePackages)
// cannot statically analyze. Named value imports through it resolve to
// `undefined` at runtime — e.g. `computePgListingScore is not a function`.
// Re-exporting the *values* explicitly compiles to `Object.defineProperty(
// exports, "name", { get })`, which bundlers DO resolve. The type-only modules
// above are erased before bundling, so their `export *` is harmless.
export { computePgListingScore } from "./pg-listing-score";
export { pgEvents, analyticsEvents } from "./events";
export {
  normalizeFullName,
  validateFullName,
  FullNameSchema,
  NAME_FIXTURES,
  FULL_NAME_MIN,
  FULL_NAME_MAX
} from "./user-name";
export type { FullNameErrorCode } from "./user-name";
