import { PageHeader } from "@/components/ui";
import { PublicacionesWorkspace, type OpcionVehiculo, type PostEnLista } from "@/components/publicaciones-workspace";
import { includePreciosDelMesActual } from "@/lib/precios";
import { prisma } from "@/lib/prisma";
import { TOPE_DIARIO_META, estadoInstagram, publicacionesUltimas24h } from "@/lib/social/instagram";
import { FORMATOS, PLANTILLAS } from "@/lib/social/plantillas";

export const dynamic = "force-dynamic";

export default async function PublicacionesPage() {
  const [estado, publicadosHoy, postsRaw, versiones] = await Promise.all([
    estadoInstagram(),
    publicacionesUltimas24h(),
    prisma.socialPost.findMany({
      orderBy: [{ estado: "asc" }, { updatedAt: "desc" }],
      take: 60,
      include: {
        medias: { orderBy: { orden: "asc" } },
        version: { include: { brand: true, model: true } },
      },
    }),
    prisma.version.findMany({
      where: { status: "VIGENTE" },
      orderBy: [{ brand: { name: "asc" } }, { model: { name: "asc" } }, { commercialOrder: "asc" }],
      take: 400,
      include: {
        brand: true,
        model: true,
        prices: includePreciosDelMesActual(),
      },
    }),
  ]);

  const posts: PostEnLista[] = postsRaw.map((p) => ({
    id: p.id,
    formato: p.formato,
    estado: p.estado,
    plantilla: p.plantilla,
    caption: p.caption,
    programadoPara: p.programadoPara?.toISOString() ?? null,
    publicadoEn: p.publicadoEn?.toISOString() ?? null,
    igPermalink: p.igPermalink,
    error: p.error,
    aprobadoPor: p.aprobadoPor,
    aprobadoEn: p.aprobadoEn?.toISOString() ?? null,
    vehiculo: p.version ? `${p.version.brand.name} ${p.version.model.name} ${p.version.name}` : null,
    medias: p.medias.map((m) => ({ id: m.id, url: m.url, tipo: m.tipo })),
  }));

  const vehiculos: OpcionVehiculo[] = versiones.map((v) => ({
    id: v.id,
    etiqueta: `${v.brand.name} ${v.model.name} ${v.name}${v.modelYear ? ` ${v.modelYear}` : ""}`,
    conPrecio: v.prices.length > 0,
  }));

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="MARKETING"
        title="Publicaciones Instagram"
        description="Arma el post con la ficha y el precio vigente del catalogo, lo deja en una cola con fecha, y publica por la API oficial de Meta. Nada sale sin que usted lo apruebe."
      />
      <PublicacionesWorkspace
        posts={posts}
        vehiculos={vehiculos}
        plantillas={PLANTILLAS}
        formatos={FORMATOS}
        cuentaConectada={estado.conectado}
        requiereAprobacion={estado.requiereAprobacion}
        publicadosHoy={publicadosHoy}
        topeDiario={TOPE_DIARIO_META}
      />
    </div>
  );
}
