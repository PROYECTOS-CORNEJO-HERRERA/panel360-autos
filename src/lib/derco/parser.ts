import { parseMoney } from "@/lib/format";

// ============================================================
// LECTURA DE LAS PAGINAS PUBLICAS DE DERCO.CL
// ============================================================
//
// Funciones puras: reciben HTML y devuelven datos. No tocan la base ni
// el disco, para que las pueda usar tanto el importador del catalogo
// (scripts/import-derco-catalog.ts, que corre a mano) como la
// actualizacion diaria de precios, que corre sola en el servidor.

export const DERCO_VEHICLES_SITEMAP = "https://www.derco.cl/sitemap-vehicles.xml";

/** Marcas que vende la automotora. El resto del sitemap se ignora. */
export const MARCAS_DERCO = new Set(["suzuki", "mazda", "great-wall", "changan", "deepal", "dfsk"]);

export type VersionImport = {
  name: string;
  imageUrl?: string;
  specs: Record<string, string>;
};

export type ModelImport = {
  url: string;
  brandName: string;
  modelName: string;
  modelTitle: string;
  pdfUrls: string[];
  versions: VersionImport[];
};

export function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripTags(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

export function canonicalUrl(url: string) {
  return url.replace(/\?.*$/, "");
}

/** "https://www.derco.cl/auto/great-wall/..." -> "GWM" */
export function brandFromUrl(url: string) {
  const match = canonicalUrl(url).match(/\/auto\/([^/]+)\//);
  const slug = match?.[1] ?? "";
  if (slug === "great-wall") return "GWM";
  return slug.toUpperCase();
}

/** Slug de marca de una URL del sitemap, o null si no es de un auto. */
export function slugMarca(url: string) {
  return canonicalUrl(url).match(/\/auto\/([^/]+)\//)?.[1] ?? null;
}

export function modelNameFromTitle(title: string, brandName: string) {
  const withoutBrand = title
    .replace(/^GWM\s+/i, "")
    .replace(/^Great Wall\s+/i, "")
    .replace(new RegExp(`^${brandName}\\s+`, "i"), "")
    .replace(/^Mazda\s+Mazda/i, "Mazda")
    .trim();
  return withoutBrand || title;
}

export function cleanVersionName(versionName: string, modelName: string) {
  const escaped = modelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cleaned = versionName.replace(new RegExp(`^${escaped}\\s+`, "i"), "").trim();
  return cleaned || versionName;
}

function titleFromHtml(html: string) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  return h1 ? stripTags(h1) : "";
}

function extractTable(html: string) {
  const marker = html.indexOf("Detalle de Versiones");
  if (marker < 0) return null;
  const tableStart = html.indexOf("<table", marker);
  if (tableStart < 0) return null;
  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableEnd < 0) return null;
  return html.slice(tableStart, tableEnd + "</table>".length);
}

function extractCells(rowHtml: string) {
  return [...rowHtml.matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((match) => ({
    tag: match[1].toLowerCase(),
    html: match[2],
    text: stripTags(match[2]),
    imageAlt: decodeHtml(match[2].match(/alt="([^"]+)"/i)?.[1] ?? ""),
    imageUrl: decodeHtml(match[2].match(/url=(https%3A%2F%2F[^&"]+)/i)?.[1] ?? "")
  }));
}

/** Lee la tabla "Detalle de Versiones" de la pagina de un modelo. */
export function parseDercoPage(url: string, html: string): ModelImport | null {
  const brandName = brandFromUrl(url);
  const title = titleFromHtml(html);
  if (!title) return null;
  const modelName = modelNameFromTitle(title, brandName);
  const table = extractTable(html);
  if (!table) return null;

  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
  if (rows.length < 2) return null;

  const headerCells = extractCells(rows[0]).slice(1);
  const versions: VersionImport[] = headerCells
    .map((cell) => {
      const fromAlt = cell.imageAlt || "";
      const text = cell.text.replace(/Cotizar ahora|Reservar ahora|Cotizar|Reservar/gi, "").trim();
      const rawName = fromAlt || text;
      return {
        name: cleanVersionName(rawName, modelName),
        imageUrl: cell.imageUrl ? decodeURIComponent(cell.imageUrl) : undefined,
        specs: {}
      };
    })
    .filter((version) => version.name);

  if (!versions.length) return null;

  for (const row of rows.slice(1)) {
    const cells = extractCells(row);
    if (cells.length < 2) continue;
    const label = cells[0].text;
    if (!label || /^consumo energético$/i.test(label)) continue;

    cells.slice(1).forEach((cell, index) => {
      const version = versions[index];
      if (!version) return;
      const value = cell.text;
      if (!value) return;
      version.specs[label] = value;
    });
  }

  const pdfUrls = [...html.matchAll(/https:\/\/[^"'<>]+\.pdf/g)].map((match) => decodeHtml(match[0]));

  return {
    url: canonicalUrl(url),
    brandName,
    modelTitle: title,
    modelName,
    pdfUrls: [...new Set(pdfUrls)],
    versions
  };
}

export function spec(specs: Record<string, string>, ...labels: string[]) {
  const entries = Object.entries(specs);
  for (const label of labels) {
    const found = entries.find(([key]) => key.toLowerCase().includes(label.toLowerCase()));
    if (found) return found[1];
  }
  return undefined;
}

/**
 * La fila "Precio y financiamiento" trae dos montos: primero el precio
 * con bonos (campaña) y despues el precio de lista.
 */
function pricePair(value?: string) {
  if (!value) return { campaign: null, list: null };
  const prices = [...value.matchAll(/\$[\d.]+/g)]
    .map((match) => parseMoney(match[0]))
    .filter((item): item is number => item !== null);
  return {
    campaign: prices[0] ?? null,
    list: prices[1] ?? null
  };
}

export function pricePairFromSpecs(specs: Record<string, string>) {
  const entry = Object.entries(specs).find(([label]) => /precio\s+y\s+financiamiento/i.test(label));
  return pricePair(entry?.[1]);
}
