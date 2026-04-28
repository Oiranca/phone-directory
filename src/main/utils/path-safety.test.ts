import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertPathChainIsNotSymlink } from "./path-safety.js";

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
});
