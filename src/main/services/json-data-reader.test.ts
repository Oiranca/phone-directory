import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultContacts } from "../../shared/fixtures/defaultContacts.js";
import {
  MAX_DATASET_RECORDS,
  MAX_JSON_DEPTH,
  MAX_JSON_FILE_SIZE_BYTES,
  MAX_JSON_OBJECT_FIELDS
} from "../../shared/constants/json-limits.js";
import { JsonDataError, parseAndValidateJson, readJsonData } from "./json-data-reader.js";

class FakeWorker extends EventEmitter {
  terminate = vi.fn().mockResolvedValue(0);
}

describe("bounded JSON data reader", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "json-data-reader-"));
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it("accepts a valid file exactly at the byte boundary", async () => {
    const filePath = path.join(testRoot, "boundary.json");
    const json = JSON.stringify(defaultContacts);
    await fs.writeFile(filePath, json + " ".repeat(MAX_JSON_FILE_SIZE_BYTES - Buffer.byteLength(json)));

    await expect(readJsonData(filePath, "contacts")).resolves.toMatchObject({ kind: "contacts" });
  });

  it("rejects excessive nesting before schema validation", () => {
    let nested = "null";
    for (let depth = 0; depth <= MAX_JSON_DEPTH; depth += 1) nested = `{"value":${nested}}`;

    expect(() => parseAndValidateJson(nested, "contacts")).toThrowError(JsonDataError);
    expect(() => parseAndValidateJson(nested, "contacts")).toThrow(`límite seguro de ${MAX_JSON_DEPTH}`);
  });

  it("rejects objects with excessive fields", () => {
    const object = Object.fromEntries(
      Array.from({ length: MAX_JSON_OBJECT_FIELDS + 1 }, (_, index) => [`field${index}`, index])
    );

    expect(() => parseAndValidateJson(JSON.stringify(object), "auto")).toThrow("demasiados campos");
  });

  it("accepts exactly the maximum contact record count", () => {
    const dataset = {
      ...defaultContacts,
      records: Array.from({ length: MAX_DATASET_RECORDS }, () => defaultContacts.records[0]!)
    };

    expect(parseAndValidateJson(JSON.stringify(dataset), "contacts").kind).toBe("contacts");
  });

  it("terminates the worker when processing is cancelled", async () => {
    const filePath = path.join(testRoot, "contacts.json");
    await fs.writeFile(filePath, JSON.stringify(defaultContacts));
    const worker = new FakeWorker();
    const controller = new AbortController();
    let markWorkerStarted!: () => void;
    const workerStarted = new Promise<void>((resolve) => { markWorkerStarted = resolve; });
    const promise = readJsonData(filePath, "contacts", {
      signal: controller.signal,
      workerFactory: () => {
        markWorkerStarted();
        return worker;
      }
    });

    await workerStarted;
    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: "aborted" });
  });

  it("terminates the worker after the timeout", async () => {
    const filePath = path.join(testRoot, "contacts.json");
    await fs.writeFile(filePath, JSON.stringify(defaultContacts));
    const worker = new FakeWorker();

    await expect(readJsonData(filePath, "contacts", {
      timeoutMs: 1,
      workerFactory: () => worker
    })).rejects.toMatchObject({ code: "timeout" });
  });
});
