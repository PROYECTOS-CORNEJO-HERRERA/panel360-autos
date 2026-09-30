import { describe, expect, it } from "vitest";
import { resolverMesEnUso } from "@/lib/precios";

const septiembre = new Date("2026-09-15T12:00:00-03:00");

describe("resolverMesEnUso", () => {
  it("no avisa nada cuando existe la lista del mes en curso", () => {
    const r = resolverMesEnUso(["2026-09", "2026-08"], { ahora: septiembre });
    expect(r.mes).toBe("2026-09");
    expect(r.esDesactualizado).toBe(false);
    expect(r.aviso).toBeNull();
  });

  it("muestra el mes anterior DICIENDO que es de otro mes", () => {
    const r = resolverMesEnUso(["2026-08"], { ahora: septiembre });
    expect(r.mes).toBe("2026-08");
    expect(r.esDesactualizado).toBe(true);
    expect(r.aviso).toContain("agosto");
  });

  it("solo dice que no hay listas cuando de verdad no hay ningun precio", () => {
    const r = resolverMesEnUso([], { ahora: septiembre });
    expect(r.aviso).toContain("No hay listas de precios cargadas");
  });

  // El bug real: 514 precios VIGENTE, todos con mesComercial null.
  // mesesConPrecios() los descartaba, la lista llegaba vacia y la
  // pantalla anunciaba en rojo que no habia precios -- con los precios
  // visibles en la misma pantalla.
  it("NO dice que no hay listas cuando hay precios sin mes asignado", () => {
    const r = resolverMesEnUso([], { hayPreciosSinMes: true, ahora: septiembre });
    expect(r.aviso).not.toContain("No hay listas de precios cargadas");
    expect(r.aviso).toContain("mes comercial");
    expect(r.mes).toBe("2026-09");
    expect(r.esDesactualizado).toBe(false);
  });
});
