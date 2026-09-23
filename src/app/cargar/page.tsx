import { BadgeDollarSign, FileSpreadsheet, Upload } from "lucide-react";
import Link from "next/link";
import { EmptyState, Notice, PageHeader, Panel } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// ============================================================
// CARGA DE DOCUMENTOS -- UNA SOLA PANTALLA
// ============================================================
//
// Todo lo que mandan las marcas de Derco entra por aca: listas de
// precios y acciones comerciales. Antes la carga estaba escondida dentro
// de "Actualizacion Comercial", un nombre que no dice "subir", y el tipo
// se adivinaba por la extension del archivo (cualquier Excel se
// guardaba como lista de precios, aunque fuera un bono).
//
// Ahora se elige el tipo y viaja explicito al servidor.

const TIPOS = [
  {
    valor: "LISTA_PRECIOS",
    etiqueta: "Lista de precios",
    icono: FileSpreadsheet,
    detalle: "El Excel de precios de la marca. De aca salen los precios de todo el sistema.",
    formatos: "Excel o CSV"
  },
  {
    valor: "ACCION_COMERCIAL",
    etiqueta: "Accion comercial",
    icono: BadgeDollarSign,
    detalle: "Bonos, campañas, patente gratis, tasas y planes comerciales del mes.",
    formatos: "Excel, CSV, PDF o PowerPoint"
  }
] as const;

export default async function CargarPage() {
  const recientes = await prisma.document.findMany({
    where: { type: { in: ["LISTA DE PRECIOS", "PLAN COMERCIAL"] } },
    orderBy: { receivedAt: "desc" },
    take: 10,
    select: { id: true, originalName: true, type: true, receivedAt: true }
  });

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="CARGA DE DOCUMENTOS"
        title="Subir documentos de la marca"
        description="Listas de precios y acciones comerciales. Elija que es, suba el archivo y revise lo detectado."
      />

      <Panel>
        <h2 className="text-xl font-black text-ink">Subir archivo</h2>
        <p className="mt-1 text-sm font-semibold text-steel">
          Suba el archivo tal como llego de la marca. No hace falta limpiarlo: el sistema revisa todas las hojas del
          Excel, incluidas las ocultas, y lee tambien las filas y columnas ocultas.
        </p>

        <form action="/api/imports/upload" method="post" encType="multipart/form-data" className="mt-5 grid gap-5">
          <fieldset className="grid gap-3">
            <legend className="text-xs font-black uppercase text-steel">Que esta subiendo</legend>
            <div className="grid gap-3 md:grid-cols-2">
              {TIPOS.map((tipo, indice) => {
                const Icono = tipo.icono;
                return (
                  <label
                    key={tipo.valor}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-graphite/15 bg-white p-4 transition hover:border-copper"
                  >
                    <input
                      type="radio"
                      name="tipo"
                      value={tipo.valor}
                      defaultChecked={indice === 0}
                      className="mt-1"
                      required
                    />
                    <span>
                      <span className="flex items-center gap-2 font-black text-ink">
                        <Icono className="h-4 w-4 text-copper" aria-hidden="true" />
                        {tipo.etiqueta}
                      </span>
                      <span className="mt-1 block text-xs font-semibold text-steel">{tipo.detalle}</span>
                      <span className="mt-1 block text-xs font-bold text-graphite">{tipo.formatos}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label className="grid gap-1.5">
            <span className="text-xs font-black uppercase text-steel">Archivo (maximo 25 MB)</span>
            <input className="input" name="file" type="file" accept=".xlsx,.xls,.csv,.pdf,.pptx" required />
          </label>

          <button className="btn btn-primary w-fit" type="submit">
            <Upload className="h-4 w-4" aria-hidden="true" />
            Subir y revisar
          </button>
        </form>
      </Panel>

      <Notice>
        Despues de subirlo vera lo detectado, hoja por hoja, para revisarlo. Nada entra al sistema hasta que lo apruebe.
      </Notice>

      <Panel>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-ink">Ultimos documentos cargados</h2>
          <Link className="btn btn-secondary px-3 py-1 text-xs" href="/documentos">
            Ver todos
          </Link>
        </div>

        {recientes.length === 0 ? (
          <EmptyState title="Todavia no se ha cargado ningun documento." description="Suba el primero con el formulario de arriba." />
        ) : (
          <ul className="mt-3 grid gap-2">
            {recientes.map((documento) => (
              <li
                key={documento.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-graphite/10 p-3"
              >
                <span className="font-black text-ink">{documento.originalName}</span>
                <span className="flex items-center gap-3 text-xs font-semibold text-steel">
                  <span className="rounded-full bg-mist px-2 py-0.5 font-bold">
                    {documento.type === "LISTA DE PRECIOS" ? "Lista de precios" : "Accion comercial"}
                  </span>
                  {formatDateTime(documento.receivedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
