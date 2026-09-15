import { formatCLP } from "@/lib/format";
import { mesComercialActual, nombreMesComercial } from "@/lib/mes-comercial";
import { includePreciosDelMesActual, precioPorTipo } from "@/lib/precios";
import { prisma } from "@/lib/prisma";

// ============================================================
// REDACCION AUTOMATICA DEL POST A PARTIR DEL CATALOGO
// ============================================================
//
// Regla que atraviesa todo este archivo: el texto se arma SOLO con
// datos que estan en la base y aprobados. Si no hay precio vigente, el
// borrador sale sin precio y lo dice; no se inventa, no se usa el del
// mes pasado y no se deja un hueco silencioso.
//
// El motivo es concreto: un post con un precio equivocado no es un
// error interno que se corrige en pantalla, es una publicacion a la
// que le llegaron clientes. Vale mas un borrador incompleto que uno
// que suene bien y este malo.

export const PLANTILLAS = [
  ["LANZAMIENTO", "Lanzamiento / presentacion del modelo"],
  ["BAJA_PRECIO", "Bajo de precio / nuevo bono"],
  ["STOCK", "Disponibilidad y stock"],
  ["FIN_DE_MES", "Cierre de mes"],
  ["LIBRE", "Texto libre"],
] as const;

export type ClavePlantilla = (typeof PLANTILLAS)[number][0];

export const FORMATOS = [
  ["FEED", "Feed (una imagen)"],
  ["CARRUSEL", "Carrusel (2 a 10 imagenes)"],
  ["REEL", "Reel (video)"],
  ["STORY", "Historia"],
] as const;

const HASHTAGS_BASE = ["#Derco", "#AutosNuevos", "#Chile"];

function hashtagDe(texto: string) {
  const limpio = texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
  return limpio ? `#${limpio}` : "";
}

export type DatosVehiculo = {
  versionId: string;
  marca: string;
  modelo: string;
  version: string;
  anio: string | null;
  motor: string | null;
  transmision: string | null;
  traccion: string | null;
  combustible: string | null;
  equipamiento: string | null;
  garantia: string | null;
  precio: number | null;
  bonoNombre: string | null;
  bonoMonto: number | null;
  mesComercial: string;
};

/** Trae de la base todo lo que el redactor necesita de una version. */
export async function datosParaPost(versionId: string): Promise<DatosVehiculo | null> {
  const version = await prisma.version.findUnique({
    where: { id: versionId },
    include: {
      brand: true,
      model: true,
      prices: includePreciosDelMesActual(),
    },
  });
  if (!version) return null;

  // Para publicidad se usa el precio de lista; si no hay, contado.
  // Nunca el de financiamiento: ese depende de condiciones que un post
  // no alcanza a explicar y termina siendo una cifra enganosa.
  const precio =
    precioPorTipo(version.prices, "LIST") ??
    precioPorTipo(version.prices, "CASH") ??
    null;

  return {
    versionId: version.id,
    marca: version.brand.name,
    modelo: version.model.name,
    version: version.name,
    anio: version.modelYear,
    motor: version.engine ?? version.displacement,
    transmision: version.transmission,
    traccion: version.traction,
    combustible: version.fuelType,
    equipamiento: version.equipmentSummary,
    garantia: version.warranty,
    precio: precio?.amount ?? null,
    bonoNombre: precio?.bonusName ?? null,
    bonoMonto: precio?.bonusAmount ?? null,
    mesComercial: mesComercialActual(),
  };
}

function lineaPrecio(d: DatosVehiculo) {
  if (d.precio === null) {
    return "Precio: consultar por interno (no hay lista vigente cargada para este mes).";
  }
  const base = `Desde ${formatCLP(d.precio)}`;
  if (d.bonoMonto) {
    return `${base} con ${d.bonoNombre ?? "bono vigente"} de ${formatCLP(d.bonoMonto)} ya aplicado.`;
  }
  return `${base}.`;
}

function fichaCorta(d: DatosVehiculo) {
  const partes = [d.motor, d.transmision, d.traccion, d.combustible].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

function hashtags(d: DatosVehiculo) {
  const propios = [hashtagDe(d.marca), hashtagDe(`${d.marca} ${d.modelo}`)].filter(Boolean);
  return Array.from(new Set([...propios, ...HASHTAGS_BASE])).join(" ");
}

/**
 * Arma el caption. Es un BORRADOR: la idea es que el ejecutivo lo
 * edite, no que salga tal cual. Por eso el tono es sobrio y sin
 * promesas que el sistema no pueda respaldar con un dato.
 */
export function redactarCaption(plantilla: ClavePlantilla, d: DatosVehiculo): string {
  const titulo = `${d.marca} ${d.modelo} ${d.version}${d.anio ? ` ${d.anio}` : ""}`.trim();
  const ficha = fichaCorta(d);
  const cierre = "Escribeme por interno y te preparo la cotizacion con tu caso.";
  const tags = hashtags(d);

  const bloques: (string | null)[] = [];

  switch (plantilla) {
    case "LANZAMIENTO":
      bloques.push(`${titulo}`);
      bloques.push(ficha);
      bloques.push(d.equipamiento ? `Equipamiento: ${d.equipamiento}` : null);
      bloques.push(lineaPrecio(d));
      bloques.push(d.garantia ? `Garantia: ${d.garantia}` : null);
      bloques.push(cierre);
      break;

    case "BAJA_PRECIO":
      bloques.push(`Cambio de precio en ${titulo}`);
      bloques.push(lineaPrecio(d));
      bloques.push(
        d.bonoMonto
          ? `El bono aplica dentro de ${nombreMesComercial(d.mesComercial)} y esta sujeto a stock.`
          : `Condicion vigente durante ${nombreMesComercial(d.mesComercial)}, sujeta a stock.`
      );
      bloques.push(ficha);
      bloques.push(cierre);
      break;

    case "STOCK":
      bloques.push(`Disponible ahora: ${titulo}`);
      bloques.push(ficha);
      bloques.push(lineaPrecio(d));
      bloques.push("Consulta colores y unidades disponibles antes de decidir.");
      bloques.push(cierre);
      break;

    case "FIN_DE_MES":
      bloques.push(`Ultimos dias de ${nombreMesComercial(d.mesComercial)}`);
      bloques.push(titulo);
      bloques.push(lineaPrecio(d));
      bloques.push("Las condiciones del mes cierran con el mes. Lo que viene se confirma recien el dia 1.");
      bloques.push(cierre);
      break;

    default:
      bloques.push(titulo);
      bloques.push(ficha);
      bloques.push(lineaPrecio(d));
      break;
  }

  bloques.push(tags);

  return bloques.filter(Boolean).join("\n\n");
}

/** Instagram corta el caption en 2200 caracteres. Mejor avisar antes. */
export const LARGO_MAXIMO_CAPTION = 2200;

export function validarCaption(caption: string) {
  const texto = caption.trim();
  if (!texto) return "El caption esta vacio.";
  if (texto.length > LARGO_MAXIMO_CAPTION) {
    return `El caption tiene ${texto.length} caracteres. Instagram acepta hasta ${LARGO_MAXIMO_CAPTION}.`;
  }
  const tags = (texto.match(/#/g) ?? []).length;
  if (tags > 30) return `Hay ${tags} hashtags. Instagram acepta hasta 30 por publicacion.`;
  return null;
}
