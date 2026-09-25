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

/** Marca con la que se registra cada consulta a derco.cl en la bitacora. */
const TIPO_CONSULTA = "DERCO_SYNC";

export type EstadoDerco = {
  /** Cuando se CONSULTO por ultima vez derco.cl (aunque nada cambiara). */
  ultimaActualizacion: Date | null;
  horasDesdeActualizacion: number | null;
  /** true si conviene volver a consultar. */
  necesitaActualizar: boolean;
  /** Cuantos precios publicados hay guardados hoy. */
  preciosGuardados: number;
  /** Resumen de la ultima consulta, si existe. */
  ultimoResultado: { preciosCambiados: number; versionesCalzadas: number; sinCalce: number; incompleta: boolean } | null;
  /** Texto para mostrar en pantalla. */
  descripcion: string;
};

/**
 * Deja constancia de una consulta a derco.cl.
 *
 * Antes la "ultima actualizacion" se sacaba del precio mas nuevo. Pero
 * si derco.cl no cambia sus precios, no se crea ninguno nuevo, y la
 * pantalla decia "hace 300 horas" aunque se hubiera revisado esa misma
 * mañana. La consulta y el cambio de precio son cosas distintas.
 */
export async function registrarConsultaDerco(resumen: {
  preciosCambiados: number;
  versionesCalzadas: number;
  sinCalce: string[];
  incompleta: boolean;
  paginasLeidas: number;
  paginas: number;
  fallidas: { url: string }[];
}) {
  await prisma.auditLog.create({
    data: {
      entityType: TIPO_CONSULTA,
      fieldModified: "precios_publicados",
      newValue: String(resumen.preciosCambiados),
      source: "derco.cl",
      user: "actualizacion-automatica",
      observation: JSON.stringify({
        preciosCambiados: resumen.preciosCambiados,
        versionesCalzadas: resumen.versionesCalzadas,
        sinCalce: resumen.sinCalce.length,
        incompleta: resumen.incompleta,
        paginasLeidas: resumen.paginasLeidas,
        paginas: resumen.paginas,
        fallidas: resumen.fallidas.length,
      }),
    },
  });
}

export async function obtenerEstadoDerco(): Promise<EstadoDerco> {
  const [consulta, ultimoPrecio, total] = await Promise.all([
    prisma.auditLog.findFirst({
      where: { entityType: TIPO_CONSULTA },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, observation: true },
    }),
    prisma.price.findFirst({
      where: { channel: CANAL_DERCO },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.price.count({ where: { channel: CANAL_DERCO, status: INFO_STATUS.ACTIVE } }),
  ]);

  // Si nunca hubo consulta automatica, se usa el precio mas nuevo como
  // referencia (es lo que dejaba el script manual).
  const fecha = consulta?.createdAt ?? ultimoPrecio?.createdAt ?? null;

  let ultimoResultado: EstadoDerco["ultimoResultado"] = null;
  if (consulta?.observation) {
    try {
      const r = JSON.parse(consulta.observation);
      ultimoResultado = {
        preciosCambiados: Number(r.preciosCambiados) || 0,
        versionesCalzadas: Number(r.versionesCalzadas) || 0,
        sinCalce: Number(r.sinCalce) || 0,
        incompleta: Boolean(r.incompleta),
      };
    } catch {
      ultimoResultado = null;
    }
  }

  if (!fecha) {
    return {
      ultimaActualizacion: null,
      horasDesdeActualizacion: null,
      necesitaActualizar: true,
      preciosGuardados: 0,
      ultimoResultado,
      descripcion: "Nunca se han traído los precios publicados en derco.cl.",
    };
  }

  const horas = (Date.now() - fecha.getTime()) / 3_600_000;
  const necesita = horas >= HORAS_FRESCURA;
  const hace = horas < 1 ? "hace menos de una hora" : `hace ${Math.floor(horas)} horas`;

  return {
    ultimaActualizacion: fecha,
    horasDesdeActualizacion: horas,
    necesitaActualizar: necesita,
    preciosGuardados: total,
    ultimoResultado,
    descripcion: necesita
      ? `derco.cl se revisó por última vez ${hace}. Conviene actualizar.`
      : `derco.cl revisado ${hace}${
          ultimoResultado ? ` · ${ultimoResultado.preciosCambiados} precios cambiaron en esa revisión` : ""
        }.`,
  };
}

export type PreciosDerco = {
  /** Precio de lista publicado. */
  lista: number | null;
  /** Precio con bonos publicado (el que la web destaca). */
  conBonos: number | null;
  /** Cuando se guardo el precio mas reciente de los dos. */
  fecha: string | null;
};

/**
 * Los precios publicados en derco.cl, por version.
 *
 * NO se filtran por mes comercial, a proposito: son "lo que la web
 * muestra hoy". Si se filtraran, al cambiar el mes desaparecerian del
 * comparativo todos los que no cambiaron de precio, justo cuando mas
 * sirve compararlos.
 */
export async function preciosDercoVigentes(): Promise<Map<string, PreciosDerco>> {
  const precios = await prisma.price.findMany({
    where: { channel: CANAL_DERCO, status: INFO_STATUS.ACTIVE, priceType: { in: ["LIST", "CAMPAIGN"] } },
    select: { versionId: true, priceType: true, amount: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const porVersion = new Map<string, PreciosDerco>();
  for (const p of precios) {
    const actual = porVersion.get(p.versionId) ?? { lista: null, conBonos: null, fecha: null };
    if (p.priceType === "LIST" && actual.lista === null) actual.lista = p.amount;
    if (p.priceType === "CAMPAIGN" && actual.conBonos === null) actual.conBonos = p.amount;
    if (!actual.fecha) actual.fecha = p.createdAt.toISOString();
    porVersion.set(p.versionId, actual);
  }
  return porVersion;
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
