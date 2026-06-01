import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useReducer } from "react";

const mocks = vi.hoisted(() => ({
  createPgListing: vi.fn(),
  push: vi.fn()
}));

vi.mock("@/lib/pg-operator-api", () => ({ createPgListing: mocks.createPgListing }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgPhotosReviewStep from "../PgPhotosReviewStep";

beforeEach(() => {
  mocks.createPgListing.mockReset();
  mocks.push.mockReset();
});

function makeValidState() {
  return {
    ...initialPgWizardState(),
    draft: {
      property: { display_name: "Acme PG", city_slug: "blr" } as any,
      pg_details: { total_beds: 10 } as any,
      room_types: [
        { sharing: "double", ac: true, monthly_rent_paise: 800000, vacancy_count: 4 }
      ] as any
    },
    pgPropertyId: "prop-1",
    currentStep: 6
  } as any;
}

function Harness({
  initState,
  accessToken = "tok" as string | null
}: {
  initState?: any;
  accessToken?: string | null;
}) {
  const [state, dispatch] = useReducer(pgWizardReducer, initState ?? initialPgWizardState());
  return (
    <PgPhotosReviewStep state={state} dispatch={dispatch} locale="en" accessToken={accessToken} />
  );
}

describe("PgPhotosReviewStep", () => {
  it("submits with Idempotency-Key + token + strict payload on Publish", async () => {
    mocks.createPgListing.mockResolvedValueOnce({ listing_id: "L-1", status: "draft" });
    render(<Harness initState={makeValidState()} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => expect(mocks.createPgListing).toHaveBeenCalled());
    const args = mocks.createPgListing.mock.calls[0][0];
    expect(args.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(args.token).toBe("tok");
    expect(args.payload.property.display_name).toBe("Acme PG");
    expect(args.payload.property.city_slug).toBe("blr");
    expect((args.payload as any).room_config).toBeUndefined();
    expect((args.payload as any).sharing_options).toBeUndefined();
  });

  it("after publish, navigates to the listing detail page with ?published=1", async () => {
    mocks.createPgListing.mockResolvedValueOnce({ listing_id: "L-1", status: "draft" });
    render(<Harness initState={makeValidState()} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/en/pg-operator/listings/L-1?published=1")
    );
  });

  it("disables Publish when required fields missing", () => {
    render(<Harness initState={{ ...initialPgWizardState(), currentStep: 6 }} />);
    const btn = screen.getByRole("button", { name: /publish/i });
    expect(btn).toBeDisabled();
  });

  it("surfaces 'No property' error with friendly message", async () => {
    const err: any = new Error("no_property: create a pg_property first");
    err.code = "no_property";
    mocks.createPgListing.mockRejectedValueOnce(err);
    render(<Harness initState={makeValidState()} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no property/i));
  });

  it("surfaces generic error message verbatim", async () => {
    mocks.createPgListing.mockRejectedValueOnce(new Error("network down"));
    render(<Harness initState={makeValidState()} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/network down/));
  });

  it("blocks publish without accessToken", async () => {
    render(<Harness initState={makeValidState()} accessToken={null} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/sign in required/i));
    expect(mocks.createPgListing).not.toHaveBeenCalled();
  });

  it("renders the review JSON pre-block showing the would-be payload", () => {
    render(<Harness initState={makeValidState()} />);
    // The <pre> should contain the property name
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toContain("Acme PG");
    expect(pre?.textContent).toContain("blr");
  });

  it("Back returns to step 5", () => {
    const initState = makeValidState();
    function H() {
      const [state, dispatch] = useReducer(pgWizardReducer, initState);
      return (
        <>
          <PgPhotosReviewStep state={state} dispatch={dispatch} locale="en" accessToken="tok" />
          <span data-testid="step">{state.currentStep}</span>
        </>
      );
    }
    render(<H />);
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByTestId("step")).toHaveTextContent("5");
  });
});
