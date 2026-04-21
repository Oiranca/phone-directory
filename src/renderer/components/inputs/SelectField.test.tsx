import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectField } from "./SelectField";

const renderSelectField = (options = [{ value: "internal", label: "Interno" }]) => {
  const onChange = vi.fn();

  render(
    <div>
      <SelectField
        id="kind"
        label="Tipo"
        onChange={onChange}
        options={options}
        value={options[0]?.value ?? ""}
      />
      <button type="button">Outside</button>
    </div>
  );

  return { onChange };
};

describe("SelectField", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not open or navigate when no options are available", () => {
    renderSelectField([]);

    const trigger = screen.getByLabelText("Tipo");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes the listbox when focus leaves the component", () => {
    renderSelectField([
      { value: "internal", label: "Interno" },
      { value: "external", label: "Externo" }
    ]);

    const trigger = screen.getByLabelText("Tipo");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.blur(trigger, { relatedTarget: screen.getByRole("button", { name: "Outside" }) });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("announces the active option with aria-activedescendant while navigating", () => {
    renderSelectField([
      { value: "internal", label: "Interno" },
      { value: "external", label: "Externo" }
    ]);

    const trigger = screen.getByLabelText("Tipo");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger).toHaveAttribute("aria-activedescendant", "kind-listbox-option-0");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger).toHaveAttribute("aria-activedescendant", "kind-listbox-option-1");
  });
});
