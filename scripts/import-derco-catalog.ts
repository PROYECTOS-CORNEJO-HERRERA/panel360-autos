import fs from "node:fs/promises";
import path from "node:path";
import { INFO_STATUS } from "../src/lib/constants";
import { mesComercialActual } from "../src/lib/mes-comercial";
import { prisma } from "../src/lib/prisma";
import {
  DERCO_VEHICLES_SITEMAP,
  MARCAS_DERCO,
  canonicalUrl,
  parseDercoPage,
  pricePairFromSpecs,
  spec,
  type ModelImport,
  type VersionImport
} from "../src/lib/derco/parser";
import { assertInsideWorkspace, sanitizeFilename } from "../src/lib/safe-paths";
import { createDatabaseBackup } from "../src/lib/services/backups";

const allowedBrandSlugs = MARCAS_DERCO;
const commercialMonth = "agosto 2026";















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
