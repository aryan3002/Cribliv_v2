// Compile-time type-usage assertions for the availability + waitlist DTOs.
//
// This file is deliberately NOT a vitest runtime test. `packages/shared-types`
// has no runtime behavior to exercise — it's types only — so the real gate is
// `tsc` (the package `build`/`typecheck` script), which actually checks that
// these shapes exist and match. A vitest `expectTypeOf` test would run through
// esbuild's transpile-only pipeline, which strips types before they're ever
// checked, making such a test a no-op that always reports green.
//
// Keep this file under `src/` (picked up by tsconfig's `"include": ["src/**/*"]`)
// so `tsc -p tsconfig.json` fails the build if any of these usages stop
// type-checking — e.g. a renamed field, a narrowed union, or a dropped export.
import type { AvailabilityAlertStatus, AvailabilityAlertResult, WaitlistLead } from "../types";

const _status: AvailabilityAlertStatus = "waiting";
const _result: AvailabilityAlertResult = { status: "ready", already_on_list: false };
const _lead: WaitlistLead = {
  id: "a",
  phone: "+91",
  user_id: null,
  status: "notified",
  created_at: ""
};
void _status;
void _result;
void _lead;
