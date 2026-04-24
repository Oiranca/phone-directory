import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./ToastRegion";

const ToastTrigger = ({
  message,
  type,
  durationMs,
  title
}: {
  message: string;
  type?: "success" | "error" | "warning" | "info";
  durationMs?: number;
  title?: string;
}) => {
  const { pushToast } = useToast();
  return (
    <button
      onClick={() => pushToast({ message, type, durationMs, title })}
    >
      Push toast
    </button>
  );
};

const renderWithProvider = (
  props: Parameters<typeof ToastTrigger>[0] = { message: "Hello" }
) =>
  render(
    <ToastProvider>
      <ToastTrigger {...props} />
    </ToastProvider>
  );

describe("ToastRegion", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("pushToast adds a toast visible in DOM", () => {
    renderWithProvider({ message: "Toast appeared" });
    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    expect(screen.getByText("Toast appeared")).toBeInTheDocument();
  });

  it("auto-dismiss removes toast after durationMs", () => {
    vi.useFakeTimers();
    renderWithProvider({ message: "Auto gone", durationMs: 1000 });
    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    expect(screen.getByText("Auto gone")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1001); });
    expect(screen.queryByText("Auto gone")).not.toBeInTheDocument();
  });

  it("dismiss button removes the toast", () => {
    renderWithProvider({ message: "Manual dismiss" });
    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    expect(screen.getByText("Manual dismiss")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar notificación" }));
    expect(screen.queryByText("Manual dismiss")).not.toBeInTheDocument();
  });

  it("info toast uses role=status", () => {
    renderWithProvider({ message: "Info msg", type: "info" });
    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("success toast uses role=status", () => {
    renderWithProvider({ message: "OK", type: "success" });
    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("error toast uses role=alert", () => {
    renderWithProvider({ message: "Err", type: "error" });
    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("warning toast uses role=alert", () => {
    renderWithProvider({ message: "Warn", type: "warning" });
    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("empty region renders no ARIA landmark when no toasts", () => {
    render(<ToastProvider><div /></ToastProvider>);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("useToast outside ToastProvider throws descriptive error", () => {
    const Broken = () => {
      useToast();
      return null;
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Broken />)).toThrow("useToast must be used within ToastProvider.");
    spy.mockRestore();
  });

  it("multiple toasts stack and each dismisses independently", () => {
    vi.useFakeTimers();
    const MultiTrigger = () => {
      const { pushToast } = useToast();
      return (
        <>
          <button onClick={() => pushToast({ message: "Toast A", durationMs: 2000 })}>A</button>
          <button onClick={() => pushToast({ message: "Toast B", durationMs: 5000 })}>B</button>
        </>
      );
    };

    render(
      <ToastProvider>
        <MultiTrigger />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.click(screen.getByRole("button", { name: "B" }));

    expect(screen.getByText("Toast A")).toBeInTheDocument();
    expect(screen.getByText("Toast B")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(2001); });
    expect(screen.queryByText("Toast A")).not.toBeInTheDocument();
    expect(screen.getByText("Toast B")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByText("Toast B")).not.toBeInTheDocument();
  });
});
