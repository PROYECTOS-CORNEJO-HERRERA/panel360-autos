import fs from "node:fs/promises";
import path from "node:path";
import { INFO_STATUS } from "../src/lib/constants";
import { mesComercialActual } from "../src/lib/mes-comercial";
import { parseMoney } from "../src/lib/format";
import { prisma } from "../src/lib/prisma";
import { assertInsideWorkspace, sanitizeFilename } from "../src/lib/safe-paths";
import { createDatabaseBackup } from "../src/lib/services/backups";

const DERCO_VEHICLES_SITEMAP = "https://www.derco.cl/sitemap-vehicles.xml";
const allowedBrandSlugs = new Set(["suzuki", "mazda", "great-wall", "changan", "deepal", "dfsk"]);
const commercialMonth = "agosto 2026";

type VersionImport = {
  name: string;
  imageUrl?: string;
  specs: Record<string, string>;
};

type ModelImport = {
  url: string;
  brandName: string;
  modelName: string;
  modelTitle: string;
  pdfUrls: string[];
  versions: VersionImport[];
};

function decodeHtml(value: string) {
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

function stripTags(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function canonicalUrl(url: string) {
  return url.replace(/\?.*$/, "");
}

function brandFromUrl(url: string) {
  const match = canonicalUrl(url).match(/\/auto\/([^/]+)\//);
  const slug = match?.[1] ?? "";
  if (slug === "great-wall") return "GWM";
  return slug.toUpperCase();
}

function modelNameFromTitle(title: string, brandName: string) {
  const withoutBrand = title
    .replace(/^GWM\s+/i, "")
    .replace(/^Great Wall\s+/i, "")
    .replace(new RegExp(`^${brandName}\\s+`, "i"), "")
    .replace(/^Mazda\s+Mazda/i, "Mazda")
    .trim();
  return withoutBrand || title;
}

function cleanVersionName(versionName: string, modelName: string) {
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

function parseDercoPage(url: string, html: string): ModelImport | null {
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

function spec(specs: Record<string, string>, ...labels: string[]) {
  const entries = Object.entries(specs);
  for (const label of labels) {
    const found = entries.find(([key]) => key.toLowerCase().includes(label.toLowerCase()));
    if (found) return found[1];
  }
  return undefined;
}

function pricePair(value?: string) {
  if (!value) return { campaign: null, list: null };
  const prices = [...value.matchAll(/\$[\d.]+/g)].map((match) => parseMoney(match[0])).filter((item): item is number => item !== null);
  return {
    campaign: prices[0] ?? null,
    list: prices[1] ?? null
  };
}

function pricePairFromSpecs(specs: Record<string, string>) {
  const entry = Object.entries(specs).find(([label]) => /precio\s+y\s+financiamiento/i.test(label));
  return pricePair(entry?.[1]);
}

function positiveFeatureRows(specs: Record<string, string>) {
  const ignored = new Set([
    "Colores"
  ]);
  return Object.entries(specs)
    .filter(([label, value]) => !ignored.has(label) && !/precio\s+y\s+financiamiento/i.test(label) && value && !/^No disponible$/i.test(value))
    .map(([label, value]) => {
      if (/^(Sí|Si)$/i.test(value)) return label;
      if (value === "-") return "";
      return `${label}: ${value}`;
    })
    .filter(Boolean);
}

function truncate(value: string, length = 3500) {
  return value.length > length ? `${value.slice(0, length - 3)}...` : value;
}

function versionDataFromSpecs(version: VersionImport, sourceUrl: string, pdfUrl?: string) {
  const specs = version.specs;
  const features = positiveFeatureRows(specs);
  const multimedia = spec(specs, "Bluetooth", "Apple Carplay", "Android Auto", "LCD delantero", "Radio touch");
  const safety = features.filter((item) => /airbag|abs|ebd|fren|colisi|carril|punto ciego|tpms|isofix|estabilidad|tracci|cámara|camara|sensor/i.test(item));
  const adas = safety.filter((item) => /acc|iacc|ldw|lka|fcw|aeb|adas|colisi|carril|punto ciego|crucero adapt/i.test(item));

  return {
    displacement: spec(specs, "Cilindrada"),
    power: spec(specs, "Potencia"),
    torque: spec(specs, "Torque"),
    traction: spec(specs, "Tracción"),
    transmission: spec(specs, "Transmisión"),
    fuelType: spec(specs, "Combustible - Tipo de Motor", "Combustible - Tipo"),
    consumption: spec(specs, "Consumo mixto", "Consumo combinado"),
    passengers: spec(specs, "Capacidad de pasajeros"),
    wheels: spec(specs, "Llantas", "Neumáticos - medida", "Neumáticos"),
    screen: spec(specs, "LCD delantero", "Radio touch"),
    carPlay: multimedia && /carplay/i.test(multimedia) ? multimedia : undefined,
    androidAuto: multimedia && /android/i.test(multimedia) ? multimedia : undefined,
    camera: spec(specs, "Cámara", "Camara"),
    sensors: spec(specs, "Sensor"),
    roof: spec(specs, "Sunroof", "Techo"),
    seats: spec(specs, "Tapiz asientos"),
    climateControl: spec(specs, "Climatizador", "Aire acondicionado"),
    airbags: safety.filter((item) => /airbag/i.test(item)).join("; ") || undefined,
    adas: adas.join("; ") || undefined,
    cruiseControl: spec(specs, "Velocidad crucero", "Control crucero"),
    equipmentSummary: truncate(features.join("; ")),
    safetySummary: truncate(safety.join("; ")),
    observations: truncate(`Fuente pública Derco: ${sourceUrl}${pdfUrl ? ` | Ficha técnica: ${pdfUrl}` : ""}`)
  };
}

async function fetchText(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} al descargar ${url}`);
  return response.text();
}

async function fetchBuffer(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} al descargar ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function saveDercoDocument(sourceUrl: string, brandName: string, filename: string, content: Buffer | string, type: string, extension: string) {
  const targetDir = assertInsideWorkspace(path.join(process.cwd(), "documentos", "2026", "08-agosto", brandName, "DERCO"));
  await fs.mkdir(targetDir, { recursive: true });
  const storedPath = assertInsideWorkspace(path.join(targetDir, sanitizeFilename(filename)));
  await fs.writeFile(storedPath, content);

  const existing = await prisma.document.findFirst({ where: { originalName: filename, type } });
  if (existing) {
    return prisma.document.update({
      where: { id: existing.id },
      data: {
        storedPath,
        textSource: sourceUrl,
        status: INFO_STATUS.ACTIVE
      }
    });
  }

  const brand = await prisma.brand.findUnique({ where: { name: brandName } });
  return prisma.document.create({
    data: {
      brandId: brand?.id,
      type,
      originalName: filename,
      storedPath,
      extension,
      textSource: sourceUrl,
      status: INFO_STATUS.ACTIVE
    }
  });
}

// Canal propio para lo publicado en derco.cl.
//
// ANTES ESTO ERA UN BUG: los precios de Derco entraban como
// priceType LIST en el canal REGULAR, o sea EN EL MISMO CARRIL que la
// lista interna, distinguidos solo por documentId. El motor de precios
// toma "el LIST mas reciente del canal REGULAR", asi que correr este
// script pisaba el precio de lista interno con el publicado en la web
// -- y nadie podia notarlo, porque el numero se veia normal.
//
// Con canal propio los dos conviven y se pueden comparar, que es
// justamente lo que se quiere ver: precio interno vs precio publicado.
const CANAL_DERCO = "DERCO_CL";

async function upsertPrice(versionId: string, priceType: string, amount: number | null, documentId: string, sourceName: string) {
  if (!amount) return false;

  const existingSame = await prisma.price.findFirst({
    where: { versionId, priceType, amount, status: INFO_STATUS.ACTIVE, channel: CANAL_DERCO }
  });
  if (existingSame) return false;

  const previousDerco = await prisma.price.findFirst({
    where: { versionId, priceType, status: INFO_STATUS.ACTIVE, channel: CANAL_DERCO },
    orderBy: { effectiveFrom: "desc" }
  });

  if (previousDerco) {
    await prisma.price.update({
      where: { id: previousDerco.id },
      data: { status: INFO_STATUS.REPLACED, effectiveTo: new Date() }
    });
  }

  const price = await prisma.price.create({
    data: {
      versionId,
      priceType,
      amount,
      channel: CANAL_DERCO,
      mesComercial: mesComercialActual(),
      status: INFO_STATUS.ACTIVE,
      documentId,
      approvedBy: "Derco público"
    }
  });

  await prisma.priceHistory.create({
    data: {
      versionId,
      priceId: price.id,
      priceType,
      previousAmount: previousDerco?.amount ?? null,
      newAmount: amount,
      difference: previousDerco ? amount - previousDerco.amount : null,
      sourceName,
      approvedBy: "Derco público",
      observation: "Precio cargado desde página pública Derco. Precio campaña corresponde al precio con bonos informado por Derco."
    }
  });

  return true;
}

async function importModel(model: ModelImport, html: string) {
  const brand = await prisma.brand.upsert({
    where: { name: model.brandName },
    update: { active: true },
    create: { name: model.brandName }
  });

  const htmlDocument = await saveDercoDocument(
    model.url,
    model.brandName,
    `Derco ${model.brandName} ${model.modelName}.html`,
    html,
    "DERCO WEB",
    ".html"
  );

  let pdfUrl = model.pdfUrls[0];
  if (pdfUrl) {
    try {
      const pdf = await fetchBuffer(pdfUrl);
      await saveDercoDocument(
        pdfUrl,
        model.brandName,
        `Ficha tecnica Derco ${model.brandName} ${model.modelName}.pdf`,
        pdf,
        "FICHA TECNICA DERCO",
        ".pdf"
      );
    } catch (error) {
      console.warn(`No fue posible descargar PDF ${pdfUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const vehicleModel = await prisma.vehicleModel.upsert({
    where: { brandId_name: { brandId: brand.id, name: model.modelName } },
    update: {
      status: INFO_STATUS.ACTIVE,
      imagePath: model.versions.find((version) => version.imageUrl)?.imageUrl,
      fuelTypes: [...new Set(model.versions.map((version) => spec(version.specs, "Combustible - Tipo de Motor", "Combustible - Tipo")).filter(Boolean))].join(", ") || undefined,
      transmissions: [...new Set(model.versions.map((version) => spec(version.specs, "Transmisión")).filter(Boolean))].join(", ") || undefined,
      tractions: [...new Set(model.versions.map((version) => spec(version.specs, "Tracción")).filter(Boolean))].join(", ") || undefined
    },
    create: {
      brandId: brand.id,
      name: model.modelName,
      imagePath: model.versions.find((version) => version.imageUrl)?.imageUrl,
      fuelTypes: [...new Set(model.versions.map((version) => spec(version.specs, "Combustible - Tipo de Motor", "Combustible - Tipo")).filter(Boolean))].join(", ") || undefined,
      transmissions: [...new Set(model.versions.map((version) => spec(version.specs, "Transmisión")).filter(Boolean))].join(", ") || undefined,
      tractions: [...new Set(model.versions.map((version) => spec(version.specs, "Tracción")).filter(Boolean))].join(", ") || undefined,
      status: INFO_STATUS.ACTIVE
    }
  });

  let versionsImported = 0;
  let pricesImported = 0;

  for (const [index, versionImport] of model.versions.entries()) {
    const data = versionDataFromSpecs(versionImport, model.url, pdfUrl);
    const version = await prisma.version.upsert({
      where: { modelId_name: { modelId: vehicleModel.id, name: versionImport.name } },
      update: {
        ...data,
        brandId: brand.id,
        status: INFO_STATUS.ACTIVE,
        commercialOrder: index
      },
      create: {
        brandId: brand.id,
        modelId: vehicleModel.id,
        name: versionImport.name,
        ...data,
        status: INFO_STATUS.ACTIVE,
        commercialOrder: index
      }
    });

    const prices = pricePairFromSpecs(versionImport.specs);
    if (await upsertPrice(version.id, "CAMPAIGN", prices.campaign, htmlDocument.id, `Derco ${model.brandName} ${model.modelName}`)) pricesImported += 1;
    if (await upsertPrice(version.id, "LIST", prices.list, htmlDocument.id, `Derco ${model.brandName} ${model.modelName}`)) pricesImported += 1;

    await prisma.auditLog.create({
      data: {
        entityType: "version",
        entityId: version.id,
        brandName: model.brandName,
        modelName: model.modelName,
        versionName: versionImport.name,
        fieldModified: "ficha_tecnica_derco",
        newValue: model.url,
        source: "DERCO WEB",
        user: "importador-derco",
        observation: "Ficha técnica y especificaciones cargadas desde Derco público."
      }
    });

    versionsImported += 1;
  }

  return { versionsImported, pricesImported };
}

async function main() {
  const backupPath = await createDatabaseBackup("antes-importacion-derco");
  const sitemap = await fetchText(DERCO_VEHICLES_SITEMAP);
  const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)]
    .map((match) => match[1])
    .filter((url) => {
      const brandSlug = canonicalUrl(url).match(/\/auto\/([^/]+)\//)?.[1];
      return brandSlug ? allowedBrandSlugs.has(brandSlug) : false;
    });

  const summary = {
    backupPath,
    urlsFound: urls.length,
    modelsImported: 0,
    versionsImported: 0,
    pricesImported: 0,
    failed: [] as { url: string; error: string }[]
  };

  for (const url of urls) {
    try {
      const html = await fetchText(url);
      const parsed = parseDercoPage(url, html);
      if (!parsed) {
        summary.failed.push({ url, error: "No se encontró tabla de versiones parseable." });
        continue;
      }
      const result = await importModel(parsed, html);
      summary.modelsImported += 1;
      summary.versionsImported += result.versionsImported;
      summary.pricesImported += result.pricesImported;
      console.log(`OK ${parsed.brandName} ${parsed.modelName}: ${result.versionsImported} versiones`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch (error) {
      summary.failed.push({ url, error: error instanceof Error ? error.message : String(error) });
      console.warn(`ERROR ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
