import { getCommercialAidAlerts, type CommercialAidAlert } from "@/lib/commercial-aids";
import { formatCLP, normalizeText } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export type VitokoTone = "neutral" | "good" | "warn" | "bad";

export type VitokoAction = {
  label: string;
  href: string;
  tone?: VitokoTone;
};

export type VitokoInsight = {
  id: string;
  agent: string;
  title: string;
  detail: string;
  tone: VitokoTone;
  actions: VitokoAction[];
};

export type VitokoBrief = {
  headline: string;
  summary: string;
  generatedAt: string;
  insights: VitokoInsight[];
};

export type VitokoAnswer = {
  reply: string;
  actions: VitokoAction[];
  sources: string[];
};

const dayMs = 24 * 60 * 60 * 1000;

function bestPrice(
  prices: {
    priceType: string;
    amount: number;
  }[]
) {
  const listPrice = prices.find((price) => price.priceType === "LIST")?.amount ?? null;
  const campaignPrice = prices.find((price) => price.priceType === "CAMPAIGN")?.amount ?? null;
  const cashPrice = prices.find((price) => price.priceType === "CASH")?.amount ?? null;
  const financingPrice = prices.find((price) => price.priceType === "FINANCING")?.amount ?? null;
  const price = cashPrice ?? financingPrice ?? campaignPrice ?? listPrice;
  const discount = listPrice && price && listPrice > price ? listPrice - price : 0;

  return { listPrice, price, discount };
}

function uniqueActions(actions: VitokoAction[]) {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.label}|${action.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasAny(normalized: string, words: string[]) {
  return words.some((word) => normalized.includes(normalizeText(word)));
}

function queryTerms(message: string) {
  const stopWords = new Set([
    "tengo",
    "cliente",
    "clientes",
    "quiere",
    "quiero",
    "necesito",
    "para",
    "con",
    "una",
    "uno",
    "los",
    "las",
    "que",
    "por",
    "del",
    "millones",
    "presupuesto"
  ]);

  return normalizeText(message)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
    .slice(0, 8);
}

function action(label: string, href: string, tone: VitokoTone = "neutral"): VitokoAction {
  return { label, href, tone };
}

function aidLine(alert: CommercialAidAlert) {
  return `${alert.brandName} ${alert.modelName}${alert.versionName ? ` ${alert.versionName}` : ""}: ${alert.title}. ${alert.detail}`;
}

export async function getVitokoBrief(): Promise<VitokoBrief> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * dayMs);
  const tomorrow = new Date(now.getTime() + dayMs);
  const thirtyDays = new Date(now.getTime() + 30 * dayMs);
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const chileNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Santiago" }));
  const todayMonth = chileNow.getMonth() + 1;
  const todayDay = chileNow.getDate();

  const [
    pendingItems,
    dueReminders,
    customers,
    recentQuotes,
    activeCampaigns,
    totalVersions,
    missingCitVersions,
    commercialAidAlerts,
    renewalsNext30,
    salesThisMonth,
    customersWithBirthday
  ] = await Promise.all([
    prisma.updateItem.count({ where: { status: { in: ["DETECTADO", "EN_REVISION"] } } }),
    prisma.reminder.count({ where: { status: "PENDIENTE", dueAt: { lte: tomorrow } } }),
    prisma.customer.count(),
    prisma.quote.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.commercialCampaign.count({ where: { status: "VIGENTE" } }),
    prisma.version.count({ where: { status: { not: "IGNORADO" } } }),
    prisma.version.count({ where: { status: { not: "IGNORADO" }, OR: [{ sapCode: null }, { sapCode: "" }] } }),
    getCommercialAidAlerts(5),
    prisma.creditContract.count({ where: { lastInstallmentDate: { gte: now, lte: thirtyDays } } }),
    prisma.sale.count({ where: { saleDate: { gte: firstOfMonth } } }),
    prisma.customer.findMany({ where: { birthDate: { not: null } }, select: { firstName: true, lastName: true, birthDate: true } })
  ]);

  // Birthday check
  const birthdaysToday = customersWithBirthday.filter((c) => {
    if (!c.birthDate) return false;
    const bd = new Date(c.birthDate);
    return bd.getMonth() + 1 === todayMonth && bd.getDate() === todayDay;
  });

  const insights: VitokoInsight[] = [];

  // RENOVACIONES (más urgente al tope)
  if (renewalsNext30 > 0) {
    insights.push({
      id: "renewals-urgent",
      agent: "Agente de Renovaciones",
      title: `${renewalsNext30} cliente${renewalsNext30 > 1 ? "s" : ""} con crédito venciendo en 30 días`,
      detail: `Son oportunidades de renovación caliente. Contacta antes de que llegue a otro concesionario.`,
      tone: renewalsNext30 >= 5 ? "warn" : "good",
      actions: [action("Ver Renovaciones", "/renovaciones", "good"), action("Cotizar", "/cotizador", "neutral")]
    });
  }

  // CUMPLEAÑOS
  if (birthdaysToday.length > 0) {
    const names = birthdaysToday.slice(0, 2).map((c) => c.firstName).join(", ");
    insights.push({
      id: "birthday-today",
      agent: "Agente CRM",
      title: `🎂 ${birthdaysToday.length === 1 ? `${names} cumple años hoy` : `${birthdaysToday.length} clientes cumplen años hoy`}`,
      detail: `Es el mejor momento para llamar y mantener la relación. Una felicitación puede marcar la diferencia.`,
      tone: "good",
      actions: [action("Ver Clientes", "/clientes", "good"), action("WhatsApp", "/whatsapp", "neutral")]
    });
  }

  // VENTAS DEL MES
  if (salesThisMonth > 0) {
    insights.push({
      id: "monthly-sales",
      agent: "Agente de Venta",
      title: `${salesThisMonth} venta${salesThisMonth > 1 ? "s" : ""} registrada${salesThisMonth > 1 ? "s" : ""} este mes`,
      detail: `Cada venta es una futura renovación. Asegúrate de registrar la fecha de última cuota.`,
      tone: "good",
      actions: [action("Registrar Cierre", "/cierre-venta", "good")]
    });
  }

  if (pendingItems) {
    insights.push({
      id: "commercial-review",
      agent: "Agente comercial",
      title: `${pendingItems} cambios comerciales necesitan revision`,
      detail: "Asistente IA 360 detecto datos de documentos que conviene aprobar antes de usarlos en venta.",
      tone: "warn",
      actions: [action("Revisar actualizaciones", "/actualizaciones", "warn")]
    });
  }

  if (commercialAidAlerts.length) {
    const topAid = commercialAidAlerts[0];
    insights.push({
      id: "commercial-aids",
      agent: "Agente comercial",
      title: "Hay ayudas comerciales que pueden ayudar a cerrar",
      detail: aidLine(topAid),
      tone: topAid.tone,
      actions: [action("Ver ayudas", "/ayudas-comerciales", topAid.tone), action("Perfilar cliente", "/cliente-frente-a-mi", "good")]
    });
  }

  if (missingCitVersions) {
    insights.push({
      id: "missing-cit",
      agent: "Agente de rentabilidad",
      title: `${missingCitVersions} versiones sin Codigo CIT`,
      detail: "Ese dato es clave para impuesto verde. Asistente IA 360 lo marca para no cotizar con informacion incompleta.",
      tone: "warn",
      actions: [action("Ver vehiculos", "/vehiculos", "warn"), action("Ir a rentabilidad", "/rentabilidad", "neutral")]
    });
  }

  if (dueReminders) {
    insights.push({
      id: "follow-ups",
      agent: "Agente CRM",
      title: `${dueReminders} seguimientos vencen hoy o manana`,
      detail: "Prioriza contactos calientes antes de abrir nuevas oportunidades.",
      tone: "good",
      actions: [action("Abrir agenda", "/agenda", "good"), action("Ver clientes", "/clientes", "neutral")]
    });
  }

  if (!customers) {
    insights.push({
      id: "crm-start",
      agent: "Agente CRM",
      title: "Todavia no hay clientes guardados",
      detail: "Cuando perfiles un cliente, Asistente IA 360 puede guardar preferencia, presupuesto, credito y proxima accion.",
      tone: "neutral",
      actions: [action("Crear cliente", "/clientes", "good"), action("Usar perfilador", "/cliente-frente-a-mi", "good")]
    });
  }

  insights.push({
    id: "next-best-action",
    agent: "Agente de venta",
    title: "Perfilador express listo para la proxima atencion",
    detail: "Ingresa presupuesto, uso y prioridad; Asistente IA 360 ordena modelos, detecta alertas y deja acciones para cotizar, comparar o evaluar credito.",
    tone: "good",
    actions: [action("Cliente frente a mi", "/cliente-frente-a-mi", "good"), action("Cotizar", "/cotizador", "neutral")]
  });

  const summaryParts = [
    `${totalVersions} versiones cargadas`,
    `${activeCampaigns} campanas vigentes`,
    `${recentQuotes} cotizaciones de la semana`,
    ...(renewalsNext30 > 0 ? [`${renewalsNext30} renovaciones próximas`] : []),
    ...(salesThisMonth > 0 ? [`${salesThisMonth} ventas este mes`] : [])
  ];

  return {
    headline: renewalsNext30 > 0
      ? `${renewalsNext30} renovacion${renewalsNext30 > 1 ? "es" : ""} urgente${renewalsNext30 > 1 ? "s" : ""} — actua hoy`
      : "Asistente IA 360 esta mirando la operacion",
    summary: summaryParts.join(" | "),
    generatedAt: now.toISOString(),
    insights: insights.slice(0, 7)
  };
}


export async function askVitoko(message: string): Promise<VitokoAnswer> {
  const trimmed = message.trim();
  const normalized = normalizeText(trimmed);
  const terms = queryTerms(trimmed);
  const actions: VitokoAction[] = [];
  const sources = new Set<string>();
  const parts: string[] = [];

  if (!trimmed) {
    const brief = await getVitokoBrief();
    return {
      reply: `${brief.headline}. ${brief.summary}. Lo mas importante ahora: ${brief.insights[0]?.title ?? "mantener datos comerciales al dia"}.`,
      actions: brief.insights.flatMap((insight) => insight.actions).slice(0, 5),
      sources: ["Base local del sistema"]
    };
  }

  const [vehicles, customers, commercialAidAlerts] = await Promise.all([
    terms.length
      ? prisma.version.findMany({
          where: {
            status: { not: "IGNORADO" },
            OR: terms.flatMap((term) => [
              { name: { contains: term } },
              { model: { name: { contains: term } } },
              { model: { segment: { contains: term } } },
              { brand: { name: { contains: term } } },
              { sapCode: { contains: term } },
              { engine: { contains: term } },
              { transmission: { contains: term } },
              { traction: { contains: term } },
              { fuelType: { contains: term } },
              { equipmentSummary: { contains: term } },
              { safetySummary: { contains: term } }
            ])
          },
          include: {
            brand: true,
            model: true,
            prices: { where: { status: "VIGENTE" }, orderBy: { effectiveFrom: "desc" } }
          },
          orderBy: [{ brand: { name: "asc" } }, { model: { name: "asc" } }, { commercialOrder: "asc" }],
          take: 5
        })
      : [],
    terms.length
      ? prisma.customer.findMany({
          where: {
            OR: terms.flatMap((term) => [
              { firstName: { contains: term } },
              { lastName: { contains: term } },
              { rut: { contains: term } },
              { phone: { contains: term } },
              { email: { contains: term } },
              { interestedModel: { contains: term } },
              { interestedVersion: { contains: term } }
            ])
          },
          include: { status: true },
          orderBy: { updatedAt: "desc" },
          take: 4
        })
      : [],
    getCommercialAidAlerts(20)
  ]);

  if (hasAny(normalized, ["cliente", "perfilar", "perfil", "ofrecer", "familia", "presupuesto", "quiero vender"])) {
    parts.push(
      "Para perfilar rapido, Asistente IA 360 partiria por tres datos: presupuesto maximo, uso principal y prioridad real del cliente. Con eso el perfilador ordena modelos y deja acciones para comparar, cotizar, rentabilidad o credito."
    );
    actions.push(action("Abrir perfilador", "/cliente-frente-a-mi", "good"));
    sources.add("Perfilador express");
  }

  if (hasAny(normalized, ["credito", "amicar", "pie", "cuota", "financiamiento", "evaluar"])) {
    parts.push(
      "Para credito, usa el flujo de Amicar: el sistema prepara datos del cliente y del vehiculo, abre Amicar oficial y deja registro del resultado en el CRM. No guardo claves ni envio datos sin aprobacion."
    );
    actions.push(action("Evaluar credito", "/creditos", "good"));
    sources.add("Modulo Creditos Amicar");
  }

  if (hasAny(normalized, ["rentabilidad", "margen", "permiso", "circulacion", "impuesto", "verde", "cit"])) {
    parts.push(
      "En rentabilidad, Asistente IA 360 revisa precio, Codigo CIT, permiso de circulacion e Imp. Fuentes Movs. Si falta CIT o fuente, lo marca como pendiente para no cerrar con un numero inventado."
    );
    actions.push(action("Abrir rentabilidad", "/rentabilidad", "good"));
    sources.add("Hoja de rentabilidad");
  }

  if (hasAny(normalized, ["bono", "bonos", "campana", "campaña", "ayuda", "descuento", "patente", "tasa"])) {
    const relevantAids = commercialAidAlerts
      .filter((alert) => {
        const text = normalizeText(`${alert.brandName} ${alert.modelName} ${alert.versionName ?? ""} ${alert.title} ${alert.detail}`);
        return terms.length ? terms.some((word) => text.includes(word)) : true;
      })
      .slice(0, 3);

    if (relevantAids.length) {
      parts.push(`Ayudas comerciales detectadas: ${relevantAids.map(aidLine).join(" / ")}`);
    } else {
      parts.push("No encontre una ayuda comercial exacta para esa busqueda. Conviene revisar el modulo de ayudas antes de prometer bono, patente o tasa.");
    }
    actions.push(action("Ver ayudas comerciales", "/ayudas-comerciales", "warn"));
    sources.add("Planes comerciales cargados");
  }

  if (vehicles.length) {
    const vehicleLines = vehicles.slice(0, 3).map((version) => {
      const price = bestPrice(version.prices);
      const discountText = price.discount ? `, diferencia vs lista ${formatCLP(price.discount)}` : "";
      const citText = version.sapCode ? `, CIT ${version.sapCode}` : ", CIT pendiente";
      return `${version.brand.name} ${version.model.name} ${version.name}: ${formatCLP(price.price)}${discountText}${citText}`;
    });
    parts.push(`Vehiculos que calzan con tu busqueda: ${vehicleLines.join(" / ")}`);
    actions.push(action("Comparar opciones", `/comparador?${vehicles.slice(0, 3).map((version) => `v=${version.id}`).join("&")}`, "good"));
    actions.push(action("Cotizar primera opcion", `/cotizador?versionId=${vehicles[0].id}`, "good"));
    actions.push(action("Rentabilidad primera opcion", `/rentabilidad?versionId=${vehicles[0].id}`, "neutral"));
    sources.add("Catalogo y precios vigentes");
  }

  if (customers.length) {
    const customerLines = customers.map((customer) => {
      const name = `${customer.firstName} ${customer.lastName ?? ""}`.trim();
      const interest = [customer.interestedBrand, customer.interestedModel, customer.interestedVersion].filter(Boolean).join(" ");
      return `${name}${customer.status?.name ? ` (${customer.status.name})` : ""}${interest ? `: ${interest}` : ""}`;
    });
    parts.push(`Clientes encontrados: ${customerLines.join(" / ")}`);
    actions.push(action("Abrir CRM", "/clientes", "neutral"));
    sources.add("Mini CRM local");
  }

  if (!parts.length) {
    parts.push(
      "Asistente IA 360 no encontro una coincidencia directa. Puedo ayudarte mejor si escribes modelo, marca, presupuesto, tipo de cliente, credito, bono o rentabilidad. Mientras tanto, partiria por el perfilador si tienes al cliente frente a ti."
    );
    actions.push(action("Cliente frente a mi", "/cliente-frente-a-mi", "good"));
    actions.push(action("Buscar vehiculo", "/buscar", "neutral"));
  }

  return {
    reply: parts.join(" "),
    actions: uniqueActions(actions).slice(0, 6),
    sources: Array.from(sources.size ? sources : new Set(["Base local del sistema"]))
  };
}
