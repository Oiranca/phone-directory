const parseBooleanFlag = (value: string | undefined) => value === "1" || value === "true";

export const env = {
  openDevTools: parseBooleanFlag(process.env.ELECTRON_OPEN_DEVTOOLS)
};
