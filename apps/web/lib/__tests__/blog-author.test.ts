import { describe, expect, it } from "vitest";
import { EDITORIAL_AUTHOR, displayAuthor, isEditorialAuthor, authorPath } from "../blog-author";

describe("editorial author (Cribliv Data Desk)", () => {
  it("recognises both the desk and the legacy persona byline", () => {
    expect(isEditorialAuthor("Cribliv Data Desk")).toBe(true);
    expect(isEditorialAuthor("Aditi Sharma")).toBe(true);
    expect(isEditorialAuthor("Someone Else")).toBe(false);
  });

  it("prints legacy persona bylines as the desk", () => {
    expect(displayAuthor("Aditi Sharma")).toBe(EDITORIAL_AUTHOR.name);
    expect(displayAuthor("Cribliv Data Desk")).toBe("Cribliv Data Desk");
    expect(displayAuthor("Guest Writer")).toBe("Guest Writer");
  });

  it("routes to the desk author page", () => {
    expect(authorPath("en")).toBe("/en/blog/author/cribliv-data-desk");
  });
});
