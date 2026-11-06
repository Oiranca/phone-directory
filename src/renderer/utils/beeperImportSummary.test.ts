import { describe, expect, it } from "vitest";
import { describeBeeperImport } from "./beeperImportSummary";

const DELETION = "Los buscas importados anteriormente que no estén en el archivo se eliminarán.";

describe("describeBeeperImport", () => {
  it("leads with the replacement and explains repeated pager numbers separately", () => {
    expect(describeBeeperImport({ parsedBeepersCellCount: 231, incomingBeeperRecordCount: 130, currentBeeperRecordCount: 623 }))
      .toBe(`Se reemplazarán los 623 buscas actuales por 130 buscas del archivo. El archivo tenía 231 números de busca; 101 estaban repetidos y se guardarán una sola vez. ${DELETION}`);
  });

  it("omits the repeated sentence when no number repeats", () => {
    expect(describeBeeperImport({ parsedBeepersCellCount: 130, incomingBeeperRecordCount: 130, currentBeeperRecordCount: 623 }))
      .toBe(`Se reemplazarán los 623 buscas actuales por 130 buscas del archivo. ${DELETION}`);
  });

  it("uses singular forms for one current busca and one incoming busca", () => {
    expect(describeBeeperImport({ parsedBeepersCellCount: 1, incomingBeeperRecordCount: 1, currentBeeperRecordCount: 1 }))
      .toBe(`Se reemplazará el busca actual por 1 busca del archivo. ${DELETION}`);
  });

  it("uses the singular verb when exactly one number repeats", () => {
    expect(describeBeeperImport({ parsedBeepersCellCount: 3, incomingBeeperRecordCount: 2, currentBeeperRecordCount: 5 }))
      .toBe(`Se reemplazarán los 5 buscas actuales por 2 buscas del archivo. El archivo tenía 3 números de busca; 1 estaba repetido y se guardará una sola vez. ${DELETION}`);
  });

  it("does not mention replacement or deletion when nothing is stored", () => {
    expect(describeBeeperImport({ parsedBeepersCellCount: 5, incomingBeeperRecordCount: 4, currentBeeperRecordCount: 0 }))
      .toBe("No hay buscas guardados; se importarán 4 buscas del archivo. El archivo tenía 5 números de busca; 1 estaba repetido y se guardará una sola vez.");
  });

  it("uses the singular import verb when nothing is stored and one busca arrives", () => {
    expect(describeBeeperImport({ parsedBeepersCellCount: 1, incomingBeeperRecordCount: 1, currentBeeperRecordCount: 0 }))
      .toBe("No hay buscas guardados; se importará 1 busca del archivo.");
  });

  it("omits the current count when it is unreadable", () => {
    expect(describeBeeperImport({ parsedBeepersCellCount: 2, incomingBeeperRecordCount: 2, currentBeeperRecordCount: null }))
      .toBe(`Se reemplazarán los buscas actuales por 2 buscas del archivo. ${DELETION}`);
  });
});
