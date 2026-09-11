import { readStoredDocument } from "@/lib/document-storage";
import { prisma } from "@/lib/prisma";
import { wherePrecioVigente } from "@/lib/precios";
import { sanitizeFilename } from "@/lib/safe-paths";
import { formatCLP } from "@/lib/format";
import { getPricingBreakdown } from "@/lib/pricing-breakdown";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const docId = params.id;

  // 1. Try finding document by ID directly
  let document = await prisma.document.findUnique({
    where: { id: docId },
    select: {
      id: true,
      type: true,
      originalName: true,
      storedPath: true,
      extension: true,
      textSource: true,
      receivedAt: true,
      brand: { select: { name: true } }
    }
  });

  // 2. Fallback: Check if params.id is a vehicleModel id
  let modelInfo: any = null;
  if (!document) {
    const model = await prisma.vehicleModel.findUnique({
      where: { id: docId },
      include: {
        brand: true,
        technicalSheet: {
          select: {
            id: true,
            type: true,
            originalName: true,
            storedPath: true,
            extension: true,
            textSource: true,
            receivedAt: true,
            brand: { select: { name: true } }
          }
        },
        versions: {
          include: {
            prices: { where: wherePrecioVigente }
          }
        }
      }
    });

    if (model) {
      if (model.technicalSheet) {
        document = model.technicalSheet;
      }
      modelInfo = model;
    }
  }

  // If document found, attempt serving the real PDF as a DOWNLOAD (never redirect the
  // user out to derco.cl / S3). We fetch remote files server-side and stream the bytes
  // back with Content-Disposition: attachment so the browser downloads the file directly.
  if (document) {
    const downloadName = sanitizeFilename(
      (document.originalName || `ficha-tecnica`).replace(/\.[^.]+$/, "")
    ) + ".pdf";

    // Resolve a remote URL, either from storedPath or extracted from textSource.
    let remoteUrl: string | null = null;
    if (document.storedPath && /^https?:\/\//i.test(document.storedPath)) {
      remoteUrl = document.storedPath;
    } else if (document.textSource) {
      const pdfMatch = document.textSource.match(/https?:\/\/[^\s"'\)]+\.pdf/i);
      const httpMatch = document.textSource.match(/https?:\/\/[^\s"'\)]+/i);
      remoteUrl = pdfMatch?.[0] ?? httpMatch?.[0] ?? null;
    }

    // A. Remote PDF -> fetch on the server and stream as an attachment (forces download).
    if (remoteUrl) {
      try {
        const upstream = await fetch(remoteUrl, { redirect: "follow" });
        if (upstream.ok) {
          const contentType = upstream.headers.get("content-type") ?? "";
          const isPdf = /pdf/i.test(contentType) || /\.pdf(\?|$)/i.test(remoteUrl);
          // Only treat it as a downloadable document when it is a real binary file
          // (a PDF / octet-stream). If the URL returns an HTML page we skip it and
          // fall back to the generated technical sheet below.
          if (isPdf || /octet-stream|application\//i.test(contentType)) {
            const buffer = Buffer.from(await upstream.arrayBuffer());
            return new Response(buffer, {
              headers: {
                "Content-Type": isPdf ? "application/pdf" : (contentType || "application/octet-stream"),
                "Content-Disposition": `attachment; filename="${downloadName}"`,
                "Cache-Control": "private, max-age=300"
              }
            });
          }
        }
      } catch {
        // Network error reaching the remote file -> fall back to local / HTML below.
      }
    }

    // B. Local binary file on disk (dev environment) -> stream as attachment.
    if (document.storedPath && !/^https?:\/\//i.test(document.storedPath)) {
      try {
        const file = await readStoredDocument(document.storedPath);
        return new Response(file.buffer, {
          headers: {
            "Content-Type": document.extension === ".pdf" ? "application/pdf" : file.contentType ?? "application/octet-stream",
            "Content-Disposition": `attachment; filename="${downloadName}"`,
            "Cache-Control": "private, max-age=60"
          }
        });
      } catch {
        // Physical local file missing on serverless disk -> fall back to rich HTML sheet below
      }
    }
  }

  // 3. Fallback Interactive HTML Technical Sheet Generator (Never 404)
  const title = document?.originalName ? document.originalName.replace(/\.[^.]+$/, "") : (modelInfo ? `${modelInfo.brand?.name} ${modelInfo.name}` : "Ficha Técnica Comercial");
  const brandName = document?.brand?.name ?? modelInfo?.brand?.name ?? "DERCO";
  const dateStr = document ? new Date(document.receivedAt).toLocaleDateString("es-CL") : new Date().toLocaleDateString("es-CL");
  const extractedText = document?.textSource || (modelInfo ? `Catálogo de especificaciones técnicas y versiones vigentes para ${brandName} ${modelInfo.name}.` : "Información comercial registrada en Panel360 Autos.");

  // Build version specs if modelInfo exists
  let versionsHtml = "";
  if (modelInfo && modelInfo.versions?.length) {
    versionsHtml = `
      <div style="margin-top: 2rem;">
        <h2 style="font-size: 1.1rem; color: #38bdf8; text-transform: uppercase; font-weight: 800; margin-bottom: 1rem;">Versiones & Equipamiento Comercial</h2>
        <div style="display: grid; gap: 1rem;">
          ${modelInfo.versions.map((v: any) => {
            const pricing = getPricingBreakdown({
              brandName,
              modelName: modelInfo.name,
              versionName: v.name,
              segment: modelInfo.segment,
              equipmentSummary: v.equipmentSummary,
              citCode: v.sapCode,
              prices: v.prices ?? []
            });

            return `
              <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 1.25rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                  <strong style="font-size: 1.05rem; color: #ffffff;">${v.name} ${v.modelYear ? `(${v.modelYear})` : ""}</strong>
                  <span style="font-size: 0.85rem; background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 0.25rem 0.6rem; border-radius: 9999px; font-weight: 700;">
                    ${pricing.cashPrice ? `Contado: ${formatCLP(pricing.cashPrice)}` : "Precio a consultar"}
                  </span>
                </div>
                
                <div style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); display: grid; gap: 0.75rem; margin-top: 0.75rem; font-size: 0.825rem; color: #94a3b8;">
                  <div>⚙️ Motor: <strong>${v.engine || v.displacement || "Standard"}</strong></div>
                  <div>🐎 Potencia: <strong>${v.power || "N/I"}</strong></div>
                  <div>🕹️ Transmisión: <strong>${v.transmission || "Manual / Aut"}</strong></div>
                  <div>⛽ Combustible: <strong>${v.fuelType || "Gasolina"}</strong></div>
                  ${pricing.isCommercialVehicle && pricing.cashNetPrice ? `<div style="color: #4ade80;">💵 Valor Neto (Sin IVA): <strong>${formatCLP(pricing.cashNetPrice)}</strong></div>` : ""}
                  ${pricing.financingPrice ? `<div style="color: #a78bfa;">💳 Crédito: <strong>${formatCLP(pricing.financingPrice)}</strong></div>` : ""}
                </div>

                ${v.equipmentSummary ? `<div style="margin-top: 0.75rem; font-size: 0.8rem; color: #cbd5e1; background: rgba(0,0,0,0.2); padding: 0.5rem 0.75rem; border-radius: 6px;">📋 <strong>Equipamiento:</strong> ${v.equipmentSummary}</div>` : ""}
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Panel360 Autos</title>
  <style>
    body { font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 2rem 1rem; }
    .card { max-width: 860px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 2.5rem; box-shadow: 0 20px 40px rgba(15,23,42,0.08); }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e2e8f0; padding-bottom: 1.25rem; margin-bottom: 1.5rem; }
    .badge { display: inline-block; background: #e31837; color: #ffffff; font-weight: 800; font-size: 0.75rem; text-transform: uppercase; padding: 0.35rem 0.75rem; border-radius: 9999px; letter-spacing: 0.05em; }
    h1 { font-size: 1.85rem; font-weight: 900; margin: 0.75rem 0 0.25rem 0; color: #0f172a; }
    .meta { font-size: 0.85rem; color: #64748b; font-weight: 600; }
    .content { font-size: 0.95rem; line-height: 1.7; color: #334155; white-space: pre-wrap; word-break: break-word; background: #f1f5f9; padding: 1.25rem; border-radius: 12px; border: 1px solid #cbd5e1; }
    .version-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem; margin-top: 0.75rem; }
    .version-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
    .version-title { font-size: 1.1rem; color: #0f172a; font-weight: 800; }
    .price-pill { font-size: 0.85rem; background: #e0f2fe; color: #0369a1; padding: 0.3rem 0.7rem; border-radius: 9999px; font-weight: 800; }
    .specs-grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); display: grid; gap: 0.75rem; margin-top: 0.75rem; font-size: 0.85rem; color: #475569; }
    .equip-box { margin-top: 0.75rem; font-size: 0.825rem; color: #334155; background: #ffffff; padding: 0.6rem 0.85rem; border-radius: 8px; border: 1px solid #cbd5e1; }
    .actions { display: flex; gap: 1rem; margin-top: 2rem; }
    .btn-primary { background: #e31837; color: white; font-weight: 800; border: none; padding: 0.85rem 1.75rem; border-radius: 10px; cursor: pointer; font-size: 0.95rem; transition: background 0.2s; text-decoration: none; display: inline-flex; align-items: center; gap: 0.5rem; box-shadow: 0 10px 20px rgba(227,24,55,0.25); }
    .btn-primary:hover { background: #c10c27; }
    .btn-secondary { background: #f1f5f9; color: #0f172a; font-weight: 700; border: 1px solid #cbd5e1; padding: 0.85rem 1.5rem; border-radius: 10px; cursor: pointer; font-size: 0.95rem; text-decoration: none; }
    .btn-secondary:hover { background: #e2e8f0; }
    @media print {
      body { background: white; padding: 0; }
      .card { border: none; box-shadow: none; padding: 0; }
      .actions { display: none; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div>
        <span class="badge">${brandName} — FICHA TÉCNICA OFICIAL</span>
        <h1>${title}</h1>
        <div class="meta">Publicación de Catálogo Comercial | Actualizado: ${dateStr}</div>
      </div>
    </div>

    <div class="content">${extractedText}</div>

    ${versionsHtml}

    <div class="actions">
      <button class="btn-primary" onclick="window.print()">🖨️ Imprimir / Guardar en PDF</button>
      <a class="btn-secondary" href="/vehiculos">🚗 Volver al Catálogo de Vehículos</a>
    </div>
  </div>
</body>
</html>`;


  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=60"
    }
  });
}
