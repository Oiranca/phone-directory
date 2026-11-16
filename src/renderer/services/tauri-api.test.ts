import { describe, expect, it, vi } from "vitest";
import type { AutoBackupFailureEvent, EditableContactRecord } from "../../shared/types/contact.js";
import type { HospitalDirectoryApi } from "../../shared/ipc/api.js";
import { createTauriHospitalDirectoryApi, TAURI_COMMANDS, type TauriTransport } from "./tauri-api.js";

const createTransport = () => {
  const invoke = vi.fn<TauriTransport["invoke"]>();
  const listen = vi.fn<TauriTransport["listen"]>();
  return { invoke, listen };
};

describe("createTauriHospitalDirectoryApi", () => {
  it("sends record identifiers separately from record payloads", async () => {
    const transport = createTransport();
    transport.invoke.mockResolvedValueOnce({});
    const api = createTauriHospitalDirectoryApi(transport);
    const record = {} as EditableContactRecord;

    await api.updateRecord("record-1", record);

    expect(transport.invoke).toHaveBeenCalledWith(TAURI_COMMANDS.updateRecord, { recordId: "record-1", record });
  });

  it("uses an empty policy list when importing CSV without a selection", async () => {
    const transport = createTransport();
    transport.invoke.mockResolvedValueOnce({});
    const api = createTauriHospitalDirectoryApi(transport);

    await api.importCsvDataset("csv-token");

    expect(transport.invoke).toHaveBeenCalledWith(TAURI_COMMANDS.importCsvDataset, {
      importToken: "csv-token",
      policies: []
    });
  });

  it("omits an optional import token when cancelling without one", async () => {
    const transport = createTransport();
    transport.invoke.mockResolvedValueOnce(undefined);
    const api = createTauriHospitalDirectoryApi(transport);

    await api.cancelCsvImportPreview();

    expect(transport.invoke).toHaveBeenCalledWith(TAURI_COMMANDS.cancelCsvImportPreview, undefined);
  });

  it("keeps merge requests nested", async () => {
    const transport = createTransport();
    transport.invoke.mockResolvedValueOnce({});
    const api = createTauriHospitalDirectoryApi(transport);
    const request: Parameters<HospitalDirectoryApi["mergeContacts"]>[0] = {
      keepId: "keep",
      discardId: "discard",
      overrides: { displayName: "Survivor" }
    };

    await api.mergeContacts(request);

    expect(transport.invoke).toHaveBeenCalledWith(TAURI_COMMANDS.mergeContacts, { request });
  });

  it("propagates command rejections", async () => {
    const transport = createTransport();
    const failure = new Error("command failed");
    transport.invoke.mockRejectedValueOnce(failure);
    const api = createTauriHospitalDirectoryApi(transport);

    await expect(api.listBeepers()).rejects.toBe(failure);
  });

  it("unsubscribes after an async listener resolves following cleanup", async () => {
    const transport = createTransport();
    let resolveListen: ((unlisten: () => void) => void) | undefined;
    const unlisten = vi.fn();
    transport.listen.mockImplementation(
      () => new Promise((resolve) => {
        resolveListen = resolve;
      })
    );
    const listener = vi.fn();
    const api = createTauriHospitalDirectoryApi(transport);

    const unsubscribe = api.onAutoBackupFailure(listener);
    unsubscribe();
    resolveListen?.(unlisten);
    await Promise.resolve();

    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("does not call an unsubscribed listener after async registration", async () => {
    const transport = createTransport();
    let handler: ((event: { payload: AutoBackupFailureEvent }) => void) | undefined;
    transport.listen.mockImplementation(async (_event, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    const listener = vi.fn();
    const api = createTauriHospitalDirectoryApi(transport);

    const unsubscribe = api.onAutoBackupFailure(listener);
    unsubscribe();
    await Promise.resolve();
    handler?.({ payload: { message: "failed" } });

    expect(listener).not.toHaveBeenCalled();
  });
});
