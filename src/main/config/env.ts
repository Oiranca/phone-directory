const parseBooleanFlag = (value: string | undefined) => value === "1" || value === "true";
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

export const env = {
  openDevTools: parseBooleanFlag(process.env.ELECTRON_OPEN_DEVTOOLS),
  rendererUrl: process.env.ELECTRON_RENDERER_URL,
  userDataPath: process.env.ELECTRON_USER_DATA_PATH,
  e2eOpenDialogPaths: parseJsonStringArray(process.env.E2E_OPEN_DIALOG_PATHS),
  e2eSaveDialogPaths: parseJsonStringArray(process.env.E2E_SAVE_DIALOG_PATHS)
};
