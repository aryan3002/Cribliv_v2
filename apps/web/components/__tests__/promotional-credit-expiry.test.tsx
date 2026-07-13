import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PromotionalCreditExpiry } from "../promotional-credit-expiry";

afterEach(cleanup);

describe("PromotionalCreditExpiry", () => {
  it("renders the remaining promotional credits and UTC expiry date in English", () => {
    render(
      <PromotionalCreditExpiry
        remaining={7}
        expiresAt="2026-10-11T23:30:00.000-05:00"
        locale="en"
      />
    );

    expect(screen.getByText("7 promotional credits expire 12 October 2026")).toBeInTheDocument();
  });

  it.each([
    ["zero remaining", 0, "2026-10-11T08:30:00.000Z"],
    ["null expiry", 7, null]
  ])("renders nothing for %s", (_label, remaining, expiresAt) => {
    const { container } = render(
      <PromotionalCreditExpiry remaining={remaining} expiresAt={expiresAt} locale="en" />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders Hindi copy and the UTC-formatted Hindi date", () => {
    render(
      <PromotionalCreditExpiry remaining={10} expiresAt="2026-10-11T08:30:00.000Z" locale="hi" />
    );

    expect(
      screen.getByText("10 प्रमोशनल क्रेडिट 11 अक्टूबर 2026 को समाप्त होंगे")
    ).toBeInTheDocument();
  });
});
