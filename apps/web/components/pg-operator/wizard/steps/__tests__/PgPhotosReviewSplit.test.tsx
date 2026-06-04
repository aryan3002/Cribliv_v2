import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useReducer } from "react";

vi.mock("@/lib/pg-operator-api", () => ({
  createPgListing: vi.fn()
}));
vi.mock("@/lib/owner-api", () => ({
  presignListingPhotos: vi.fn(),
  completeListingPhotos: vi.fn()
}));
vi.mock("@/lib/pg-funnel", () => ({
  trackPgFunnel: vi.fn()
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgPhotosStep from "../PgPhotosStep";
import PgReviewStep from "../PgReviewStep";

function H({ Comp }: { Comp: any }) {
  const [state, dispatch] = useReducer(pgWizardReducer, initialPgWizardState());
  return <Comp state={state} dispatch={dispatch} locale="en" accessToken="t" />;
}

describe("Photos/Review split", () => {
  it("PhotosStep renders the uploader without the submit button", () => {
    render(<H Comp={PgPhotosStep} />);
    expect(screen.queryByRole("button", { name: /submit for review/i })).toBeNull();
  });
  it("ReviewStep renders the submit affordance", () => {
    render(<H Comp={PgReviewStep} />);
    expect(screen.getByRole("button", { name: /submit for review/i })).toBeInTheDocument();
  });
});
