import { CompareClient } from "@/components/compare-client";
import { PageHeader } from "@/components/ui";
import { mesesConPrecios, resolverMesEnUso, wherePrecioDelMes } from "@/lib/precios";
import { AvisoMes } from "@/components/aviso-mes";
import { getCommercialAidAlerts } from "@/lib/commercial-aids";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function selectedVersions(searchParams?: Record<string, string | string[] | undefined>) {
  const raw = searchParams?.v ?? searchParams?.versionId;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

export default async function ComparePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  // Bloque B: que mes se esta mostrando, y si hay que avisarlo.
  const mesEnUso = resolverMesEnUso(await mesesConPrecios());

  const [versions, commercialAidAlerts] = await Promise.all([
    prisma.version.findMany({
      include: {
        brand: true,
        model: true,
        prices: { where: wherePrecioDelMes(mesEnUso.mes), orderBy: { effectiveFrom: "desc" } }
      },
      orderBy: [{ brand: { name: "asc" } }, { model: { name: "asc" } }, { commercialOrder: "asc" }, { name: "asc" }]
    }),
    getCommercialAidAlerts(300)
  ]);

  const aids = commercialAidAlerts.map((alert) => ({
    id: alert.id,
    title: alert.title,
    brandName: alert.brandName,
    modelName: alert.modelName,
    versionName: alert.versionName,
    category: alert.category,
    detail: alert.detail,
    source: alert.source,
    tone: alert.tone
  }));

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Comparador"
        description="Compara hasta 3 versiones con precio lista, precio final campana, ahorro, CIT, equipamiento y alertas comerciales detectadas."
      />
      <AvisoMes mesEnUso={mesEnUso} />
      <CompareClient versions={versions} initialSelected={selectedVersions(searchParams)} commercialAids={aids} />
    </div>
  );
}
