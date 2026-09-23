import { pareceVehiculoComercial } from "@/lib/importers/iva";
import { interpretarMesComercial, nombreMesComercial } from "@/lib/mes-comercial";

// ============================================================
// QUE TRAE ESTE ARCHIVO, ANTES DE CONFIRMARLO (Bloque C)
// ============================================================
//
// Aprobar una lista es meter cientos de precios a la vez a las
// pantallas que usa el ejecutivo frente al cliente. Conviene poder
// mirar primero que se detecto, en una linea, en vez de revisar 500
// filas o aprobar a ciegas.

export type ResumenCarga = {
  marcas: string[];
  periodo: string | null;
  modelos: number;
  versiones: number;
  precios: number;
  preciosConIva: number;
  preciosNetos: number;
  comerciales: number;
  bonos: number;
  campanas: number;
  /** Filas que no se pueden aprobar tal como estan. */
  inconsistencias: number;
  /** Los motivos concretos, agrupados y contados. */
  motivos: { motivo: string; filas: number }[];
  /** De que se componen los precios: cada version trae varios (lista,
   *  contado, financiamiento...). Sin esto el total parece inflado:
   *  33 versiones pueden dar 124 precios y nadie entiende por que. */
  porTipo: { tipo: string; filas: number }[];
};

type ItemResumible = {
  category: string;
  fieldName?: string | null;
  brandName: string | null;
  modelName: string | null;
  versionName: string | null;
  confidence: string;
  ambiguityReason: string | null;
  payloadJson: string | null;
  rawText: string;
};

function leerPayload(json: string | null): { hasIva?: boolean | null } {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function resumirCarga(items: ItemResumible[], tituloCarga?: string | null): ResumenCarga {
  const precios = items.filter((i) => i.category === "PRECIO");

  const marcas = [...new Set(precios.map((i) => i.brandName).filter((m): m is string => Boolean(m)))].sort();
  const modelos = new Set(precios.map((i) => i.modelName).filter(Boolean));
  const versiones = new Set(
    precios.map((i) => `${i.modelName ?? ""}|${i.versionName ?? ""}`).filter((v) => v !== "|")
  );

  let preciosNetos = 0;
  let comerciales = 0;
  for (const p of precios) {
    if (leerPayload(p.payloadJson).hasIva) preciosNetos++;
    if (pareceVehiculoComercial(`${p.modelName ?? ""} ${p.versionName ?? ""}`)) comerciales++;
  }

  // Las filas que necesitan una decision humana antes de entrar.
  const conProblema = items.filter(
    (i) => i.confidence === "AMBIGUA" || Boolean(i.ambiguityReason)
  );

  const porTipoMapa = new Map<string, number>();
  for (const p of precios) {
    const tipo = p.fieldName?.trim() || "Sin tipo";
    porTipoMapa.set(tipo, (porTipoMapa.get(tipo) ?? 0) + 1);
  }

  const porMotivo = new Map<string, number>();
  for (const item of conProblema) {
    const motivo = item.ambiguityReason ?? "Sin identificar";
    porMotivo.set(motivo, (porMotivo.get(motivo) ?? 0) + 1);
  }

  const periodoDetectado =
    interpretarMesComercial(tituloCarga) ??
    interpretarMesComercial(precios[0]?.rawText ?? null);

  return {
    marcas,
    porTipo: [...porTipoMapa.entries()].map(([tipo, filas]) => ({ tipo, filas })).sort((a, b) => b.filas - a.filas),
    periodo: periodoDetectado ? nombreMesComercial(periodoDetectado) : null,
    modelos: modelos.size,
    versiones: versiones.size,
    precios: precios.length,
    preciosNetos,
    preciosConIva: precios.length - preciosNetos,
    comerciales,
    bonos: items.filter((i) => i.category === "BONO").length,
    campanas: items.filter((i) => i.category === "CAMPAÑA").length,
    inconsistencias: conProblema.length,
    motivos: [...porMotivo.entries()]
      .map(([motivo, filas]) => ({ motivo, filas }))
      .sort((a, b) => b.filas - a.filas),
  };
}
