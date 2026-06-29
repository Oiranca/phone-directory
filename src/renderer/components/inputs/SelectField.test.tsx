import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectField } from "./SelectField";

const renderSelectField = (props = {}) => {
  const onChange = vi.fn();
  const defaultOptions = [{ value: "internal", label: "Interno" }, { value: "external", label: "Externo" }];
  
  const utils = render(
    <div>
      <SelectField
        id="kind"
        label="Tipo"
        onChange={onChange}
        options={defaultOptions}
        value={defaultOptions[0].value}
        {...props}
      />
      <button type="button">Outside</button>
    </div>
  );

  return { ...utils, onChange };
};

describe("SelectField", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not open or navigate when no options are available", () => {
    renderSelectField({ options: [] });

    const trigger = screen.getByLabelText("Tipo");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes the listbox when focus leaves the component", () => {
    renderSelectField();

    const trigger = screen.getByLabelText("Tipo");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.blur(trigger, { relatedTarget: screen.getByRole("button", { name: "Outside" }) });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("announces the active option with aria-activedescendant while navigating", () => {
    renderSelectField();

    const trigger = screen.getByLabelText("Tipo");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger).toHaveAttribute("aria-activedescendant", "kind-listbox-option-0");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger).toHaveAttribute("aria-activedescendant", "kind-listbox-option-1");
  });

  it("only points aria-controls at the listbox while open", () => {
    renderSelectField();

    const trigger = screen.getByLabelText("Tipo");
    expect(trigger).not.toHaveAttribute("aria-controls");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-controls", "kind-listbox");
  });

  it("renders helper text and associates it with the trigger", () => {
    renderSelectField({ helperText: "Choose carefully" });
    
    const trigger = screen.getByLabelText("Tipo");
    const hint = screen.getByText("Choose carefully");
    
    expect(hint).toHaveAttribute("id", "kind-hint");
    expect(trigger).toHaveAttribute("aria-describedby", expect.stringContaining("kind-hint"));
  });

  it("renders error text, associates it with the trigger, and sets aria-invalid", () => {
    renderSelectField({ errorText: "Selection required", invalid: true });
    
    const trigger = screen.getByLabelText("Tipo");
    const error = screen.getByText("Selection required");
    
    expect(error).toHaveAttribute("id", "kind-error");
    expect(trigger).toHaveAttribute("aria-describedby", expect.stringContaining("kind-error"));
    expect(trigger).toHaveAttribute("aria-invalid", "true");
  });

  it("trigger uses focus-visible ring instead of plain focus ring (WCAG 2.4.7)", () => {
    renderSelectField();
    const trigger = screen.getByLabelText("Tipo");
    // focus-visible:ring-2 must be present so the ring only shows on keyboard focus
    expect(trigger.className).toContain("focus-visible:ring-2");
    // plain focus:ring-2 must NOT be present to avoid ring on mouse click
    expect(trigger.className).not.toContain("focus:ring-2");
  });

  it("invalid trigger also uses focus-visible:ring-2 (WCAG 2.4.7, security LOW-1)", () => {
    renderSelectField({ invalid: true });
    const trigger = screen.getByLabelText("Tipo");
    // ring size must be explicit even in the invalid branch
    expect(trigger.className).toContain("focus-visible:ring-2");
    expect(trigger.className).not.toContain("focus:ring-2");
  });

  it("disables the trigger and prevents interaction when disabled is true", () => {
    const { onChange } = renderSelectField({ disabled: true });
    
    const trigger = screen.getByLabelText("Tipo");
    expect(trigger).toBeDisabled();
    
    fireEvent.click(trigger);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
