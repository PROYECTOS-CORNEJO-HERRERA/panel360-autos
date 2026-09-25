import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { INFO_STATUS } from "@/lib/constants";
import { interpretarMesComercial, mesComercialActual } from "@/lib/mes-comercial";
import { normalizeText } from "@/lib/format";

// ============================================================
// DE UNA FILA DETECTADA A UN PRECIO REAL (Bloque C)
// ============================================================
//
// Hasta ahora el importador de Excel NUNCA escribio precios. Leia el
// archivo, creaba "propuestas" (UpdateItem) y ahi moria la cadena:
// aprobar una fila solo la marcaba EN_REVISION. Los 1.961 precios que
// existen entraron por scripts sueltos corridos a mano.
//
// Por eso "no se puede cargar la lista de septiembre": no es que falle,
// es que ese camino nunca se termino de construir.

/** "Precio lista" -> "LIST". El importador escribe etiquetas legibles;
 *  la base guarda codigos. */
const TIPO_POR_ETIQUETA: Record<string, string> = {
  "precio lista": "LIST",
  "precio contado": "CASH",
  "precio financiamiento": "FINANCING",
  "precio campana": "CAMPAIGN",
  "precio derco.cl": "LIST", // mismo tipo, distinto canal
  "precio preventa": "LIST",
};

/** El canal va aparte del tipo: Derco.cl y Preventa son el mismo
 *  "precio lista" pero de otra fuente. */
const CANAL_POR_ETIQUETA: Record<string, string> = {
  "precio derco.cl": "DERCO_CL",
  "precio preventa": "PREVENTA",
};

export type ResultadoAprobacion =
  | { ok: true; precioId: string; versionId: string }
  | { ok: false; motivo: string };

type PayloadPrecio = {
  citCode?: string | null;
  channel?: string | null;
  bonusName?: string | null;
  bonusAmount?: number | null;
  hasIva?: boolean | null;
};

function leerPayload(json: string | null): PayloadPrecio {
  if (!json) return {};
  try {
    return JSON.parse(json) as PayloadPrecio;
  } catch {
    return {};
  }
}

/** Lo minimo del catalogo que hace falta para calzar una fila con una version. */
export type CandidataVersion = {
  id: string;
  name: string;
  sapCode: string | null;
  brand: { name: string };
  model: { name: string };
};

export type CriterioVersion = {
  brandName?: string | null;
  modelName?: string | null;
  versionName?: string | null;
  citCode?: string | null;
};

/**
 * Carga el catalogo UNA vez.
 *
 * Quien calza muchas filas seguidas (una lista completa, los codigos CIT,
 * la actualizacion diaria de derco.cl) debe cargarlo antes y pasarlo.
 * Antes cada fila volvia a traer el catalogo entero desde la base: una
 * lista de 118 precios eran 118 cargas completas, y por eso el boton
 * "Aprobar" se quedaba sin tiempo a mitad de camino.
 */
export function cargarCandidatas(): Promise<CandidataVersion[]> {
  return prisma.version.findMany({
    select: {
      id: true,
      name: true,
      sapCode: true,
      brand: { select: { name: true } },
      model: { select: { name: true } },
    },
  });
}

/**
 * Encuentra la version del catalogo a la que apunta una fila, sin tocar
 * la base.
 *
 * Devuelve null si no hay UNA sola coincidencia clara. Es deliberado:
 * asociar un precio a la version equivocada es peor que no cargarlo,
 * porque el error queda invisible -- el ejecutivo ve un precio que
 * parece normal y no tiene como sospechar. Ante duda, la fila queda
 * pendiente y una persona decide.
 */
export function calzarVersion(params: CriterioVersion, candidatas: CandidataVersion[]): { id: string } | null {
  const { brandName, modelName, versionName, citCode } = params;

  // El codigo CIT identifica la version de forma exacta, asi que manda
  // sobre el calce por nombre. En marcas como DFSK el codigo viene en
  // otra hoja del Excel, y el indice del importador lo trae hasta aca.
  if (citCode) {
    const porCodigo = candidatas.filter((v) => v.sapCode === citCode);
    if (porCodigo.length === 1) return { id: porCodigo[0].id };
  }

  if (!modelName && !versionName) return null;

  const nBrand = brandName ? normalizeText(brandName) : null;
  const nModel = modelName ? normalizeText(modelName) : null;
  const nVersion = versionName ? normalizeText(versionName) : null;

  // Las listas escriben la version con el modelo y la carroceria
  // adelante: el catalogo la llama "C21 1.3" y el Excel dice "Cargo Box
  // CS C21 1.3". Comparar el texto completo no calzaba NUNCA, y por eso
  // decenas de filas buenas quedaban "requieren revision" -- el problema
  // era del sistema, no de la lista.
  //
  // Se compara en tres pasadas, de la mas estricta a la mas flexible, y
  // en todas se exige que el resultado sea UNICO. Si hay dos candidatas
  // se prefiere no elegir: un precio en la version equivocada es un
  // error que nadie ve.
  const mismoModelo = candidatas.filter((v) => {
    if (nBrand && normalizeText(v.brand.name) !== nBrand) return false;
    if (nModel && normalizeText(v.model.name) !== nModel) return false;
    return true;
  });

  if (!nVersion) {
    return mismoModelo.length === 1 ? { id: mismoModelo[0].id } : null;
  }

  // 1) Nombre identico.
  const exactas = mismoModelo.filter((v) => normalizeText(v.name) === nVersion);
  if (exactas.length === 1) return { id: exactas[0].id };
  if (exactas.length > 1) return null;

  // 2) El nombre del catalogo esta contenido en el del Excel ("c21 1.3"
  //    dentro de "cargo box cs c21 1.3"), o al reves. Se toma la
  //    coincidencia mas larga: entre "c21 1.3" y "c21 1.3 ac" gana la
  //    que use mas del texto, que es la mas especifica.
  const contenidas = mismoModelo.filter((v) => {
    const n = normalizeText(v.name);
    if (!n) return false;
    return nVersion.includes(n) || n.includes(nVersion);
  });

  if (contenidas.length === 1) return { id: contenidas[0].id };

  if (contenidas.length > 1) {
    const ordenadas = [...contenidas].sort((a, b) => normalizeText(b.name).length - normalizeText(a.name).length);
    const largo = normalizeText(ordenadas[0].name).length;
    const empatadas = ordenadas.filter((v) => normalizeText(v.name).length === largo);
    return empatadas.length === 1 ? { id: empatadas[0].id } : null;
  }

  return null;
}

/** Igual que calzarVersion, pero carga el catalogo si no se lo pasan. */
export async function buscarVersion(
  params: CriterioVersion,
  candidatas?: CandidataVersion[]
): Promise<{ id: string } | null> {
  return calzarVersion(params, candidatas ?? (await cargarCandidatas()));
}

type ItemConCarga = Prisma.UpdateItemGetPayload<{ include: { update: true } }>;

/** Tipo y canal de precio de una fila, a partir de su etiqueta. */
function tipoYCanal(item: { fieldName: string | null; payloadJson: string | null }) {
  const etiqueta = normalizeText(item.fieldName ?? "");
  const payload = leerPayload(item.payloadJson);
  return {
    priceType: TIPO_POR_ETIQUETA[etiqueta] ?? null,
    channel: CANAL_POR_ETIQUETA[etiqueta] ?? payload.channel ?? "REGULAR",
    payload,
  };
}

/**
 * Convierte UNA fila ya cargada en un precio vigente.
 *
 * Reemplaza el precio anterior del mismo tipo/canal (no lo borra: queda
 * REEMPLAZADO, que es como el sistema conserva el historial) y deja
 * registro en PriceHistory.
 */
async function aprobarItemCargado(
  item: ItemConCarga,
  candidatas: CandidataVersion[],
  aprobadoPor?: string
): Promise<ResultadoAprobacion> {
  if (item.category !== "PRECIO") return { ok: false, motivo: "Esta fila no es un precio." };
  if (!item.amount || item.amount <= 0) return { ok: false, motivo: "La fila no tiene un monto valido." };

  const { priceType, channel, payload } = tipoYCanal(item);
  const version = calzarVersion({ ...item, citCode: payload.citCode }, candidatas);

  if (!version) {
    // No se adivina: se explica por que quedo pendiente.
    const nombre = `${item.brandName ?? ""} ${item.modelName ?? ""} ${item.versionName ?? ""}`.replace(/\s+/g, " ").trim();
    await prisma.updateItem.update({
      where: { id: item.id },
      data: {
        status: INFO_STATUS.IN_REVIEW,
        ambiguityReason: `No se pudo identificar una unica version para "${nombre}" en el catalogo. Corrige el nombre o crea la version antes de aprobar.`,
      },
    });
    return { ok: false, motivo: "No se encontro una unica version que calce con esa fila." };
  }

  if (!priceType) return { ok: false, motivo: `No se reconoce el tipo de precio "${item.fieldName}".` };

  // Si la lista traia el CIT y el catalogo no lo tenia, se completa. Asi
  // el codigo deja de faltar para el impuesto verde del SII sin que nadie
  // tenga que escribirlo a mano.
  if (payload.citCode) {
    await prisma.version.updateMany({
      where: { id: version.id, OR: [{ sapCode: null }, { sapCode: "" }] },
      data: { sapCode: payload.citCode },
    });
  }

  // El mes sale del documento; si no se pudo leer, el del mes en curso.
  const mesComercial =
    interpretarMesComercial(item.update.title) ?? interpretarMesComercial(item.rawText) ?? mesComercialActual();

  const precio = await prisma.$transaction(async (tx) => {
    // El anterior del mismo tipo/canal pasa a REEMPLAZADO. No se borra:
    // asi queda el historial y se puede comparar mes a mes.
    const anterior = await tx.price.findFirst({
      where: { versionId: version.id, priceType, channel, status: INFO_STATUS.ACTIVE },
      orderBy: { effectiveFrom: "desc" },
    });

    if (anterior) {
      await tx.price.update({
        where: { id: anterior.id },
        data: { status: INFO_STATUS.REPLACED, effectiveTo: new Date() },
      });
    }

    const creado = await tx.price.create({
      data: {
        versionId: version.id,
        priceType,
        amount: item.amount as number,
        channel,
        mesComercial,
        bonusName: payload.bonusName ?? null,
        bonusAmount: payload.bonusAmount ?? null,
        hasIva: payload.hasIva ?? false,
        status: INFO_STATUS.ACTIVE,
        sourceId: item.updateId,
        approvedBy: aprobadoPor ?? null,
      },
    });

    await tx.priceHistory.create({
      data: {
        versionId: version.id,
        priceId: creado.id,
        priceType,
        previousAmount: anterior?.amount ?? null,
        newAmount: creado.amount,
        difference: anterior ? creado.amount - anterior.amount : null,
        sourceName: item.update.title,
        sourceId: item.updateId,
        approvedBy: aprobadoPor ?? null,
      },
    });

    await tx.updateItem.update({
      where: { id: item.id },
      data: { status: INFO_STATUS.ACTIVE, ambiguityReason: null },
    });

    return creado;
  });

  return { ok: true, precioId: precio.id, versionId: version.id };
}

/** Aprueba una sola fila por su id. Para varias, usar aprobarLote. */
export async function aprobarItemComoPrecio(itemId: string, aprobadoPor?: string): Promise<ResultadoAprobacion> {
  const item = await prisma.updateItem.findUnique({ where: { id: itemId }, include: { update: true } });
  if (!item) return { ok: false, motivo: "La fila ya no existe." };
  return aprobarItemCargado(item, await cargarCandidatas(), aprobadoPor);
}

export type ResultadoLote = {
  aprobados: number;
  pendientes: number;
  /** Filas que no alcanzaron a procesarse dentro del tiempo disponible. */
  sinProcesar: number;
};

/**
 * Aprueba muchas filas de una vez, rapido y sin pasarse del tiempo.
 *
 * Tres cosas que antes hacian fallar el boton "Aprobar 118 precios":
 *
 *  1. Cada fila recargaba el catalogo completo. Ahora se carga una vez.
 *  2. Las filas iban una por una, y cada una son varios viajes a la
 *     base. Ahora van en paralelo -- pero agrupadas por version, tipo y
 *     canal: dos filas que reemplazan EL MISMO precio nunca corren a la
 *     vez, porque las dos verian el mismo "anterior" y quedarian dos
 *     precios vigentes para lo mismo.
 *  3. Si el tiempo no alcanza, se detiene ordenadamente y dice cuantas
 *     quedaron, en vez de morir a la mitad sin avisar. Apretar de nuevo
 *     sigue donde quedo: las ya aprobadas no se vuelven a tocar.
 */
export async function aprobarLote(
  items: ItemConCarga[],
  opciones: { aprobadoPor?: string; presupuestoMs?: number; concurrencia?: number } = {}
): Promise<ResultadoLote> {
  const inicio = Date.now();
  const presupuesto = opciones.presupuestoMs ?? 40_000;
  const concurrencia = opciones.concurrencia ?? 6;
  const candidatas = await cargarCandidatas();

  // Agrupar las filas que tocan el mismo precio.
  const grupos = new Map<string, ItemConCarga[]>();
  for (const item of items) {
    const { priceType, channel, payload } = tipoYCanal(item);
    const version = calzarVersion({ ...item, citCode: payload.citCode }, candidatas);
    const clave = version && priceType ? `${version.id}|${priceType}|${channel}` : `suelta|${item.id}`;
    const grupo = grupos.get(clave);
    if (grupo) grupo.push(item);
    else grupos.set(clave, [item]);
  }

  const cola = [...grupos.values()];
  let aprobados = 0;
  let pendientes = 0;
  let sinProcesar = 0;

  async function trabajador() {
    for (;;) {
      const grupo = cola.shift();
      if (!grupo) return;
      if (Date.now() - inicio > presupuesto) {
        sinProcesar += grupo.length;
        continue;
      }
      for (const item of grupo) {
        const resultado = await aprobarItemCargado(item, candidatas, opciones.aprobadoPor);
        if (resultado.ok) aprobados++;
        else pendientes++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrencia, cola.length || 1) }, trabajador));
  return { aprobados, pendientes, sinProcesar };
}
