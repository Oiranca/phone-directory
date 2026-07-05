import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComboboxField } from "./ComboboxField";

const renderComboboxField = (props: Partial<React.ComponentProps<typeof ComboboxField>> = {}) => {
  const onChange = vi.fn();

  const Wrapper = () => {
    const [value, setValue] = useState(props.value ?? "");
    return (
      <div>
        <ComboboxField
          id="custom-field-key"
          label="Nombre del campo"
          value={value}
          suggestions={["Número extranjero", "DNI", "Turno"]}
          onChange={(nextValue: string) => {
            setValue(nextValue);
            onChange(nextValue);
          }}
          {...props}
        />
        <button type="button">Outside</button>
      </div>
    );
  };

  const utils = render(<Wrapper />);
  return { ...utils, onChange };
};

describe("ComboboxField", () => {
  afterEach(() => {
    cleanup();
  });

  it("suggests previously-used keys when focused", () => {
    renderComboboxField();

    const input = screen.getByLabelText("Nombre del campo");
    fireEvent.focus(input);

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Número extranjero" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "DNI" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Turno" })).toBeInTheDocument();
  });

  it("filters suggestions as the user types, but still allows arbitrary new text", () => {
    const { onChange } = renderComboboxField();

    const input = screen.getByLabelText("Nombre del campo");
    fireEvent.change(input, { target: { value: "Num" } });

    expect(onChange).toHaveBeenLastCalledWith("Num");
    expect(screen.getByRole("option", { name: "Número extranjero" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "DNI" })).not.toBeInTheDocument();

    // Typing something that matches no suggestion is still accepted (free text).
    fireEvent.change(input, { target: { value: "Un campo totalmente nuevo" } });
    expect(onChange).toHaveBeenLastCalledWith("Un campo totalmente nuevo");
  });

  it("clicking a suggestion commits its value", () => {
    const { onChange } = renderComboboxField();

    const input = screen.getByLabelText("Nombre del campo");
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole("option", { name: "DNI" }));

    expect(onChange).toHaveBeenLastCalledWith("DNI");
  });

  it("closes the listbox when focus leaves the component", () => {
    renderComboboxField();

    const input = screen.getByLabelText("Nombre del campo");
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.blur(input, { relatedTarget: screen.getByRole("button", { name: "Outside" }) });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("renders error text and sets aria-invalid", () => {
    renderComboboxField({ errorText: "Falta el nombre del campo", invalid: true });

    const input = screen.getByLabelText("Nombre del campo");
    expect(screen.getByText("Falta el nombre del campo")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});
