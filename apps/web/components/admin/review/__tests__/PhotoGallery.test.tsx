import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhotoGallery } from "../PhotoGallery";

describe("PhotoGallery", () => {
  it("renders an empty state with no photos", () => {
    render(<PhotoGallery photos={[]} />);
    expect(screen.getByText(/no photos/i)).toBeInTheDocument();
  });

  it("shows a cover badge and opens the lightbox on click", () => {
    render(
      <PhotoGallery
        photos={[
          {
            url: "https://img/1.jpg",
            is_cover: true,
            sort_order: 0,
            moderation_status: "approved"
          },
          { url: "https://img/2.jpg", is_cover: false, sort_order: 1, moderation_status: "pending" }
        ]}
      />
    );
    expect(screen.getByText("COVER")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    const imgs = screen.getAllByRole("img");
    fireEvent.click(imgs[0]);
    expect(screen.getByTestId("photo-lightbox")).toBeInTheDocument();
  });
});
