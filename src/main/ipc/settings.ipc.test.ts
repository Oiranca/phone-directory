/**
 * Unit tests for src/main/ipc/settings.ipc.ts — registerSettingsIpc.
 *
 * Mirrors the style of beeper.ipc.test.ts: mock electron, collect handlers
 * via ipcMain.handle, then invoke them directly.
 *
 * Covers acceptance criterion 2 (settings IPC handlers) and partial coverage
 * of criterion 1 (browsePath unknown-input guard).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SETTINGS_CHANNELS } from "../../shared/ipc/channels.js";

// ---------------------------------------------------------------------------
// Hoist handler store and ipcMain stub before vi.mock() runs.
// ---------------------------------------------------------------------------
const { handlers, ipcMainStub } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMainStub = {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }
  };
  return { handlers, ipcMainStub };
});

vi.mock("electron", () => ({
  ipcMain: ipcMainStub,
  BrowserWindow: {
    fromWebContents: vi.fn().mockReturnValue(null)
  },
  dialog: {
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: true, filePath: undefined }),
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })
  }
}));

// ---------------------------------------------------------------------------
// Helper: invoke a registered handler as if called from the renderer.
// IPC handlers receive (_event, ...args).
// ---------------------------------------------------------------------------
const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for channel: ${channel}`);
  return fn({ sender: {} } as unknown, ...args);
};

// ---------------------------------------------------------------------------
// Service mock — typed to match AppDataService's relevant surface.
// ---------------------------------------------------------------------------
const defaultSettings = {
  dataFilePath: "/data/contacts.json",
  backupDirectory: "/data/backups",
  autoBackupEnabled: false,
  autoBackupIntervalHours: 24,
  maxAutoBackups: 5
};

const serviceMock = {
  saveSettings: vi.fn().mockResolvedValue(defaultSettings),
  toEditableSettings: vi.fn((s: unknown) => s),
  getEditableSettingsDefaults: vi.fn().mockReturnValue(defaultSettings)
};

beforeAll(async () => {
  const { registerSettingsIpc } = await import("./settings.ipc.js");
  registerSettingsIpc(serviceMock as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// settings:defaults
// ---------------------------------------------------------------------------
describe(`${SETTINGS_CHANNELS.defaults} — getSettingsDefaults`, () => {
  it("returns defaults from service", async () => {
    const result = await invoke(SETTINGS_CHANNELS.defaults);
    expect(serviceMock.getEditableSettingsDefaults).toHaveBeenCalledOnce();
    expect(result).toEqual(defaultSettings);
  });

  it("is registered on the correct channel constant", () => {
    expect(handlers.has(SETTINGS_CHANNELS.defaults)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// settings:save
// ---------------------------------------------------------------------------
describe(`${SETTINGS_CHANNELS.save} — saveSettings`, () => {
  it("passes the payload to service.saveSettings", async () => {
    const payload = { ...defaultSettings, autoBackupEnabled: true };
    serviceMock.saveSettings.mockResolvedValueOnce(payload);
    serviceMock.toEditableSettings.mockReturnValueOnce(payload);

    const result = await invoke(SETTINGS_CHANNELS.save, payload);

    expect(serviceMock.saveSettings).toHaveBeenCalledWith(payload);
    expect(serviceMock.toEditableSettings).toHaveBeenCalledWith(payload);
    expect(result).toEqual(payload);
  });

  it("is registered on the correct channel constant", () => {
    expect(handlers.has(SETTINGS_CHANNELS.save)).toBe(true);
  });

  it("propagates service errors", async () => {
    serviceMock.saveSettings.mockRejectedValueOnce(new Error("disk full"));
    await expect(invoke(SETTINGS_CHANNELS.save, defaultSettings)).rejects.toThrow("disk full");
  });
});

// ---------------------------------------------------------------------------
// settings:browse-path — unknown/invalid inputs
// ---------------------------------------------------------------------------
describe(`${SETTINGS_CHANNELS.browsePath} — browseForPath`, () => {
  it("is registered on the correct channel constant", () => {
    expect(handlers.has(SETTINGS_CHANNELS.browsePath)).toBe(true);
  });

  it("returns null for an unknown type ('dataDirectory')", async () => {
    const result = await invoke(SETTINGS_CHANNELS.browsePath, "dataDirectory");
    expect(result).toBeNull();
  });

  it("returns null for a numeric type argument", async () => {
    const result = await invoke(SETTINGS_CHANNELS.browsePath, 42);
    expect(result).toBeNull();
  });

  it("returns null for undefined type", async () => {
    const result = await invoke(SETTINGS_CHANNELS.browsePath, undefined);
    expect(result).toBeNull();
  });

  it("returns null for null type", async () => {
    const result = await invoke(SETTINGS_CHANNELS.browsePath, null);
    expect(result).toBeNull();
  });

  it("returns null when save dialog is canceled for 'dataFile'", async () => {
    const { dialog } = await import("electron");
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: true,
      filePath: undefined
    } as Awaited<ReturnType<typeof dialog.showSaveDialog>>);

    const result = await invoke(SETTINGS_CHANNELS.browsePath, "dataFile");
    expect(result).toBeNull();
    expect(dialog.showSaveDialog).toHaveBeenCalledOnce();
  });

  it("returns filePath when save dialog is confirmed for 'dataFile'", async () => {
    const { dialog } = await import("electron");
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: "/chosen/contacts.json"
    } as Awaited<ReturnType<typeof dialog.showSaveDialog>>);

    const result = await invoke(SETTINGS_CHANNELS.browsePath, "dataFile");
    expect(result).toBe("/chosen/contacts.json");
  });

  it("returns null when open dialog is canceled for 'backupDirectory'", async () => {
    const { dialog } = await import("electron");
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: true,
      filePaths: []
    } as Awaited<ReturnType<typeof dialog.showOpenDialog>>);

    const result = await invoke(SETTINGS_CHANNELS.browsePath, "backupDirectory");
    expect(result).toBeNull();
  });

  it("returns first filePath when open dialog is confirmed for 'backupDirectory'", async () => {
    const { dialog } = await import("electron");
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ["/chosen/backups"]
    } as Awaited<ReturnType<typeof dialog.showOpenDialog>>);

    const result = await invoke(SETTINGS_CHANNELS.browsePath, "backupDirectory");
    expect(result).toBe("/chosen/backups");
  });

  it("returns null when open dialog returns empty filePaths (edge case)", async () => {
    const { dialog } = await import("electron");
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: []
    } as Awaited<ReturnType<typeof dialog.showOpenDialog>>);

    const result = await invoke(SETTINGS_CHANNELS.browsePath, "backupDirectory");
    expect(result).toBeNull();
  });
});
