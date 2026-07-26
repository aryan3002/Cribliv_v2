import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// @testing-library/react's internal `asyncWrapper` (wraps every async
// userEvent call and RTL's own `waitFor`) drains a microtask queue after the
// action by awaiting `setTimeout(resolve, 0)`, and only advances fake timers
// for that wait when its own `jestFakeTimersAreEnabled()` check passes — see
// node_modules/@testing-library/react/dist/pure.js. That check looks for a
// global `jest` object; it has no idea Vitest exists. Vitest's fake timers
// are built on the same @sinonjs/fake-timers engine Jest's "modern" fake
// timers use, so the `setTimeout.clock` marker that check inspects is already
// present once `vi.useFakeTimers()` is active — the only missing piece is the
// global `jest` reference itself. Without this shim, any test that mixes
// `vi.useFakeTimers()` with `userEvent` or `waitFor` hangs forever (verified:
// a bare `userEvent.click()` on a plain button times out at the harness
// default with fake timers on, and resolves immediately with this shim in
// place). The shim is inert otherwise: `jestFakeTimersAreEnabled()` also
// checks that `setTimeout` currently carries that marker, which is only true
// while fake timers are actually active, so real-timer tests are unaffected.
if (typeof (globalThis as { jest?: unknown }).jest === "undefined") {
  (globalThis as { jest?: { advanceTimersByTime: (ms: number) => unknown } }).jest = {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms)
  };
}
