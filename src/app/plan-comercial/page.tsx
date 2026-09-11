import { PageHeader, Panel, StatusPill } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { wherePrecioVigente } from "@/lib/precios";
import { prisma } from "@/lib/prisma";
import { CheckCircle2, AlertCircle, Clock, TrendingUp } from "lucide-react";

export const dynamic = "force-dynamic";

type TrafficLight = "verde" | "amarillo" | "rojo";

function getBrandStatus(
  brand: { name: string },
  hasCurrentPrice: boolean,
  hasCurrentCampaign: boolean,
  lastUpdate: Date | null
): { status: TrafficLight; reason: string } {
  if (!hasCurrentPrice && !hasCurrentCampaign) return { status: "rojo", reason: "Sin lista de precios ni acciones comerciales activas" };

  const daysSinceUpdate = lastUpdate
    ? Math.floor((Date.now() - lastUpdate.getTime()) / 86_400_000)
    : 999;

  if (hasCurrentPrice && hasCurrentCampaign && daysSinceUpdate <= 7) return { status: "verde", reason: "Precios y acciones actualizadas" };
  if (hasCurrentPrice || hasCurrentCampaign) return { status: "amarillo", reason: `Actualización parcial — hace ${daysSinceUpdate}d` };

  return { status: "rojo", reason: "Sin datos actualizados este mes" };
}

export default async function PlanComercialPage() {
  const [brands, prices, campaigns, commercialOffers] = await Promise.all([
    // Bloque A: las dos consultas de precios usan el criterio unico.
    // La primera no filtraba por estado en absoluto (tomaba el mas
    // reciente, aunque estuviera REEMPLAZADO o IGNORADO) y la segunda
    // aceptaba DETECTADO. Ver src/lib/precios.ts.
    prisma.brand.findMany({ orderBy: { name: "asc" }, include: { models: { include: { versions: { include: { prices: { take: 1, where: wherePrecioVigente, orderBy: { effectiveFrom: "desc" } }, campaigns: { take: 1, orderBy: { createdAt: "desc" } } } } } } } }),
    prisma.price.findMany({ where: wherePrecioVigente, orderBy: { effectiveFrom: "desc" } }),
    prisma.commercialCampaign.findMany({ where: { status: { in: ["VIGENTE", "DETECTADO", "APROBADO"] } }, orderBy: { createdAt: "desc" } }),
    prisma.commercialOffer.findMany({ where: { status: { in: ["VIGENTE", "DETECTADO", "APROBADO"] } } })
  ]);


  const now = new Date();

  const brandStats = brands.map((brand) => {
    const versions = brand.models.flatMap((m) => m.versions);
    const versionIds = versions.map((v) => v.id);

    const activePrices = prices.filter((p) => versionIds.includes(p.versionId));
    const brandOffers = commercialOffers.filter((o) => o.brandName?.toUpperCase() === brand.name.toUpperCase() || (o.versionId && versionIds.includes(o.versionId)));
    const activeCampaigns = campaigns.filter((c) => c.versionId && versionIds.includes(c.versionId));

    const hasCurrentPrice = activePrices.length > 0;
    const hasCurrentCampaign = activeCampaigns.length > 0 || brandOffers.length > 0;

    const lastPriceDate = activePrices[0]?.effectiveFrom ?? null;
    const lastCampaignDate = activeCampaigns[0]?.startDate ?? activeCampaigns[0]?.createdAt ?? brandOffers[0]?.createdAt ?? null;

    const lastUpdate = [lastPriceDate, lastCampaignDate]
      .filter(Boolean)
      .sort((a, b) => (b?.getTime() ?? 0) - (a?.getTime() ?? 0))[0] ?? null;

    const { status, reason } = getBrandStatus(brand, hasCurrentPrice, hasCurrentCampaign, lastUpdate);


    return {
      brandId: brand.id,
      brandName: brand.name,
      status,
      reason,
      modelCount: brand.models.length,
      versionCount: versions.length,
      activePriceCount: activePrices.length,
      activeCampaignCount: activeCampaigns.length,
      lastUpdate
    };
  });

  const verde = brandStats.filter((b) => b.status === "verde").length;
  const amarillo = brandStats.filter((b) => b.status === "amarillo").length;
  const rojo = brandStats.filter((b) => b.status === "rojo").length;

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="INTELIGENCIA COMERCIAL"
        title="Control Comercial por Marca"
        description="Semáforo de actualización. Verde = precio + acciones vigentes. Amarillo = actualización parcial. Rojo = sin datos."
      />

      {/* KPI SEMÁFOROS */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { label: "Actualizadas", count: verde, color: "emerald", icon: CheckCircle2 },
          { label: "Parciales", count: amarillo, color: "amber", icon: AlertCircle },
          { label: "Sin actualizar", count: rojo, color: "red", icon: Clock }
        ].map(({ label, count, color, icon: Icon }) => (
          <div key={label} className={`rounded-xl border p-4 border-${color}-500/30 bg-${color}-50/40 dark:border-${color}-800 dark:bg-${color}-950/30`}>
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 text-${color}-600 dark:text-${color}-400`} />
              <p className={`text-xs font-black uppercase text-${color}-700 dark:text-${color}-300`}>{label}</p>
            </div>
            <p className="mt-2 text-4xl font-black text-slate-900 dark:text-white">{count}</p>
          </div>
        ))}
      </div>

      {/* BRAND TABLE */}
      <Panel>
        <h2 className="text-xl font-black text-slate-900 dark:text-white">Estado por Marca</h2>
        <div className="mt-4 space-y-2">
          {brandStats.map((b) => (
            <div
              key={b.brandId}
              className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50/40 p-4 dark:border-slate-800 dark:bg-slate-900/60 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3">
                {/* Semáforo */}
                <div className={`h-3 w-3 rounded-full shrink-0 ${b.status === "verde" ? "bg-emerald-500" : b.status === "amarillo" ? "bg-amber-400" : "bg-red-500"}`} />
                <div>
                  <p className="font-black text-slate-900 dark:text-white">{b.brandName}</p>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{b.reason}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                <span>{b.modelCount} modelos</span>
                <span>·</span>
                <span>{b.versionCount} versiones</span>
                <span>·</span>
                <span className={b.activePriceCount > 0 ? "text-teal-600 dark:text-teal-400" : "text-red-500"}>
                  {b.activePriceCount} precios vigentes
                </span>
                <span>·</span>
                <span className={b.activeCampaignCount > 0 ? "text-teal-600 dark:text-teal-400" : "text-slate-400"}>
                  {b.activeCampaignCount} campañas
                </span>
                {b.lastUpdate && (
                  <>
                    <span>·</span>
                    <span>Último: {formatDateTime(b.lastUpdate)}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
