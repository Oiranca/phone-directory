import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FullConfig } from "@playwright/test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const globalSetup = async (_config: FullConfig) => {
  execFileSync("npm", ["run", "build:electron"], {
    cwd: rootDir,
    stdio: "inherit"
  });
};

export default globalSetup;
