import { CargaDocumentos } from "@/components/carga-documentos";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CargarListasPreciosPage() {
  const recientes = await prisma.document.findMany({
    where: { type: "LISTA DE PRECIOS" },
    orderBy: { receivedAt: "desc" },
    take: 8,
    select: { id: true, originalName: true, type: true, receivedAt: true }
  });

  return <CargaDocumentos tipo="LISTA_PRECIOS" recientes={recientes} />;
}
