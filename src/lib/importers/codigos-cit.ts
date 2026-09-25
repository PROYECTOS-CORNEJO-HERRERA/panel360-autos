import { prisma } from "@/lib/prisma";
import { cargarCandidatas, calzarVersion } from "@/lib/importers/aprobar-precios";
import type { IndiceCodigos } from "@/lib/importers/excel";

// ============================================================
// CODIGOS CIT AL CATALOGO
// ============================================================
//
// El CIT identifica la version ante el SII: sin el no se puede calcular
// el impuesto verde, y el vehiculo aparece como "CIT pendiente".
//
// Dos cosas lo rompian antes:
//
//  1. El codigo solo se escribia al APROBAR un precio, asi que si la
//     fila de precio no calzaba, el CIT tampoco entraba -- aunque el
//     archivo lo trajera. Ahora se aplica al subir, como paso propio.
//
//  2. Se calzaba por nombre exacto. El catalogo llama a la version
//     "C21 1.3" y el Excel dice "Cargo Box CS C21 1.3": no calzaba
//     nunca. Ahora se usa el MISMO buscador que los precios, que
//     compara de la forma estricta a la flexible y solo acepta
//     resultados unicos.

export type ResultadoCodigos = {
  completados: number;
  yaTenian: number;
  sinCalce: string[];
};

export async function aplicarCodigosAlCatalogo(indice: IndiceCodigos): Promise<ResultadoCodigos> {
  if (indice.entradasCit.length === 0) return { completados: 0, yaTenian: 0, sinCalce: [] };

  const asignaciones = new Map<string, string>();
  const sinCalce: string[] = [];
  // Una sola carga del catalogo para todos los codigos.
  const candidatas = await cargarCandidatas();

  for (const entrada of indice.entradasCit) {
    const version = calzarVersion(
      { modelName: entrada.modelo || null, versionName: entrada.version || null },
      candidatas
    );

    if (!version) {
      const etiqueta = `${entrada.modelo} ${entrada.version}`.replace(/\s+/g, " ").trim();
      if (etiqueta && !sinCalce.includes(etiqueta)) sinCalce.push(etiqueta);
      continue;
    }

    // Si dos filas apuntan a la misma version con codigos distintos, se
    // queda la primera: adivinar cual manda seria inventar.
    if (!asignaciones.has(version.id)) asignaciones.set(version.id, entrada.codigo);
  }

  let completados = 0;
  let yaTenian = 0;

  for (const [versionId, codigo] of asignaciones) {
    // Nunca se pisa un codigo ya cargado: un CIT equivocado manda mal el
    // impuesto verde y el error queda invisible.
    const actualizadas = await prisma.version.updateMany({
      where: { id: versionId, OR: [{ sapCode: null }, { sapCode: "" }] },
      data: { sapCode: codigo },
    });
    if (actualizadas.count > 0) completados++;
    else yaTenian++;
  }

  return { completados, yaTenian, sinCalce: sinCalce.slice(0, 20) };
}
