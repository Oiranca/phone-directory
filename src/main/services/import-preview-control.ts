export class ImportPreviewAbortError extends Error {
  constructor() {
    super("Import preview was aborted");
    this.name = "ImportPreviewAbortError";
  }
}

export type ImportPreviewProcessingOptions = {
  signal?: AbortSignal;
  yieldEvery?: number;
};

export const yieldDuringImportPreview = async (
  index: number,
  options: ImportPreviewProcessingOptions = {}
) => {
  if (options.signal?.aborted) {
    throw new ImportPreviewAbortError();
  }

  const yieldEvery = Math.max(1, options.yieldEvery ?? 50);
  if (index > 0 && index % yieldEvery === 0) {
    await new Promise<void>((resolve) => setImmediate(resolve));

    if (options.signal?.aborted) {
      throw new ImportPreviewAbortError();
    }
  }
};
