// ============================================================
// MES COMERCIAL (Bloque B)
// ============================================================
//
// En el rubro automotriz los precios y las acciones comerciales tienen
// vigencia por MES: la lista de agosto deja de regir cuando empieza
// septiembre, aunque nadie la desactive a mano.
//
// Hasta ahora el sistema no tenia ese concepto. Un precio solo tenia
// `effectiveFrom` y un estado VIGENTE/REEMPLAZADO, asi que la lista de
// agosto seguia apareciendo como vigente en septiembre hasta que
// alguien la reemplazara una por una.
//
// El mes se guarda como texto "AAAA-MM" (ej. "2026-09") y no como
// fecha, a proposito: es una etiqueta de periodo comercial, no un
// instante. Ordena solo alfabeticamente, es legible en la base y no
// depende de zona horaria.

/** Zona horaria del negocio. El mes comercial es el de Chile, no el
 *  del servidor (Vercel corre en UTC: un dia 1 a las 00:30 en Chile
 *  seria todavia el mes anterior si se calculara en UTC). */
const ZONA_CHILE = "America/Santiago";

export type MesComercial = string; // "AAAA-MM"

const NOMBRES_MES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** El mes comercial vigente hoy, en hora de Chile. */
export function mesComercialActual(ahora = new Date()): MesComercial {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_CHILE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(ahora);
  const anio = partes.find((p) => p.type === "year")?.value ?? "0000";
  const mes = partes.find((p) => p.type === "month")?.value ?? "00";
  return `${anio}-${mes}`;
}

/** El mes anterior a uno dado. Sirve para comparar septiembre vs agosto. */
export function mesComercialAnterior(mes: MesComercial): MesComercial {
  const [anio, numero] = mes.split("-").map(Number);
  if (!anio || !numero) return mes;
  if (numero === 1) return `${anio - 1}-12`;
  return `${anio}-${String(numero - 1).padStart(2, "0")}`;
}

/** "2026-09" -> "septiembre 2026", para mostrar en pantalla. */
export function nombreMesComercial(mes: MesComercial): string {
  const [anio, numero] = mes.split("-").map(Number);
  const nombre = NOMBRES_MES[(numero ?? 0) - 1];
  if (!nombre || !anio) return mes;
  return `${nombre} ${anio}`;
}

/**
 * Interpreta el mes escrito en un documento comercial.
 * Acepta "agosto 2026", "AGOSTO-2026", "08/2026", "2026-08".
 * Devuelve null si no reconoce nada: es preferible dejarlo sin mes y
 * pedir revision, a adivinar y archivar la lista en el mes equivocado.
 */
export function interpretarMesComercial(texto: string | null | undefined, anioPorDefecto?: number): MesComercial | null {
  if (!texto) return null;
  const limpio = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

  // "2026-08" o "2026/08"
  const iso = limpio.match(/(20\d{2})[-/](0?[1-9]|1[0-2])\b/);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}`;

  // "08/2026" o "8-2026"
  const invertido = limpio.match(/\b(0?[1-9]|1[0-2])[-/](20\d{2})\b/);
  if (invertido) return `${invertido[2]}-${String(Number(invertido[1])).padStart(2, "0")}`;

  // "agosto 2026" / "agosto de 2026" / solo "agosto"
  for (let i = 0; i < NOMBRES_MES.length; i++) {
    if (!limpio.includes(NOMBRES_MES[i])) continue;
    const anioEnTexto = limpio.match(/\b(20\d{2})\b/);
    const anio = anioEnTexto ? Number(anioEnTexto[1]) : anioPorDefecto;
    if (!anio) return null;
    return `${anio}-${String(i + 1).padStart(2, "0")}`;
  }

  return null;
}

/** True si ese mes ya paso (es historial y no debe mostrarse como vigente). */
export function esMesPasado(mes: MesComercial, ahora = new Date()): boolean {
  return mes < mesComercialActual(ahora);
}
