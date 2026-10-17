import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const rectangle = (left: number, top: number, width: number, height: number) => ({
  bottom: top + height,
  height,
  left,
  right: left + width,
  top,
  width,
  x: left,
  y: top,
  toJSON: () => ({})
}) as DOMRect;

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

  it("keeps one active toast when the same save result is reported twice", () => {
    renderWithProvider({ message: "Configuración guardada.", type: "success" });

    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));

    expect(screen.getAllByText("Configuración guardada.")).toHaveLength(1);
    expect(screen.getAllByRole("status")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar notificación" }));
    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));

    expect(screen.getAllByText("Configuración guardada.")).toHaveLength(1);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("refreshes the lifetime when the same save result is reported again", () => {
    vi.useFakeTimers();
    renderWithProvider({ message: "Configuración guardada.", type: "success" });

    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    act(() => { vi.advanceTimersByTime(4700); });
    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));

    expect(screen.getAllByRole("status")).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(101); });
    expect(screen.getByText("Configuración guardada.")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(4700); });
    expect(screen.queryByText("Configuración guardada.")).not.toBeInTheDocument();
  });

  it("keeps toasts with different titles visible", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Configuración guardada." type="success" title="Directorio" />
        <ToastTrigger message="Configuración guardada." type="success" title="Preferencias" />
      </ToastProvider>
    );

    const triggers = screen.getAllByRole("button", { name: "Push toast" });
    fireEvent.click(triggers[0]);
    fireEvent.click(triggers[1]);

    expect(screen.getByText("Directorio")).toBeInTheDocument();
    expect(screen.getByText("Preferencias")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(2);
  });

  it("dismisses a transient toast that obscures a focused control", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Guardado" type="success" />
        <button type="button">Control cubierto</button>
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    const toast = screen.getByRole("status");
    const control = screen.getByRole("button", { name: "Control cubierto" });
    vi.spyOn(toast, "getBoundingClientRect").mockReturnValue(rectangle(0, 0, 100, 100));
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(rectangle(20, 20, 44, 44));

    act(() => { control.focus(); });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps a persistent alert when it obscures a focused control", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Error persistente" type="error" />
        <button type="button">Control cubierto</button>
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    const toast = screen.getByRole("alert");
    const region = screen.getByLabelText("Notificaciones");
    const control = screen.getByRole("button", { name: "Control cubierto" });
    vi.spyOn(toast, "getBoundingClientRect").mockReturnValue(rectangle(0, 0, 100, 100));
    vi.spyOn(region, "getBoundingClientRect").mockImplementation(() => rectangle(0, Number.parseInt(region.style.top || "0", 10), 100, 100));
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(rectangle(20, 20, 44, 44));

    act(() => { control.focus(); });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(region).toHaveClass("pointer-events-none");
    expect(region).toHaveStyle({ position: "fixed" });
    expect(region.getBoundingClientRect().top).toBeGreaterThanOrEqual(control.getBoundingClientRect().bottom);
  });

  it("positions a persistent alert above a focused control near the viewport bottom", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Error persistente" type="error" />
        <button type="button">Control inferior</button>
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    const toast = screen.getByRole("alert");
    const region = screen.getByLabelText("Notificaciones");
    const control = screen.getByRole("button", { name: "Control inferior" });
    vi.spyOn(toast, "getBoundingClientRect").mockReturnValue(rectangle(0, window.innerHeight - 68, 100, 100));
    vi.spyOn(region, "getBoundingClientRect").mockImplementation(() => {
      const top = region.style.top && region.style.top !== "auto"
        ? Number.parseInt(region.style.top, 10)
        : window.innerHeight - Number.parseInt(region.style.bottom || "0", 10) - 100;
      return rectangle(0, top, 100, 100);
    });
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(rectangle(20, window.innerHeight - 64, 44, 44));

    act(() => { control.focus(); });

    expect(region).toHaveClass("pointer-events-none");
    expect(region).toHaveStyle({ position: "fixed" });
    expect(region.getBoundingClientRect().bottom).toBeLessThanOrEqual(control.getBoundingClientRect().top);
  });

  it("keeps persistent alerts in one repositioned group and updates it on resize", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Error uno" type="error" />
        <ToastTrigger message="Error dos" type="error" />
        <button type="button">Control cubierto</button>
      </ToastProvider>
    );

    const triggers = screen.getAllByRole("button", { name: "Push toast" });
    fireEvent.click(triggers[0]);
    fireEvent.click(triggers[1]);
    const region = screen.getByLabelText("Notificaciones");
    const control = screen.getByRole("button", { name: "Control cubierto" });
    let controlTop = 20;
    screen.getAllByRole("alert").forEach((toast) => {
      vi.spyOn(toast, "getBoundingClientRect").mockReturnValue(rectangle(0, 0, 100, 100));
    });
    vi.spyOn(region, "getBoundingClientRect").mockImplementation(() => rectangle(0, Number.parseInt(region.style.top || "0", 10), 100, 100));
    vi.spyOn(control, "getBoundingClientRect").mockImplementation(() => rectangle(20, controlTop, 44, 44));

    act(() => { control.focus(); });
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(region.style.top).toBe("80px");

    controlTop = 160;
    act(() => { window.dispatchEvent(new Event("resize")); });

    expect(region.style.top).toBe("220px");
  });

  it("detects an overlap introduced by resize when the notification group is initially unpositioned", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Error persistente" type="error" />
        <button type="button">Control cubierto</button>
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    const toast = screen.getByRole("alert");
    const region = screen.getByLabelText("Notificaciones");
    const control = screen.getByRole("button", { name: "Control cubierto" });
    let controlTop = 160;
    vi.spyOn(toast, "getBoundingClientRect").mockReturnValue(rectangle(0, 0, 100, 100));
    vi.spyOn(region, "getBoundingClientRect").mockImplementation(() => rectangle(0, Number.parseInt(region.style.top || "0", 10), 100, 100));
    vi.spyOn(control, "getBoundingClientRect").mockImplementation(() => rectangle(20, controlTop, 44, 44));

    act(() => { control.focus(); });
    expect(region.style.position).toBe("");

    controlTop = 20;
    act(() => { window.dispatchEvent(new Event("resize")); });

    expect(region.style.top).toBe("80px");
  });

  it("restores the default notification position when the focused control leaves the viewport", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Error persistente" type="error" />
        <button type="button">Control cubierto</button>
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    const toast = screen.getByRole("alert");
    const region = screen.getByLabelText("Notificaciones");
    const control = screen.getByRole("button", { name: "Control cubierto" });
    let controlTop = 20;
    vi.spyOn(toast, "getBoundingClientRect").mockReturnValue(rectangle(0, 0, 100, 100));
    vi.spyOn(region, "getBoundingClientRect").mockImplementation(() => rectangle(0, Number.parseInt(region.style.top || "0", 10), 100, 100));
    vi.spyOn(control, "getBoundingClientRect").mockImplementation(() => rectangle(20, controlTop, 44, 44));

    act(() => { control.focus(); });
    expect(region.style.position).toBe("fixed");

    controlTop = -100;
    act(() => { window.dispatchEvent(new Event("scroll")); });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(region.style.position).toBe("");
  });

  it("scrolls an overflowing persistent notification group without intercepting clicks", async () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Error persistente" type="error" />
        <button type="button">Control cubierto</button>
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    const toast = screen.getByRole("alert");
    const region = screen.getByLabelText("Notificaciones");
    const control = screen.getByRole("button", { name: "Control cubierto" });
    Object.defineProperties(region, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, value: 0, writable: true }
    });
    vi.spyOn(toast, "getBoundingClientRect").mockReturnValue(rectangle(0, 0, 100, 100));
    vi.spyOn(region, "getBoundingClientRect").mockImplementation(() => rectangle(0, Number.parseInt(region.style.top || "0", 10), 100, 100));
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(rectangle(20, 20, 44, 44));

    act(() => { control.focus(); });

    await waitFor(() => expect(region).toHaveClass("pointer-events-none"));
    act(() => {
      document.dispatchEvent(new WheelEvent("wheel", { cancelable: true, clientX: 50, clientY: 100, deltaY: 80 }));
    });

    expect(region.scrollTop).toBe(80);
    expect(screen.getByRole("button", { name: "Cerrar notificación" })).toHaveClass("sticky", "bottom-0");
  });

  it("dismisses a transient toast that obscures a focused summary", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Guardado" type="success" />
        <details><summary>Opciones avanzadas</summary></details>
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    const toast = screen.getByRole("status");
    const summary = screen.getByText("Opciones avanzadas");
    vi.spyOn(toast, "getBoundingClientRect").mockReturnValue(rectangle(0, 0, 100, 100));
    vi.spyOn(summary, "getBoundingClientRect").mockReturnValue(rectangle(20, 20, 44, 44));

    act(() => { summary.focus(); });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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

  it("auto-dismisses a warning when an explicit duration is provided", () => {
    vi.useFakeTimers();
    renderWithProvider({ message: "Aviso temporal", type: "warning", durationMs: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));
    expect(screen.getByText("Aviso temporal")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(4001); });

    expect(screen.queryByText("Aviso temporal")).not.toBeInTheDocument();
  });

  it("empty region renders no ARIA landmark when no toasts", () => {
    render(<ToastProvider><div /></ToastProvider>);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    { type: "success" as const, srPrefix: "Correcto:" },
    { type: "error" as const, srPrefix: "Error:" },
    { type: "warning" as const, srPrefix: "Aviso:" },
    { type: "info" as const, srPrefix: "Información:" },
  ])("$type toast exposes sr-only prefix '$srPrefix' and aria-hidden icon", ({ type, srPrefix }) => {
    const { container } = renderWithProvider({ message: "Mensaje de prueba", type });
    fireEvent.click(screen.getByRole("button", { name: "Push toast" }));

    // Prefijo sr-only presente en el DOM
    const srEl = screen.getByText(srPrefix);
    expect(srEl).toHaveClass("sr-only");

    // Icono SVG decorativo con aria-hidden (excluye el chevron del SelectField)
    const icons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(icons.length).toBeGreaterThan(0);
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
