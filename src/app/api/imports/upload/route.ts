import path from "node:path";
import { NextResponse } from "next/server";
import { CONFIDENCE, INFO_STATUS } from "@/lib/constants";
import { aprobarItemComoPrecio } from "@/lib/importers/aprobar-precios";
import { aplicarCodigosAlCatalogo } from "@/lib/importers/codigos-cit";
import { extraerIndiceCodigos } from "@/lib/importers/excel";
import { storeDocumentFile } from "@/lib/document-storage";
import { allowedDocumentExtensions, parseCommercialDocument } from "@/lib/importers";
import { prisma } from "@/lib/prisma";
import { sanitizeFilename } from "@/lib/safe-paths";

const MONTH_NAMES = ["01-enero", "02-febrero", "03-marzo", "04-abril", "05-mayo", "06-junio", "07-julio", "08-agosto", "09-septiembre", "10-octubre", "11-noviembre", "12-diciembre"];
const MAX_SIZE_BYTES = 25 * 1024 * 1024;

// El tipo lo elige el usuario en la pantalla de carga. Adivinarlo por la
// extension era una fuente de errores: una accion comercial en Excel se
// guardaba como lista de precios, y despues nadie entendia por que
// aparecia donde no correspondia.
function documentType(extension: string, tipoElegido: string) {
  if (tipoElegido === "LISTA_PRECIOS") return "LISTA DE PRECIOS";
  if (tipoElegido === "ACCION_COMERCIAL") return "PLAN COMERCIAL";

  // Sin tipo explicito (formularios antiguos) se mantiene la deduccion.
  if (extension === ".xlsx" || extension === ".xls") return "LISTA DE PRECIOS";
  if (extension === ".csv") return "LISTA DE PRECIOS";
  if (extension === ".pdf" || extension === ".pptx") return "PLAN COMERCIAL";
  return "DOCUMENTO";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No se recibió archivo." }, { status: 400 });
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: "Archivo demasiado grande. Máximo 25 MB." }, { status: 400 });
    }

    const extension = path.extname(file.name).toLowerCase();
    if (!allowedDocumentExtensions.includes(extension)) {
      return NextResponse.json({ error: "Formato no soportado." }, { status: 400 });
    }

    const tipoElegido = String(formData.get("tipo") ?? "");
    // Una lista de precios es una planilla. Si llega un PDF con ese tipo
    // es que el usuario se equivoco de pantalla, y conviene decirselo
    // ahora y no dejarlo con cero precios detectados y sin explicacion.
    if (tipoElegido === "LISTA_PRECIOS" && ![".xlsx", ".xls", ".csv"].includes(extension)) {
      return NextResponse.json(
        {
          error:
            "Una lista de precios tiene que ser Excel o CSV. Si esto es un bono, campaña o plan comercial, subelo en Acciones comerciales."
        },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const now = new Date();
    const year = String(now.getFullYear());
    const month = MONTH_NAMES[now.getMonth()];
    const safeName = `${now.toISOString().replace(/[:.]/g, "-")}-${sanitizeFilename(file.name)}`;
    const storedPath = await storeDocumentFile({
      buffer,
      contentType: file.type || undefined,
      directoryParts: ["documentos", year, month, "SIN_MARCA"],
      filename: safeName
    });

    const result = await parseCommercialDocument(file.name, buffer);
    const brand = result.detectedBrand ? await prisma.brand.findFirst({ where: { name: { equals: result.detectedBrand } } }) : null;

    const document = await prisma.document.create({
      data: {
        brandId: brand?.id,
        type: documentType(extension, tipoElegido),
        originalName: file.name,
        storedPath,
        mimeType: file.type || undefined,
        extension,
        status: INFO_STATUS.DETECTED
      }
    });

    const documentImport = await prisma.documentImport.create({
      data: {
        documentId: document.id,
        importType: result.importer,
        status: INFO_STATUS.IN_REVIEW,
        detectedBrand: result.detectedBrand,
        detectedMonth: result.detectedMonth,
        summaryJson: JSON.stringify({
          cambios_detectados: result.changes.length,
          advertencias: result.warnings
        })
      }
    });

    if (result.changes.length) {
      await prisma.documentExtraction.createMany({
        data: result.changes.map((change) => ({
          importId: documentImport.id,
          category: change.category,
          rawText: change.rawText,
          payloadJson: JSON.stringify(change.payload ?? {}),
          confidence: change.confidence,
          status: INFO_STATUS.DETECTED
        }))
      });
    }

    const update = await prisma.update.create({
      data: {
        title: `Importación: ${file.name}`,
        sourceType: document.type,
        documentId: document.id,
        rawText: result.rawText.slice(0, 200000),
        status: INFO_STATUS.IN_REVIEW,
        items: {
          create: result.changes.map((change) => ({
            category: change.category,
            brandName: change.brandName,
            modelName: change.modelName,
            versionName: change.versionName,
            fieldName: change.fieldName,
            proposedValue: change.proposedValue,
            amount: change.amount,
            rawText: change.rawText,
            confidence: change.confidence,
            status: INFO_STATUS.DETECTED,
            ambiguityReason: change.ambiguityReason,
            payloadJson: JSON.stringify(change.payload ?? {})
          }))
        }
      }
    });

    // ── Codigos CIT al catalogo ─────────────────────────────────────
    //
    // Se hace aparte de aprobar precios y antes que eso: el CIT es dato
    // del vehiculo, no del precio, y no tiene por que depender de que la
    // fila de precio calce.
    let codigos = { completados: 0, yaTenian: 0, sinCalce: [] as string[] };
    if ([".xlsx", ".xls"].includes(extension)) {
      try {
        codigos = await aplicarCodigosAlCatalogo(extraerIndiceCodigos(buffer));
      } catch (error) {
        console.error("No se pudieron aplicar los codigos CIT:", error);
      }
    }

    // ── Aprobacion automatica de lo que NO tiene dudas ──────────────
    //
    // Revisar 124 filas a mano no es trabajo de una persona. El sistema
    // aprueba solo las filas de confianza ALTA: vehiculo identificado sin
    // ambiguedad y con el IVA resuelto sin dudas.
    //
    // Lo que queda en REQUIERE_REVISION o AMBIGUA NO se aprueba solo, a
    // proposito: son justamente las filas donde equivocarse cuesta caro
    // (un 19% de error por el IVA, o un precio pegado a la version
    // equivocada). Esas quedan para que una persona decida.
    const candidatas = await prisma.updateItem.findMany({
      where: { updateId: update.id, category: "PRECIO", confidence: CONFIDENCE.HIGH },
      select: { id: true }
    });

    let aprobadosSolos = 0;
    for (const candidata of candidatas) {
      const resultado = await aprobarItemComoPrecio(candidata.id, "Aprobacion automatica");
      if (resultado.ok) aprobadosSolos++;
    }

    if (aprobadosSolos > 0) {
      const quedanPendientes = await prisma.updateItem.count({
        where: { updateId: update.id, status: { in: [INFO_STATUS.DETECTED, INFO_STATUS.IN_REVIEW] } }
      });
      await prisma.update.update({
        where: { id: update.id },
        data: {
          status: quedanPendientes === 0 ? INFO_STATUS.ACTIVE : INFO_STATUS.IN_REVIEW,
          approvedAt: new Date()
        }
      });
    }

    // 303 y no el 307 por omision de NextResponse.redirect. Un 307
    // CONSERVA el metodo, asi que el navegador volvia a mandar el POST
    // (con el Excel entero) a /actualizaciones; Next.js interpreta un
    // POST a una pagina como una accion de formulario, no la encontraba
    // y respondia 500. Ese era el error de TODAS las cargas: el archivo
    // se guardaba bien y el fallo venia despues, al redirigir.
    const destino = new URL(`/actualizaciones?update=${update.id}`, request.url);
    destino.searchParams.set("cit", String(codigos.completados));
    destino.searchParams.set("aprobados", String(aprobadosSolos));
    return NextResponse.redirect(destino, 303);
  } catch (error) {
    // El motivo real se quedaba en los registros de Vercel y el usuario
    // solo veia "No fue posible procesar este archivo", sin manera de
    // saber si el problema era el archivo, la base o el almacenamiento.
    console.error("Fallo la importacion:", error);
    const motivo = error instanceof Error ? error.message : "error desconocido";
    return NextResponse.json(
      { error: `No fue posible procesar este archivo: ${motivo}` },
      { status: 500 }
    );
  }
}
