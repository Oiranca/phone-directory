import { renderHook, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createRef } from "react";
import { useFocusOnMount } from "./useFocusOnMount";

describe("useFocusOnMount", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not focus the element when `when` is falsy", () => {
    const el = document.createElement("button");
    document.body.appendChild(el);
    const ref = createRef<HTMLButtonElement>();
    (ref as { current: HTMLButtonElement | null }).current = el;

    renderHook(({ when }) => useFocusOnMount(ref, when), { initialProps: { when: false } });

    expect(document.activeElement).not.toBe(el);
    document.body.removeChild(el);
  });

  it("focuses the element when `when` is truthy", () => {
    const el = document.createElement("button");
    document.body.appendChild(el);
    const ref = createRef<HTMLButtonElement>();
    (ref as { current: HTMLButtonElement | null }).current = el;

    renderHook(({ when }) => useFocusOnMount(ref, when), { initialProps: { when: true } });

    expect(document.activeElement).toBe(el);
    document.body.removeChild(el);
  });

  it("re-focuses when the (still truthy) `when` value changes identity", () => {
    // Mirrors BeepersPage's "switch from create to edit while form stays open"
    // requirement: `when` stays truthy throughout but its value changes.
    const el = document.createElement("input");
    document.body.appendChild(el);
    const other = document.createElement("input");
    document.body.appendChild(other);
    const ref = createRef<HTMLInputElement>();
    (ref as { current: HTMLInputElement | null }).current = el;

    const { rerender } = renderHook(({ when }) => useFocusOnMount(ref, when), {
      initialProps: { when: "new" as string }
    });
    expect(document.activeElement).toBe(el);

    // Simulate the user moving focus away in between.
    other.focus();
    expect(document.activeElement).toBe(other);

    rerender({ when: "record-123" });
    expect(document.activeElement).toBe(el);

    document.body.removeChild(el);
    document.body.removeChild(other);
  });

  it("does nothing when the ref has no current element", () => {
    const ref = createRef<HTMLButtonElement>();

    expect(() => {
      renderHook(({ when }) => useFocusOnMount(ref, when), { initialProps: { when: true } });
    }).not.toThrow();
  });
});
