import Link from "next/link";
import { ClipboardPaste, FileUp } from "lucide-react";
import { aprobarPreciosDeCarga, ignoreUpdateItem, pasteCommercialUpdate, validateUpdateItem } from "@/lib/actions";
import { formatDateTime, formatCLP } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { EmptyState, Notice, PageHeader, Panel, StatusPill } from "@/components/ui";
import { ResumenCargaPanel } from "@/components/resumen-carga";
import { resumirCarga } from "@/lib/importers/resumen-carga";

export const dynamic = "force-dynamic";

function confidenceTone(confidence: string) {
  if (confidence === "ALTA_CONFIANZA") return "good" as const;
  if (confidence === "AMBIGUA") return "bad" as const;
  return "warn" as const;
}

export default async function UpdatesPage({
  searchParams
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const [updates, documents, priceHistory] = await Promise.all([
    prisma.update.findMany({
      include: { items: { orderBy: { createdAt: "desc" } } },
      orderBy: { createdAt: "desc" },
      take: 12
    }),
    prisma.document.findMany({ orderBy: { receivedAt: "desc" }, take: 8 }),
    prisma.priceHistory.findMany({
      include: { version: { include: { brand: true, model: true } } },
      orderBy: { changedAt: "desc" },
      take: 8
    })
  ]);

  // Resultado de la ultima accion (subir o aprobar), para que los botones
  // dejen de parecer que no hacen nada.
  const leer = (clave: string) => {
    const bruto = searchParams?.[clave];
    const valor = Array.isArray(bruto) ? bruto[0] : bruto;
    const numero = Number.parseInt(valor ?? "", 10);
    return Number.isNaN(numero) ? null : numero;
  };
  const cit = leer("cit");
  const aprobados = leer("aprobados");
  const pendientes = leer("pendientes");

  const partes: string[] = [];
  if (aprobados !== null) {
    partes.push(
      aprobados > 0
        ? `Se aprobaron ${aprobados} precios automaticamente.`
        : "No se aprobo ningun precio automaticamente: ninguna fila calzo con una unica version del catalogo."
    );
  }
  if (pendientes !== null && pendientes > 0) {
    partes.push(`${pendientes} quedaron pendientes de revision.`);
  }
  if (cit !== null) {
    partes.push(
      cit > 0
        ? `Se completaron ${cit} codigos CIT en el catalogo.`
        : "No se completo ningun codigo CIT: el archivo no traia codigos, o no calzaron con las versiones del catalogo."
    );
  }
  const citSinCalce = leer("citSinCalce");
  const citYaTenian = leer("citYaTenian");
  if (citYaTenian !== null && citYaTenian > 0) {
    partes.push(`${citYaTenian} versiones ya tenian su codigo cargado.`);
  }
  if (citSinCalce !== null && citSinCalce > 0) {
    partes.push(
      `${citSinCalce} codigos del archivo no calzaron con ninguna version del catalogo (puede que esas versiones todavia no existan).`
    );
  }
  const avisoResultado = partes.length > 0 ? partes.join(" ") : null;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Revisar y aprobar cargas"
        description="Acá se revisa lo que el sistema detectó en los documentos cargados. Nada se vuelve vigente hasta que usted lo apruebe."
      />

      {avisoResultado ? <Notice>{avisoResultado}</Notice> : null}

      <Notice>
        Los importadores procesan localmente y conservan el documento original. Si la información es ambigua o contradictoria, el sistema la mantiene en revisión para completar manualmente.
      </Notice>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel>
          <p className="flex items-center gap-2 text-lg font-black text-ink">
            <FileUp className="h-5 w-5 text-signal" aria-hidden="true" />
            Subir un documento
          </p>
          <p className="mt-1 text-sm font-semibold text-steel">
            Las listas de precios y las acciones comerciales se suben desde una sola pantalla, eligiendo qué es cada archivo.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link className="btn btn-primary" href="/cargar">
              Ir a subir documentos
            </Link>
          </div>
        </Panel>

        <Panel>
          <p className="flex items-center gap-2 text-lg font-black text-ink">
            <ClipboardPaste className="h-5 w-5 text-signal" aria-hidden="true" />
            Pegar actualización comercial
          </p>
          <form action={pasteCommercialUpdate} className="mt-4 grid gap-3">
            <input className="input" name="title" placeholder="Título o fuente del mensaje" />
            <textarea className="input min-h-56" name="rawText" placeholder="Pegue aquí el mensaje de WhatsApp, correo o Teams." required />
            <button className="btn btn-primary w-fit" type="submit">
              Detectar cambios
            </button>
          </form>
        </Panel>
      </div>

      <Panel>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-copper">Vista previa</p>
            <h2 className="text-xl font-black text-ink">Cambios detectados</h2>
          </div>
          <StatusPill>{updates.reduce((count, update) => count + update.items.length, 0)} items</StatusPill>
        </div>

        <div className="mt-4 grid gap-4">
          {updates.length ? (
            updates.map((update) => (
              <div key={update.id} className="rounded-lg border border-graphite/10 bg-white p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-black text-ink">{update.title}</p>
                    <p className="text-xs font-semibold text-steel">
                      {update.sourceType} · {formatDateTime(update.createdAt)} · Estado: {update.status}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill>{update.items.length} detectados</StatusPill>
                    {/* Bloque C: aprobar las filas de precio de una vez.
                        Validar 500 filas de a una es inviable. Las que no
                        se puedan resolver quedan pendientes con su motivo,
                        no se fuerzan. */}
                    {update.items.some((item) => item.category === "PRECIO" && item.status !== "VIGENTE") && (
                      <form action={aprobarPreciosDeCarga}>
                        <input type="hidden" name="updateId" value={update.id} />
                        <button
                          type="submit"
                          className="rounded-lg bg-ink px-3 py-2 text-xs font-black uppercase text-white hover:bg-graphite"
                        >
                          Aprobar {update.items.filter((i) => i.category === "PRECIO" && i.status !== "VIGENTE").length} precios
                        </button>
                      </form>
                    )}
                  </div>
                </div>
                {/* Bloque C: que trae el archivo, antes de aprobarlo. */}
                <ResumenCargaPanel resumen={resumirCarga(update.items, update.title)} />

                <div className="mt-4 overflow-x-auto">
                  {update.items.length ? (
                    <table className="data-table min-w-[900px]">
                      <thead>
                        <tr>
                          <th>Categoría</th>
                          <th>Detectado</th>
                          <th>Valor</th>
                          <th>Confianza</th>
                          <th>Estado</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {update.items.map((item) => (
                          <tr key={item.id}>
                            <td className="font-black text-ink">{item.category}</td>
                            <td>
                              <p className="font-semibold text-graphite">{[item.brandName, item.modelName, item.versionName].filter(Boolean).join(" ") || "Dato no asociado"}</p>
                              <p className="mt-1 max-w-md text-xs font-semibold leading-5 text-steel">{item.rawText}</p>
                              {item.ambiguityReason ? <p className="mt-1 text-xs font-black text-red-700">{item.ambiguityReason}</p> : null}
                            </td>
                            <td className="font-semibold text-graphite">{item.amount ? formatCLP(item.amount) : item.proposedValue ?? "Información pendiente de cargar"}</td>
                            <td>
                              <StatusPill tone={confidenceTone(item.confidence)}>{item.confidence}</StatusPill>
                            </td>
                            <td>
                              <StatusPill>{item.status}</StatusPill>
                            </td>
                            <td>
                              <div className="flex gap-2">
                                <form action={validateUpdateItem}>
                                  <input type="hidden" name="id" value={item.id} />
                                  <button className="btn btn-secondary" type="submit">
                                    Revisar
                                  </button>
                                </form>
                                <form action={ignoreUpdateItem}>
                                  <input type="hidden" name="id" value={item.id} />
                                  <button className="btn btn-danger" type="submit">
                                    Ignorar
                                  </button>
                                </form>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-sm font-semibold text-steel">No se detectaron cambios estructurados. Revise el documento fuente manualmente.</p>
                  )}
                </div>
              </div>
            ))
          ) : (
            <EmptyState
              title="Todavía no hay actualizaciones cargadas."
              description="Suba un archivo o pegue un mensaje comercial. El sistema preparará una revisión antes de aprobar cualquier cambio."
            />
          )}
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <h2 className="text-xl font-black text-ink">Documentos fuente conservados</h2>
          <div className="mt-4 grid gap-3">
            {documents.length ? (
              documents.map((document) => (
                <div key={document.id} className="rounded-lg border border-graphite/10 bg-white p-4">
                  <p className="font-black text-ink">{document.originalName}</p>
                  <p className="mt-1 text-xs font-semibold text-steel">
                    {document.type} · {formatDateTime(document.receivedAt)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm font-semibold text-steel">No hay documentos subidos todavía.</p>
            )}
          </div>
        </Panel>

        <Panel>
          <h2 className="text-xl font-black text-ink">Historial de precios</h2>
          <div className="mt-4 grid gap-3">
            {priceHistory.length ? (
              priceHistory.map((history) => (
                <div key={history.id} className="rounded-lg border border-graphite/10 bg-white p-4">
                  <p className="font-black text-ink">
                    {history.version.brand.name} {history.version.model.name} {history.version.name}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-steel">
                    Antes: {formatCLP(history.previousAmount)} · Ahora: {formatCLP(history.newAmount)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm font-semibold text-steel">Aún no hay precios aprobados ni historial.</p>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
