import { describe, expect, it } from "vitest";
import { montoDeCelda } from "@/lib/importers/excel";

describe("montoDeCelda", () => {
  it("lee un precio chileno con puntos de miles", () => {
    expect(montoDeCelda("12.990.000")).toBe(12990000);
    expect(montoDeCelda("$ 8.490.000")).toBe(8490000);
  });

  it("lee un numero puro", () => {
    expect(montoDeCelda(10490000)).toBe(10490000);
  });

  // El bug real: borrar todo lo que no fuera digito pegaba la parte
  // decimal a la entera. "1,1764705882352942" terminaba como
  // 11764705882352942 en la base, un valor que Prisma despues no podia
  // leer: la consulta fallaba entera y la pantalla de Actualizaciones
  // no abria.
  it("corta la parte decimal en vez de concatenarla", () => {
    expect(montoDeCelda("1,1764705882352942")).toBeUndefined();
    expect(montoDeCelda("12.990.000,50")).toBe(12990000);
  });

  it("descarta montos imposibles en vez de guardarlos", () => {
    expect(montoDeCelda(11764705882352942)).toBeUndefined();
    expect(montoDeCelda("120260000450400")).toBeUndefined();
    expect(montoDeCelda(3_000_000_000)).toBeUndefined();
  });

  it("descarta celdas vacias, texto y ceros", () => {
    expect(montoDeCelda("")).toBeUndefined();
    expect(montoDeCelda("MODELO")).toBeUndefined();
    expect(montoDeCelda(0)).toBeUndefined();
    expect(montoDeCelda(-500)).toBeUndefined();
    expect(montoDeCelda(null)).toBeUndefined();
  });
});
