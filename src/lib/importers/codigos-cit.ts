import { normalizeText } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import type { IndiceCodigos } from "@/lib/importers/excel";

// ============================================================
// CODIGOS CIT AL CATALOGO
// ============================================================
//
// El CIT identifica la version ante el SII: sin el no se puede calcular
// el impuesto verde, y el vehiculo aparece como "CIT pendiente".
//
// Antes el codigo solo se escribia al APROBAR un precio. Eso ata dos
// cosas que no tienen por que ir juntas: si la aprobacion no calzaba
// ninguna version, el CIT tampoco entraba, y el usuario veia 23
// vehiculos con "CIT pendiente" despues de subir una lista que TRAIA
// los codigos.
//
// Ahora se aplican al subir, como paso propio.

export type ResultadoCodigos = {
  completados: number;
  yaTenian: number;
  sinCalce: string[];
};

function clave(modelo: string, version: string) {
  return normalizeText(`${modelo} ${version}`).replace(/\s+/g, " ").trim();
}

/**
 * Escribe en el catalogo los codigos CIT que venian en el Excel.
 *
 * Solo completa los que faltan: nunca pisa un codigo ya cargado, porque
 * un CIT equivocado manda mal el impuesto verde y el error queda
 * invisible.
 */
export async function aplicarCodigosAlCatalogo(indice: IndiceCodigos): Promise<ResultadoCodigos> {
  if (indice.cit.size === 0) return { completados: 0, yaTenian: 0, sinCalce: [] };

  const versiones = await prisma.version.findMany({
    include: { model: true },
  });

  // Indice del catalogo por "modelo version" y por "version" sola. Las
  // claves de version sola que se repiten se descartan: si dos versiones
  // de modelos distintos se llaman igual, calzar por nombre suelto
  // pondria el codigo en la equivocada.
  const porModeloVersion = new Map<string, string>();
  const porVersion = new Map<string, string | null>();

  for (const v of versiones) {
    porModeloVersion.set(clave(v.model.name, v.name), v.id);
    const soloVersion = clave("", v.name);
    porVersion.set(soloVersion, porVersion.has(soloVersion) ? null : v.id);
  }

  const asignaciones = new Map<string, string>();
  const sinCalce: string[] = [];

  for (const [claveExcel, codigo] of indice.cit) {
    const id = porModeloVersion.get(claveExcel) ?? porVersion.get(claveExcel) ?? null;
    if (!id) {
      if (!sinCalce.includes(claveExcel)) sinCalce.push(claveExcel);
      continue;
    }
    if (!asignaciones.has(id)) asignaciones.set(id, codigo);
  }

  let completados = 0;
  let yaTenian = 0;

  for (const [versionId, codigo] of asignaciones) {
    const actualizadas = await prisma.version.updateMany({
      where: { id: versionId, OR: [{ sapCode: null }, { sapCode: "" }] },
      data: { sapCode: codigo },
    });
    if (actualizadas.count > 0) completados++;
    else yaTenian++;
  }

  return { completados, yaTenian, sinCalce: sinCalce.slice(0, 20) };
}
