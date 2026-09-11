import { INFO_STATUS } from "@/lib/constants";

export type CommercialScenario = {
  key: "LISTA" | "CONTADO" | "FINANCING" | "FINANCIAMIENTO" | "CAMPAIGN" | "DERCO_CL" | "PREVENTA";
  label: string;
  amount: number;
  condition?: string;
  badge?: string;
};


export type CommercialOfferEngineResult = {
  // Scenarios
  listPrice: number | null;
  cashPrice: number | null;
  financingPrice: number | null;
  campaignPrice: number | null;
  dercoClPrice: number | null;
  presalePrice: number | null;

  // Best scenario matching buyer criteria
  bestEligiblePrice: number | null;
  eligibleScenarioName: string;

  // All active scenarios
  scenarios: CommercialScenario[];

  // On The Road Breakdown (Puesto en Calle / Llave en Mano)
  onTheRoad: {
    isCommercialVehicle: boolean;
    greenTax: number;
    registrationPermit: number; // RNVM / Conservaduría
    soap: number;
    freight: number;
    circulatingPermit: number;
    circulatingPermitCash: number;
    circulatingPermitFinancing: number;
    roadCostCash: number;
    roadCostFinancing: number;
    totalOnTheRoadCash: number | null;
    totalOnTheRoadFinancing: number | null;
    statusText: "DISPONIBLE" | "ESTIMADO" | "PENDIENTES_DATOS";
  };

  // Client Bonuses (Bono público al cliente)
  clientBonuses: {
    brandBonus: number;
    financingBonus: number;
    totalClientBonus: number;
  };

  // Internal Closing Tool (Bono / Aporte de Cierre Compartido CES + Marca)
  closingTool: {
    hasClosingSupport: boolean;
    cesCashShare: number;
    brandCashShare: number;
    cesCreditShare: number;
    brandCreditShare: number;
    totalClosingSupportCash: number;
    totalClosingSupportCredit: number;
    restrictions: string[];
    compatibleCampaigns: string[];
  };

  // Badges & Special Features
  features: {
    hasFreeLicensePlate: boolean; // Patente gratis
    specialRate?: string | null;  // Tasa especial, ej: "1.69%"
    presaleName?: string | null;
    digitalExclusiveName?: string | null;
  };
};

type PriceInput = {
  priceType: string;
  amount: number;
  status?: string | null;
  channel?: string | null;
  bonusName?: string | null;
  bonusAmount?: number | null;
  hasIva?: boolean | null;
  effectiveFrom?: Date | string | null;
};

const DEFAULT_FREIGHT_OSORNO = 380600;
const DEFAULT_REGISTRATION = 82230;
const DEFAULT_SOAP = 22000;
const DEFAULT_GREEN_TAX_PASSENGER = 250000;
const DEFAULT_GREEN_TAX_COMMERCIAL = 120000;
const VAT_RATE = 1.19;
const UTM_BY_MONTH_2026: Record<number, number> = {
  1: 69751,
  2: 69611,
  3: 69889,
  4: 69889,
  5: 70588,
  6: 71506,
  7: 71649,
  8: 71649
};

function priceEffectiveTime(price: PriceInput) {
  if (!price.effectiveFrom) return 0;
  const date = price.effectiveFrom instanceof Date ? price.effectiveFrom : new Date(price.effectiveFrom);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function latestPrice(prices: PriceInput[], predicate: (price: PriceInput) => boolean) {
  return prices
    .filter(predicate)
    .sort((left, right) => priceEffectiveTime(right) - priceEffectiveTime(left))[0];
}

function isRegularChannel(price: PriceInput) {
  return (price.channel ?? "REGULAR") === "REGULAR";
}

function round(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0);
}

function estimateCirculationPermit(grossPrice: number | null, invoiceDate = new Date()) {
  if (!grossPrice || grossPrice <= 0) return 0;

  const month = invoiceDate.getMonth() + 1;
  const utm = UTM_BY_MONTH_2026[month] ?? UTM_BY_MONTH_2026[8];
  const netPrice = round(grossPrice / VAT_RATE);
  const priceInUtm = netPrice / utm;

  let annualPermit = 0;
  if (priceInUtm > 0 && priceInUtm <= 60) annualPermit = round(netPrice * 0.01);
  if (priceInUtm > 60 && priceInUtm <= 120) annualPermit = round(netPrice * 0.02 - 0.6 * utm);
  if (priceInUtm > 120 && priceInUtm <= 250) annualPermit = round(netPrice * 0.03 - 1.8 * utm);
  if (priceInUtm > 250 && priceInUtm <= 400) annualPermit = round(netPrice * 0.04 - 4.3 * utm);
  if (priceInUtm > 400) annualPermit = round(netPrice * 0.045 - 6.3 * utm);

  return Math.max(0, round((annualPermit / 12) * (13 - month)));
}

export function evaluateCommercialOffers(params: {
  brandName: string;
  modelName: string;
  versionName: string;
  segment?: string | null;
  canonicalSegment?: string | null;
  equipmentSummary?: string | null;
  sapCode?: string | null;
  prices: PriceInput[];
  offers?: Array<{
    offerType: string;
    title?: string | null;
    channel?: string | null;
    paymentType?: string | null;
    amountCash?: number | null;
    amountCredit?: number | null;
    amountTotal?: number | null;
    aporteCES?: number | null;
    aporteMarca?: number | null;
    aporteCESCredit?: number | null;
    aporteMarcaCredit?: number | null;
    rate?: string | null;
    incompatibleWith?: string | null;
    compatibleWith?: string | null;
    condition?: string | null;
    sheetName?: string | null;
    status?: string;
  }>;


  customFreight?: number;
  customGreenTax?: number;
  preferredPayment?: "CONTADO" | "CREDITO" | "INDIFERENTE";
}): CommercialOfferEngineResult {
  const {
    brandName,
    modelName,
    versionName,
    segment,
    canonicalSegment,
    equipmentSummary,
    sapCode,
    prices,
    offers = [],
    customFreight = DEFAULT_FREIGHT_OSORNO,
    customGreenTax,
    preferredPayment = "INDIFERENTE"
  } = params;

  // Active prices filtering
  // Bloque A: el motor aceptaba cualquier estado salvo IGNORADO y
  // REEMPLAZADO, o sea tambien DETECTADO (leido de un documento, sin
  // aprobar). Como de aca salen el cotizador, el comparador y la hoja
  // de rentabilidad, un precio sin validar terminaba frente al cliente.
  // Ahora solo VIGENTE, igual que el resto. Ver src/lib/precios.ts.
  const activePrices = prices.filter((p) => p.status === INFO_STATUS.ACTIVE);

  const listPriceObj = latestPrice(activePrices, (p) => p.priceType === "LIST" && isRegularChannel(p));
  const campaignPriceObj = latestPrice(activePrices, (p) => p.priceType === "CAMPAIGN" && isRegularChannel(p));
  const cashPriceObj = latestPrice(activePrices, (p) => p.priceType === "CASH" && isRegularChannel(p));
  const financingPriceObj = latestPrice(activePrices, (p) => p.priceType === "FINANCING" && isRegularChannel(p));
  const dercoClPriceObj = latestPrice(activePrices, (p) => p.channel === "DERCO_CL" || p.priceType === "DERCO_CL");
  const presalePriceObj = latestPrice(activePrices, (p) => p.channel === "PREVENTA" || p.priceType === "PREVENTA");

  const listPrice = listPriceObj?.amount ?? null;
  const campaignPrice = campaignPriceObj?.amount ?? null;
  const cashPrice = cashPriceObj?.amount ?? null;
  const financingPrice = financingPriceObj?.amount ?? null;
  const dercoClPrice = dercoClPriceObj?.amount ?? null;
  const presalePrice = presalePriceObj?.amount ?? null;

  // Scenarios list
  const scenarios: CommercialScenario[] = [];
  if (listPrice) scenarios.push({ key: "LISTA", label: "Precio Lista Oficial", amount: listPrice });
  if (cashPrice) scenarios.push({ key: "CONTADO", label: "Precio Contado", amount: cashPrice });
  if (financingPrice) scenarios.push({ key: "FINANCING", label: "Precio Financiamiento (Todos Bonos)", amount: financingPrice, badge: "💳 Crédito" });
  if (campaignPrice && campaignPrice !== cashPrice) scenarios.push({ key: "CAMPAIGN", label: "Precio Campaña Vigente", amount: campaignPrice, badge: "🔥 Campaña" });
  if (dercoClPrice) scenarios.push({ key: "DERCO_CL", label: "Precio Derco.cl / DCR.cl", amount: dercoClPrice, condition: "Requiere reserva online en Derco.cl", badge: "🌐 Web" });
  if (presalePrice) scenarios.push({ key: "PREVENTA", label: "Precio Preventa", amount: presalePrice, badge: "⭐ Preventa" });

  // Determine best eligible price based on preferred payment method
  let bestEligiblePrice: number | null = null;
  let eligibleScenarioName = "Precio Contado";

  if (preferredPayment === "CONTADO") {
    bestEligiblePrice = dercoClPrice ?? presalePrice ?? cashPrice ?? campaignPrice ?? listPrice;
    if (dercoClPrice) eligibleScenarioName = "Precio Reserva Derco.cl (Contado)";
    else if (presalePrice) eligibleScenarioName = "Precio Preventa (Contado)";
    else if (cashPrice) eligibleScenarioName = "Precio Contado";
    else if (campaignPrice) eligibleScenarioName = "Precio Campaña Vigente";
    else eligibleScenarioName = "Precio Lista";
  } else if (preferredPayment === "CREDITO") {
    bestEligiblePrice = financingPrice ?? dercoClPrice ?? cashPrice ?? campaignPrice ?? listPrice;
    if (financingPrice) eligibleScenarioName = "Precio Financiamiento";
    else if (dercoClPrice) eligibleScenarioName = "Precio Reserva Derco.cl";
    else if (cashPrice) eligibleScenarioName = "Precio Contado (Sin bono crédito disponible)";
    else if (campaignPrice) eligibleScenarioName = "Precio Campaña Vigente";
    else eligibleScenarioName = "Precio Lista";
  } else {
    // Indiferente: mejor precio disponible
    const allAmounts = [financingPrice, dercoClPrice, presalePrice, campaignPrice, cashPrice, listPrice].filter((a): a is number => a != null && a > 0);
    bestEligiblePrice = allAmounts.length ? Math.min(...allAmounts) : null;
    if (bestEligiblePrice === financingPrice) eligibleScenarioName = "Precio Financiamiento (Mejor opción)";
    else if (bestEligiblePrice === dercoClPrice) eligibleScenarioName = "Precio Derco.cl (Requiere reserva web)";
    else if (bestEligiblePrice === campaignPrice) eligibleScenarioName = "Precio Campaña Vigente";
    else eligibleScenarioName = "Precio Contado";
  }

  // Detect commercial/pickup status for VAT deduction
  const textHaystack = [brandName, modelName, versionName, segment, canonicalSegment, equipmentSummary].filter(Boolean).join(" ").toLowerCase();
  const isCommercialVehicle =
    canonicalSegment === "PICKUP" ||
    canonicalSegment === "COMERCIAL" ||
    textHaystack.includes("pickup") ||
    textHaystack.includes("camioneta") ||
    textHaystack.includes("wingle") ||
    textHaystack.includes("poer") ||
    textHaystack.includes("hunter") ||
    textHaystack.includes("bt-50") ||
    textHaystack.includes("furgon") ||
    textHaystack.includes("truck");

  // On The Road Expenses (Llave en Mano)
  const freight = customFreight;
  const registrationPermit = DEFAULT_REGISTRATION; // Conservaduría / Inscripción RNVM
  const soap = DEFAULT_SOAP;
  const greenTax = customGreenTax ?? (isCommercialVehicle ? DEFAULT_GREEN_TAX_COMMERCIAL : DEFAULT_GREEN_TAX_PASSENGER);
  const circulatingPermitCash = estimateCirculationPermit(cashPrice ?? listPrice);
  const circulatingPermitFinancing = estimateCirculationPermit(financingPrice ?? cashPrice ?? listPrice);
  const circulatingPermit = circulatingPermitCash;
  const roadCostCash = freight + registrationPermit + soap + greenTax + circulatingPermitCash;
  const roadCostFinancing = freight + registrationPermit + soap + greenTax + circulatingPermitFinancing;

  const totalOnTheRoadCash = cashPrice ? cashPrice + roadCostCash : null;
  const totalOnTheRoadFinancing = financingPrice ? financingPrice + roadCostFinancing : null;

  // Client Public Bonuses
  const brandBonus = cashPriceObj?.bonusAmount ?? (listPrice && cashPrice && listPrice > cashPrice ? listPrice - cashPrice : 0);
  const financingBonus = financingPriceObj?.bonusAmount ?? (cashPrice && financingPrice && cashPrice > financingPrice ? cashPrice - financingPrice : 0);
  const totalClientBonus = brandBonus + financingBonus;

  // Internal Closing Tool (Bono Cierre Compartido CES + Marca)
  const closingOffers = offers.filter((o) => o.offerType === "BONO_CIERRE_COMPARTIDO" && o.status !== "FINALIZADA");
  let cesCashShare = 0;
  let brandCashShare = 0;
  let cesCreditShare = 0;
  let brandCreditShare = 0;
  const restrictions: string[] = [];
  const compatibleCampaigns: string[] = [];

  for (const c of closingOffers) {
    cesCashShare += c.aporteCES ?? 0;
    brandCashShare += c.aporteMarca ?? 0;
    cesCreditShare += c.aporteCESCredit ?? c.aporteCES ?? 0;
    brandCreditShare += c.aporteMarcaCredit ?? c.aporteMarca ?? 0;
    if (c.incompatibleWith) restrictions.push(c.incompatibleWith);
    if (c.compatibleWith) compatibleCampaigns.push(c.compatibleWith);
    if (c.condition) restrictions.push(c.condition);
  }

  const totalClosingSupportCash = cesCashShare + brandCashShare;
  const totalClosingSupportCredit = cesCreditShare + brandCreditShare;
  const hasClosingSupport = totalClosingSupportCash > 0 || totalClosingSupportCredit > 0;

  // Features (Patente Gratis, Tasas)
  const hasFreeLicensePlate = offers.some((o) => o.offerType === "PATENTE_GRATIS" && o.status !== "FINALIZADA");
  const rateOffer = offers.find((o) => o.offerType === "TASA" && o.status !== "FINALIZADA");
  const specialRate = rateOffer?.rate ?? null;
  const presaleOffer = offers.find((o) => o.offerType === "PREVENTA");
  const digitalOffer = offers.find((o) => o.channel === "DERCO_CL");

  return {
    listPrice,
    cashPrice,
    financingPrice,
    campaignPrice,
    dercoClPrice,
    presalePrice,
    bestEligiblePrice,
    eligibleScenarioName,
    scenarios,
    onTheRoad: {
      isCommercialVehicle,
      greenTax,
      registrationPermit,
      soap,
      freight,
      circulatingPermit,
      circulatingPermitCash,
      circulatingPermitFinancing,
      roadCostCash,
      roadCostFinancing,
      totalOnTheRoadCash,
      totalOnTheRoadFinancing,
      statusText: cashPrice || financingPrice ? "ESTIMADO" : "PENDIENTES_DATOS"
    },
    clientBonuses: {
      brandBonus,
      financingBonus,
      totalClientBonus
    },
    closingTool: {
      hasClosingSupport,
      cesCashShare,
      brandCashShare,
      cesCreditShare,
      brandCreditShare,
      totalClosingSupportCash,
      totalClosingSupportCredit,
      restrictions: Array.from(new Set(restrictions)),
      compatibleCampaigns: Array.from(new Set(compatibleCampaigns))
    },
    features: {
      hasFreeLicensePlate,
      specialRate,
      presaleName: presaleOffer?.title ?? null,
      digitalExclusiveName: digitalOffer?.title ?? null
    }
  };
}
