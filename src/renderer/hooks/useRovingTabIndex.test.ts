import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { useRovingTabIndex } from "./useRovingTabIndex";

/**
 * Builds a minimal fake React.KeyboardEvent<HTMLElement> — enough for
 * useRovingTabIndex's handler, which only reads `event.key`, `event.target`,
 * and calls `event.preventDefault()`.
 */
const makeKeyDownEvent = (key: string, target?: HTMLElement): KeyboardEvent<HTMLElement> => {
  const preventDefault = vi.fn();
  return {
    key,
    target: target ?? null,
    preventDefault
  } as unknown as KeyboardEvent<HTMLElement>;
};

const makeTargetWithId = (id: string, attribute = "data-record-id"): HTMLElement => {
  const el = document.createElement("button");
  el.setAttribute(attribute, id);
  return el;
};

describe("useRovingTabIndex", () => {
  it("ArrowDown moves to the next item, wrapping at the end (default keys, DirectoryPage semantics)", () => {
    const { result } = renderHook(() => useRovingTabIndex({ enableHomeEnd: true }));
    const onNavigate = vi.fn();

    result.current(makeKeyDownEvent("ArrowDown", makeTargetWithId("c")), {
      itemIds: ["a", "b", "c"],
      fallbackId: null,
      onNavigate
    });

    expect(onNavigate).toHaveBeenCalledWith("a");
  });

  it("ArrowUp moves to the previous item, wrapping at the start", () => {
    const { result } = renderHook(() => useRovingTabIndex());
    const onNavigate = vi.fn();

    result.current(makeKeyDownEvent("ArrowUp", makeTargetWithId("a")), {
      itemIds: ["a", "b", "c"],
      fallbackId: null,
      onNavigate
    });

    expect(onNavigate).toHaveBeenCalledWith("c");
  });

  it("falls back to fallbackId's index when the event target has no matching id (DirectoryPage semantics)", () => {
    const { result } = renderHook(() => useRovingTabIndex());
    const onNavigate = vi.fn();
    // Target has no data-record-id attribute at all — e.g. Escape refocus case.
    const strayTarget = document.createElement("div");

    result.current(makeKeyDownEvent("ArrowDown", strayTarget), {
      itemIds: ["a", "b", "c"],
      fallbackId: "b",
      onNavigate
    });

    // Falls back to "b" (index 1), then moves to the next item: "c".
    expect(onNavigate).toHaveBeenCalledWith("c");
  });

  it("falls back straight to index 0 when no fallbackId is given (DeduplicatePage semantics)", () => {
    const { result } = renderHook(() =>
      useRovingTabIndex({ previousKeys: ["ArrowUp", "ArrowLeft"], nextKeys: ["ArrowDown", "ArrowRight"] })
    );
    const onNavigate = vi.fn();
    const strayTarget = document.createElement("div");

    result.current(makeKeyDownEvent("ArrowRight", strayTarget), {
      itemIds: ["recordA", "recordB"],
      // No fallbackId passed at all (DeduplicatePage's radiogroup never had one).
      onNavigate
    });

    // Falls back to index 0 ("recordA"), then moves to the next item: "recordB".
    expect(onNavigate).toHaveBeenCalledWith("recordB");
  });

  it("supports a second set of previous/next keys (ArrowLeft/ArrowRight) alongside Up/Down", () => {
    const { result } = renderHook(() =>
      useRovingTabIndex({ previousKeys: ["ArrowUp", "ArrowLeft"], nextKeys: ["ArrowDown", "ArrowRight"] })
    );
    const onNavigate = vi.fn();

    result.current(makeKeyDownEvent("ArrowLeft", makeTargetWithId("recordB")), {
      itemIds: ["recordA", "recordB"],
      onNavigate
    });

    expect(onNavigate).toHaveBeenCalledWith("recordA");
  });

  it("Home/End are no-ops unless enableHomeEnd is set", () => {
    const { result } = renderHook(() => useRovingTabIndex());
    const onNavigate = vi.fn();

    result.current(makeKeyDownEvent("Home", makeTargetWithId("b")), {
      itemIds: ["a", "b", "c"],
      onNavigate
    });

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("Home jumps to the first item and End jumps to the last when enableHomeEnd is set", () => {
    const { result } = renderHook(() => useRovingTabIndex({ enableHomeEnd: true }));
    const onNavigate = vi.fn();

    result.current(makeKeyDownEvent("Home", makeTargetWithId("b")), {
      itemIds: ["a", "b", "c"],
      onNavigate
    });
    expect(onNavigate).toHaveBeenCalledWith("a");

    onNavigate.mockClear();
    result.current(makeKeyDownEvent("End", makeTargetWithId("b")), {
      itemIds: ["a", "b", "c"],
      onNavigate
    });
    expect(onNavigate).toHaveBeenCalledWith("c");
  });

  it("calls onEnter without calling preventDefault (native button activation must proceed)", () => {
    const { result } = renderHook(() => useRovingTabIndex());
    const onNavigate = vi.fn();
    const onEnter = vi.fn();
    const event = makeKeyDownEvent("Enter", makeTargetWithId("a"));

    result.current(event, { itemIds: ["a", "b"], onNavigate, onEnter });

    expect(onEnter).toHaveBeenCalledWith(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("calls onEscape and calls preventDefault when onEscape is provided", () => {
    const { result } = renderHook(() => useRovingTabIndex());
    const onNavigate = vi.fn();
    const onEscape = vi.fn();
    const event = makeKeyDownEvent("Escape", makeTargetWithId("a"));

    result.current(event, { itemIds: ["a", "b"], onNavigate, onEscape });

    expect(onEscape).toHaveBeenCalledWith(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("Escape is a no-op (no preventDefault) when onEscape is not provided", () => {
    const { result } = renderHook(() => useRovingTabIndex());
    const onNavigate = vi.fn();
    const event = makeKeyDownEvent("Escape", makeTargetWithId("a"));

    result.current(event, { itemIds: ["a", "b"], onNavigate });

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("does nothing when itemIds is empty", () => {
    const { result } = renderHook(() => useRovingTabIndex());
    const onNavigate = vi.fn();
    const event = makeKeyDownEvent("ArrowDown");

    result.current(event, { itemIds: [], onNavigate });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("supports a custom dataAttribute", () => {
    const { result } = renderHook(() => useRovingTabIndex());
    const onNavigate = vi.fn();
    const target = makeTargetWithId("x", "data-option-id");

    result.current(makeKeyDownEvent("ArrowDown", target), {
      itemIds: ["x", "y"],
      onNavigate,
      dataAttribute: "data-option-id"
    });

    expect(onNavigate).toHaveBeenCalledWith("y");
  });
});
