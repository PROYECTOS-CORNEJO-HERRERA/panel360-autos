import path from "node:path";
import { NextResponse } from "next/server";
import { INFO_STATUS } from "@/lib/constants";
import { storeDocumentFile } from "@/lib/document-storage";
import { allowedDocumentExtensions, parseCommercialDocument } from "@/lib/importers";
import { prisma } from "@/lib/prisma";
import { sanitizeFilename } from "@/lib/safe-paths";

const MONTH_NAMES = ["01-enero", "02-febrero", "03-marzo", "04-abril", "05-mayo", "06-junio", "07-julio", "08-agosto", "09-septiembre", "10-octubre", "11-noviembre", "12-diciembre"];
const MAX_SIZE_BYTES = 25 * 1024 * 1024;

function documentType(extension: string) {
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
        type: documentType(extension),
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

    return NextResponse.redirect(new URL(`/actualizaciones?update=${update.id}`, request.url));
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
