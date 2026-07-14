import { describe, expect, it } from "vitest";
import { toCompactToastMessage } from "./toastMessage";

describe("toCompactToastMessage", () => {
  it("returns the fallback when the input is not an Error instance", () => {
    expect(toCompactToastMessage("plain string", "fallback message")).toBe("fallback message");
    expect(toCompactToastMessage(undefined, "fallback message")).toBe("fallback message");
    expect(toCompactToastMessage(null, "fallback message")).toBe("fallback message");
    expect(toCompactToastMessage({ message: "not an Error" }, "fallback message")).toBe(
      "fallback message"
    );
  });

  it("strips the Electron IPC-invocation prefix boilerplate", () => {
    const error = new Error(
      "Error invoking remote method 'contacts:import': Error: No se pudo leer el archivo"
    );

    expect(toCompactToastMessage(error, "fallback")).toBe("No se pudo leer el archivo");
  });

  it("strips a 'Ruta afectada:' diagnostic suffix", () => {
    const error = new Error("No se pudo escribir el archivo Ruta afectada: /Users/foo/data/contacts.json");

    expect(toCompactToastMessage(error, "fallback")).toBe("No se pudo escribir el archivo");
  });

  it("strips a 'Ruta de origen:' diagnostic suffix", () => {
    const error = new Error("No se pudo copiar el archivo Ruta de origen: /Users/foo/source.json");

    expect(toCompactToastMessage(error, "fallback")).toBe("No se pudo copiar el archivo");
  });

  it("strips a 'Ruta de destino:' diagnostic suffix", () => {
    const error = new Error("No se pudo copiar el archivo Ruta de destino: /Users/foo/dest.json");

    expect(toCompactToastMessage(error, "fallback")).toBe("No se pudo copiar el archivo");
  });

  it("strips an 'Archivo afectado:' diagnostic suffix", () => {
    const error = new Error("No se pudo procesar el archivo Archivo afectado: contacts.xlsx");

    expect(toCompactToastMessage(error, "fallback")).toBe("No se pudo procesar el archivo");
  });

  it("strips the IPC prefix and every diagnostic suffix combined in one message", () => {
    const error = new Error(
      "Error invoking remote method 'backup:create': Error: No se pudo crear la copia de seguridad" +
        " Ruta afectada: /Users/foo/data" +
        " Ruta de origen: /Users/foo/source" +
        " Ruta de destino: /Users/foo/dest" +
        " Archivo afectado: contacts.json"
    );

    expect(toCompactToastMessage(error, "fallback")).toBe("No se pudo crear la copia de seguridad");
  });

  it("falls back when stripping the diagnostic suffix leaves an empty string", () => {
    const error = new Error(" Ruta afectada: /Users/foo/data/contacts.json");

    expect(toCompactToastMessage(error, "fallback message")).toBe("fallback message");
  });

  it("falls back when stripping the IPC prefix alone leaves an empty string", () => {
    const error = new Error("Error invoking remote method 'contacts:import': Error: ");

    expect(toCompactToastMessage(error, "fallback message")).toBe("fallback message");
  });

  it("returns the trimmed message unchanged when there is nothing to strip", () => {
    const error = new Error("No se pudo guardar la configuración.");

    expect(toCompactToastMessage(error, "fallback")).toBe("No se pudo guardar la configuración.");
  });
});
