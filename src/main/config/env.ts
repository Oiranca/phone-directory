import { app } from "electron";

const parseBooleanFlag = (value: string | undefined) => value === "1" || value === "true";
const isLoopbackUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
};

const parseRendererUrl = (value: string | undefined, isE2E: boolean) => {
  if (!isE2E || !value || !isLoopbackUrl(value)) {
    return null;
  }

  const parsed = new URL(value);
  const normalizedPathname = parsed.pathname.replace(/\/+$/, "");

  return `${parsed.origin}${normalizedPathname}`;
};

const parseUserDataPath = (value: string | undefined, isE2E: boolean) => {
  if (!isE2E || !value) {
    return null;
  }

  return value;
};

const parsePortableRootPath = (value: string | undefined) => {
  if (!value) {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
};

const parseJsonStringArray = (value: string | undefined) => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
      return [];
    }

    return parsed;
  } catch {
    return [];
  }
};

const isE2E = parseBooleanFlag(process.env.ELECTRON_E2E) && !app.isPackaged;

export const env = {
  isE2E,
  portableMode: parseBooleanFlag(process.env.ELECTRON_PORTABLE),
  openDevTools: parseBooleanFlag(process.env.ELECTRON_OPEN_DEVTOOLS),
  rendererUrl: parseRendererUrl(process.env.ELECTRON_RENDERER_URL, isE2E),
  portableRootPath: parsePortableRootPath(process.env.ELECTRON_PORTABLE_ROOT_PATH),
  userDataPath: parseUserDataPath(process.env.ELECTRON_USER_DATA_PATH, isE2E),
  e2eOpenDialogPaths: isE2E ? parseJsonStringArray(process.env.E2E_OPEN_DIALOG_PATHS) : [],
  e2eSaveDialogPaths: isE2E ? parseJsonStringArray(process.env.E2E_SAVE_DIALOG_PATHS) : []
};
