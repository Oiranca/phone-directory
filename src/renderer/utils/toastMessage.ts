const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': Error: /u;

const DIAGNOSTIC_SUFFIX_PATTERNS = [
  /\s+Ruta afectada:.*$/u,
  /\s+Ruta de origen:.*$/u,
  /\s+Ruta de destino:.*$/u,
  /\s+Archivo afectado:.*$/u
];

export const toCompactToastMessage = (error: unknown, fallback: string) => {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const sanitized = DIAGNOSTIC_SUFFIX_PATTERNS.reduce(
    (message, pattern) => message.replace(pattern, ""),
    error.message.replace(IPC_ERROR_PREFIX, "")
  ).trim();

  return sanitized || fallback;
};
