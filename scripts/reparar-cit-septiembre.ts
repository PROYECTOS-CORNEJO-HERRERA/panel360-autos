import XLSX from "xlsx";
import { cargarCandidatas, calzarVersion } from "@/lib/importers/aprobar-precios";
import { prisma } from "@/lib/prisma";

// ============================================================
// REPARAR LOS CIT DEL CATALOGO CONTRA LAS PLANILLAS DE ORIGEN
// ============================================================
//
// El CIT identifica la version ante el SII: con uno equivocado el
// impuesto verde sale mal y nadie lo nota, porque el numero se ve igual
// de normal. Por eso este script NO adivina:
//
//   - solo cambia un CIT cuando la planilla dice otro,
//   - solo si la fila calza con UNA version del catalogo,
//   - si dos filas distintas apuntan a la misma version con codigos
//     distintos, no toca ninguna y lo reporta como conflicto.
//
// Sin --aplicar imprime lo que haria y no escribe nada.

const APLICAR = process.argv.includes("--aplicar");
const BASE = "V:/Sergio Escobar/septiembre";

type Entrada = { marca: string; modelo: string | null; version: string; cit: string };

const texto = (v: unknown) => String(v ?? "").trim();

/** Un CIT chileno: dos letras, numeros, y termina en guion + caracter. */
function pareceCit(valor: string): boolean {
  return /^[A-Z]{2}\d+[A-Z]\d+[A-Z]\d+[A-Z]?\d*-[\dA-Za-z]$/.test(valor.replace(/\s+/g, ""));
}

function filas(ruta: string, hoja: string): unknown[][] {
  const wb = XLSX.readFile(ruta);
  const sheet = wb.Sheets[hoja];
  if (!sheet) throw new Error(`No existe la hoja "${hoja}" en ${ruta}`);
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
}

/** CHANGAN: hoja dedicada "3. CIT por modelo" -> Modelo | Version | SAP | CIT.
 *  El modelo viene en celda combinada, asi que se arrastra. */
function leerChangan(): Entrada[] {
  const rows = filas(`${BASE}/changan/Septiembre 2026 -  Changan Lista de Precios - Envio a CES 04.09.xlsx`, "3. CIT por modelo");
  const out: Entrada[] = [];
  let modelo = "";
  for (const r of rows) {
    const mod = texto(r[0]);
    const ver = texto(r[1]);
    const cit = texto(r[3]);
    if (mod && mod.toLowerCase() !== "modelo") modelo = mod;
    if (ver && pareceCit(cit)) out.push({ marca: "CHANGAN", modelo: modelo || null, version: ver, cit });
  }
  return out;
}

/** GWM: MODELO | MARCA | VERSION | DESC SAP | COD SAP | CODIGO DE HOMOLOGADO.
 *  El "codigo de homologado" ES el CIT. */
function leerGwm(): Entrada[] {
  const rows = filas(`${BASE}/gwm/Lista de Precios GWM Septiembre 2026 - 3 Septiembre.xlsx`, "Precios Septiembre 2026");
  const out: Entrada[] = [];
  let modelo = "";
  for (const r of rows) {
    const mod = texto(r[2]).replace(/\s+/g, " ");
    const ver = texto(r[4]);
    const cit = texto(r[7]);
    if (mod) modelo = mod;
    if (ver && pareceCit(cit)) out.push({ marca: "GWM", modelo: modelo || null, version: ver, cit });
  }
  return out;
}

/** MAZDA: no hay columna de modelo -- "Codigo Modelo" trae un codigo
 *  interno (BHVVLAG). El modelo va dentro del texto de la version
 *  ("MAZDA3 SDN ENTRY 2.0 7G 6MT E6C"), asi que se busca sin modelo y
 *  se exige que la version calce sola. */
function leerMazda(): Entrada[] {
  const rows = filas(`${BASE}/mazda/09- LISTA DE PRECIOS N1 MAZDA Septiembre 2026 - UE.xlsx`, "Mazda");
  const out: Entrada[] = [];
  for (const r of rows) {
    const ver = texto(r[2]);
    const cit = texto(r[10]);
    if (ver && pareceCit(cit)) out.push({ marca: "MAZDA", modelo: null, version: ver, cit });
  }
  return out;
}

async function main() {
  const lectores: [string, () => Entrada[]][] = [
    ["CHANGAN", leerChangan],
    ["GWM", leerGwm],
    ["MAZDA", leerMazda],
  ];

  const candidatas = await cargarCandidatas();
  const actuales = new Map(
    (await prisma.version.findMany({ select: { id: true, sapCode: true } })).map((v) => [v.id, v.sapCode])
  );
  const nombres = new Map(candidatas.map((c) => [c.id, `${c.brand.name} ${c.model.name} / ${c.name}`]));

  console.log(APLICAR ? "APLICANDO\n" : "SIMULACION — no se escribe nada\n");
  let totalCambios = 0;

  for (const [marca, leer] of lectores) {
    const entradas = leer();
    const propuesto = new Map<string, string>();
    const conflicto: string[] = [];
    const sinCalce: string[] = [];

    for (const e of entradas) {
      const v = calzarVersion(
        { brandName: e.marca, modelName: e.modelo, versionName: e.version },
        candidatas
      );
      if (!v) {
        sinCalce.push(`${e.modelo ?? "-"} / ${e.version}`);
        continue;
      }
      const previo = propuesto.get(v.id);
      if (previo && previo !== e.cit) {
        conflicto.push(`${nombres.get(v.id)}: ${previo} vs ${e.cit}`);
        propuesto.delete(v.id);
        continue;
      }
      propuesto.set(v.id, e.cit);
    }

    const cambios = [...propuesto].filter(([id, cit]) => actuales.get(id) !== cit);
    totalCambios += cambios.length;

    console.log(`──── ${marca} ────`);
    console.log(`  filas con CIT: ${entradas.length} | calzaron: ${propuesto.size} | sin calce: ${sinCalce.length} | conflictos: ${conflicto.length}`);
    console.log(`  CIT a corregir: ${cambios.length}`);
    for (const [id, cit] of cambios) {
      console.log(`    ${nombres.get(id)}`);
      console.log(`        ${actuales.get(id) || "(vacio)"}  ->  ${cit}`);
    }
    if (conflicto.length) {
      console.log("  CONFLICTOS (no se tocan):");
      for (const c of conflicto.slice(0, 8)) console.log("    ", c);
    }
    if (sinCalce.length) {
      console.log(`  sin calce (${sinCalce.length}), primeros:`);
      for (const s of sinCalce.slice(0, 6)) console.log("    ", s);
    }
    console.log();

    if (APLICAR) {
      for (const [id, cit] of cambios) await prisma.version.update({ where: { id }, data: { sapCode: cit } });
    }
  }

  console.log(APLICAR ? `${totalCambios} versiones actualizadas.` : `${totalCambios} cambios propuestos. Repetir con --aplicar para escribirlos.`);
  await prisma.$disconnect();
}

main();
