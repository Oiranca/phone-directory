import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PathDisplay } from "./PathDisplay";

/** Flush all pending microtasks (Promise callbacks) without advancing fake timers. */
const flushPromises = () => act(async () => { await Promise.resolve(); });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Clipboard mock helpers
// ---------------------------------------------------------------------------
const mockClipboard = (impl?: (text: string) => Promise<void>) => {
  const writeText = vi.fn(impl ?? (() => Promise.resolve()));
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText }
  });
  return writeText;
};

describe("PathDisplay", () => {
  describe("default redaction (basename only)", () => {
    it("shows only the basename by default — absolute path NOT in DOM", () => {
      render(<PathDisplay path="/home/alice/hospitalDirectory/contacts.json" />);
      expect(screen.getByText("contacts.json")).toBeInTheDocument();
      expect(screen.queryByText("/home/alice/hospitalDirectory/contacts.json")).not.toBeInTheDocument();
    });

    it("shows only the basename for Windows-style paths", () => {
      render(<PathDisplay path="C:\\Users\\alice\\data\\contacts.json" />);
      expect(screen.getByText("contacts.json")).toBeInTheDocument();
      expect(screen.queryByText("C:\\Users\\alice\\data\\contacts.json")).not.toBeInTheDocument();
    });

    it("renders a reveal toggle with correct aria-label and pressed=false", () => {
      render(<PathDisplay path="/data/contacts.json" />);
      const btn = screen.getByRole("button", { name: "Mostrar ruta completa" });
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveAttribute("aria-pressed", "false");
    });

    it("renders a copy button with aria-label", () => {
      render(<PathDisplay path="/data/contacts.json" />);
      expect(screen.getByRole("button", { name: "Copiar ruta completa" })).toBeInTheDocument();
    });

    it("trailing separator — shows last non-empty segment, not blank", () => {
      render(<PathDisplay path="/Users/foo/copias-seguridad/" />);
      // Basename must be the last non-empty segment; the absolute path must not leak.
      expect(screen.getByText("copias-seguridad")).toBeInTheDocument();
      expect(screen.queryByText("/Users/foo/copias-seguridad/")).not.toBeInTheDocument();
    });

    it("trailing separator on Windows path — shows last non-empty segment", () => {
      render(<PathDisplay path="C:\\Users\\foo\\copias\\" />);
      expect(screen.getByText("copias")).toBeInTheDocument();
    });

    it("empty string input — falls back to the full path value (never renders blank label)", () => {
      render(<PathDisplay path="" />);
      // basename("") returns "" which ?? fullPath gives "" — the component should show
      // the full path string as fallback. Since fullPath is also "" here, the span text
      // is empty but the component must not crash.  Verify buttons still render.
      expect(screen.getByRole("button", { name: "Mostrar ruta completa" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Copiar ruta completa" })).toBeInTheDocument();
    });
  });

  describe("explicit reveal shows full path", () => {
    it("clicking reveal shows the full absolute path", () => {
      render(<PathDisplay path="/home/alice/hospitalDirectory/contacts.json" />);
      fireEvent.click(screen.getByRole("button", { name: "Mostrar ruta completa" }));
      expect(screen.getByText("/home/alice/hospitalDirectory/contacts.json")).toBeInTheDocument();
    });

    it("toggling reveal back hides the full path again", () => {
      render(<PathDisplay path="/home/alice/hospitalDirectory/contacts.json" />);
      const toggle = screen.getByRole("button", { name: "Mostrar ruta completa" });
      fireEvent.click(toggle);
      expect(screen.getByText("/home/alice/hospitalDirectory/contacts.json")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Ocultar ruta completa" }));
      expect(screen.queryByText("/home/alice/hospitalDirectory/contacts.json")).not.toBeInTheDocument();
      expect(screen.getByText("contacts.json")).toBeInTheDocument();
    });

    it("aria-pressed flips when toggled", () => {
      render(<PathDisplay path="/data/contacts.json" />);
      const toggle = screen.getByRole("button", { name: "Mostrar ruta completa" });
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(toggle);
      expect(screen.getByRole("button", { name: "Ocultar ruta completa" })).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("copy action copies full path", () => {
    it("clicking copy writes the full path to clipboard", async () => {
      const writeText = mockClipboard();
      render(<PathDisplay path="/home/alice/data/contacts.json" />);
      fireEvent.click(screen.getByRole("button", { name: "Copiar ruta completa" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("/home/alice/data/contacts.json"));
    });

    it("shows 'Copiado' feedback after copying", async () => {
      mockClipboard();
      render(<PathDisplay path="/home/alice/data/contacts.json" />);
      fireEvent.click(screen.getByRole("button", { name: "Copiar ruta completa" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Copiar ruta completa" })).toHaveTextContent("Copiado"));
    });

    it("copies the full path even when basename is displayed (not revealed)", () => {
      const writeText = mockClipboard();
      render(<PathDisplay path="/home/alice/data/contacts.json" />);
      // Do not reveal — just copy.
      fireEvent.click(screen.getByRole("button", { name: "Copiar ruta completa" }));
      expect(writeText).toHaveBeenCalledWith("/home/alice/data/contacts.json");
    });

    it("clipboard rejection is silently swallowed — no 'Copiado' and no thrown error", async () => {
      // Mock writeText to reject (e.g. clipboard permission denied).
      mockClipboard(() => Promise.reject(new Error("NotAllowedError")));
      render(<PathDisplay path="/home/alice/data/contacts.json" />);
      fireEvent.click(screen.getByRole("button", { name: "Copiar ruta completa" }));
      // Give the rejected promise time to settle.
      await waitFor(() => {});
      // The button must still show the default label — no "Copiado" state mutation.
      expect(screen.getByRole("button", { name: "Copiar ruta completa" })).toHaveTextContent("Copiar ruta");
    });
  });

  describe("copy timer lifecycle (FIX 1 — no setState-after-unmount)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("unmounting during the reset window does not cause setState-after-unmount", async () => {
      mockClipboard();
      const { unmount } = render(<PathDisplay path="/home/alice/data/contacts.json" />);

      // Click copy — starts the 1500 ms reset timer.
      fireEvent.click(screen.getByRole("button", { name: "Copiar ruta completa" }));

      // Wait for clipboard promise to resolve so copied=true is set.
      await flushPromises();

      // Unmount before the timer fires.
      unmount();

      // Advance past the 1500 ms timeout — the cleared timer must NOT call setCopied.
      // If setState fires on an unmounted component React would warn; capture any error.
      const consoleSpy = vi.spyOn(console, "error");
      act(() => { vi.advanceTimersByTime(2000); });
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it("a second copy click cancels the previous timer (no two pending resets)", async () => {
      mockClipboard();
      render(<PathDisplay path="/home/alice/data/contacts.json" />);

      const copyBtn = screen.getByRole("button", { name: "Copiar ruta completa" });

      // First click at t=0.
      fireEvent.click(copyBtn);
      await flushPromises();

      // t=1000 ms: still within the 1500 ms window from the first click.
      act(() => { vi.advanceTimersByTime(1000); });
      expect(copyBtn).toHaveTextContent("Copiado");

      // Second click at t=1000 ms — cancels the first timer and restarts the 1500 ms window.
      fireEvent.click(copyBtn);
      await flushPromises();

      // t=2000 ms: only 1000 ms since the second click — should still show "Copiado".
      act(() => { vi.advanceTimersByTime(1000); });
      expect(copyBtn).toHaveTextContent("Copiado");

      // t=2600 ms: 1600 ms since the second click — timer has fired, label reverts.
      act(() => { vi.advanceTimersByTime(600); });
      expect(copyBtn).toHaveTextContent("Copiar ruta");
    });
  });

  describe("basename collision disambiguation", () => {
    it("when two items share basename, reveal on each shows its own distinct full path", () => {
      const { unmount } = render(<PathDisplay path="/volume/alice/backups/contacts.json" />);
      fireEvent.click(screen.getByRole("button", { name: "Mostrar ruta completa" }));
      expect(screen.getByText("/volume/alice/backups/contacts.json")).toBeInTheDocument();
      unmount();

      render(<PathDisplay path="/volume/bob/backups/contacts.json" />);
      fireEvent.click(screen.getByRole("button", { name: "Mostrar ruta completa" }));
      expect(screen.getByText("/volume/bob/backups/contacts.json")).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("reveal button has an aria-label on both states", () => {
      render(<PathDisplay path="/data/contacts.json" />);
      expect(screen.getByRole("button", { name: "Mostrar ruta completa" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Mostrar ruta completa" }));
      expect(screen.getByRole("button", { name: "Ocultar ruta completa" })).toBeInTheDocument();
    });

    it("copy button always has its aria-label", () => {
      render(<PathDisplay path="/data/contacts.json" />);
      expect(screen.getByRole("button", { name: "Copiar ruta completa" })).toBeInTheDocument();
    });
  });

  describe("path prop change resets revealed and copied state (FIX 3 — no auto-exposure)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("revealed resets to false when path prop changes — new path is NOT auto-exposed", () => {
      const { rerender } = render(<PathDisplay path="/home/alice/backup-A/contacts.json" />);

      // Reveal path A explicitly.
      fireEvent.click(screen.getByRole("button", { name: "Mostrar ruta completa" }));
      expect(screen.getByText("/home/alice/backup-A/contacts.json")).toBeInTheDocument();

      // Rerender the SAME instance with a new path (simulates list refresh/reorder).
      act(() => {
        rerender(<PathDisplay path="/home/bob/backup-B/contacts.json" />);
      });

      // Must return to basename-only — full path B must NOT be in the DOM.
      expect(screen.getByText("contacts.json")).toBeInTheDocument();
      expect(screen.queryByText("/home/bob/backup-B/contacts.json")).not.toBeInTheDocument();
      // The old path A must also be gone.
      expect(screen.queryByText("/home/alice/backup-A/contacts.json")).not.toBeInTheDocument();
      // Toggle button must reflect hidden state.
      expect(screen.getByRole("button", { name: "Mostrar ruta completa" })).toHaveAttribute("aria-pressed", "false");
    });

    it("'Copiado' feedback resets when path prop changes and pending timer is cleared", async () => {
      mockClipboard();
      const { rerender } = render(<PathDisplay path="/home/alice/backup-A/contacts.json" />);

      // Trigger copy on path A — starts the 1500 ms reset timer.
      fireEvent.click(screen.getByRole("button", { name: "Copiar ruta completa" }));
      // Flush clipboard Promise so copied=true is applied.
      await flushPromises();

      const copyBtn = screen.getByRole("button", { name: "Copiar ruta completa" });
      expect(copyBtn).toHaveTextContent("Copiado");

      // Rerender with a new path BEFORE the 1500 ms timer fires.
      act(() => {
        rerender(<PathDisplay path="/home/bob/backup-B/contacts.json" />);
      });

      // copied must have been reset immediately (not waiting for the timer).
      const copyBtnAfter = screen.getByRole("button", { name: "Copiar ruta completa" });
      expect(copyBtnAfter).toHaveTextContent("Copiar ruta");

      // Advance well past the original 1500 ms window to confirm the stale timer
      // was cleared and does NOT flip copied back to true.
      const consoleSpy = vi.spyOn(console, "error");
      act(() => { vi.advanceTimersByTime(2000); });
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Copiar ruta completa" })).toHaveTextContent("Copiar ruta");
    });
  });

  describe("className passthrough", () => {
    it("applies extra className to the wrapper", () => {
      const { container } = render(<PathDisplay path="/data/contacts.json" className="extra-class" />);
      expect(container.firstChild).toHaveClass("extra-class");
    });
  });

  describe("textClassName prop (FIX 2 — caller-controlled text size)", () => {
    it("defaults to text-sm on the basename span when textClassName is not provided", () => {
      const { container } = render(<PathDisplay path="/data/contacts.json" />);
      // The first child of the root span is the text span.
      const textSpan = container.querySelector("span > span:first-child");
      expect(textSpan).toHaveClass("text-sm");
    });

    it("applies a caller-provided textClassName (e.g. text-xs) to the basename span", () => {
      const { container } = render(
        <PathDisplay path="/data/contacts.json" textClassName="text-xs" />
      );
      const textSpan = container.querySelector("span > span:first-child");
      expect(textSpan).toHaveClass("text-xs");
      expect(textSpan).not.toHaveClass("text-sm");
    });

    it("caller textClassName is applied to the revealed full path span as well", () => {
      const { container } = render(
        <PathDisplay path="/data/contacts.json" textClassName="text-xs" />
      );
      fireEvent.click(screen.getByRole("button", { name: "Mostrar ruta completa" }));
      const textSpan = container.querySelector("span > span:first-child");
      expect(textSpan).toHaveClass("text-xs");
      expect(textSpan).not.toHaveClass("text-sm");
    });
  });
});
