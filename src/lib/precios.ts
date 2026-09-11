import { mesComercialActual, nombreMesComercial } from "@/lib/mes-comercial";
import { INFO_STATUS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

// ============================================================
// FUENTE UNICA DE VERDAD SOBRE QUE PRECIO SE PUEDE MOSTRAR
// ============================================================
//
// Antes cada modulo decidia por su cuenta que precios aceptaba, y no
// decidian lo mismo:
//
//   - Cotizador, comparador, rentabilidad, vehiculos, buscador y el
//     asistente: solo VIGENTE.
//   - Perfilador, plan comercial, home, ayudas comerciales y
//     promociones: VIGENTE y tambien DETECTADO.
//   - Una consulta de plan comercial: cualquiera, el mas reciente.
//
// Resultado: el perfilador podia mostrarle un precio al ejecutivo y el
// cotizador otro distinto para el mismo auto. No eran bases separadas
// -- era la misma tabla leida con reglas distintas.
//
// DECISION: solo VIGENTE es precio comercial.
//
// DETECTADO significa "lo leimos de un documento y nadie lo ha
// aprobado todavia". Mostrarselo a un ejecutivo que esta cotizando
// frente a un cliente es peor que no mostrar nada: el sistema estaria
// afirmando un precio que nadie valido. Si hace falta ver lo pendiente
// de aprobar, eso es la pantalla de Actualizaciones, no el cotizador.

/** Estados que un precio puede tener y seguir siendo mostrable. */
export const ESTADOS_PRECIO_VIGENTE = [INFO_STATUS.ACTIVE] as const;

/**
 * Filtro Prisma para precios que se pueden mostrar a un ejecutivo.
 * Usar SIEMPRE este, nunca `status: "VIGENTE"` escrito a mano: si
 * manana la regla cambia, tiene que cambiar en un solo lugar.
 */
export const wherePrecioVigente = { status: INFO_STATUS.ACTIVE } as const;

/**
 * Filtro por mes comercial (Bloque B).
 *
 * Se acepta el mes pedido Y TAMBIEN los precios sin mes asignado. Esa
 * segunda parte es deliberada y temporal: mientras existan precios
 * cargados antes de que el sistema tuviera este concepto, excluirlos
 * dejaria pantallas en blanco. La Fase 82 les asigna mes a todos, asi
 * que en la practica el `null` deja de aparecer; queda como red de
 * seguridad para cualquier precio que entre por un camino viejo.
 */
export function wherePrecioDelMes(mes: string) {
  return {
    ...wherePrecioVigente,
    OR: [{ mesComercial: mes }, { mesComercial: null }],
  };
}

/** Precios vigentes del mes comercial en curso. Es lo que debe ver el
 *  ejecutivo por defecto en cotizador, comparador y rentabilidad. */
export function wherePrecioVigenteActual() {
  return wherePrecioDelMes(mesComercialActual());
}

export type MesEnUso = {
  /** El mes cuyos precios se estan mostrando. */
  mes: string;
  /** El mes comercial en curso segun el calendario. */
  mesActual: string;
  /** true si se esta mostrando un mes que ya paso. */
  esDesactualizado: boolean;
  /** Texto para mostrar en pantalla cuando esta desactualizado. */
  aviso: string | null;
};

/**
 * Decide QUE MES mostrar, y si hay que avisar (Bloque B).
 *
 * El caso real: llego septiembre y la lista de septiembre todavia no se
 * carga. Hay tres salidas posibles y ninguna es obvia:
 *
 *   1. Mostrar agosto como si fuera vigente -> la interfaz miente: el
 *      ejecutivo cotiza con precios del mes pasado sin saberlo. Es lo
 *      que hacia el sistema hasta ahora.
 *   2. Filtrar estricto por septiembre -> pantallas en blanco.
 *   3. Mostrar el ultimo mes que exista, DICIENDO que es de otro mes.
 *
 * Se elige la 3. Un ejecutivo con precios de agosto y un aviso claro
 * puede trabajar y sabe que debe confirmar; uno con la pantalla vacia
 * no puede hacer nada, y uno con precios viejos sin aviso cotiza mal
 * sin enterarse.
 *
 * @param mesesConPrecios meses que tienen precios VIGENTE, de mas
 *        nuevo a mas antiguo (lo resuelve quien llama, con una
 *        consulta agrupada).
 */
export function resolverMesEnUso(mesesConPrecios: string[], ahora = new Date()): MesEnUso {
  const mesActual = mesComercialActual(ahora);

  if (mesesConPrecios.includes(mesActual)) {
    return { mes: mesActual, mesActual, esDesactualizado: false, aviso: null };
  }

  const masReciente = [...mesesConPrecios].sort().reverse()[0];

  if (!masReciente) {
    return {
      mes: mesActual,
      mesActual,
      esDesactualizado: false,
      aviso: "No hay listas de precios cargadas en el sistema.",
    };
  }

  return {
    mes: masReciente,
    mesActual,
    esDesactualizado: true,
    aviso: `Estás viendo la lista de ${nombreMesComercial(masReciente)}. La lista de ${nombreMesComercial(mesActual)} todavía no se ha cargado — confirma los valores antes de comprometerlos con un cliente.`,
  };
}

/** Los meses que tienen precios vigentes, del mas nuevo al mas antiguo. */
export async function mesesConPrecios(): Promise<string[]> {
  const filas = await prisma.price.findMany({
    where: wherePrecioVigente,
    select: { mesComercial: true },
    distinct: ["mesComercial"],
    orderBy: { mesComercial: "desc" },
  });
  return filas.map((f) => f.mesComercial).filter((m): m is string => Boolean(m));
}

/**
 * `include` de precios vigentes para consultas de versiones, con el
 * orden que espera el resto del sistema (el mas reciente primero).
 */
export const includePreciosVigentes = {
  where: wherePrecioVigente,
  orderBy: { effectiveFrom: "desc" },
} as const;

/** Igual que el anterior, pero acotado al mes comercial en curso. */
export function includePreciosDelMesActual() {
  return {
    where: wherePrecioVigenteActual(),
    orderBy: { effectiveFrom: "desc" },
  } as const;
}

type PrecioMostrable = {
  priceType: string;
  amount: number;
  channel?: string | null;
};

/**
 * Busca un precio por tipo dentro de una lista ya filtrada.
 * Devuelve null si no existe: quien llama decide que hacer, pero
 * nadie debe inventar un valor por defecto.
 */
export function precioPorTipo<T extends PrecioMostrable>(
  precios: T[],
  tipo: string,
  canal = "REGULAR"
): T | null {
  return precios.find((p) => p.priceType === tipo && (p.channel ?? "REGULAR") === canal) ?? null;
}
