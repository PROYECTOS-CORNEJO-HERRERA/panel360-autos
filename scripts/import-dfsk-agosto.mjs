// Importa precios DFSK Agosto 2026 (Lista / Contado / Financiamiento) desde el
// archivo oficial de Sergio Escobar. Corrige el problema de que faltaba el precio
// CONTADO y de nombres Comfort/Luxury cruzados.
//
// Uso:
//   node scripts/import-dfsk-agosto.mjs --dry-run   (solo muestra los matches)
//   node scripts/import-dfsk-agosto.mjs             (aplica a la base configurada en DATABASE_URL)
//
// Matchea por NOMBRE (no por id) para funcionar igual en SQLite local y Supabase.

import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE_FILE =
  process.env.DFSK_FILE ??
  "V:/Sergio Escobar/Agosto/Lista de Precios Plan Comercial y Flotas DFSK - Agosto 2026.xlsx";
const SHEET = "DFSK Agosto 2026";
const STATUS_ACTIVE = "VIGENTE";
const STATUS_REPLACED = "REEMPLAZADO";
const effectiveFrom = new Date("2026-08-03T12:00:00-04:00");

function asText(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}
function money(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(Math.abs(v));
  const cleaned = asText(v).replace(/[^\d]/g, "");
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function norm(v) {
  return asText(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(\d)[.,](\d)/g, "$1$2") // "1.3" -> "13", "1.5" -> "15"
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Lee las filas de datos del Excel ---
function readRows() {
  const wb = XLSX.readFile(SOURCE_FILE, { cellDates: false });
  const sheet = wb.Sheets[SHEET];
  if (!sheet) throw new Error(`No existe la hoja "${SHEET}" en ${SOURCE_FILE}`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const out = [];
  for (const row of rows) {
    const versionName = asText(row[2]);
    const sap = asText(row[3]);
    const list = money(row[5]);
    // fila de datos = tiene versión + SAP de 4 dígitos + precio lista
    if (!versionName || !/^\d{3,5}$/.test(sap) || !list) continue;
    out.push({
      modelGroup: asText(row[1]),
      versionName,
      sap,
      cit: asText(row[25]),
      listPrice: list,
      brandBonus: money(row[6]),
      cashPrice: money(row[8]),
      financingBonus: money(row[9]),
      financingPrice: money(row[10]),
      netoFinal: money(row[11])
    });
  }
  return out;
}

// --- Matcher DFSK: firma canónica por SAP → tokens que deben/ no deben aparecer ---
// tokens: todos deben estar en `${model.name} ${version.name}` normalizado
// not: ninguno debe estar
const MATCHERS = {
  "5000": { tokens: ["500", "comfort"], not: ["cvt", "luxury", "600"] },        // SUV 500 1.5L Comfort
  "5005": { tokens: ["500", "luxury"], not: ["cvt", "600"] },                    // SUV 500 1.5L Luxury
  "5011": { tokens: ["500", "luxury", "cvt"], not: ["600"] },                    // SUV 500 1.5L Luxury CVT SK
  "5315": { tokens: ["600", "elite"], not: ["pro"] },                            // SUV 600 PHEV Elite
  "5320": { tokens: ["600", "elite", "pro"], not: [] },                          // SUV 600 PHEV Elite Pro
  "5325": { tokens: ["e5", "plus"], not: [] },                                   // E5 PLUS PHEV
  "5401": { tokens: ["d1", "4x2", "mt"], not: ["4x4"] },                         // NEW D1 4x2 MT
  "5406": { tokens: ["d1", "4x4", "mt"], not: ["4x2", "at"] },                   // NEW D1 4x4 MT
  "5411": { tokens: ["d1", "4x4", "at"], not: ["4x2", "mt"] },                   // NEW D1 4x4 AT
  "5415": { tokens: ["z9", "4x2", "mt", "lite"], not: ["4x4"] },                 // NEW Z9 4X2 MT LITE
  "5416": { tokens: ["z9", "4x2", "mt"], not: ["4x4", "lite"] },                 // NEW Z9 4X2 MT
  "5420": { tokens: ["z9", "4x4", "mt"], not: ["4x2", "at", "lite"] },           // NEW Z9 4X4 MT
  "5425": { tokens: ["z9", "4x4", "at"], not: ["4x2", "mt", "lite"] },           // NEW Z9 4X4 AT
  "5505": { tokens: ["truck", "cs", "c21", "13"], not: ["ac", "31"] },           // Truck CS C21 1.3
  "5510": { tokens: ["truck", "cs", "c21", "13", "ac"], not: ["31"] },           // Truck CS C21 1.3 AC
  "5515": { tokens: ["truck", "cs", "c31", "15"], not: ["c21"] },                // Truck CS C31 1.5
  "5525": { tokens: ["truck", "dc", "c22", "13"], not: ["ac", "32"] },           // Truck DC C22 1.3
  "5530": { tokens: ["truck", "dc", "c22", "13", "ac"], not: ["32"] },           // Truck DC C22 1.3 AC
  "5535": { tokens: ["truck", "dc", "c32", "15"], not: ["c22"] },                // Truck DC C32 1.5
  "5600": { tokens: ["cargo", "box", "c21", "13"], not: ["ac"] },                // Cargo Box CS C21 1.3
  "5605": { tokens: ["cargo", "box", "c21", "13", "ac"], not: [] },              // Cargo Box CS C21 1.3 AC
  "5700": { tokens: ["refri"], not: [] },                                        // Refri Truck CS 1.3
  "5800": { tokens: ["cargo", "van", "c25", "13"], not: ["ac", "c35", "ec35"] }, // Cargo Van C25 1.3
  "5805": { tokens: ["cargo", "van", "c25", "13", "ac"], not: ["c35", "ec35"] }, // Cargo Van C25 1.3 AC
  "5810": { tokens: ["cargo", "van", "c35", "15"], not: ["c25", "ec35"] }        // Cargo Van C35 1.5
};

function findVersion(entry, versions) {
  const m = MATCHERS[entry.sap];
  if (!m) return { match: null, reason: "sin-matcher" };
  const candidates = versions.filter((v) => {
    const sig = norm(`${v.model.name} ${v.name}`);
    const toks = sig.split(" ");
    const hasAll = m.tokens.every((t) => toks.includes(t) || sig.includes(t));
    const hasNone = m.not.every((t) => !(toks.includes(t) || sig.includes(t)));
    return hasAll && hasNone;
  });
  if (candidates.length === 1) return { match: candidates[0] };
  return { match: null, reason: candidates.length === 0 ? "0-candidatos" : `ambiguo(${candidates.length})`, candidates };
}

async function ensureDocument() {
  const originalName = "Lista de Precios Plan Comercial y Flotas DFSK - Agosto 2026.xlsx :: DFSK Agosto 2026";
  const existing = await prisma.document.findFirst({ where: { originalName } });
  if (existing) return existing;
  return prisma.document.create({
    data: {
      type: "LISTA DE PRECIOS",
      originalName,
      storedPath: SOURCE_FILE,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: ".xlsx",
      status: STATUS_ACTIVE
    }
  });
}

async function upsertPrice({ versionId, priceType, amount, bonusName, bonusAmount, documentId, entry }) {
  if (!amount) return false;
  const previous = await prisma.price.findFirst({
    where: { versionId, priceType, channel: "REGULAR", status: STATUS_ACTIVE },
    orderBy: { effectiveFrom: "desc" }
  });
  if (previous && previous.amount === amount && previous.bonusName === (bonusName ?? null) && previous.bonusAmount === (bonusAmount ?? null)) {
    return false;
  }
  await prisma.price.updateMany({
    where: { versionId, priceType, channel: "REGULAR", status: STATUS_ACTIVE },
    data: { status: STATUS_REPLACED, effectiveTo: effectiveFrom }
  });
  const price = await prisma.price.create({
    data: {
      versionId, priceType, amount, channel: "REGULAR",
      bonusName: bonusName ?? null, bonusAmount: bonusAmount ?? null,
      hasIva: false, effectiveFrom, status: STATUS_ACTIVE,
      documentId, approvedBy: "IMPORT_DFSK_AGOSTO_2026"
    }
  });
  await prisma.priceHistory.create({
    data: {
      versionId, priceId: price.id, priceType,
      previousAmount: previous?.amount ?? null, newAmount: amount,
      difference: previous ? amount - previous.amount : null,
      changedAt: new Date(), sourceName: "DFSK Agosto 2026",
      observation: `SAP ${entry.sap} · ${entry.modelGroup} / ${entry.versionName}`
    }
  });
  return true;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const entries = readRows();
  const brand = await prisma.brand.findFirst({ where: { name: { in: ["DFSK", "dfsk"] } } });
  if (!brand) throw new Error("No existe la marca DFSK");
  const versions = await prisma.version.findMany({ where: { brandId: brand.id }, include: { model: true } });

  const matched = [];
  const unmatched = [];
  for (const entry of entries) {
    const { match, reason, candidates } = findVersion(entry, versions);
    if (!match) { unmatched.push({ entry, reason, candidates }); continue; }
    matched.push({ entry, version: match });
  }

  console.log(`Filas DFSK en Excel: ${entries.length}`);
  console.log(`Con match: ${matched.length}  |  Sin match: ${unmatched.length}\n`);
  console.log("=== MATCHES (Contado / Financiamiento) ===");
  for (const { entry, version } of matched) {
    console.log(
      `SAP ${entry.sap} | ${version.model.name} / ${version.name}\n` +
      `   Lista=${entry.listPrice}  Contado=${entry.cashPrice}  Financiam=${entry.financingPrice}` +
      (entry.netoFinal ? `  NetoFinal=${entry.netoFinal}` : "")
    );
  }
  if (unmatched.length) {
    console.log("\n=== SIN MATCH ===");
    for (const u of unmatched) {
      console.log(`SAP ${u.entry.sap} | ${u.entry.modelGroup} / ${u.entry.versionName} | ${u.reason}` +
        (u.candidates?.length ? " -> " + u.candidates.map((c) => `${c.model.name}/${c.name}`).join(" ; ") : ""));
    }
  }

  if (process.argv.includes("--sql")) {
    const rows = matched
      .map(({ entry, version }) => {
        const esc = (s) => String(s).replace(/'/g, "''");
        return `  ('${esc(version.model.name)}','${esc(version.name)}',${entry.listPrice},${entry.cashPrice},${entry.financingPrice})`;
      })
      .join(",\n");
    const sql = `-- Precios DFSK Agosto 2026 (Lista / Contado / Financiamiento)
-- Generado automaticamente. Pegar en Supabase -> SQL Editor -> Run.
BEGIN;

CREATE TEMP TABLE dfsk_src (model text, version text, list int, cash int, fin int) ON COMMIT DROP;
INSERT INTO dfsk_src (model, version, list, cash, fin) VALUES
${rows};

-- Resolver los ids de version reales de la marca DFSK
CREATE TEMP TABLE dfsk_match ON COMMIT DROP AS
SELECT ver.id AS version_id, s.list, s.cash, s.fin
FROM dfsk_src s
JOIN brands b   ON b.name = 'DFSK'
JOIN models m   ON m."brandId" = b.id AND lower(btrim(m.name)) = lower(btrim(s.model))
JOIN versions ver ON ver."modelId" = m.id AND lower(btrim(ver.name)) = lower(btrim(s.version));

-- Marcar como reemplazados los precios vigentes anteriores de esas versiones
UPDATE prices p SET status = 'REEMPLAZADO', "effectiveTo" = now()
WHERE p.status = 'VIGENTE' AND p."versionId" IN (SELECT version_id FROM dfsk_match);

-- Insertar Lista / Contado / Financiamiento nuevos
INSERT INTO prices (id, "versionId", "priceType", amount, currency, channel, "hasIva", "effectiveFrom", status, "approvedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, dm.version_id, t.ptype, t.amount, 'CLP', 'REGULAR', false, now(), 'VIGENTE', 'IMPORT_DFSK_AGOSTO_2026', now(), now()
FROM dfsk_match dm
CROSS JOIN LATERAL (VALUES ('LIST', dm.list), ('CASH', dm.cash), ('FINANCING', dm.fin)) AS t(ptype, amount)
WHERE t.amount IS NOT NULL;

COMMIT;

-- Verificacion: debe mostrar 22 versiones con sus 3 precios
SELECT m.name AS modelo, ver.name AS version,
       max(amount) FILTER (WHERE "priceType"='LIST')      AS lista,
       max(amount) FILTER (WHERE "priceType"='CASH')      AS contado,
       max(amount) FILTER (WHERE "priceType"='FINANCING') AS financiamiento
FROM prices p
JOIN versions ver ON ver.id = p."versionId"
JOIN models m ON m.id = ver."modelId"
JOIN brands b ON b.id = m."brandId"
WHERE b.name = 'DFSK' AND p.status = 'VIGENTE' AND p."approvedBy" = 'IMPORT_DFSK_AGOSTO_2026'
GROUP BY m.name, ver.name
ORDER BY m.name, ver.name;
`;
    console.log(sql);
    return;
  }

  if (dryRun) { console.log("\n(DRY RUN: no se escribió nada)"); return; }

  const document = await ensureDocument();
  let changes = 0;
  for (const { entry, version } of matched) {
    // Retiramos precios CAMPAIGN antiguos (el bug guardaba financiamiento como CAMPAIGN)
    await prisma.price.updateMany({
      where: { versionId: version.id, priceType: "CAMPAIGN", channel: "REGULAR", status: STATUS_ACTIVE },
      data: { status: STATUS_REPLACED, effectiveTo: effectiveFrom }
    });
    if (await upsertPrice({ versionId: version.id, priceType: "LIST", amount: entry.listPrice, documentId: document.id, entry })) changes++;
    if (await upsertPrice({ versionId: version.id, priceType: "CASH", amount: entry.cashPrice, bonusName: "Bono marca", bonusAmount: entry.brandBonus, documentId: document.id, entry })) changes++;
    if (await upsertPrice({ versionId: version.id, priceType: "FINANCING", amount: entry.financingPrice, bonusName: "Bono financiamiento Amicar", bonusAmount: entry.financingBonus, documentId: document.id, entry })) changes++;
    if (entry.sap && !version.sapCode) {
      await prisma.version.update({ where: { id: version.id }, data: { sapCode: entry.sap } });
    }
  }
  console.log(`\nPrecios creados/actualizados: ${changes}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
