import { prisma } from "@/lib/prisma";
import { INFO_STATUS } from "@/lib/constants";
import { mesComercialActual, mesComercialAnterior, nombreMesComercial } from "@/lib/mes-comercial";

// ============================================================
// QUE CAMBIO ESTE MES (Bloque D)
// ============================================================
//
// Compara el mes comercial en curso contra el anterior, version por
// version y tipo de precio por tipo de precio.
//
// Se compara contra el HISTORIAL, no contra lo que este vigente hoy:
// los precios del mes pasado siguen en la base marcados REEMPLAZADO, y
// esa es justamente la fotografia que permite decir "en agosto costaba
// X". Por eso el sistema nunca borra un precio al reemplazarlo.

export type TipoCambio = "SUBIO" | "BAJO" | "IGUAL" | "NUEVO" | "RETIRADO";

export type CambioPrecio = {
  versionId: string;
  marca: string;
  modelo: string;
  version: string;
  tipoPrecio: string;
  montoAnterior: number | null;
  montoActual: number | null;
  diferencia: number | null;
  variacionPct: number | null;
  tipo: TipoCambio;
};

export type ResumenCambios = {
  mesActual: string;
  mesAnterior: string;
  nombreMesActual: string;
  nombreMesAnterior: string;
  /** true si no hay datos del mes anterior con que comparar. */
  sinComparacion: boolean;
  subieron: number;
  bajaron: number;
  iguales: number;
  nuevos: number;
  retirados: number;
  cambios: CambioPrecio[];
};

/** Etiqueta legible de un tipo de precio. */
export const ETIQUETA_TIPO: Record<string, string> = {
  LIST: "Lista",
  CASH: "Contado",
  FINANCING: "Financiamiento",
  CAMPAIGN: "Campaña",
};

type PrecioComparable = {
  versionId: string;
  priceType: string;
  amount: number;
  version: { name: string; brand: { name: string }; model: { name: string } };
};

function clave(p: { versionId: string; priceType: string }) {
  return `${p.versionId}|${p.priceType}`;
}

/**
 * Compara dos meses comerciales.
 *
 * Si no se indican, compara el mes en curso contra el anterior.
 */
export async function compararMeses(params?: {
  mesActual?: string;
  mesAnterior?: string;
}): Promise<ResumenCambios> {
  const mesActual = params?.mesActual ?? mesComercialActual();
  const mesAnterior = params?.mesAnterior ?? mesComercialAnterior(mesActual);

  const incluirVersion = {
    version: { select: { name: true, brand: { select: { name: true } }, model: { select: { name: true } } } },
  };

  const [preciosActuales, preciosAnteriores] = await Promise.all([
    // Del mes en curso interesa lo que esta vigente.
    prisma.price.findMany({
      where: { mesComercial: mesActual, status: INFO_STATUS.ACTIVE },
      select: { versionId: true, priceType: true, amount: true, ...incluirVersion },
    }),
    // Del mes anterior interesa lo que RIGIO, aunque hoy este
    // reemplazado -- esa es la fotografia historica.
    prisma.price.findMany({
      where: { mesComercial: mesAnterior },
      select: { versionId: true, priceType: true, amount: true, effectiveFrom: true, ...incluirVersion },
      orderBy: { effectiveFrom: "desc" },
    }),
  ]);

  // Del mes anterior puede haber varias filas por version+tipo (se fue
  // reemplazando dentro del mes): vale la ultima.
  const anterioresPorClave = new Map<string, PrecioComparable>();
  for (const p of preciosAnteriores) {
    if (!anterioresPorClave.has(clave(p))) anterioresPorClave.set(clave(p), p);
  }

  const actualesPorClave = new Map<string, PrecioComparable>();
  for (const p of preciosActuales) {
    if (!actualesPorClave.has(clave(p))) actualesPorClave.set(clave(p), p);
  }

  const cambios: CambioPrecio[] = [];

  for (const [k, actual] of actualesPorClave) {
    const anterior = anterioresPorClave.get(k);
    const montoAnterior = anterior?.amount ?? null;
    const diferencia = montoAnterior === null ? null : actual.amount - montoAnterior;

    cambios.push({
      versionId: actual.versionId,
      marca: actual.version.brand.name,
      modelo: actual.version.model.name,
      version: actual.version.name,
      tipoPrecio: actual.priceType,
      montoAnterior,
      montoActual: actual.amount,
      diferencia,
      variacionPct:
        montoAnterior && montoAnterior !== 0 && diferencia !== null
          ? (diferencia / montoAnterior) * 100
          : null,
      tipo:
        montoAnterior === null ? "NUEVO" : diferencia! > 0 ? "SUBIO" : diferencia! < 0 ? "BAJO" : "IGUAL",
    });
  }

  // Lo que existia el mes pasado y este mes ya no aparece.
  for (const [k, anterior] of anterioresPorClave) {
    if (actualesPorClave.has(k)) continue;
    cambios.push({
      versionId: anterior.versionId,
      marca: anterior.version.brand.name,
      modelo: anterior.version.model.name,
      version: anterior.version.name,
      tipoPrecio: anterior.priceType,
      montoAnterior: anterior.amount,
      montoActual: null,
      diferencia: null,
      variacionPct: null,
      tipo: "RETIRADO",
    });
  }

  // Primero lo que mas cambio en plata: es lo que el ejecutivo necesita
  // ver antes de cotizar.
  cambios.sort((a, b) => Math.abs(b.diferencia ?? 0) - Math.abs(a.diferencia ?? 0));

  return {
    mesActual,
    mesAnterior,
    nombreMesActual: nombreMesComercial(mesActual),
    nombreMesAnterior: nombreMesComercial(mesAnterior),
    // Sin datos del mes anterior no hay nada que comparar, y decirlo es
    // mejor que mostrar 165 "versiones nuevas" que en realidad son las
    // de siempre.
    sinComparacion: anterioresPorClave.size === 0,
    subieron: cambios.filter((c) => c.tipo === "SUBIO").length,
    bajaron: cambios.filter((c) => c.tipo === "BAJO").length,
    iguales: cambios.filter((c) => c.tipo === "IGUAL").length,
    nuevos: cambios.filter((c) => c.tipo === "NUEVO").length,
    retirados: cambios.filter((c) => c.tipo === "RETIRADO").length,
    cambios,
  };
}
