import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/admin-api", () => ({
  fetchSeoCopyForPath: vi.fn(),
  upsertSeoCopyOverride: vi.fn(),
  deleteSeoCopyOverride: vi.fn(),
  revalidateSeoPaths: vi.fn()
}));

import { SeoCopyEditModal } from "../SeoCopyEditModal";
import {
  deleteSeoCopyOverride,
  fetchSeoCopyForPath,
  revalidateSeoPaths,
  upsertSeoCopyOverride
} from "../../../../lib/admin-api";

const mockedFetch = vi.mocked(fetchSeoCopyForPath);
const mockedUpsert = vi.mocked(upsertSeoCopyOverride);
const mockedDelete = vi.mocked(deleteSeoCopyOverride);
const mockedRevalidate = vi.mocked(revalidateSeoPaths);

const LOCALITY = { slug: "gomti-nagar", name_en: "Gomti Nagar", name_hi: "गोमती नगर" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetch.mockResolvedValue({
    h1: "Live H1",
    meta_title: "Live MT",
    meta_description: "Live MD",
    intro_paragraph: "Live intro",
    nearby_blurb: "Live nearby",
    faq_items: [{ q: "Q1", a: "A1" }]
  });
  mockedUpsert.mockResolvedValue({ page_path: "/city/lucknow/gomti-nagar", locale: "en" });
  mockedDelete.mockResolvedValue({ page_path: "/city/lucknow/gomti-nagar", locale: "en" });
  mockedRevalidate.mockResolvedValue();
});

function renderModal(overrides: Record<string, unknown> = {}) {
  const props = {
    accessToken: "tok",
    citySlug: "lucknow",
    locality: LOCALITY,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    onToast: vi.fn(),
    ...overrides
  };
  render(<SeoCopyEditModal {...props} />);
  return props;
}

describe("SeoCopyEditModal", () => {
  it("prefills the h1 field from the currently stored copy", async () => {
    renderModal();
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith("/city/lucknow/gomti-nagar", "en")
    );
    const h1 = (await screen.findByLabelText(/^h1$/i)) as HTMLInputElement;
    expect(h1.value).toBe("Live H1");
  });

  it("saves an override with the edited fields, revalidates, and closes", async () => {
    const props = renderModal();
    const h1 = await screen.findByLabelText(/^h1$/i);
    fireEvent.change(h1, { target: { value: "Edited H1" } });

    fireEvent.click(screen.getByRole("button", { name: /^save/i }));

    await waitFor(() => expect(mockedUpsert).toHaveBeenCalled());
    const [token, payload] = mockedUpsert.mock.calls[0];
    expect(token).toBe("tok");
    expect(payload).toMatchObject({
      citySlug: "lucknow",
      localitySlug: "gomti-nagar",
      locale: "en",
      copy: expect.objectContaining({ h1: "Edited H1" })
    });
    expect(mockedRevalidate).toHaveBeenCalled();
    expect(props.onSaved).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it("reverts (deletes) the override for the current locale", async () => {
    const props = renderModal();
    await screen.findByLabelText(/^h1$/i);

    fireEvent.click(screen.getByRole("button", { name: /revert/i }));

    await waitFor(() =>
      expect(mockedDelete).toHaveBeenCalledWith("tok", "/city/lucknow/gomti-nagar", "en")
    );
    expect(props.onSaved).toHaveBeenCalled();
  });

  it("loads the Hindi copy when the HI locale is selected", async () => {
    renderModal();
    await screen.findByLabelText(/^h1$/i);

    fireEvent.click(screen.getByRole("button", { name: /^hi$/i }));

    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith("/city/lucknow/gomti-nagar", "hi")
    );
  });
});
