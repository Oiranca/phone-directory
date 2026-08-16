export interface DirectoryHighlight {
  id: string;
  title: string;
  scope: string;
  phone: string;
  schedule: string;
  exclusions: readonly string[];
}

/**
 * Operational contacts that must survive dataset replacement and remain
 * visible independently from directory search results.
 */
export const GENERIC_CCEE_APPOINTMENTS: DirectoryHighlight = {
  id: "generic-ccee-appointments",
  title: "Citas CCEE",
  scope: "CAE Gáldar y CAE Arucas",
  phone: "79178",
  schedule: "L–V 08:00–21:00",
  exclusions: ["Rehabilitación", "Tórax", "RXVI", "Dermatología", "RX", "Banco de Sangre"]
};
