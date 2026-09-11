import { prisma } from "@/lib/prisma";
import { INFO_STATUS } from "@/lib/constants";

// ============================================================
// PRECIOS PUBLICADOS EN DERCO.CL (Bloque E)
// ============================================================
//
// Los precios de derco.cl son una FUENTE DISTINTA de la lista interna:
// la web suele tener campanas que la lista comercial no refleja, y al
// reves. Por eso viven en su propio canal (DERCO_CL) y no se mezclan
// con el precio de lista -- antes si se mezclaban, y correr el
// importador pisaba el precio interno sin que nadie lo notara.

export const CANAL_DERCO = "DERCO_CL";

/** Cada cuanto tiene sentido volver a consultar la web. Consultarla en
 *  cada visita seria golpear un sitio ajeno sin necesidad: sus precios
 *  no cambian por hora. */
export const HORAS_FRESCURA = 24;

export type EstadoDerco = {
  /** Cuando se trajo por ultima vez informacion de derco.cl. */
  ultimaActualizacion: Date | null;
  horasDesdeActualizacion: number | null;
  /** true si conviene volver a consultar. */
  necesitaActualizar: boolean;
  /** Cuantos precios publicados hay guardados hoy. */
  preciosGuardados: number;
  /** Texto para mostrar en pantalla. */
  descripcion: string;
};

export async function obtenerEstadoDerco(): Promise<EstadoDerco> {
  const [ultimo, total] = await Promise.all([
    prisma.price.findFirst({
      where: { channel: CANAL_DERCO },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.price.count({ where: { channel: CANAL_DERCO, status: INFO_STATUS.ACTIVE } }),
  ]);

  if (!ultimo) {
    return {
      ultimaActualizacion: null,
      horasDesdeActualizacion: null,
      necesitaActualizar: true,
      preciosGuardados: 0,
      descripcion: "Nunca se han traído los precios publicados en derco.cl.",
    };
  }

  const horas = (Date.now() - ultimo.createdAt.getTime()) / 3_600_000;
  const necesita = horas >= HORAS_FRESCURA;

  return {
    ultimaActualizacion: ultimo.createdAt,
    horasDesdeActualizacion: horas,
    necesitaActualizar: necesita,
    preciosGuardados: total,
    descripcion: necesita
      ? `Los precios de derco.cl se trajeron hace ${Math.floor(horas)} horas. Conviene actualizarlos.`
      : `Precios de derco.cl actualizados hace ${horas < 1 ? "menos de una hora" : `${Math.floor(horas)} horas`}.`,
  };
}

export type DiferenciaDerco = {
  versionId: string;
  marca: string;
  modelo: string;
  version: string;
  precioInterno: number;
  precioDerco: number;
  diferencia: number;
  variacionPct: number;
};

/**
 * Donde el precio publicado en derco.cl NO coincide con el precio de
 * lista interno.
 *
 * Sirve para detectar dos cosas distintas: que la web tenga una
 * campana que la lista todavia no refleja, o que la lista interna este
 * desactualizada. En ambos casos el ejecutivo necesita saberlo ANTES
 * de comprometer un precio con el cliente, porque el cliente llega
 * habiendo visto la web.
 */
export async function diferenciasConDerco(): Promise<DiferenciaDerco[]> {
  const precios = await prisma.price.findMany({
    where: {
      status: INFO_STATUS.ACTIVE,
      priceType: "LIST",
      OR: [{ channel: "REGULAR" }, { channel: CANAL_DERCO }],
    },
    select: {
      versionId: true,
      amount: true,
      channel: true,
      version: { select: { name: true, brand: { select: { name: true } }, model: { select: { name: true } } } },
    },
    orderBy: { effectiveFrom: "desc" },
  });

  const internos = new Map<string, (typeof precios)[number]>();
  const dercos = new Map<string, (typeof precios)[number]>();

  for (const p of precios) {
    const destino = p.channel === CANAL_DERCO ? dercos : internos;
    if (!destino.has(p.versionId)) destino.set(p.versionId, p);
  }

  const diferencias: DiferenciaDerco[] = [];
  for (const [versionId, derco] of dercos) {
    const interno = internos.get(versionId);
    if (!interno || interno.amount === derco.amount) continue;

    const diferencia = derco.amount - interno.amount;
    diferencias.push({
      versionId,
      marca: derco.version.brand.name,
      modelo: derco.version.model.name,
      version: derco.version.name,
      precioInterno: interno.amount,
      precioDerco: derco.amount,
      diferencia,
      variacionPct: (diferencia / interno.amount) * 100,
    });
  }

  // Primero las diferencias mas grandes en plata.
  return diferencias.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
}
