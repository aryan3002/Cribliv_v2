import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// next/dynamic → resolve the loader synchronously enough for findBy*.
vi.mock("next/dynamic", () => ({
  default: (loader: any) => {
    let Loaded: any = null;
    return function Dyn(props: any) {
      const [, force] = React.useReducer((x: number) => x + 1, 0);
      React.useEffect(() => {
        if (!Loaded)
          loader().then((m: any) => {
            Loaded = m.default ?? m;
            force();
          });
      }, []);
      return Loaded ? React.createElement(Loaded, props) : null;
    };
  }
}));

// Entry chooser → expose the two callbacks as buttons.
vi.mock("../PgCaptureEntry", () => ({
  default: ({ onManual, onVoice }: any) => (
    <div>
      <button onClick={onManual}>manual</button>
      <button onClick={onVoice}>voice</button>
    </div>
  )
}));
vi.mock("../PgVoiceListingFlow", () => ({
  default: (p: any) => <div data-testid="voice-flow">{p.locale}</div>
}));
vi.mock("@/components/pg-operator/voice/PgVoiceOrb", () => ({ default: () => null }));
vi.mock("@/lib/pg-funnel", () => ({ trackPgFunnel: vi.fn(), setPgFunnelToken: vi.fn() }));
vi.mock("@/lib/pg-operator-api", () => ({ putPgDraft: vi.fn(), getPgDraft: vi.fn() }));
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: any) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: any) => <div {...rest}>{children}</div>
    }
  )
}));

import PgWizardClient from "../PgWizardClient";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("PgWizardClient voice routing (Task 4)", () => {
  it("renders the voice-first flow when 'Talk to list' is chosen", async () => {
    render(<PgWizardClient locale="en" accessToken="tok" operatorUserId="op-1" />);
    expect(screen.queryByTestId("voice-flow")).toBeNull();
    fireEvent.click(screen.getByText("voice"));
    const flow = await screen.findByTestId("voice-flow");
    expect(flow.textContent).toBe("en");
  });
});
