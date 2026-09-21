import { FileSpreadsheet, BadgeDollarSign, Upload } from "lucide-react";
import Link from "next/link";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

// ============================================================
// CARGA DE DOCUMENTOS
// ============================================================
//
// Las listas de precios y las acciones comerciales llegan como archivos
// que mandan las marcas de Derco. Antes se subian desde "Actualizacion
// Comercial", un nombre que no dice "subir", con un solo campo de archivo
// para todo y adivinando el tipo por la extension: un Excel SIEMPRE se
// tomaba como lista de precios, aunque fuera una accion comercial.
//
// Ahora cada tipo tiene su pantalla y su boton, y el tipo viaja explicito
// al servidor en vez de deducirse.

export type TipoCarga = "LISTA_PRECIOS" | "ACCION_COMERCIAL";

type DocumentoReciente = {
  id: string;
  originalName: string;
  type: string;
  receivedAt: Date;
};

const CONFIG = {
  LISTA_PRECIOS: {
    eyebrow: "CARGA DE DOCUMENTOS",
    titulo: "Listas de precios",
    descripcion: "El Excel de precios que envia la marca. De aca salen los precios de todo el sistema.",
    icono: FileSpreadsheet,
    accept: ".xlsx,.xls,.csv",
    formatos: "Excel (.xlsx, .xls) o CSV",
    ayuda:
      "Sube el archivo tal como llego de la marca. No hace falta limpiarlo: el sistema encuentra la fila de encabezados aunque haya titulos arriba, y lee tambien las filas y columnas ocultas.",
    despues:
      "Despues de subirlo veras los precios detectados para revisarlos uno por uno. Ningun precio entra al sistema hasta que los apruebes."
  },
  ACCION_COMERCIAL: {
    eyebrow: "CARGA DE DOCUMENTOS",
    titulo: "Acciones comerciales",
    descripcion: "Bonos, campañas y planes comerciales que envia la marca.",
    icono: BadgeDollarSign,
    accept: ".pdf,.pptx,.xlsx,.xls,.csv",
    formatos: "PDF, PowerPoint (.pptx), Excel o CSV",
    ayuda:
      "Sirve para planes comerciales del mes, bonos por modelo y campañas de financiamiento. El documento original queda guardado como respaldo.",
    despues:
      "Despues de subirlo veras lo que el sistema detecto para que lo revises. Lo que quede ambiguo se marca en revision en vez de inventarse."
  }
} as const;

export function CargaDocumentos({
  tipo,
  recientes
}: {
  tipo: TipoCarga;
  recientes: DocumentoReciente[];
}) {
  const config = CONFIG[tipo];
  const Icono = config.icono;

  return (
    <div className="grid gap-6">
      <PageHeader eyebrow={config.eyebrow} title={config.titulo} description={config.descripcion} />

      <Panel>
        <div className="flex items-start gap-3">
          <Icono className="mt-0.5 h-6 w-6 shrink-0 text-copper" aria-hidden="true" />
          <div className="flex-1">
            <h2 className="text-xl font-black text-ink">Subir archivo</h2>
            <p className="mt-1 text-sm font-semibold text-steel">{config.ayuda}</p>

            <form action="/api/imports/upload" method="post" encType="multipart/form-data" className="mt-4 grid gap-3">
              {/* El tipo viaja explicito: antes se adivinaba por la extension. */}
              <input type="hidden" name="tipo" value={tipo} />
              <label className="grid gap-1.5">
                <span className="text-xs font-black uppercase text-steel">Archivo ({config.formatos})</span>
                <input className="input" name="file" type="file" accept={config.accept} required />
              </label>
              <button className="btn btn-primary w-fit" type="submit">
                <Upload className="h-4 w-4" aria-hidden="true" />
                Subir y revisar
              </button>
            </form>
          </div>
        </div>
      </Panel>

      <Notice>{config.despues}</Notice>

      <Panel>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-ink">Ultimos documentos de este tipo</h2>
          <Link className="btn btn-secondary px-3 py-1 text-xs" href="/documentos">
            Ver todos
          </Link>
        </div>

        {recientes.length === 0 ? (
          <p className="mt-3 text-sm font-semibold text-steel">Todavia no se ha cargado ninguno.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {recientes.map((documento) => (
              <li
                key={documento.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-graphite/10 p-3"
              >
                <span className="font-black text-ink">{documento.originalName}</span>
                <span className="text-xs font-semibold text-steel">{formatDateTime(documento.receivedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
