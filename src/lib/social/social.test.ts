import { beforeAll, describe, expect, it } from "vitest";
import { cifrar, descifrar, enmascarar } from "@/lib/social/secretos";
import { redactarCaption, validarCaption, type DatosVehiculo } from "@/lib/social/plantillas";

beforeAll(() => {
  process.env.PANEL360_SECRET_KEY = "llave-de-prueba-para-tests-1234";
});

const base: DatosVehiculo = {
  versionId: "v1",
  marca: "SUZUKI",
  modelo: "Swift",
  version: "GL 1.2",
  anio: "2026",
  motor: "1.2",
  transmision: "Manual",
  traccion: "4x2",
  combustible: "Bencina",
  equipamiento: "Pantalla 9 pulgadas",
  garantia: "3 anos",
  precio: 12990000,
  bonoNombre: "Bono Contado",
  bonoMonto: 500000,
  mesComercial: "2026-09",
};

describe("cifrado del token", () => {
  it("devuelve el mismo texto al descifrar", () => {
    const token = "EAAGabcdefghijklmnop1234567890";
    expect(descifrar(cifrar(token))).toBe(token);
  });

  it("produce un cifrado distinto cada vez (IV aleatorio)", () => {
    expect(cifrar("mismo")).not.toBe(cifrar("mismo"));
  });

  it("falla si el texto cifrado fue alterado", () => {
    const guardado = cifrar("token");
    const [iv, tag, cuerpo] = guardado.split(".");
    const alterado = [iv, tag, Buffer.from("otracosa").toString("base64")].join(".");
    expect(() => descifrar(alterado)).toThrow();
  });

  it("no revela el token al enmascarar", () => {
    const token = "EAAGabcdefghijklmnop1234567890";
    const visible = enmascarar(token);
    expect(visible).not.toContain("hijklmnop");
    expect(visible).toContain("...");
  });
});

describe("redaccion del caption", () => {
  it("incluye el precio y el bono cuando existen", () => {
    const caption = redactarCaption("LANZAMIENTO", base);
    expect(caption).toContain("SUZUKI Swift GL 1.2 2026");
    expect(caption).toContain("12.990.000");
    expect(caption).toContain("Bono Contado");
  });

  it("no inventa un precio cuando no hay lista vigente", () => {
    const caption = redactarCaption("LANZAMIENTO", { ...base, precio: null, bonoMonto: null });
    expect(caption).toContain("consultar por interno");
    expect(caption).not.toContain("12.990.000");
  });

  it("agrega hashtags de marca y modelo", () => {
    const caption = redactarCaption("STOCK", base);
    expect(caption).toContain("#Suzuki");
    expect(caption).toContain("#SuzukiSwift");
  });
});

describe("validacion del caption", () => {
  it("rechaza un caption vacio", () => {
    expect(validarCaption("   ")).toContain("vacio");
  });

  it("rechaza mas de 2200 caracteres", () => {
    expect(validarCaption("a".repeat(2201))).toContain("2200");
  });

  it("rechaza mas de 30 hashtags", () => {
    expect(validarCaption("#tag ".repeat(31))).toContain("30");
  });

  it("acepta un caption normal", () => {
    expect(validarCaption(redactarCaption("FIN_DE_MES", base))).toBeNull();
  });
});
