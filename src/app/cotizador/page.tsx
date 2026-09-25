import { QuoteProfitabilityWorkspace } from "@/components/quote-profitability-workspace";
import { EmptyState, Notice, PageHeader, Panel } from "@/components/ui";
import { formatCLP } from "@/lib/format";
import { prisma } from "@/lib/prisma";

import { mesesConPrecios, precioPorTipo, resolverMesEnUso, wherePrecioDelMes } from "@/lib/precios";
import { preciosDercoVigentes } from "@/lib/derco/estado";
import { AvisoMes } from "@/components/aviso-mes";
export const dynamic = "force-dynamic";

function searchValue(value?: string | string[]) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function todayInChile() {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Santiago",
    year: "numeric"
  }).formatToParts(new Date());
  const dateByType = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  return `${dateByType.year}-${dateByType.month}-${dateByType.day}`;
}

export default async function QuotePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  // Bloque B: se resuelve primero QUE MES se esta mostrando. Si la
  // lista del mes en curso no se ha cargado, se muestra la ultima
  // disponible pero avisandolo en pantalla -- no se hace pasar por
  // vigente.
  const meses = await mesesConPrecios();
  const mesEnUso = resolverMesEnUso(meses);

  const [versions, customers, quotes, dercoPorVersion] = await Promise.all([
    prisma.version.findMany({
      include: {
        brand: true,
        model: true,
        prices: { where: wherePrecioDelMes(mesEnUso.mes), orderBy: { effectiveFrom: "desc" } },
      },
      orderBy: [{ brand: { name: "asc" } }, { model: { name: "asc" } }, { commercialOrder: "asc" }, { name: "asc" }]
    }),
    prisma.customer.findMany({ orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.quote.findMany({ include: { customer: true, items: true }, orderBy: { createdAt: "desc" }, take: 10 }),
    preciosDercoVigentes()
  ]);

  const vehicles = versions.map((version) => {
    // Solo la lista INTERNA (canal REGULAR). Antes se tomaba el LIST mas
    // reciente de cualquier canal, asi que un precio de derco.cl o de
    // preventa podia aparecer en la hoja como si fuera el precio de lista.
    const listPrice = precioPorTipo(version.prices, "LIST")?.amount ?? null;
    const campaignPrice = precioPorTipo(version.prices, "CAMPAIGN")?.amount ?? null;
    const cashPrice = precioPorTipo(version.prices, "CASH")?.amount ?? null;
    const financingPrice = precioPorTipo(version.prices, "FINANCING")?.amount ?? null;
    const derco = dercoPorVersion.get(version.id);
    return {
      id: version.id,
      label: `${version.brand.name} ${version.model.name} ${version.name}`,
      brandName: version.brand.name,
      modelName: version.model.name,
      versionName: version.name,
      segment: version.model.segment,
      equipmentSummary: version.equipmentSummary,
      citCode: version.sapCode,
      listPrice,
      campaignPrice,
      cashPrice,
      financingPrice,
      dercoListPrice: derco?.lista ?? null,
      dercoCampaignPrice: derco?.conBonos ?? null,
      dercoUpdatedAt: derco?.fecha ?? null,
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

  const quoteCustomers = customers.map((customer) => ({
    id: customer.id,
    label: `${customer.firstName} ${customer.lastName ?? ""}`.trim(),
    email: customer.email ?? ""
  }));

  return (
    <div className="grid gap-6">
      <div className="no-print grid gap-6">
        <PageHeader title="Cotizador" description="Cotiza el auto y arma en paralelo la hoja de rentabilidad con el mismo vehiculo, cliente y descuento." />

        <AvisoMes mesEnUso={mesEnUso} />

        <Notice>
          Al seleccionar una version se precarga precio, Codigo CIT y precio venta con IVA. Desde la misma hoja puedes consultar permiso de circulacion, calcular Imp. Fuentes Movs., imprimir o enviar por correo.
        </Notice>
      </div>

      {vehicles.length ? (
        <QuoteProfitabilityWorkspace
          vehicles={vehicles}
          customers={quoteCustomers}
          today={todayInChile()}
          initialVersionId={searchValue(searchParams?.versionId)}
          initialCustomerId={searchValue(searchParams?.customerId)}
        />
      ) : (
        <EmptyState title="No hay versiones para cotizar." description="Carga una version y un precio aprobado antes de crear cotizaciones." actionHref="/admin" actionLabel="Administrar catalogo" />
      )}

      <Panel className="no-print">
        <h2 className="text-xl font-black text-ink">Cotizaciones guardadas</h2>
        <div className="mt-4 grid gap-3">
          {quotes.length ? (
            quotes.map((quote) => (
              <div key={quote.id} className="rounded-lg border border-graphite/10 bg-white p-4">
                <p className="font-black text-ink">{quote.title}</p>
                <p className="mt-1 text-sm font-semibold text-steel">
                  Cliente: {quote.customer ? `${quote.customer.firstName} ${quote.customer.lastName ?? ""}` : "No asociado"} | Total: {formatCLP(quote.totalAmount)}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm font-semibold text-steel">No hay cotizaciones guardadas todavia.</p>
          )}
        </div>
      </Panel>
    </div>
  );
}
