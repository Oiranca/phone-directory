import type { CsvImportPreview } from "../../shared/types/contact";

type BeeperImportCounts = Pick<CsvImportPreview, "parsedBeepersCellCount" | "incomingBeeperRecordCount" | "currentBeeperRecordCount">;

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * Text for the preview panel and the confirmation dialog. Leads with what is
 * replaced, then explains how many pager numbers in the file were repeated
 * (the import keys on the pager number), then what happens to imported buscas
 * absent from the file. Manually created buscas are never touched by the import.
 */
export const describeBeeperImport = (counts: BeeperImportCounts): string => {
  const incoming = counts.incomingBeeperRecordCount;
  const current = counts.currentBeeperRecordCount;
  const repeated = counts.parsedBeepersCellCount - incoming;
  const fromFile = count(incoming, "busca", "buscas");

  let replacement: string;
  if (current === 0) {
    replacement = `No hay buscas guardados; ${incoming === 1 ? "se importará" : "se importarán"} ${fromFile} del archivo.`;
  } else if (current === 1) {
    replacement = `Se reemplazará el busca actual por ${fromFile} del archivo.`;
  } else {
    const currentText = current == null ? "los buscas actuales" : `los ${current} buscas actuales`;
    replacement = `Se reemplazarán ${currentText} por ${fromFile} del archivo.`;
  }

  const sentences = [replacement];
  if (repeated > 0) {
    sentences.push(
      `El archivo tenía ${count(counts.parsedBeepersCellCount, "número de busca", "números de busca")}; ` +
      `${repeated} ${repeated === 1 ? "estaba repetido y se guardará" : "estaban repetidos y se guardarán"} una sola vez.`
    );
  }
  if (current !== 0) {
    sentences.push("Los buscas importados anteriormente que no estén en el archivo se eliminarán.");
  }
  return sentences.join(" ");
};
