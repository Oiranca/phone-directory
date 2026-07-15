import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPathChainIsNotSymlink, formatPathForError } from "./path-safety.js";

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("assertPathChainIsNotSymlink", () => {
  it("allows a missing leaf when the parent chain is real", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-path-safety-"));
    cleanupRoots.push(root);

    await expect(
      assertPathChainIsNotSymlink(path.join(root, "portable-root"), "portable root", true)
    ).resolves.toBeUndefined();
  });

  it("rejects symlinked ancestor directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-path-safety-"));
    cleanupRoots.push(root);
    const realRoot = path.join(root, "real-root");
    const linkRoot = path.join(root, "link-root");

    await fs.mkdir(realRoot, { recursive: true });
    await fs.symlink(realRoot, linkRoot);

    await expect(
      assertPathChainIsNotSymlink(path.join(linkRoot, "portable-root"), "portable root", true)
    ).rejects.toThrow(/No se permiten enlaces simbólicos/);
  });

  it("wraps unexpected filesystem errors with caller message and a sanitized (basename-only) failing path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-path-safety-"));
    cleanupRoots.push(root);
    const targetPath = path.join(root, "nested", "portable-root");
    const parentPath = path.join(root, "nested");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const lstatSpy = vi
      .spyOn(fs, "lstat")
      .mockImplementation(async (filePath) => {
        if (filePath === parentPath) {
          throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
        }

        return actualFs.lstat(filePath);
      });

    const rejection = assertPathChainIsNotSymlink(targetPath, "portable root", true);

    await expect(rejection).rejects.toThrow(
      /portable root Ruta afectada: nested\. Error al verificar la ruta: EACCES: permission denied/
    );

    // SEC-3 regression guard: the absolute realpath (which typically embeds
    // the OS username/home directory) must never cross the IPC boundary —
    // neither via the "Ruta afectada" segment nor via a rewrapped raw fs
    // error message.
    const error = await rejection.catch((e: unknown) => e as Error);
    expect(error.message).not.toContain(root);
    expect(error.message).not.toContain(parentPath);

    lstatSpy.mockRestore();
  });

  it("sanitizes an absolute path embedded in the underlying fs error message (e.g. ENOENT)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-path-safety-"));
    cleanupRoots.push(root);
    const targetPath = path.join(root, "nested", "portable-root");
    const parentPath = path.join(root, "nested");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const lstatSpy = vi
      .spyOn(fs, "lstat")
      .mockImplementation(async (filePath) => {
        if (filePath === parentPath) {
          // Mirrors Node's real fs errno error shape: the absolute path is
          // embedded directly in `.message`, not just in `.path`.
          throw Object.assign(
            new Error(`ENOENT: no such file or directory, lstat '${parentPath}'`),
            { code: "ENOENT", path: parentPath }
          );
        }

        return actualFs.lstat(filePath);
      });

    // allowMissingLeaf=false so the ENOENT on a non-leaf segment is not
    // swallowed and instead reaches the generic error-wrapping branch.
    const rejection = assertPathChainIsNotSymlink(targetPath, "portable root", false);

    await expect(rejection).rejects.toThrow(/portable root Ruta afectada: nested\./);

    const error = await rejection.catch((e: unknown) => e as Error);
    expect(error.message).not.toContain(root);
    expect(error.message).not.toContain(parentPath);
    expect(error.message).toContain("ENOENT: no such file or directory, lstat 'nested'");

    lstatSpy.mockRestore();
  });
});

describe("formatPathForError", () => {
  it("reduces an absolute path to just its basename", () => {
    expect(formatPathForError("/Users/someone/Library/Application Support/phone-directory/contacts.json")).toBe(
      "contacts.json"
    );
  });

  it("falls back to a placeholder for the filesystem root", () => {
    expect(formatPathForError("/")).toBe("<raíz>");
  });
});
