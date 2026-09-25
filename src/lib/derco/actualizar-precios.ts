import { INFO_STATUS } from "@/lib/constants";
import { cargarCandidatas, calzarVersion } from "@/lib/importers/aprobar-precios";
import { mesComercialActual } from "@/lib/mes-comercial";
import { prisma } from "@/lib/prisma";
import { CANAL_DERCO, registrarConsultaDerco } from "@/lib/derco/estado";
import {
  DERCO_VEHICLES_SITEMAP,
  MARCAS_DERCO,
  parseDercoPage,
  pricePairFromSpecs,
  slugMarca,
} from "@/lib/derco/parser";

// ============================================================
// ACTUALIZACION DIARIA DE PRECIOS DE DERCO.CL
// ============================================================
//
// Antes los precios de derco.cl solo se traian corriendo un script a
// mano desde un computador. Nadie lo corria, asi que el comparativo
// mostraba precios de hace semanas como si fueran de hoy.
//
// Esto corre solo, una vez al dia, y hace UNA cosa: traer los precios
// publicados y guardarlos en el canal DERCO_CL. No crea versiones ni
// modelos, no baja fichas tecnicas y no escribe en disco -- eso sigue
// siendo trabajo del importador del catalogo. Una version que existe en
// la web pero no en el catalogo se informa, no se inventa.
//
// Es cuidadoso con un sitio ajeno: pocas consultas a la vez, con tiempo
// limite cada una, y se identifica.

const AGENTE = "Panel360Autos/1.0 (comparativo diario de precios publicados)";
const TIEMPO_POR_PAGINA_MS = 15_000;

export type ResultadoActualizacionDerco = {
  paginas: number;
  paginasLeidas: number;
  versionesEncontradas: number;
  versionesCalzadas: number;
  preciosCambiados: number;
  preciosIguales: number;
  sinCalce: string[];
  fallidas: { url: string; error: string }[];
  /** true si se acabo el tiempo antes de leer todas las paginas. */
  incompleta: boolean;
  duracionMs: number;
};

async function traer(url: string) {
  const respuesta = await fetch(url, {
    headers: { "User-Agent": AGENTE, Accept: "text/html,application/xml" },
    signal: AbortSignal.timeout(TIEMPO_POR_PAGINA_MS),
    cache: "no-store",
  });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  return respuesta.text();
}

type Cambio = { versionId: string; priceType: "LIST" | "CAMPAIGN"; amount: number; fuente: string };

/**
 * Trae los precios publicados en derco.cl y actualiza los que cambiaron.
 *
 * `presupuestoMs` es el tiempo maximo para LEER paginas: si se acaba, se
 * guarda lo que alcanzo y se marca como incompleta, en vez de que el
 * servidor corte a la mitad sin dejar registro.
 */
export async function actualizarPreciosDerco(
  opciones: { presupuestoMs?: number; concurrencia?: number } = {}
): Promise<ResultadoActualizacionDerco> {
  const inicio = Date.now();
  const presupuesto = opciones.presupuestoMs ?? 35_000;
  const concurrencia = opciones.concurrencia ?? 4;

  const resultado: ResultadoActualizacionDerco = {
    paginas: 0,
    paginasLeidas: 0,
    versionesEncontradas: 0,
    versionesCalzadas: 0,
    preciosCambiados: 0,
    preciosIguales: 0,
    sinCalce: [],
    fallidas: [],
    incompleta: false,
    duracionMs: 0,
  };

  const sitemap = await traer(DERCO_VEHICLES_SITEMAP);
  const urls = [...new Set([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]))].filter((url) => {
    const slug = slugMarca(url);
    return slug ? MARCAS_DERCO.has(slug) : false;
  });
  resultado.paginas = urls.length;

  // Todo lo que se necesita de la base se carga UNA vez al principio. La
  // base y el servidor pueden estar lejos: cien consultas sueltas serian
  // la diferencia entre terminar a tiempo o no.
  const [candidatas, vigentes] = await Promise.all([
    cargarCandidatas(),
    prisma.price.findMany({
      where: { channel: CANAL_DERCO, status: INFO_STATUS.ACTIVE, priceType: { in: ["LIST", "CAMPAIGN"] } },
      select: { versionId: true, priceType: true, amount: true },
    }),
  ]);
  const vigentePorClave = new Map(vigentes.map((p) => [`${p.versionId}|${p.priceType}`, p.amount]));

  const cambios = new Map<string, Cambio>();
  const cola = [...urls];

  async function trabajador() {
    for (;;) {
      const url = cola.shift();
      if (!url) return;
      if (Date.now() - inicio > presupuesto) {
        resultado.incompleta = true;
        return;
      }
      try {
        const modelo = parseDercoPage(url, await traer(url));
        resultado.paginasLeidas++;
        if (!modelo) {
          resultado.fallidas.push({ url, error: "La pagina no trae la tabla de versiones." });
          continue;
        }

        for (const version of modelo.versions) {
          resultado.versionesEncontradas++;
          const encontrada = calzarVersion(
            { brandName: modelo.brandName, modelName: modelo.modelName, versionName: version.name },
            candidatas
          );
          if (!encontrada) {
            const etiqueta = `${modelo.brandName} ${modelo.modelName} ${version.name}`;
            if (resultado.sinCalce.length < 30) resultado.sinCalce.push(etiqueta);
            continue;
          }
          resultado.versionesCalzadas++;

          const { list, campaign } = pricePairFromSpecs(version.specs);
          const fuente = `derco.cl ${modelo.brandName} ${modelo.modelName}`;
          for (const [priceType, amount] of [
            ["LIST", list],
            ["CAMPAIGN", campaign],
          ] as const) {
            if (!amount) continue;
            const clave = `${encontrada.id}|${priceType}`;
            if (vigentePorClave.get(clave) === amount) {
              resultado.preciosIguales++;
              continue;
            }
            // Si dos paginas apuntan a la misma version, gana la primera:
            // elegir entre las dos seria inventar.
            if (!cambios.has(clave)) cambios.set(clave, { versionId: encontrada.id, priceType, amount, fuente });
          }
        }
      } catch (error) {
        resultado.fallidas.push({ url, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrencia, urls.length || 1) }, trabajador));

  // Solo se escribe lo que cambio. Un dia normal son pocos precios o
  // ninguno, asi que casi no hay escrituras.
  const mes = mesComercialActual();
  for (const cambio of cambios.values()) {
    await prisma.$transaction(async (tx) => {
      const anterior = await tx.price.findFirst({
        where: { versionId: cambio.versionId, priceType: cambio.priceType, channel: CANAL_DERCO, status: INFO_STATUS.ACTIVE },
        orderBy: { effectiveFrom: "desc" },
      });
      if (anterior) {
        await tx.price.update({
          where: { id: anterior.id },
          data: { status: INFO_STATUS.REPLACED, effectiveTo: new Date() },
        });
      }
      const nuevo = await tx.price.create({
        data: {
          versionId: cambio.versionId,
          priceType: cambio.priceType,
          amount: cambio.amount,
          channel: CANAL_DERCO,
          mesComercial: mes,
          status: INFO_STATUS.ACTIVE,
          approvedBy: "derco.cl (automatico)",
        },
      });
      await tx.priceHistory.create({
        data: {
          versionId: cambio.versionId,
          priceId: nuevo.id,
          priceType: cambio.priceType,
          previousAmount: anterior?.amount ?? null,
          newAmount: cambio.amount,
          difference: anterior ? cambio.amount - anterior.amount : null,
          sourceName: cambio.fuente,
          approvedBy: "derco.cl (automatico)",
          observation:
            cambio.priceType === "CAMPAIGN"
              ? "Precio con bonos publicado en derco.cl (actualizacion diaria)."
              : "Precio de lista publicado en derco.cl (actualizacion diaria).",
        },
      });
    });
    resultado.preciosCambiados++;
  }

  resultado.duracionMs = Date.now() - inicio;
  await registrarConsultaDerco(resultado);
  return resultado;
}
