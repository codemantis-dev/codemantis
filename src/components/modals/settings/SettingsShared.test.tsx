import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionTitle, FieldRow } from "./SettingsShared";

describe("SectionTitle", () => {
  it("renders children text", () => {
    render(<SectionTitle>My Section</SectionTitle>);
    expect(screen.getByText("My Section")).toBeInTheDocument();
  });

  it("renders as an h3 element", () => {
    const { container } = render(<SectionTitle>Title</SectionTitle>);
    const h3 = container.querySelector("h3");
    expect(h3).toBeInTheDocument();
    expect(h3?.textContent).toBe("Title");
  });

  it("applies correct styling classes", () => {
    const { container } = render(<SectionTitle>Styled</SectionTitle>);
    const h3 = container.querySelector("h3");
    expect(h3?.className).toContain("text-text-primary");
    expect(h3?.className).toContain("font-medium");
  });
});

describe("FieldRow", () => {
  it("renders label and children", () => {
    render(
      <FieldRow label="Font Size">
        <input type="number" defaultValue={13} />
      </FieldRow>
    );
    expect(screen.getByText("Font Size")).toBeInTheDocument();
    expect(screen.getByDisplayValue("13")).toBeInTheDocument();
  });

  it("renders the label as a label element", () => {
    const { container } = render(
      <FieldRow label="Test Label">
        <span>child</span>
      </FieldRow>
    );
    const label = container.querySelector("label");
    expect(label).toBeInTheDocument();
    expect(label?.textContent).toBe("Test Label");
  });

  it("wraps content in a flex row", () => {
    const { container } = render(
      <FieldRow label="Layout">
        <span>content</span>
      </FieldRow>
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("flex");
    expect(wrapper?.className).toContain("items-center");
    expect(wrapper?.className).toContain("justify-between");
  });
});
