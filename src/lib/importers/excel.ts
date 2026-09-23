/**
 * Parser multi-hoja de Excel Comercial — Panel360 Autos
 *
 * Soporta TODAS las marcas Derco: GWM, Mazda, Suzuki, Changan, Deepal, DFSK.
 * Detecta el tipo de cada hoja y usa el parser correcto:
 *
 *  PRECIOS      → precio lista, bonos, contado, financiamiento, tasas, campañas por fila
 *  PATENTE_GRATIS → monto patente contado / crédito por versión + condiciones
 *  BONO_CIERRE  → aportes CES / marca contado y crédito, restricciones de cabecera
 *  TASA         → tasas subvencionadas como texto estructurado
 *  PREVENTA     → igual que PRECIOS pero channel = PREVENTA
 *  DERCO_CL     → igual que PRECIOS pero channel = DERCO_CL
 *  CAMPANA      → beneficios adicionales (giftcards, mantenciones, COPEC, etc.)
 *  DESCONOCIDA  → texto plano para parseTextUpdate
 */

import * as XLSX from "xlsx";
import { CONFIDENCE } from "@/lib/constants";
import { detectarIva } from "@/lib/importers/iva";
import { normalizeText } from "@/lib/format";
import { parseTextUpdate } from "@/lib/importers/text";
import type { DetectedChange, ImportResult } from "@/lib/importers/types";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type SheetKind =
  | "PRECIOS"
  | "PATENTE_GRATIS"
  | "BONO_CIERRE"
  | "TASA"
  | "PREVENTA"
  | "DERCO_CL"
  | "CAMPANA"
  | "DESCONOCIDA";

// ─── Utilidades ───────────────────────────────────────────────────────────────

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function moneyFromCell(value: unknown): number | undefined {
  if (typeof value === "number" && value > 0) return Math.round(value);
  const cleaned = valueToString(value).replace(/[^\d]/g, "");
  const n = Number.parseInt(cleaned, 10);
  return n > 0 ? n : undefined;
}

function norm(text: unknown): string {
  return normalizeText(valueToString(text));
}

/** Devuelve el texto solo si parece un nombre (no un numero ni un porcentaje). */
function nombreValido(texto: string): string {
  const limpio = texto.trim();
  if (!limpio) return "";
  if (/^[\d.,%\s$-]+$/.test(limpio)) return "";
  if (!/[a-zA-Z]/.test(limpio)) return "";
  return limpio;
}

function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

type RowGetter = (...candidates: string[]) => unknown;

/**
 * Puntua que tan bien calza el nombre de una columna con lo que se busca.
 * 3 = es exactamente esa columna, 2 = empieza por ahi, 1 = solo la
 * contiene, 0 = no calza.
 *
 * Antes se aceptaba el PRIMER calce de cualquier tipo, y "contiene"
 * bastaba: buscando "marca" se tomaba la columna "% aporte marca" si
 * aparecia antes, y la marca del vehiculo quedaba siendo 0.0944. Por eso
 * el resumen mostraba numeros decimales donde deberia decir DFSK.
 */
function puntuarColumna(clave: string, candidato: string): number {
  if (clave === candidato) return 3;
  if (clave.startsWith(`${candidato} `)) return 2;
  if (clave.includes(candidato)) return 1;
  return 0;
}

function mejorIndice(normalizedKeys: string[], candidates: string[]): number {
  let mejor = -1;
  let mejorPuntaje = 0;

  // Los candidatos van en orden de preferencia: el primero que calce
  // bien gana, y dentro de un mismo candidato manda la calidad del calce.
  for (const candidato of candidates) {
    for (let i = 0; i < normalizedKeys.length; i++) {
      const puntaje = puntuarColumna(normalizedKeys[i], candidato);
      if (puntaje > mejorPuntaje) {
        mejorPuntaje = puntaje;
        mejor = i;
      }
    }
    if (mejorPuntaje === 3) break;
  }

  return mejor;
}

function makeGetter(entries: [string, unknown][], normalizedKeys: string[]): RowGetter {
  return (...candidates: string[]): unknown => {
    const index = mejorIndice(normalizedKeys, candidates);
    return index >= 0 ? entries[index][1] : undefined;
  };
}

/**
 * Igual que makeGetter pero devuelve tambien COMO SE LLAMABA la columna
 * (Bloque C). Hace falta para el IVA: el titulo de la columna es la
 * pista principal de si ese monto es neto o final ("Precio neto",
 * "Valor + IVA", "Precio con IVA").
 */
function makeGetterConClave(entries: [string, unknown][], normalizedKeys: string[]) {
  return (...candidates: string[]): { valor: unknown; clave: string } | null => {
    const index = mejorIndice(normalizedKeys, candidates);
    return index >= 0 ? { valor: entries[index][1], clave: normalizedKeys[index] } : null;
  };
}

// ─── Deteccion del tipo de hoja ───────────────────────────────────────────────

function detectSheetKind(sheetName: string, firstRowsText: string): SheetKind {
  const sn = norm(sheetName);
  const combined = `${sn} ${norm(firstRowsText)}`;

  if (hasAny(combined, ["preventa", "pre-venta", "pre venta"])) return "PREVENTA";
  if (hasAny(combined, ["dercocenter", "dcr.cl", "derco.cl", "0km", "0 km", "dias 0", "dias cero", "reservando en"])) return "DERCO_CL";
  if (hasAny(combined, ["patente gratis", "patente gratuita", "permiso circulacion gratis"])) return "PATENTE_GRATIS";
  if (hasAny(combined, ["bono cierre", "cierre compartido", "bono compartido", "aporte ces", "aporte concesionario", "bono de cierre"])) return "BONO_CIERRE";
  if (hasAny(combined, ["tasa especial", "tasa subvencionada", "tasa promocional", "tasa preferencial", "tasa 0", "credito especial"])) return "TASA";
  if (hasAny(combined, ["campana", "campaign", "giftcard", "gift card", "premio", "accesorios gratis", "mantencion gratis", "copec", "bono combustible", "beneficio", "promocion"])) return "CAMPANA";
  if (hasAny(combined, ["precio", "lista", "precios", "price", "tarifario", "agosto", "julio", "junio", "mayo", "abril", "enero", "febrero", "marzo", "octubre", "noviembre", "diciembre", "septiembre"])) return "PRECIOS";

  return "DESCONOCIDA";
}

// ─── Parser: hojas de PRECIOS / PREVENTA / DERCO_CL ──────────────────────────

function parseSheetPrecios(
  sheetName: string,
  rows: Record<string, unknown>[],
  channel: "REGULAR" | "DERCO_CL" | "PREVENTA",
  detectedBrand: string | undefined,
  indiceCit?: Map<string, string>
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  for (const row of rows) {
    const entries = Object.entries(row);
    const normalizedKeys = entries.map(([key]) => norm(key));
    const get = makeGetter(entries, normalizedKeys);
    const rawText = entries.map(([key, value]) => `${key}: ${valueToString(value)}`).join(" | ");

    // Una marca es un nombre. Si lo que salio es un numero o un
    // porcentaje, la columna elegida no era la marca: se descarta antes
    // de que contamine todo el resumen de la carga.
    const brandName = nombreValido(valueToString(get("marca", "brand", "fabricante"))) || detectedBrand || "";
    const modelName = nombreValido(valueToString(get("modelo", "model", "linea")));
    const versionName = nombreValido(valueToString(get("version", "variante", "trim", "descripcion sap")));

    // Bloque C: se guarda de QUE columna salio el precio de lista, para
    // poder deducir si viene neto o con IVA.
    const getCon = makeGetterConClave(entries, normalizedKeys);
    const celdaLista = getCon("precio lista", "lista", "precio de lista", "precio base", "precio oficial", "precio", "list price");
    const priceList = moneyFromCell(celdaLista?.valor);
    const bonusAmount = moneyFromCell(get("bonos marca", "bono marca", "bono", "descuento marca"));
    const bonusName = valueToString(get("nombre bono", "tipo bono")) || (bonusAmount ? "Bono marca" : undefined);

    const cash = moneyFromCell(get("precio contado", "contado", "precio con bono", "p. contado", "precio neto contado"));
    const financing = moneyFromCell(get("precio financiamiento", "financiamiento", "precio credito", "p. credito", "precio con bono financiamiento"));
    const bonusFinancing = moneyFromCell(get("bono financiamiento", "bono credito"));
    const rate = valueToString(get("tasa", "tasa especial", "tasa subvencionada", "tasas subvencionadas"));
    const promoText = valueToString(get("promociones", "campana", "beneficio adicional"));

    // El CIT puede venir en esta misma fila o en otra hoja del libro
    // (es lo que pasa con DFSK). Primero se mira la fila; si no esta, se
    // busca en el indice armado con el libro completo.
    const citEnLaFila = valueToString(get("codigo cit", "cit", "codigo sap", "sap", "codigo"));
    const citCode =
      citEnLaFila ||
      indiceCit?.get(claveCit(modelName, versionName)) ||
      indiceCit?.get(claveCit("", versionName)) ||
      indiceCit?.get(claveCit(modelName, "")) ||
      "";

    const hasIdentity = Boolean(modelName || versionName);

    if (priceList) {
      const fieldLabel = channel === "DERCO_CL" ? "Precio Derco.cl"
        : channel === "PREVENTA" ? "Precio Preventa"
        : "Precio lista";

      const iva = detectarIva({
        nombreColumna: celdaLista?.clave,
        textoFila: rawText,
        descripcionVehiculo: `${brandName} ${modelName} ${versionName}`,
      });

      changes.push({
        category: "PRECIO",
        brandName: brandName || undefined,
        modelName: modelName || undefined,
        versionName: versionName || undefined,
        fieldName: fieldLabel,
        proposedValue: String(priceList),
        amount: priceList,
        rawText,
        // Si el IVA quedo en duda, la fila entra como ambigua aunque el
        // vehiculo este bien identificado: equivocarse en el IVA es un
        // 19% de error, que en una camioneta son millones.
        confidence: !hasIdentity
          ? CONFIDENCE.AMBIGUOUS
          : iva.confianza === "REVISAR"
            ? CONFIDENCE.REVIEW
            : CONFIDENCE.HIGH,
        ambiguityReason: !hasIdentity
          ? "Fila con monto sin modelo/version identificable."
          : iva.confianza === "REVISAR"
            ? iva.motivo
            : undefined,
        payload: { citCode: citCode || null, channel, sheetName, bonusName: bonusName ?? null, bonusAmount: bonusAmount ?? null, cash: cash ?? null, financing: financing ?? null, bonusFinancing: bonusFinancing ?? null, rate: rate || null, promoText: promoText || null, hasIva: iva.esNeto, ivaMotivo: iva.motivo, ivaConfianza: iva.confianza }
      });
    }

    if (cash && cash !== priceList) {
      changes.push({
        category: "PRECIO",
        brandName: brandName || undefined,
        modelName: modelName || undefined,
        versionName: versionName || undefined,
        fieldName: "Precio contado",
        proposedValue: String(cash),
        amount: cash,
        rawText,
        confidence: hasIdentity ? CONFIDENCE.REVIEW : CONFIDENCE.AMBIGUOUS,
        payload: { citCode: citCode || null, channel, sheetName, bonusName, bonusAmount }
      });
    }

    if (financing && financing !== cash) {
      changes.push({
        category: "PRECIO",
        brandName: brandName || undefined,
        modelName: modelName || undefined,
        versionName: versionName || undefined,
        fieldName: "Precio financiamiento",
        proposedValue: String(financing),
        amount: financing,
        rawText,
        confidence: hasIdentity ? CONFIDENCE.REVIEW : CONFIDENCE.AMBIGUOUS,
        payload: { citCode: citCode || null, channel, sheetName, bonusFinancing }
      });
    }

    if (bonusAmount) {
      changes.push({
        category: "BONO",
        brandName: brandName || undefined,
        modelName: modelName || undefined,
        versionName: versionName || undefined,
        fieldName: bonusName || "Bono marca",
        proposedValue: String(bonusAmount),
        amount: bonusAmount,
        rawText,
        confidence: hasIdentity ? CONFIDENCE.REVIEW : CONFIDENCE.AMBIGUOUS,
        payload: { offerType: "BONO_MARCA", channel, sheetName, bonusName: bonusName ?? null, bonusFinancing: bonusFinancing ?? null, rate: rate || null }
      });
    }

    if (promoText && hasAny(norm(promoText), ["giftcard", "gift card", "copec", "mantencion", "premio", "accesorio"])) {
      changes.push({
        category: "CAMPAÑA",
        brandName: brandName || undefined,
        modelName: modelName || undefined,
        versionName: versionName || undefined,
        fieldName: "campana en fila de precios",
        proposedValue: promoText,
        rawText,
        confidence: CONFIDENCE.REVIEW,
        payload: { offerType: "CAMPANA", channel, sheetName }
      });
    }
  }

  return changes;
}

// ─── Parser: hoja PATENTE_GRATIS ──────────────────────────────────────────────

function parseSheetPatenteGratis(
  sheetName: string,
  rows: Record<string, unknown>[]
): DetectedChange[] {
  const changes: DetectedChange[] = [];
  const conditionRows: string[] = [];

  for (const row of rows) {
    const entries = Object.entries(row);
    const normalizedKeys = entries.map(([key]) => norm(key));
    const get = makeGetter(entries, normalizedKeys);
    const rawText = entries.map(([key, value]) => `${key}: ${valueToString(value)}`).join(" | ");

    const modelVersionRaw = valueToString(get("modelo", "modelo - version", "modelo-version", "version"));
    const amountCash = moneyFromCell(get("patente contado", "contado", "cash"));
    const amountCredit = moneyFromCell(get("patente credito", "credito"));

    if (!amountCash && !amountCredit) {
      const texts = entries.map(([, v]) => valueToString(v)).filter(Boolean).join(" ");
      if (texts.length > 3) conditionRows.push(texts);
      continue;
    }

    if (!modelVersionRaw) continue;

    changes.push({
      category: "PATENTE",
      modelName: modelVersionRaw,
      fieldName: "Patente gratis",
      proposedValue: amountCash ? String(amountCash) : String(amountCredit),
      amount: amountCash ?? amountCredit,
      rawText,
      confidence: CONFIDENCE.REVIEW,
      payload: {
        offerType: "PATENTE_GRATIS",
        sheetName,
        amountCash: amountCash ?? null,
        amountCredit: amountCredit ?? null,
        hasIva: true,
        conditions: conditionRows.join("; ") || null,
        compatibleWith: "BONO_CIERRE_COMPARTIDO, TASA_ESPECIAL, CAMPANAS"
      }
    });
  }

  return changes;
}

// ─── Parser: hoja BONO_CIERRE ─────────────────────────────────────────────────

function parseSheetBonoCierre(
  sheetName: string,
  rows: Record<string, unknown>[],
  headerRestrictionsText: string
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  for (const row of rows) {
    const entries = Object.entries(row);
    const normalizedKeys = entries.map(([key]) => norm(key));
    const get = makeGetter(entries, normalizedKeys);
    const rawText = entries.map(([key, value]) => `${key}: ${valueToString(value)}`).join(" | ");

    const modelName = valueToString(get("modelo", "model"));
    const versionName = valueToString(get("version", "versiones", "aplica a"));
    const aporteCESCash = moneyFromCell(get("aporte ces", "ces contado", "aporte concesionario"));
    const aporteMarcaCash = moneyFromCell(get("aporte marca", "marca contado", "aporte fabricante"));
    const totalCash = moneyFromCell(get("aporte total", "total contado", "total"));

    // Detectar segunda columna de CES/Marca para credito
    const cesIndices = normalizedKeys.reduce<number[]>((acc, k, i) => { if (k.includes("ces")) acc.push(i); return acc; }, []);
    const marcaIndices = normalizedKeys.reduce<number[]>((acc, k, i) => { if (k.includes("aporte") && !k.includes("ces") && !k.includes("total")) acc.push(i); return acc; }, []);

    const aporteCESCredit = cesIndices[1] !== undefined ? moneyFromCell(entries[cesIndices[1]][1]) : undefined;
    const aporteMarcaCredit = marcaIndices[1] !== undefined ? moneyFromCell(entries[marcaIndices[1]][1]) : undefined;
    const totalCredit = moneyFromCell(get("negocios credito", "credito total"));

    if (!modelName || (!aporteCESCash && !aporteMarcaCash && !totalCash)) continue;

    changes.push({
      category: "BONO",
      modelName: modelName || undefined,
      versionName: versionName || "Todas",
      fieldName: "Bono Cierre Compartido",
      proposedValue: String(totalCash ?? (aporteCESCash ?? 0) + (aporteMarcaCash ?? 0)),
      amount: totalCash ?? (aporteCESCash ?? 0) + (aporteMarcaCash ?? 0),
      rawText,
      confidence: CONFIDENCE.REVIEW,
      payload: {
        offerType: "BONO_CIERRE_COMPARTIDO",
        sheetName,
        paymentType: "AMBOS",
        aporteCES: aporteCESCash ?? null,
        aporteMarca: aporteMarcaCash ?? null,
        amountCash: totalCash ?? null,
        aporteCESCredit: aporteCESCredit ?? null,
        aporteMarcaCredit: aporteMarcaCredit ?? null,
        amountCredit: totalCredit ?? null,
        hasIva: true,
        incompatibleWith: headerRestrictionsText || null
      }
    });
  }

  return changes;
}

// ─── Parser: hoja CAMPANA ─────────────────────────────────────────────────────

function parseSheetCampana(
  sheetName: string,
  rows: Record<string, unknown>[]
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  for (const row of rows) {
    const entries = Object.entries(row);
    const normalizedKeys = entries.map(([key]) => norm(key));
    const get = makeGetter(entries, normalizedKeys);
    const rawText = entries.map(([key, value]) => `${key}: ${valueToString(value)}`).join(" | ");

    const modelName = valueToString(get("modelo", "model", "vehiculo", "auto"));
    const versionName = valueToString(get("version"));
    const benefitText = valueToString(get("beneficio", "campana", "premio", "giftcard", "descripcion", "detalle"));
    const amount = moneyFromCell(get("monto", "valor", "amount", "precio"));

    if (!benefitText && !amount) continue;

    const bnorm = norm(benefitText);
    const offerType = hasAny(bnorm, ["giftcard", "gift card"]) ? "GIFTCARD"
      : hasAny(bnorm, ["mantencion"]) ? "MANTENCION"
      : hasAny(bnorm, ["copec", "bencina", "combustible"]) ? "COPEC"
      : "CAMPANA";

    changes.push({
      category: "CAMPAÑA",
      modelName: modelName || undefined,
      versionName: versionName || undefined,
      fieldName: "Campana adicional",
      proposedValue: benefitText || String(amount),
      amount: amount,
      rawText,
      confidence: CONFIDENCE.REVIEW,
      payload: { offerType, sheetName, benefitText }
    });
  }

  return changes;
}

// ─── Parser principal ─────────────────────────────────────────────────────────

/**
 * Encuentra en que fila esta el encabezado de verdad (Bloque C).
 *
 * Las listas de las marcas casi nunca empiezan en la fila 1: arriba
 * traen logo, titulo ("LISTA DE PRECIOS SEPTIEMBRE 2026"), la marca,
 * filas en blanco. Al asumir que el encabezado era la primera fila, el
 * importador terminaba con nombres de columna como
 * "LISTA DE PRECIOS SEPTIEMBRE 2026", "_1", "_2" -- y como ninguna se
 * parecia a "precio lista" o "modelo", NO DETECTABA NINGUN PRECIO.
 * Ese era el motivo real de que las listas reales no se pudieran
 * cargar.
 *
 * Se busca la fila que mas se parezca a un encabezado: la que tenga
 * mas celdas de texto reconocibles como columnas de una lista de
 * precios. Si ninguna califica, se usa la 0 (comportamiento anterior).
 */
const PALABRAS_ENCABEZADO = [
  "modelo", "version", "variante", "trim", "precio", "lista", "contado",
  "financiamiento", "credito", "bono", "descuento", "marca", "codigo",
  "sap", "cit", "neto", "iva", "total", "campana", "tasa",
];

export function detectarFilaEncabezado(sheet: XLSX.WorkSheet, maxFilas = 25): number {
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: true });

  let mejorFila = 0;
  let mejorPuntaje = 0;

  for (let i = 0; i < Math.min(matriz.length, maxFilas); i++) {
    const celdas = (matriz[i] ?? []).map((c) => norm(valueToString(c)));
    const conTexto = celdas.filter((c) => c.length > 0);
    if (conTexto.length < 2) continue;

    // Cuantas celdas de esta fila suenan a nombre de columna.
    const aciertos = conTexto.filter((celda) =>
      PALABRAS_ENCABEZADO.some((palabra) => celda.includes(palabra))
    ).length;

    // Se exige mas de un acierto: una fila con un solo "precio" suelto
    // suele ser un titulo, no un encabezado.
    if (aciertos >= 2 && aciertos > mejorPuntaje) {
      mejorPuntaje = aciertos;
      mejorFila = i;
    }
  }

  return mejorFila;
}

// ─── Indice de codigos CIT / SAP de todo el libro ─────────────────────────────
//
// En varias marcas (DFSK entre ellas) el codigo CIT no viene en la hoja de
// precios: esta en OTRA hoja del mismo Excel, a veces oculta. El importador
// leia hoja por hoja de forma aislada, asi que esos codigos no se detectaban
// nunca. El CIT importa: es lo que identifica la version ante el SII para el
// impuesto verde, y es una identificacion exacta, mejor que calzar nombres.
//
// Por eso antes de parsear nada se recorre el libro COMPLETO buscando
// cualquier columna que sea un codigo, y se arma un indice por modelo y
// version para poder pegarselo despues a cada fila de precio.

const COLUMNAS_CIT = ["cit", "codigo cit", "cod cit", "sap", "codigo sap", "cod sap", "codigo", "cod."];
const COLUMNAS_MODELO = ["modelo", "model", "linea"];
const COLUMNAS_VERSION = ["version", "variante", "trim", "descripcion"];

export function claveCit(modelo: string, version: string): string {
  return norm(`${modelo} ${version}`).replace(/\s+/g, " ").trim();
}

function indiceDeColumna(claves: string[], candidatas: string[]): number {
  return claves.findIndex((clave) => candidatas.some((c) => clave === c || clave.startsWith(`${c} `) || clave.includes(c)));
}

export function construirIndiceCit(workbook: XLSX.WorkBook): Map<string, string> {
  const indice = new Map<string, string>();

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const filaEncabezado = detectarFilaEncabezado(sheet);
    const matriz = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
    const encabezado = (matriz[filaEncabezado] ?? []).map((c) => norm(valueToString(c)));

    const colCit = indiceDeColumna(encabezado, COLUMNAS_CIT);
    if (colCit < 0) continue;

    const colModelo = indiceDeColumna(encabezado, COLUMNAS_MODELO);
    const colVersion = indiceDeColumna(encabezado, COLUMNAS_VERSION);
    if (colModelo < 0 && colVersion < 0) continue;

    for (let i = filaEncabezado + 1; i < matriz.length; i++) {
      const fila = matriz[i] ?? [];
      const codigo = valueToString(fila[colCit]);
      if (!codigo || codigo.length < 3) continue;

      const modelo = colModelo >= 0 ? valueToString(fila[colModelo]) : "";
      const version = colVersion >= 0 ? valueToString(fila[colVersion]) : "";
      if (!modelo && !version) continue;

      // Se registra bajo varias claves para poder calzar despues aunque la
      // hoja de precios escriba el nombre de otra forma. La primera que se
      // escribe manda: no se pisa un codigo ya encontrado.
      for (const clave of [claveCit(modelo, version), claveCit("", version), claveCit(modelo, "")]) {
        if (clave && !indice.has(clave)) indice.set(clave, codigo);
      }
    }
  }

  return indice;
}

export async function parseExcel(buffer: Buffer): Promise<ImportResult> {
  // cellStyles y sheetStubs: leer el archivo completo, incluidas las
  // celdas vacias y la metadata de filas/columnas ocultas. (Las filas
  // ocultas ya se leian: SheetJS parsea el XML, no lo que se ve.)
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, cellStyles: true, sheetStubs: true });

  // Se recorre el libro ENTERO antes de parsear, porque los codigos CIT
  // pueden estar en una hoja distinta de la de precios.
  const indiceCit = construirIndiceCit(workbook);
  const textParts: string[] = [];
  const changes: DetectedChange[] = [];
  const sheetSummaries: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const filaEncabezado = detectarFilaEncabezado(sheet);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", range: filaEncabezado });
    const csvText = XLSX.utils.sheet_to_csv(sheet);
    textParts.push(`=== Hoja: ${sheetName} ===\n${csvText}`);

    const firstRowsText = rows
      .slice(0, 4)
      .flatMap((row) => Object.entries(row).map(([k, v]) => `${k} ${valueToString(v)}`))
      .join(" ");

    const sheetKind = detectSheetKind(sheetName, firstRowsText);
    sheetSummaries.push(`  * "${sheetName}" -> ${sheetKind} (${rows.length} filas)`);

    switch (sheetKind) {
      case "PRECIOS":
        changes.push(...parseSheetPrecios(sheetName, rows, "REGULAR", undefined, indiceCit));
        break;
      case "DERCO_CL":
        changes.push(...parseSheetPrecios(sheetName, rows, "DERCO_CL", undefined, indiceCit));
        break;
      case "PREVENTA":
        changes.push(...parseSheetPrecios(sheetName, rows, "PREVENTA", undefined, indiceCit));
        break;
      case "PATENTE_GRATIS":
        changes.push(...parseSheetPatenteGratis(sheetName, rows));
        break;
      case "BONO_CIERRE": {
        const headerRestrictions = rows
          .slice(0, 3)
          .flatMap((row) => Object.values(row).map(valueToString))
          .filter(Boolean)
          .join(". ");
        changes.push(...parseSheetBonoCierre(sheetName, rows, headerRestrictions));
        break;
      }
      case "TASA":
        changes.push(
          ...parseTextUpdate(csvText).changes.map((c) => ({
            ...c,
            payload: { offerType: "TASA", sheetName }
          }))
        );
        break;
      case "CAMPANA":
        changes.push(...parseSheetCampana(sheetName, rows));
        break;
      case "DESCONOCIDA":
        if (rows.length > 0) {
          changes.push(...parseTextUpdate(csvText).changes);
        }
        break;
    }
  }

  const fullText = textParts.join("\n\n");
  const parsedText = parseTextUpdate(fullText);
  const warnings = parsedText.warnings;

  if (sheetSummaries.length > 0) {
    warnings.unshift(`Hojas procesadas:\n${sheetSummaries.join("\n")}`);
  }

  return {
    importer: "excel",
    detectedBrand: parsedText.detectedBrand,
    detectedMonth: parsedText.detectedMonth,
    rawText: fullText,
    changes,
    warnings
  };
}
