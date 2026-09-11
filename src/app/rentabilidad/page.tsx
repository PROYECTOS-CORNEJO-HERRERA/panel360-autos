import { ProfitabilitySheet } from "@/components/profitability-sheet";
import { Notice, PageHeader } from "@/components/ui";
import { mesesConPrecios, resolverMesEnUso, wherePrecioDelMes } from "@/lib/precios";
import { AvisoMes } from "@/components/aviso-mes";
import { prisma } from "@/lib/prisma";
import { listProfitabilitySheets } from "./sheet-actions";

export const dynamic = "force-dynamic";

function searchValue(value?: string | string[]) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function ProfitabilityPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  // Bloque B: que mes se esta mostrando, y si hay que avisarlo.
  const mesEnUso = resolverMesEnUso(await mesesConPrecios());

  const versions = await prisma.version.findMany({
    include: {
      brand: true,
      model: true,
      prices: { where: wherePrecioDelMes(mesEnUso.mes), orderBy: { effectiveFrom: "desc" } }
    },
    orderBy: [{ brand: { name: "asc" } }, { model: { name: "asc" } }, { commercialOrder: "asc" }, { name: "asc" }]
  });

  const savedSheets = await listProfitabilitySheets();

  const vehicles = versions.map((version) => {
    const listPrice = version.prices.find((price) => price.priceType === "LIST")?.amount ?? null;
    const campaignPrice = version.prices.find((price) => price.priceType === "CAMPAIGN")?.amount ?? null;
    const cashPrice = version.prices.find((price) => price.priceType === "CASH")?.amount ?? null;
    const financingPrice = version.prices.find((price) => price.priceType === "FINANCING")?.amount ?? null;
    return {
      id: version.id,
      label: `${version.brand.name} ${version.model.name} ${version.name}`,
      brandName: version.brand.name,
      modelName: version.model.name,
      versionName: version.name,
      citCode: version.sapCode,
      listPrice,
      campaignPrice,
      cashPrice,
      financingPrice,
      prices: version.prices.map((p) => ({
        priceType: p.priceType,
        amount: p.amount,
        status: p.status,
        channel: p.channel,
        bonusName: p.bonusName,
        bonusAmount: p.bonusAmount,
        hasIva: p.hasIva,
        effectiveFrom: p.effectiveFrom.toISOString()
      }))
    };
  });

  const dateParts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Santiago",
    year: "numeric"
  }).formatToParts(new Date());
  const dateByType = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  const today = `${dateByType.year}-${dateByType.month}-${dateByType.day}`;

  return (
    <div className="grid gap-6">
      <div className="no-print grid gap-6">
        <PageHeader
          title="Hoja de rentabilidad"
          description="Completa la hoja con datos reales del catalogo, valores editables, Codigo CIT, permiso de circulacion e Imp. Fuentes Movs."
        />
        <AvisoMes mesEnUso={mesEnUso} />
        <Notice>
          El permiso de circulacion se consulta con el Precio Lista Final neto y fecha de factura del dia. El Imp. Fuentes Movs. se completa con el resultado del SII usando marca, modelo, Codigo CIT y precio venta con IVA.
        </Notice>
      </div>
      <ProfitabilitySheet vehicles={vehicles} today={today} initialState={{ selectedVersionId: searchValue(searchParams?.versionId) }} savedSheets={savedSheets} />
    </div>
  );
}
