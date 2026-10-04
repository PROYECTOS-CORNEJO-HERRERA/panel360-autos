import { describe, expect, it } from "vitest";
import { interpretarMesComercial } from "@/lib/mes-comercial";

describe("interpretarMesComercial", () => {
  it("lee los formatos corrientes", () => {
    expect(interpretarMesComercial("Lista de Precios GWM Septiembre 2026")).toBe("2026-09");
    expect(interpretarMesComercial("AGOSTO-2026")).toBe("2026-08");
    expect(interpretarMesComercial("2026-08")).toBe("2026-08");
    expect(interpretarMesComercial("08/2026")).toBe("2026-08");
  });

  // El caso que archivo la lista de Suzuki en el mes equivocado: la
  // fecha viene pegada, asi que los cuatro digitos del año no quedan
  // aislados y el lector no los veia.
  it("lee la fecha compacta AAAAMMDD del nombre del archivo", () => {
    expect(interpretarMesComercial("Lista 09 20260901 lista de precio Septiembre (1).xlsx")).toBe("2026-09");
    expect(interpretarMesComercial("20260801")).toBe("2026-08");
  });

  it("no confunde un numero largo cualquiera con una fecha", () => {
    expect(interpretarMesComercial("codigo 20261399")).toBeNull();
    expect(interpretarMesComercial("20260001")).toBeNull();
    expect(interpretarMesComercial("20260932")).toBeNull();
  });

  // Preferir null a adivinar es la razon de ser de esta funcion.
  it("devuelve null cuando no reconoce nada", () => {
    expect(interpretarMesComercial("lista de precios")).toBeNull();
    expect(interpretarMesComercial("septiembre")).toBeNull(); // mes sin año
    expect(interpretarMesComercial("")).toBeNull();
    expect(interpretarMesComercial(null)).toBeNull();
  });
});
