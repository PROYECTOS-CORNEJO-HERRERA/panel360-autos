// Genera un SQL para sincronizar TODOS los precios VIGENTES desde la base local
// (SQLite, que Codex dejó correcta) hacia produccion (Supabase PostgreSQL).
// Incluye la correccion de precios DFSK Agosto (Lista/Contado/Financiamiento).
//
// Uso:  node scripts/gen-sync-prices-sql.mjs > sync-precios.sql
// Luego: pegar el contenido en Supabase -> SQL Editor -> Run.
//
// Solo LEE la base local. Matchea versiones por (marca, modelo, version) por nombre.

import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ---------- helpers ----------
const asText = (v) => (v === null || v === undefined ? "" : String(v).trim());
const money = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(Math.abs(v));
  const n = Number.parseInt(asText(v).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const norm = (v) =>
  asText(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/(\d)[.,](\d)/g, "$1$2").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
// Quita tildes/dieresis/\u00f1 para que el SQL sea 100% ASCII (evita cortes de copiado/encoding).
const fold = (v) => asText(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const sqlStr = (s) => (s === null || s === undefined ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const sqlStrFold = (s) => (s === null || s === undefined ? "NULL" : `'${fold(String(s)).replace(/'/g, "''")}'`);
const sqlInt = (n) => (n === null || n === undefined ? "NULL" : String(n));
const sqlBool = (b) => (b ? "true" : "false");

// ---------- DFSK desde Excel ----------
const DFSK_FILE =
  process.env.DFSK_FILE ??
  "V:/Sergio Escobar/Agosto/Lista de Precios Plan Comercial y Flotas DFSK - Agosto 2026.xlsx";
const DFSK_SHEET = "DFSK Agosto 2026";
const MATCHERS = {
  "5000": { tokens: ["500", "comfort"], not: ["cvt", "luxury", "600"] },
  "5005": { tokens: ["500", "luxury"], not: ["cvt", "600"] },
  "5011": { tokens: ["500", "luxury", "cvt"], not: ["600"] },
  "5315": { tokens: ["600", "elite"], not: ["pro"] },
  "5320": { tokens: ["600", "elite", "pro"], not: [] },
  "5325": { tokens: ["e5", "plus"], not: [] },
  "5401": { tokens: ["d1", "4x2", "mt"], not: ["4x4"] },
  "5406": { tokens: ["d1", "4x4", "mt"], not: ["4x2", "at"] },
  "5411": { tokens: ["d1", "4x4", "at"], not: ["4x2", "mt"] },
  "5415": { tokens: ["z9", "4x2", "mt", "lite"], not: ["4x4"] },
  "5416": { tokens: ["z9", "4x2", "mt"], not: ["4x4", "lite"] },
  "5420": { tokens: ["z9", "4x4", "mt"], not: ["4x2", "at", "lite"] },
  "5425": { tokens: ["z9", "4x4", "at"], not: ["4x2", "mt", "lite"] },
  "5505": { tokens: ["truck", "cs", "c21", "13"], not: ["ac", "31"] },
  "5510": { tokens: ["truck", "cs", "c21", "13", "ac"], not: ["31"] },
  "5515": { tokens: ["truck", "cs", "c31", "15"], not: ["c21"] },
  "5525": { tokens: ["truck", "dc", "c22", "13"], not: ["ac", "32"] },
  "5530": { tokens: ["truck", "dc", "c22", "13", "ac"], not: ["32"] },
  "5535": { tokens: ["truck", "dc", "c32", "15"], not: ["c22"] },
  "5600": { tokens: ["cargo", "box", "c21", "13"], not: ["ac"] },
  "5605": { tokens: ["cargo", "box", "c21", "13", "ac"], not: [] },
  "5700": { tokens: ["refri"], not: [] },
  "5800": { tokens: ["cargo", "van", "c25", "13"], not: ["ac", "c35", "ec35"] },
  "5805": { tokens: ["cargo", "van", "c25", "13", "ac"], not: ["c35", "ec35"] },
  "5810": { tokens: ["cargo", "van", "c35", "15"], not: ["c25", "ec35"] }
};
function readDfskRows() {
  const wb = XLSX.readFile(DFSK_FILE, { cellDates: false });
  const sheet = wb.Sheets[DFSK_SHEET];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const out = [];
  for (const row of rows) {
    const versionName = asText(row[2]);
    const sap = asText(row[3]);
    const list = money(row[5]);
    if (!versionName || !/^\d{3,5}$/.test(sap) || !list) continue;
    out.push({ sap, list, cash: money(row[8]), fin: money(row[10]),
      brandBonus: money(row[6]), finBonus: money(row[9]) });
  }
  return out;
}
function matchDfsk(sap, versions) {
  const m = MATCHERS[sap];
  if (!m) return null;
  const c = versions.filter((v) => {
    const sig = norm(`${v.model.name} ${v.name}`);
    const toks = sig.split(" ");
    return m.tokens.every((t) => toks.includes(t) || sig.includes(t)) &&
      m.not.every((t) => !(toks.includes(t) || sig.includes(t)));
  });
  return c.length === 1 ? c[0] : null;
}

async function main() {
  const brands = await prisma.brand.findMany();
  const dfsk = brands.find((b) => /dfsk/i.test(b.name));

  // 1) Precios VIGENTES locales de TODAS las marcas EXCEPTO DFSK (local DFSK esta incompleto)
  const localPrices = await prisma.price.findMany({
    where: { status: "VIGENTE", version: { brandId: { not: dfsk?.id } } },
    include: { version: { include: { brand: true, model: true } } }
  });

  const rows = [];
  for (const p of localPrices) {
    const v = p.version;
    if (!v?.brand || !v?.model) continue;
    rows.push({
      brand: v.brand.name, model: v.model.name, version: v.name,
      ptype: p.priceType, channel: p.channel ?? "REGULAR", amount: p.amount,
      bonusName: p.bonusName ?? null, bonusAmount: p.bonusAmount ?? null, hasIva: !!p.hasIva
    });
  }

  // 2) DFSK corregido desde el Excel oficial (Lista/Contado/Financiamiento)
  let dfskCount = 0;
  if (dfsk) {
    const dfskVersions = await prisma.version.findMany({ where: { brandId: dfsk.id }, include: { model: true } });
    for (const entry of readDfskRows()) {
      const ver = matchDfsk(entry.sap, dfskVersions);
      if (!ver) continue;
      dfskCount++;
      const base = { brand: dfsk.name, model: ver.model.name, version: ver.name, channel: "REGULAR", hasIva: false };
      if (entry.list) rows.push({ ...base, ptype: "LIST", amount: entry.list, bonusName: null, bonusAmount: null });
      if (entry.cash) rows.push({ ...base, ptype: "CASH", amount: entry.cash, bonusName: "Bono marca", bonusAmount: entry.brandBonus });
      if (entry.fin) rows.push({ ...base, ptype: "FINANCING", amount: entry.fin, bonusName: "Bono financiamiento Amicar", bonusAmount: entry.finBonus });
    }
  }

  // Empaquetamos ~25 tuplas por linea para que el archivo tenga POCAS lineas
  // (evita que una vista previa que recorta por lineas deje el SQL incompleto).
  const tuples = rows.map((r) =>
    `(${sqlStrFold(r.brand)},${sqlStrFold(r.model)},${sqlStrFold(r.version)},${sqlStr(r.ptype)},${sqlStr(r.channel)},${sqlInt(r.amount)},${sqlStrFold(r.bonusName)},${sqlInt(r.bonusAmount)},${sqlBool(r.hasIva)})`
  );
  const chunks = [];
  for (let i = 0; i < tuples.length; i += 25) chunks.push("  " + tuples.slice(i, i + 25).join(","));
  const values = chunks.join(",\n");

  const sql = `-- ============================================================
-- SINCRONIZACION DE PRECIOS A PRODUCCION (Agosto 2026)
-- Carga Lista / Contado / Financiamiento de todas las marcas.
-- Total filas: ${rows.length}  (DFSK versiones corregidas: ${dfskCount})
-- Pegar completo en Supabase -> SQL Editor -> RUN.
-- ============================================================
BEGIN;

CREATE TEMP TABLE price_src (
  brand text, model text, version text, ptype text, channel text,
  amount int, bonus_name text, bonus_amount int, has_iva boolean
) ON COMMIT DROP;

INSERT INTO price_src (brand, model, version, ptype, channel, amount, bonus_name, bonus_amount, has_iva) VALUES
${values};

-- Resolver ids reales de version (match por marca/modelo/version, sin distinguir mayusculas)
-- unaccent casero: baja a minusculas, recorta y reemplaza tildes/dieresis/n por ASCII.
-- Las secuencias de escape mantienen este SQL 100% ASCII.
CREATE TEMP TABLE price_match ON COMMIT DROP AS
SELECT ver.id AS version_id, s.ptype, s.channel, s.amount, s.bonus_name, s.bonus_amount, s.has_iva
FROM price_src s
JOIN brands b   ON translate(lower(btrim(b.name)),   E'\\u00e1\\u00e9\\u00ed\\u00f3\\u00fa\\u00fc\\u00f1', 'aeiouun') = lower(btrim(s.brand))
JOIN models m   ON m."brandId" = b.id AND translate(lower(btrim(m.name)),   E'\\u00e1\\u00e9\\u00ed\\u00f3\\u00fa\\u00fc\\u00f1', 'aeiouun') = lower(btrim(s.model))
JOIN versions ver ON ver."modelId" = m.id AND translate(lower(btrim(ver.name)), E'\\u00e1\\u00e9\\u00ed\\u00f3\\u00fa\\u00fc\\u00f1', 'aeiouun') = lower(btrim(s.version));

-- Reemplazar los precios vigentes anteriores de esas versiones
UPDATE prices p SET status = 'REEMPLAZADO', "effectiveTo" = now()
WHERE p.status = 'VIGENTE' AND p."versionId" IN (SELECT DISTINCT version_id FROM price_match);

-- Insertar los precios nuevos
INSERT INTO prices (id, "versionId", "priceType", amount, currency, channel, "bonusName", "bonusAmount", "hasIva", "effectiveFrom", status, "approvedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, pm.version_id, pm.ptype, pm.amount, 'CLP', pm.channel, pm.bonus_name, pm.bonus_amount, pm.has_iva, now(), 'VIGENTE', 'SYNC_LOCAL_AGOSTO_2026', now(), now()
FROM price_match pm;

COMMIT;

-- Verificacion: cantidad de precios Contado/Financiamiento por marca
SELECT b.name AS marca,
       count(*) FILTER (WHERE p."priceType"='LIST')      AS lista,
       count(*) FILTER (WHERE p."priceType"='CASH')      AS contado,
       count(*) FILTER (WHERE p."priceType"='FINANCING') AS financiamiento
FROM prices p
JOIN versions ver ON ver.id = p."versionId"
JOIN models m ON m.id = ver."modelId"
JOIN brands b ON b.id = m."brandId"
WHERE p.status = 'VIGENTE'
GROUP BY b.name ORDER BY b.name;
`;

  process.stdout.write(sql);
  console.error(`\n[gen] filas=${rows.length} dfsk=${dfskCount}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
