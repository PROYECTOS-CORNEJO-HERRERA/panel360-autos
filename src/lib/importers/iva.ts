import { normalizeText } from "@/lib/format";

// ============================================================
// ¿ESTE PRECIO LLEVA IVA O NO? (Bloque C)
// ============================================================
//
// El caso que lo hace necesario: en una misma lista, las camionetas y
// vehiculos comerciales suelen venir en valor NETO (sin IVA) porque el
// comprador los factura, mientras el resto viene con IVA incluido.
// Tratarlos igual produce un error del 19% -- en una camioneta de
// $20.000.000 son casi $3.800.000 de diferencia.
//
// Hasta ahora el importador nunca deducia esto: el campo `hasIva` de
// los precios se quedaba siempre en false.
//
// REGLA DE ORO: cuando no se puede afirmar, NO se inventa. Se marca
// para revision. Un precio marcado "revisar" cuesta un minuto de una
// persona; un precio con 19% de error cuesta el margen del negocio.

export type DeteccionIva = {
  /** true = el monto es NETO (hay que sumarle IVA para el precio final).
   *  Es el mismo significado que el campo `hasIva` de la base. */
  esNeto: boolean;
  confianza: "ALTA" | "REVISAR";
  motivo: string;
};

/** La columna dice explicitamente que el valor es neto / sin IVA. */
const SENALES_NETO = [
  "neto", "sin iva", "mas iva", "+ iva", "+iva", "exento",
  "valor neto", "precio neto", "antes de iva",
];

/** La columna dice explicitamente que el valor ya incluye IVA. */
const SENALES_CON_IVA = [
  "con iva", "iva incluido", "incluye iva", "precio final",
  "valor final", "publico", "al publico",
];

/** Palabras que delatan un vehiculo comercial en el nombre del modelo,
 *  la version o el segmento. */
const SENALES_COMERCIAL = [
  "camioneta", "pickup", "pick up", "furgon", "furgoneta", "van",
  "cargo", "truck", "chasis", "comercial", "utilitario",
];

function contieneAlguna(texto: string, senales: string[]): boolean {
  return senales.some((s) => texto.includes(s));
}

/**
 * Decide si un monto viene neto, usando en orden:
 *   1. Lo que diga la columna (la fuente mas confiable).
 *   2. Lo que diga el resto de la fila.
 *   3. Si el vehiculo es comercial (senal fuerte, pero NO concluyente:
 *      hay listas donde las camionetas vienen con IVA igual).
 *
 * @param nombreColumna titulo de la columna de donde salio el monto
 * @param textoFila la fila completa, por si el aviso esta en otra celda
 * @param descripcionVehiculo marca + modelo + version + segmento
 */
export function detectarIva(params: {
  nombreColumna?: string | null;
  textoFila?: string | null;
  descripcionVehiculo?: string | null;
}): DeteccionIva {
  const columna = normalizeText(params.nombreColumna ?? "");
  const fila = normalizeText(params.textoFila ?? "");
  const vehiculo = normalizeText(params.descripcionVehiculo ?? "");

  // 1. La columna lo dice. Es lo mas confiable que hay.
  if (contieneAlguna(columna, SENALES_NETO)) {
    return { esNeto: true, confianza: "ALTA", motivo: `La columna "${params.nombreColumna}" indica valor neto.` };
  }
  if (contieneAlguna(columna, SENALES_CON_IVA)) {
    return { esNeto: false, confianza: "ALTA", motivo: `La columna "${params.nombreColumna}" indica valor con IVA.` };
  }

  // 2. Lo dice alguna otra celda de la fila.
  if (contieneAlguna(fila, SENALES_NETO) && !contieneAlguna(fila, SENALES_CON_IVA)) {
    return { esNeto: true, confianza: "ALTA", motivo: "La fila indica que el valor es neto." };
  }
  if (contieneAlguna(fila, SENALES_CON_IVA) && !contieneAlguna(fila, SENALES_NETO)) {
    return { esNeto: false, confianza: "ALTA", motivo: "La fila indica que el valor incluye IVA." };
  }

  // 3. Es un vehiculo comercial y nadie dijo nada. Es la situacion
  //    ambigua tipica, y justamente la que mas caro sale equivocar.
  if (contieneAlguna(vehiculo, SENALES_COMERCIAL)) {
    return {
      esNeto: false,
      confianza: "REVISAR",
      motivo:
        "Vehiculo comercial sin indicacion de IVA en la lista. En estas listas suelen venir en valor neto; confirmar antes de aprobar.",
    };
  }

  // 4. Sin ninguna senal: se asume con IVA, que es lo habitual en las
  //    listas al publico, pero se deja constancia de que fue un
  //    supuesto y no un dato leido.
  return {
    esNeto: false,
    confianza: "REVISAR",
    motivo: "La lista no indica si el precio incluye IVA. Se asume que si; confirmar si corresponde.",
  };
}

/** True si la descripcion corresponde a un vehiculo comercial. Se usa
 *  tambien en el resumen previo a la carga. */
export function pareceVehiculoComercial(descripcion: string | null | undefined): boolean {
  return contieneAlguna(normalizeText(descripcion ?? ""), SENALES_COMERCIAL);
}
