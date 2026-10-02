import { describe, expect, it } from "vitest";
import { calzarVersion, normalizarVersion, type CandidataVersion } from "@/lib/importers/aprobar-precios";

const catalogo: CandidataVersion[] = [
  { id: "dfsk-comfort", name: "500 1.5 COMFORT", sapCode: null, brand: { name: "DFSK" }, model: { name: "SUV 500" } },
  { id: "dfsk-luxury", name: "500 1.5 LUXURY", sapCode: null, brand: { name: "DFSK" }, model: { name: "SUV 500" } },
  { id: "dfsk-luxury-cvt", name: "500 1.5 LUXURY CVT", sapCode: null, brand: { name: "DFSK" }, model: { name: "SUV 500" } },
  { id: "hunter-20", name: "HUNTER 2.0 MT", sapCode: null, brand: { name: "CHANGAN" }, model: { name: "HUNTER" } },
  { id: "hunter-20t", name: "HUNTER 2.0T MT", sapCode: null, brand: { name: "CHANGAN" }, model: { name: "HUNTER" } },
];

describe("normalizarVersion", () => {
  it("quita la L de litros, que no distingue nada", () => {
    expect(normalizarVersion("SUV 500 1.5L Comfort")).toBe("suv 500 1.5 comfort");
  });

  it("NO toca la T de turbo: 2.0T y 2.0 son autos distintos", () => {
    expect(normalizarVersion("HUNTER 2.0T MT")).toContain("2.0t");
  });

  // Sin el corte de palabra, "1.5 Luxury" se convertia en "1.5uxury".
  it("no se come la L de una palabra que empieza con L", () => {
    expect(normalizarVersion("500 1.5 Luxury")).toBe("500 1.5 luxury");
    expect(normalizarVersion("1.5LUXURY")).toBe("1.5luxury");
  });
});

describe("calzarVersion", () => {
  it("calza aunque la lista escriba 1.5L y el catalogo 1.5", () => {
    const r = calzarVersion(
      { brandName: "DFSK", modelName: "SUV 500", versionName: "SUV 500 1.5L Comfort" },
      catalogo
    );
    expect(r?.id).toBe("dfsk-comfort");
  });

  it("no confunde turbo con atmosferico", () => {
    const r = calzarVersion({ brandName: "CHANGAN", modelName: "HUNTER", versionName: "HUNTER 2.0T MT" }, catalogo);
    expect(r?.id).toBe("hunter-20t");
  });

  // La regla que protege de lo caro: ante duda, no elegir.
  it("devuelve null si hay mas de una candidata posible", () => {
    const r = calzarVersion({ brandName: "DFSK", modelName: "SUV 500", versionName: "500 1.5" }, catalogo);
    expect(r).toBeNull();
  });
});
