import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HowItWorksPage from "../page";

describe("how it works page", () => {
  it("renders the redesigned seeker journey and primary CTAs", () => {
    render(<HowItWorksPage params={{ locale: "en" }} />);

    expect(screen.getByTestId("how-hero")).toHaveTextContent(
      "Find a verified rental without the broker runaround"
    );
    expect(screen.getByTestId("how-process")).toHaveTextContent("Search in your own words");
    expect(screen.getByTestId("how-process")).toHaveTextContent("Contact the owner directly");
    expect(screen.getAllByTestId("how-process-step")).toHaveLength(3);

    const trust = screen.getByTestId("how-trust");
    expect(trust).toHaveTextContent("Aadhaar-verified owners");
    expect(trust).toHaveTextContent("12-hour response protection");

    const paths = screen.getByTestId("how-audience-paths");
    expect(within(paths).getByRole("link", { name: "Start your search" })).toHaveAttribute(
      "href",
      "/en/search"
    );
    expect(within(paths).getByRole("link", { name: "List your property" })).toHaveAttribute(
      "href",
      "/en/become-owner"
    );

    expect(screen.getByTestId("how-final-cta")).toHaveTextContent(
      "Ready to search with fewer surprises?"
    );
  });

  it("localizes the trust and path sections for Hindi", () => {
    render(<HowItWorksPage params={{ locale: "hi" }} />);

    expect(screen.getByTestId("how-hero")).toHaveTextContent(
      "ब्रोकर की भागदौड़ के बिना सत्यापित किराया खोजें"
    );
    expect(screen.getByTestId("how-trust")).toHaveTextContent("Aadhaar-सत्यापित मालिक");
    expect(screen.getByTestId("how-trust")).toHaveTextContent("12-घंटे प्रतिक्रिया सुरक्षा");
    expect(screen.getByTestId("how-audience-paths")).toHaveTextContent("किरायेदारों के लिए");
    expect(screen.getByRole("link", { name: "सत्यापित किराये खोजें" })).toHaveAttribute(
      "href",
      "/hi/search"
    );
  });
});
