import { CargaDocumentos } from "@/components/carga-documentos";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CargarAccionesComercialesPage() {
  const recientes = await prisma.document.findMany({
    where: { type: "PLAN COMERCIAL" },
    orderBy: { receivedAt: "desc" },
    take: 8,
    select: { id: true, originalName: true, type: true, receivedAt: true }
  });

  return <CargaDocumentos tipo="ACCION_COMERCIAL" recientes={recientes} />;
}
