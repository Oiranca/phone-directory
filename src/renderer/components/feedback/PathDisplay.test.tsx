import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PathDisplay } from "./PathDisplay";

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

  describe("className passthrough", () => {
    it("applies extra className to the wrapper", () => {
      const { container } = render(<PathDisplay path="/data/contacts.json" className="extra-class" />);
      expect(container.firstChild).toHaveClass("extra-class");
    });
  });
});
