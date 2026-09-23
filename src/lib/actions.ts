"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { INFO_STATUS } from "@/lib/constants";
import { aprobarItemComoPrecio } from "@/lib/importers/aprobar-precios";
import { parseMoney } from "@/lib/format";
import { parseTextUpdate } from "@/lib/importers/text";
import { prisma } from "@/lib/prisma";
import { formatRut, isValidRut, normalizeRut, rutMatches } from "@/lib/rut";
import { createDatabaseBackup } from "@/lib/services/backups";
import { sendTelegramMessage } from "@/lib/services/notifications/telegram";
import { writeAudit } from "@/lib/services/audit";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value ? String(value).trim() : "";
}

function dateValue(formData: FormData, key: string) {
  const value = textValue(formData, key);
  return value ? new Date(value) : undefined;
}

export async function createBrand(formData: FormData) {
  const name = textValue(formData, "name").toUpperCase();
  if (!name) return;

  await prisma.brand.upsert({
    where: { name },
    update: { active: true },
    create: { name }
  });

  await writeAudit({ entityType: "brand", fieldModified: "name", newValue: name, source: "INGRESO MANUAL", user: "local" });
  revalidatePath("/admin");
  revalidatePath("/vehiculos");
}

export async function createModel(formData: FormData) {
  const brandId = textValue(formData, "brandId");
  const name = textValue(formData, "name");
  if (!brandId || !name) return;

  const model = await prisma.vehicleModel.create({
    data: {
      brandId,
      name,
      segment: textValue(formData, "segment") || undefined,
      fuelTypes: textValue(formData, "fuelTypes") || undefined,
      transmissions: textValue(formData, "transmissions") || undefined,
      tractions: textValue(formData, "tractions") || undefined,
      status: INFO_STATUS.DRAFT
    },
    include: { brand: true }
  });

  await writeAudit({
    entityType: "model",
    entityId: model.id,
    brandName: model.brand.name,
    modelName: model.name,
    fieldModified: "modelo",
    newValue: model.name,
    source: "INGRESO MANUAL",
    user: "local"
  });

  revalidatePath("/admin");
  revalidatePath("/vehiculos");
}

export async function createVersion(formData: FormData) {
  const modelId = textValue(formData, "modelId");
  const name = textValue(formData, "name");
  if (!modelId || !name) return;

  const model = await prisma.vehicleModel.findUnique({ where: { id: modelId }, include: { brand: true } });
  if (!model) return;

  const version = await prisma.version.create({
    data: {
      brandId: model.brandId,
      modelId: model.id,
      name,
      sapCode: textValue(formData, "sapCode") || undefined,
      modelYear: textValue(formData, "modelYear") || undefined,
      engine: textValue(formData, "engine") || undefined,
      displacement: textValue(formData, "displacement") || undefined,
      power: textValue(formData, "power") || undefined,
      torque: textValue(formData, "torque") || undefined,
      transmission: textValue(formData, "transmission") || undefined,
      gears: textValue(formData, "gears") || undefined,
      traction: textValue(formData, "traction") || undefined,
      fuelType: textValue(formData, "fuelType") || undefined,
      consumption: textValue(formData, "consumption") || undefined,
      passengers: textValue(formData, "passengers") || undefined,
      cargoCapacity: textValue(formData, "cargoCapacity") || undefined,
      wheels: textValue(formData, "wheels") || undefined,
      screen: textValue(formData, "screen") || undefined,
      carPlay: textValue(formData, "carPlay") || undefined,
      androidAuto: textValue(formData, "androidAuto") || undefined,
      camera: textValue(formData, "camera") || undefined,
      sensors: textValue(formData, "sensors") || undefined,
      roof: textValue(formData, "roof") || undefined,
      seats: textValue(formData, "seats") || undefined,
      climateControl: textValue(formData, "climateControl") || undefined,
      airbags: textValue(formData, "airbags") || undefined,
      adas: textValue(formData, "adas") || undefined,
      cruiseControl: textValue(formData, "cruiseControl") || undefined,
      equipmentSummary: textValue(formData, "equipmentSummary") || undefined,
      safetySummary: textValue(formData, "safetySummary") || undefined,
      warranty: textValue(formData, "warranty") || undefined,
      observations: textValue(formData, "observations") || undefined,
      commercialOrder: Number.parseInt(textValue(formData, "commercialOrder") || "0", 10)
    }
  });

  await writeAudit({
    entityType: "version",
    entityId: version.id,
    brandName: model.brand.name,
    modelName: model.name,
    versionName: version.name,
    fieldModified: "version",
    newValue: version.name,
    source: "INGRESO MANUAL",
    user: "local"
  });

  revalidatePath("/admin");
  revalidatePath("/vehiculos");
  revalidatePath("/comparador");
}

export async function createManualPrice(formData: FormData) {
  const versionId = textValue(formData, "versionId");
  const priceType = textValue(formData, "priceType");
  const amount = parseMoney(formData.get("amount"));
  if (!versionId || !priceType || amount === null) return;

  await createDatabaseBackup("precio-manual");

  const version = await prisma.version.findUnique({
    where: { id: versionId },
    include: { brand: true, model: true }
  });
  if (!version) return;

  const previous = await prisma.price.findFirst({
    where: { versionId, priceType, status: INFO_STATUS.ACTIVE, effectiveTo: null },
    orderBy: { effectiveFrom: "desc" }
  });

  if (previous) {
    await prisma.price.update({
      where: { id: previous.id },
      data: { status: INFO_STATUS.REPLACED, effectiveTo: new Date() }
    });
  }

  const price = await prisma.price.create({
    data: {
      versionId,
      priceType,
      amount,
      status: INFO_STATUS.ACTIVE,
      approvedBy: "local"
    }
  });

  await prisma.priceHistory.create({
    data: {
      versionId,
      priceId: price.id,
      priceType,
      previousAmount: previous?.amount ?? null,
      newAmount: amount,
      difference: previous ? amount - previous.amount : null,
      sourceName: textValue(formData, "sourceName") || "Ingreso manual",
      approvedBy: "local",
      observation: textValue(formData, "observation") || undefined
    }
  });

  await writeAudit({
    entityType: "price",
    entityId: price.id,
    brandName: version.brand.name,
    modelName: version.model.name,
    versionName: version.name,
    fieldModified: priceType,
    previousValue: previous ? String(previous.amount) : null,
    newValue: String(amount),
    source: "INGRESO MANUAL",
    user: "local",
    observation: textValue(formData, "observation") || undefined
  });

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/vehiculos");
  revalidatePath("/comparador");
  revalidatePath("/historial-precios");
}

export async function pasteCommercialUpdate(formData: FormData) {
  const rawText = textValue(formData, "rawText");
  if (!rawText) return;

  const title = textValue(formData, "title") || "Actualización pegada";
  const result = parseTextUpdate(rawText);

  const document = await prisma.document.create({
    data: {
      type: "MENSAJE",
      originalName: title,
      textSource: rawText,
      status: INFO_STATUS.DETECTED
    }
  });

  const documentImport = await prisma.documentImport.create({
    data: {
      documentId: document.id,
      importType: "text",
      status: INFO_STATUS.IN_REVIEW,
      detectedBrand: result.detectedBrand,
      detectedMonth: result.detectedMonth,
      summaryJson: JSON.stringify({
        cambios_detectados: result.changes.length,
        advertencias: result.warnings
      })
    }
  });

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

  const update = await prisma.update.create({
    data: {
      title,
      sourceType: "MENSAJE",
      documentId: document.id,
      rawText,
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

  revalidatePath("/actualizaciones");
  redirect(`/actualizaciones?update=${update.id}`);
}

export async function ignoreUpdateItem(formData: FormData) {
  const id = textValue(formData, "id");
  if (!id) return;
  await prisma.updateItem.update({ where: { id }, data: { status: INFO_STATUS.IGNORED } });
  revalidatePath("/actualizaciones");
}

export async function validateUpdateItem(formData: FormData) {
  const id = textValue(formData, "id");
  if (!id) return;

  const item = await prisma.updateItem.findUnique({ where: { id }, include: { update: true } });
  if (!item) return;

  if (item.confidence === "AMBIGUA") {
    await prisma.updateItem.update({
      where: { id },
      data: {
        status: INFO_STATUS.IN_REVIEW,
        ambiguityReason: item.ambiguityReason || "Información incompleta. Complete manualmente antes de aprobar."
      }
    });
    revalidatePath("/actualizaciones");
    return;
  }

  // Bloque C: si la fila es un precio, aprobarla ahora SI crea el
  // precio. Antes solo la marcaba EN_REVISION y ahi moria la cadena --
  // por eso "no se podia cargar la lista del mes": ese camino nunca se
  // habia terminado de construir.
  if (item.category === "PRECIO") {
    const resultado = await aprobarItemComoPrecio(id);
    revalidatePath("/actualizaciones");
    revalidatePath("/cotizador");
    revalidatePath("/comparador");
    revalidatePath("/rentabilidad");
    revalidatePath("/vehiculos");
    if (!resultado.ok) {
      // El motivo ya quedo escrito en la fila cuando corresponde; no se
      // lanza excepcion para no perder el resto de la pantalla.
      return;
    }
    return;
  }

  await prisma.updateItem.update({ where: { id }, data: { status: INFO_STATUS.IN_REVIEW } });
  revalidatePath("/actualizaciones");
}

/**
 * Aprueba de una vez todas las filas de precio de una carga (Bloque C).
 *
 * Validar 500 filas de una lista mensual de a una es inviable. Las que
 * no se puedan resolver quedan pendientes con su motivo, no se fuerzan.
 */
export async function aprobarPreciosDeCarga(formData: FormData) {
  const updateId = textValue(formData, "updateId");
  if (!updateId) return;

  const items = await prisma.updateItem.findMany({
    where: {
      updateId,
      category: "PRECIO",
      status: { in: [INFO_STATUS.DETECTED, INFO_STATUS.IN_REVIEW] },
    },
  });

  let aprobados = 0;
  let pendientes = 0;
  for (const item of items) {
    const resultado = await aprobarItemComoPrecio(item.id);
    if (resultado.ok) aprobados++;
    else pendientes++;
  }

  await prisma.update.update({
    where: { id: updateId },
    data: {
      status: pendientes === 0 ? INFO_STATUS.ACTIVE : INFO_STATUS.IN_REVIEW,
      approvedAt: new Date(),
    },
  });

  revalidatePath("/actualizaciones");
  revalidatePath("/cotizador");
  revalidatePath("/comparador");
  revalidatePath("/rentabilidad");
  revalidatePath("/vehiculos");

  // El boton "Aprobar N precios" no devolvia nada: si ninguna fila
  // calzaba con el catalogo, no pasaba nada en pantalla y parecia roto.
  // Ahora siempre se informa el resultado.
  redirect(`/actualizaciones?update=${updateId}&aprobados=${aprobados}&pendientes=${pendientes}`);
}

export async function createCustomer(formData: FormData) {
  const firstName = textValue(formData, "firstName");
  if (!firstName) return;

  const rawRut = textValue(formData, "rut");
  const formattedRut = rawRut ? formatRut(rawRut) || rawRut : undefined;
  const rutLookupConsentAt = textValue(formData, "rutLookupConsent") ? new Date() : undefined;
  const existingByRut = formattedRut
    ? (await prisma.customer.findMany({ where: { rut: { not: null } } })).find((customer) => rutMatches(customer.rut, formattedRut))
    : null;
  const defaultStatus = await prisma.customerStatus.findFirst({ orderBy: { position: "asc" } });

  const customerData = {
    firstName,
    lastName: textValue(formData, "lastName") || undefined,
    rut: formattedRut,
    phone: textValue(formData, "phone") || undefined,
    whatsapp: textValue(formData, "whatsapp") || undefined,
    email: textValue(formData, "email") || undefined,
    birthDate: dateValue(formData, "birthDate"),
    address: textValue(formData, "address") || undefined,
    commune: textValue(formData, "commune") || undefined,
    city: textValue(formData, "city") || undefined,
    region: textValue(formData, "region") || undefined,
    rutLookupConsentAt,
    rutLookupSource: rutLookupConsentAt ? textValue(formData, "rutLookupSource") || "AUTORIZADO_CLIENTE" : undefined,
    statusId: textValue(formData, "statusId") || defaultStatus?.id,
    originId: textValue(formData, "originId") || undefined,
    interestedBrand: textValue(formData, "interestedBrand") || undefined,
    interestedModel: textValue(formData, "interestedModel") || undefined,
    interestedVersion: textValue(formData, "interestedVersion") || undefined,
    budget: parseMoney(formData.get("budget")),
    purchaseType: textValue(formData, "purchaseType") || undefined,
    currentVehicle: textValue(formData, "currentVehicle") || undefined,
    currentPlate: textValue(formData, "currentPlate") || undefined,
    notes: textValue(formData, "notes") || undefined,
    nextActionType: textValue(formData, "nextActionType") || undefined,
    nextActionAt: dateValue(formData, "nextActionAt"),
    nextActionNote: textValue(formData, "nextActionNote") || undefined,
    nextActionPriority: textValue(formData, "nextActionPriority") || undefined
  };

  if (formattedRut && !isValidRut(formattedRut)) return;

  if (existingByRut) {
    const nonEmptyUpdates = Object.fromEntries(
      Object.entries(customerData).filter(([, value]) => value !== undefined && value !== null && value !== "")
    );

    const customer = await prisma.customer.update({
      where: { id: existingByRut.id },
      data: nonEmptyUpdates
    });

    await prisma.activity.create({
      data: {
        customerId: customer.id,
        type: "CLIENTE ACTUALIZADO",
        description: `Datos actualizados desde ingreso por RUT ${normalizeRut(formattedRut ?? "")}.`
      }
    });

    revalidatePath("/");
    revalidatePath("/clientes");
    redirect(`/clientes/${customer.id}`);
  }

  const customer = await prisma.customer.create({
    data: customerData
  });

  await prisma.activity.create({
    data: {
      customerId: customer.id,
      type: "CLIENTE INGRESADO",
      description: "Cliente creado en el sistema."
    }
  });

  revalidatePath("/");
  revalidatePath("/clientes");
  redirect(`/clientes/${customer.id}`);
}

export async function updateCustomerStatus(formData: FormData) {
  const customerId = textValue(formData, "customerId");
  const statusId = textValue(formData, "statusId");
  if (!customerId || !statusId) return;

  const status = await prisma.customerStatus.findUnique({ where: { id: statusId } });
  await prisma.customer.update({ where: { id: customerId }, data: { statusId } });
  await prisma.activity.create({
    data: {
      customerId,
      type: "CAMBIO DE ESTADO",
      description: `Estado actualizado a ${status?.name ?? "estado no disponible"}.`
    }
  });

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${customerId}`);
}

export async function addCustomerActivity(formData: FormData) {
  const customerId = textValue(formData, "customerId");
  const type = textValue(formData, "type");
  const description = textValue(formData, "description");
  if (!customerId || !type || !description) return;

  await prisma.activity.create({ data: { customerId, type, description } });
  await prisma.customer.update({ where: { id: customerId }, data: { lastContactAt: new Date() } });
  revalidatePath(`/clientes/${customerId}`);
  revalidatePath("/clientes");
}

export async function saveClientProfile(formData: FormData) {
  const customerId = textValue(formData, "customerId");
  if (!customerId) return;

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return;

  const profileLines = [
    "Perfilamiento express",
    `Presupuesto: ${textValue(formData, "budgetLabel") || "No informado"}`,
    `Uso: ${textValue(formData, "use") || "No informado"}`,
    `Tipo: ${textValue(formData, "type") || "No informado"}`,
    `Combustible: ${textValue(formData, "fuel") || "No informado"}`,
    `Caja: ${textValue(formData, "box") || "No informado"}`,
    `Traccion: ${textValue(formData, "traction") || "No informado"}`,
    `Prioridad: ${textValue(formData, "priority") || "No informada"}`,
    `Familia/carga: ${textValue(formData, "familySize") || "No informado"}`,
    `Compra: ${textValue(formData, "purchaseTiming") || "No informado"}`,
    `Financiamiento: ${textValue(formData, "financing") || "No informado"}`,
    `Retoma: ${textValue(formData, "tradeIn") || "No informado"}`,
    `Recomendacion: ${textValue(formData, "recommendedVehicleLabel") || "Pendiente"}`,
    textValue(formData, "sellerAdvice") ? `Argumento: ${textValue(formData, "sellerAdvice")}` : "",
    textValue(formData, "profileNotes") ? `Notas: ${textValue(formData, "profileNotes")}` : ""
  ].filter(Boolean);

  const notesBlock = profileLines.join("\n");
  const currentNotes = customer.notes ? `${customer.notes}\n\n` : "";

  await prisma.customer.update({
    where: { id: customerId },
    data: {
      budget: parseMoney(formData.get("budget")) ?? customer.budget,
      purchaseType: textValue(formData, "financing") || customer.purchaseType,
      interestedBrand: textValue(formData, "recommendedBrand") || customer.interestedBrand,
      interestedModel: textValue(formData, "recommendedModel") || customer.interestedModel,
      interestedVersion: textValue(formData, "recommendedVersion") || customer.interestedVersion,
      notes: `${currentNotes}${notesBlock}`,
      lastContactAt: new Date()
    }
  });

  await prisma.activity.create({
    data: {
      customerId,
      type: "PERFILAMIENTO",
      description: `Perfil express guardado. Recomendacion: ${textValue(formData, "recommendedVehicleLabel") || "pendiente"}.`
    }
  });

  revalidatePath("/");
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${customerId}`);
  revalidatePath("/cliente-frente-a-mi");

  const returnTo = textValue(formData, "returnTo");
  const safeReturnTo = returnTo.startsWith("/cliente-frente-a-mi") ? returnTo : "/cliente-frente-a-mi";
  redirect(safeReturnTo.includes("?") ? `${safeReturnTo}&guardado=1` : `${safeReturnTo}?guardado=1`);
}

export async function addReminder(formData: FormData) {
  const customerId = textValue(formData, "customerId") || undefined;
  const type = textValue(formData, "type");
  const description = textValue(formData, "description");
  const dueAt = dateValue(formData, "dueAt");
  if (!type || !description || !dueAt) return;

  await prisma.reminder.create({
    data: {
      customerId,
      type,
      description,
      dueAt,
      priority: textValue(formData, "priority") || "NORMAL"
    }
  });

  if (customerId) {
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        nextActionType: type,
        nextActionAt: dueAt,
        nextActionNote: description,
        nextActionPriority: textValue(formData, "priority") || "NORMAL"
      }
    });
  }

  revalidatePath("/agenda");
  revalidatePath("/clientes");
  if (customerId) revalidatePath(`/clientes/${customerId}`);
}

export async function completeReminder(formData: FormData) {
  const id = textValue(formData, "id");
  if (!id) return;
  await prisma.reminder.update({ where: { id }, data: { status: "REALIZADO" } });
  revalidatePath("/agenda");
  revalidatePath("/clientes");
}

export async function addCreditContract(formData: FormData) {
  const customerId = textValue(formData, "customerId");
  if (!customerId) return;

  const firstInstallmentDate = dateValue(formData, "firstInstallmentDate");
  const installments = Number.parseInt(textValue(formData, "installments") || "0", 10) || undefined;
  const manualEndDate = dateValue(formData, "lastInstallmentDate");
  const estimatedEndDate =
    !manualEndDate && firstInstallmentDate && installments
      ? new Date(firstInstallmentDate.getFullYear(), firstInstallmentDate.getMonth() + installments - 1, firstInstallmentDate.getDate())
      : undefined;

  await prisma.creditContract.create({
    data: {
      customerId,
      financialEntity: textValue(formData, "financialEntity") || undefined,
      purchaseDate: dateValue(formData, "purchaseDate"),
      creditStartDate: dateValue(formData, "creditStartDate"),
      installments,
      firstInstallmentDate,
      lastInstallmentDate: manualEndDate ?? estimatedEndDate,
      endDateSource: manualEndDate ? "Fecha informada" : estimatedEndDate ? "Fecha estimada" : undefined,
      financedAmount: parseMoney(formData.get("financedAmount")),
      downPayment: parseMoney(formData.get("downPayment")),
      installmentAmount: parseMoney(formData.get("installmentAmount")),
      rate: textValue(formData, "rate") || undefined,
      cae: textValue(formData, "cae") || undefined,
      creditType: textValue(formData, "creditType") || undefined,
      observations: textValue(formData, "observations") || undefined
    }
  });

  await prisma.activity.create({
    data: {
      customerId,
      type: "CRÉDITO",
      description: "Contrato de crédito registrado."
    }
  });

  revalidatePath(`/clientes/${customerId}`);
  revalidatePath("/agenda");
}

const amicarResultLabels: Record<string, string> = {
  EN_EVALUACION: "En evaluacion",
  SOLICITAR_DOCUMENTOS: "Solicitar documentos",
  APROBADO: "Aprobado",
  RECHAZADO: "Rechazado"
};

function amicarResultLabel(value: string) {
  return amicarResultLabels[value] ?? "En evaluacion";
}

async function resolveCreditCustomerStatus(result: string) {
  const wantsApproved = result === "APROBADO";
  const target = wantsApproved ? "APROB" : "EVALU";
  const statuses = await prisma.customerStatus.findMany({ orderBy: { position: "asc" } });
  const existing = statuses.find((status) => {
    const raw = `${status.name} ${status.stage ?? ""}`.toUpperCase();
    const looksCredit = raw.includes("CREDITO") || raw.includes("CRÃ") || raw.includes("CRÉDITO");
    return looksCredit && raw.includes(target);
  });

  if (existing) return existing;

  const name = wantsApproved ? "CREDITO APROBADO" : "CREDITO EN EVALUACION";
  return prisma.customerStatus.upsert({
    where: { name },
    update: { stage: "CREDITO", position: wantsApproved ? 70 : 60, active: true },
    create: { name, stage: "CREDITO", position: wantsApproved ? 70 : 60, active: true }
  });
}

export async function registerAmicarCreditEvaluation(formData: FormData) {
  const customerId = textValue(formData, "customerId");
  if (!customerId) return;

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return;

  const evaluationResult = textValue(formData, "evaluationResult") || "EN_EVALUACION";
  const resultLabel = amicarResultLabel(evaluationResult);
  const firstInstallmentDate = dateValue(formData, "firstInstallmentDate");
  const installments = Number.parseInt(textValue(formData, "installments") || "0", 10) || undefined;
  const manualEndDate = dateValue(formData, "lastInstallmentDate");
  const estimatedEndDate =
    !manualEndDate && firstInstallmentDate && installments
      ? new Date(firstInstallmentDate.getFullYear(), firstInstallmentDate.getMonth() + installments - 1, firstInstallmentDate.getDate())
      : undefined;

  const vehicleLabel = textValue(formData, "vehicleLabel");
  const quoteId = textValue(formData, "quoteId");
  const saleAmount = parseMoney(formData.get("saleAmount"));
  const userObservations = textValue(formData, "observations");
  const observationLines = [
    `Resultado Amicar: ${resultLabel}`,
    vehicleLabel ? `Vehiculo: ${vehicleLabel}` : "",
    quoteId ? `Cotizacion asociada: ${quoteId}` : "",
    saleAmount !== null ? `Precio venta: ${saleAmount}` : "",
    userObservations ? `Observaciones: ${userObservations}` : ""
  ].filter(Boolean);

  await prisma.creditContract.create({
    data: {
      customerId,
      financialEntity: "AMICAR",
      purchaseDate: dateValue(formData, "purchaseDate"),
      creditStartDate: dateValue(formData, "creditStartDate"),
      installments,
      firstInstallmentDate,
      lastInstallmentDate: manualEndDate ?? estimatedEndDate,
      endDateSource: manualEndDate ? "Fecha informada" : estimatedEndDate ? "Fecha estimada" : undefined,
      financedAmount: parseMoney(formData.get("financedAmount")),
      downPayment: parseMoney(formData.get("downPayment")),
      installmentAmount: parseMoney(formData.get("installmentAmount")),
      rate: textValue(formData, "rate") || undefined,
      cae: textValue(formData, "cae") || undefined,
      creditType: "Financiamiento automotriz",
      observations: observationLines.join("\n") || undefined
    }
  });

  const creditStatus = await resolveCreditCustomerStatus(evaluationResult);
  const nextActionAt = dateValue(formData, "nextActionAt");
  const nextActionDescription =
    textValue(formData, "nextActionDescription") ||
    (evaluationResult === "SOLICITAR_DOCUMENTOS" ? "Solicitar documentos pendientes para Amicar." : "Revisar resultado de evaluacion Amicar.");

  if (nextActionAt) {
    await prisma.reminder.create({
      data: {
        customerId,
        type: "REVISAR CREDITO AMICAR",
        description: nextActionDescription,
        dueAt: nextActionAt,
        priority: "ALTA"
      }
    });
  }

  await prisma.customer.update({
    where: { id: customerId },
    data: {
      statusId: creditStatus.id,
      lastContactAt: new Date(),
      nextActionType: nextActionAt ? "REVISAR CREDITO AMICAR" : customer.nextActionType,
      nextActionAt: nextActionAt ?? customer.nextActionAt,
      nextActionNote: nextActionAt ? nextActionDescription : customer.nextActionNote,
      nextActionPriority: nextActionAt ? "ALTA" : customer.nextActionPriority
    }
  });

  await prisma.activity.create({
    data: {
      customerId,
      type: "AMICAR",
      description: `Evaluacion Amicar registrada: ${resultLabel}${vehicleLabel ? ` | ${vehicleLabel}` : ""}.`
    }
  });

  revalidatePath("/");
  revalidatePath("/creditos");
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${customerId}`);
  revalidatePath("/agenda");
  redirect(`/creditos?customerId=${customerId}&guardado=1`);
}

export async function saveQuote(formData: FormData) {
  const versionId = textValue(formData, "versionId");
  const customerId = textValue(formData, "customerId") || undefined;
  if (!versionId) return;

  const version = await prisma.version.findUnique({
    where: { id: versionId },
    include: { brand: true, model: true, prices: { where: { status: INFO_STATUS.ACTIVE }, orderBy: { effectiveFrom: "desc" } } }
  });
  if (!version) return;

  const price = version.prices.find((item) => item.priceType === "CASH") ?? version.prices.find((item) => item.priceType === "CAMPAIGN") ?? version.prices.find((item) => item.priceType === "LIST");
  const discount = parseMoney(formData.get("discount")) ?? 0;
  const total = price?.amount ? price.amount - discount : null;
  const snapshot = {
    versionId,
    brand: version.brand.name,
    model: version.model.name,
    version: version.name,
    prices: version.prices,
    discount,
    createdWith: "cotizador-local"
  };

  const quote = await prisma.quote.create({
    data: {
      customerId,
      title: `${version.brand.name} ${version.model.name} ${version.name}`,
      snapshotJson: JSON.stringify(snapshot),
      totalAmount: total,
      items: {
        create: {
          versionId,
          brandName: version.brand.name,
          modelName: version.model.name,
          versionName: version.name,
          priceUsed: price?.amount ?? null,
          bonusUsed: discount || null,
          conditions: textValue(formData, "conditions") || undefined
        }
      }
    }
  });

  if (customerId) {
    await prisma.activity.create({
      data: {
        customerId,
        type: "COTIZACIÓN",
        description: `Cotización guardada: ${quote.title}.`
      }
    });
  }

  revalidatePath("/cotizador");
  if (customerId) revalidatePath(`/clientes/${customerId}`);
}

export async function sendTelegramTest() {
  const result = await sendTelegramMessage("Prueba de conexión del Asistente Comercial Automotriz.");

  await prisma.notificationHistory.create({
    data: {
      channel: "telegram",
      eventType: "TEST",
      message: "Prueba de conexión del Asistente Comercial Automotriz.",
      status: result.status,
      error: result.ok ? undefined : result.message
    }
  });

  revalidatePath("/configuracion/telegram");
}

// ─── CIERRE DE VENTA ───────────────────────────────────────────────────────────
export async function registerSale(formData: FormData) {
  "use server";
  const customerId = formData.get("customerId") as string;
  if (!customerId) return;

  const brandName = (formData.get("brandName") as string)?.trim() ?? "";
  const modelName = (formData.get("modelName") as string)?.trim() ?? "";
  const versionName = (formData.get("versionName") as string)?.trim() || null;
  const agreedPriceRaw = formData.get("agreedPrice") as string;
  const agreedPrice = agreedPriceRaw ? parseInt(agreedPriceRaw, 10) : null;
  const saleDateRaw = formData.get("saleDate") as string;
  const saleDate = saleDateRaw ? new Date(saleDateRaw) : new Date();

  const sale = await prisma.sale.create({
    data: { customerId, brandName, modelName, versionName, agreedPrice, saleDate, status: "VENDIDO" }
  });

  // Register associated credit contract if payment is credit
  const paymentMethod = formData.get("paymentMethod") as string;
  if (paymentMethod === "CREDITO") {
    const financialEntity = (formData.get("financialEntity") as string) || null;
    const installments = formData.get("installments") ? parseInt(formData.get("installments") as string, 10) : null;
    const installmentAmount = formData.get("installmentAmount") ? parseInt(formData.get("installmentAmount") as string, 10) : null;
    const financedAmount = formData.get("financedAmount") ? parseInt(formData.get("financedAmount") as string, 10) : null;
    const downPayment = formData.get("downPayment") ? parseInt(formData.get("downPayment") as string, 10) : null;
    const firstInstallmentDateRaw = formData.get("firstInstallmentDate") as string;
    const lastInstallmentDateRaw = formData.get("lastInstallmentDate") as string;

    await prisma.creditContract.create({
      data: {
        customerId,
        financialEntity,
        purchaseDate: saleDate,
        installments,
        installmentAmount,
        financedAmount,
        downPayment,
        firstInstallmentDate: firstInstallmentDateRaw ? new Date(firstInstallmentDateRaw) : null,
        lastInstallmentDate: lastInstallmentDateRaw ? new Date(lastInstallmentDateRaw) : null,
        creditType: "NUEVO",
        endDateSource: "CIERRE_VENTA"
      }
    });
  }

  // Register customer activity
  await prisma.activity.create({
    data: {
      customerId,
      type: "ENTREGA",
      description: `Venta registrada: ${brandName} ${modelName} ${versionName ?? ""} — $${agreedPrice?.toLocaleString("es-CL") ?? "—"}`,
      activityAt: saleDate
    }
  });

  revalidatePath("/cierre-venta");
  revalidatePath(`/clientes/${customerId}`);
  revalidatePath("/renovaciones");
}
