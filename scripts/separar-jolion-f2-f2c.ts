import { prisma } from "@/lib/prisma";

// ============================================================
// SEPARAR HAVAL JOLION F2 Y F2C EN EL CATALOGO
// ============================================================
//
// La lista de GWM trata "Haval Jolion F2" y "Haval Jolion F2C" como dos
// variantes distintas, cada una con su propio CIT:
//
//   F2    Active/Elite MT -> GW9530E60624S00-2   Elite/Deluxe AT -> GW9523E60624S01-8
//   F2C   Active/Elite MT -> GW10365E61125S00-7  Elite/Deluxe AT -> GW10385E61225S00-8
//
// El catalogo tenia un solo "Haval Jolion" con cuatro versiones, asi
// que las ocho filas de la planilla caian en cuatro y el reparador de
// CIT las declaraba en conflicto -- con razon: no hay donde poner dos
// codigos distintos en una misma version.
//
// Se eligio separar por VERSION y no por modelo. El cliente conoce un
// solo Jolion; F2 y F2C son generaciones de homologacion, no productos
// distintos en la conversacion de venta. Crear dos modelos habria
// partido el Jolion en dos en todas las pantallas de modelo.
//
// Las versiones F2C se crean SIN precios: sus precios estan en la lista
// de septiembre, que todavia no se aprueba.
//
// Sin --aplicar imprime lo que haria y no escribe nada.

const APLICAR = process.argv.includes("--aplicar");

/** Lo que dice la planilla de septiembre, por trim y caja. */
const CIT = {
  F2: { MT: "GW9530E60624S00-2", AT: "GW9523E60624S01-8" },
  F2C: { MT: "GW10365E61125S00-7", AT: "GW10385E61225S00-8" },
};

/** Las cuatro versiones actuales son la F2. El sufijo las hace
 *  explicitas, y deja libre el nombre para la F2C. */
const RENOMBRES: { actual: string; nuevo: string; caja: "MT" | "AT" }[] = [
  { actual: "4x2 ACTIVE MT", nuevo: "4x2 ACTIVE MT F2", caja: "MT" },
  { actual: "4x2 ELITE MT", nuevo: "4x2 ELITE MT F2", caja: "MT" },
  { actual: "4x2 ELITE AT", nuevo: "4x2 ELITE AT F2", caja: "AT" },
  { actual: "4x2 DELUXE AT", nuevo: "4x2 DELUXE AT F2", caja: "AT" },
];

async function main() {
  const modelo = await prisma.vehicleModel.findFirst({
    where: { name: "Haval Jolion", brand: { name: "GWM" } },
    include: { brand: true },
  });
  if (!modelo) throw new Error("No existe el modelo GWM / Haval Jolion.");

  console.log(APLICAR ? "APLICANDO\n" : "SIMULACION — no se escribe nada\n");

  // ── 1. Renombrar las actuales a F2 y corregir su CIT ──────────────
  console.log("── Versiones actuales -> F2 ──");
  for (const r of RENOMBRES) {
    const v = await prisma.version.findFirst({ where: { modelId: modelo.id, name: r.actual } });
    if (!v) {
      console.log(`  (no existe) ${r.actual}`);
      continue;
    }
    const citCorrecto = CIT.F2[r.caja];
    const cambiaCit = v.sapCode !== citCorrecto;
    console.log(`  "${r.actual}" -> "${r.nuevo}"`);
    if (cambiaCit) console.log(`      CIT ${v.sapCode || "(vacio)"} -> ${citCorrecto}`);

    if (APLICAR) {
      await prisma.version.update({
        where: { id: v.id },
        data: { name: r.nuevo, sapCode: citCorrecto },
      });
    }
  }

  // ── 2. Crear las F2C ──────────────────────────────────────────────
  //
  // Se copia solo el tren motriz, que es lo que el nombre de la version
  // ya afirma y que la planilla confirma igual en las dos ("1.5T MT/AT
  // 2WD"). El equipamiento NO se copia: la F2C es un facelift y no hay
  // ficha cargada todavia. Inventarla seria peor que dejarla vacia --
  // el sistema ya muestra "Informacion pendiente de cargar" y eso es la
  // verdad.
  console.log("\n── Versiones F2C nuevas ──");
  for (const r of RENOMBRES) {
    const base = await prisma.version.findFirst({
      where: { modelId: modelo.id, name: APLICAR ? r.nuevo : r.actual },
    });
    if (!base) continue;

    const nombreF2C = r.nuevo.replace(/ F2$/, " F2C");
    const yaExiste = await prisma.version.findFirst({ where: { modelId: modelo.id, name: nombreF2C } });
    if (yaExiste) {
      console.log(`  (ya existe) ${nombreF2C}`);
      continue;
    }

    console.log(`  crear "${nombreF2C}"  CIT ${CIT.F2C[r.caja]}  (sin precios, sin ficha)`);

    if (APLICAR) {
      await prisma.version.create({
        data: {
          brandId: modelo.brandId,
          modelId: modelo.id,
          name: nombreF2C,
          sapCode: CIT.F2C[r.caja],
          displacement: base.displacement,
          power: base.power,
          transmission: base.transmission,
          traction: base.traction,
          fuelType: base.fuelType,
          passengers: base.passengers,
          commercialOrder: base.commercialOrder + 10,
          status: "VIGENTE",
          observations:
            "Variante F2C separada de la F2 por tener CIT propio en la lista GWM de septiembre 2026. Ficha y precios pendientes de cargar.",
        },
      });
    }
  }

  console.log(APLICAR ? "\nListo." : "\nRepetir con --aplicar para escribir.");
  await prisma.$disconnect();
}

main();
