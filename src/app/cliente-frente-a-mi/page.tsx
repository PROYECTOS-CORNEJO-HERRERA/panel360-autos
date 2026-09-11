import Link from "next/link";
import {
  AlertTriangle,
  BadgeDollarSign,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Gauge,
  GitCompareArrows,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  UsersRound
} from "lucide-react";
import { saveClientProfile } from "@/lib/actions";
import { commercialAidMatchesVehicle, getCommercialAidAlerts, type CommercialAidAlert } from "@/lib/commercial-aids";
import { formatCLP, missing, normalizeText, parseMoney } from "@/lib/format";
import { includePreciosVigentes } from "@/lib/precios";
import { getPricingBreakdown } from "@/lib/pricing-breakdown";
import { prisma } from "@/lib/prisma";
import { EmptyState, Notice, PageHeader, Panel, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";

const budgets = [
  ["", "Sin limite claro"],
  ["10000000", "Hasta $10 millones"],
  ["12000000", "Hasta $12 millones"],
  ["15000000", "Hasta $15 millones"],
  ["18000000", "Hasta $18 millones"],
  ["20000000", "Hasta $20 millones"],
  ["25000000", "Hasta $25 millones"],
  ["30000000", "Hasta $30 millones"],
  ["40000000", "Hasta $40 millones"],
  ["50000000", "Hasta $50 millones"]
];

const types = ["Citycar", "Hatchback", "Sedan", "SUV", "Pickup", "Comercial", "Indiferente"];
const uses = ["Ciudad", "Familia", "Carretera", "Trabajo", "Campo", "4x4", "Mixto"];
const fuels = ["Gasolina", "Diesel", "Hibrido", "Hibrido enchufable", "Electrico", "Indiferente"];
const boxes = ["Manual", "Automatica", "Indiferente"];
const tractions = ["2WD", "AWD", "4WD", "Indiferente"];
const priorities = ["Precio", "Economia", "Equipamiento", "Seguridad", "Espacio", "Potencia", "Tecnologia"];
const familySizes = ["1-2 personas", "3-4 personas", "5 o mas", "Carga/herramientas"];
const timings = ["Solo mirando", "Cotizar hoy", "Credito ahora", "Cerrar esta semana"];
const financingModes = ["Indefinido", "Contado", "Credito", "Credito con pie", "Retoma + credito"];
const tradeInOptions = ["No", "Si, por tasar", "Si, ya valorizado"];

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(searchParams: SearchParams, key: string) {
  const value = searchParams[key];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function budgetLabel(value: string) {
  return budgets.find(([optionValue]) => optionValue === value)?.[1] ?? "No informado";
}

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(normalizeText(word)));
}

function addReason(reasons: string[], reason: string) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function buildCompareHref(ids: string[]) {
  const params = new URLSearchParams();
  ids.slice(0, 3).forEach((id) => params.append("v", id));
  return `/comparador?${params.toString()}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default async function ClientInFrontPage({ searchParams }: { searchParams: SearchParams }) {
  const customerId = firstParam(searchParams, "customerId");
  const preferredBrandId = firstParam(searchParams, "brandId");
  const budgetRaw = firstParam(searchParams, "budget");
  const budget = parseMoney(budgetRaw);
  const segment = firstParam(searchParams, "type");
  const use = firstParam(searchParams, "use");
  const fuel = firstParam(searchParams, "fuel");
  const box = firstParam(searchParams, "box");
  const traction = firstParam(searchParams, "traction");
  const priority = firstParam(searchParams, "priority");
  const familySize = firstParam(searchParams, "familySize");
  const purchaseTiming = firstParam(searchParams, "purchaseTiming");
  const financing = firstParam(searchParams, "financing");
  const tradeIn = firstParam(searchParams, "tradeIn");
  const profileNotes = firstParam(searchParams, "profileNotes");
  const hasFilters = [customerId, preferredBrandId, budgetRaw, segment, use, fuel, box, traction, priority, familySize, purchaseTiming, financing, tradeIn, profileNotes].some(Boolean);

  const [versions, customers, commercialAidAlerts, allBrands] = await Promise.all([
    prisma.version.findMany({
      where: { status: { not: "IGNORADO" } },
      include: {
        brand: true,
        model: true,
        // Bloque A: solo precios VIGENTE, como el resto del sistema.
        // Antes aceptaba tambien DETECTADO y ademas ordenaba por status
        // ascendente -- y como "DETECTADO" va antes que "VIGENTE"
        // alfabeticamente, cuando existian los dos el perfilador
        // PREFERIA el precio sin validar. Ver src/lib/precios.ts.
        prices: {
          ...includePreciosVigentes,
          orderBy: [{ effectiveFrom: "desc" }]
        }
      },
      orderBy: [{ brand: { name: "asc" } }, { model: { name: "asc" } }, { commercialOrder: "asc" }, { name: "asc" }]
    }),
    prisma.customer.findMany({
      include: { status: true },
      orderBy: { updatedAt: "desc" },
      take: 80
    }),
    getCommercialAidAlerts(120),
    prisma.brand.findMany({ orderBy: { name: "asc" } })
  ]);


  const selectedCustomer = customers.find((customer) => customer.id === customerId);

  const scored = versions
    .map((version) => {
      const listPrice = version.prices.find((item) => item.priceType === "LIST" && item.status === "VIGENTE")?.amount
        ?? version.prices.find((item) => item.priceType === "LIST")?.amount
        ?? null;
      const campaignPrice = version.prices.find((item) => item.priceType === "CAMPAIGN" && item.status === "VIGENTE")?.amount
        ?? version.prices.find((item) => item.priceType === "CAMPAIGN")?.amount
        ?? null;
      const cashPrice = version.prices.find((item) => item.priceType === "CASH" && item.status === "VIGENTE")?.amount
        ?? version.prices.find((item) => item.priceType === "CASH")?.amount
        ?? null;
      const financingPrice = version.prices.find((item) => item.priceType === "FINANCING" && item.status === "VIGENTE")?.amount
        ?? version.prices.find((item) => item.priceType === "FINANCING")?.amount
        ?? null;
      const hasPendingPrice = version.prices.length > 0 && !version.prices.some((p) => p.status === "VIGENTE");
      const wantsCredit = financing.includes("Credito");
      const price = wantsCredit && financingPrice ? financingPrice : cashPrice ?? financingPrice ?? campaignPrice ?? listPrice;
      const detectedBonus = listPrice && price && listPrice > price ? listPrice - price : 0;

      const haystack = normalizeText(
        [
          version.brand.name,
          version.model.name,
          version.model.segment,
          version.name,
          version.engine,
          version.power,
          version.transmission,
          version.traction,
          version.fuelType,
          version.consumption,
          version.passengers,
          version.cargoCapacity,
          version.screen,
          version.carPlay,
          version.androidAuto,
          version.camera,
          version.sensors,
          version.airbags,
          version.adas,
          version.equipmentSummary,
          version.safetySummary
        ]
          .filter(Boolean)
          .join(" ")
      );

      const segmentText = normalizeText(version.model.segment ?? `${version.model.name} ${version.name}`);
      const reasons: string[] = [];
      const warnings: string[] = [];
      let score = price ? 24 : -40;

      if (!price) warnings.push("Sin precio vigente aprobado.");
      if (hasPendingPrice) warnings.push("Precio pendiente de aprobación en sistema.");

      if (budget && price) {
        if (price <= budget) {
          score += 28;
          addReason(reasons, "calza dentro del presupuesto declarado");
        } else if (price <= budget * 1.08) {
          score += 8;
          addReason(reasons, "sirve como opcion para subir presupuesto");
        } else {
          score -= 36;
          warnings.push(`Supera el presupuesto por ${formatCLP(price - budget)}.`);
        }
      }

      // HARD FILTERING (Filtros Obligatorios)
      let hardFiltered = false;
      const hardFilterReasons: string[] = [];

      // ── 1. Carrocería / Segmento Obligatorio ──────────────────────────────────
      // Estrategia: usar model.segment como fuente de verdad primaria,
      // luego haystack como fallback. Esto garantiza que Mazda CX-5, Suzuki Vitara,
      // Changan CS55, GWM H6, etc. sean detectados correctamente sin importar
      // cómo esté escrito el nombre del modelo.
      if (segment && segment !== "Indiferente") {
        const segLower = normalizeText(segment);
        const canonical = (version.model.canonicalSegment ?? "").toUpperCase();
        const rawSegment = normalizeText(version.model.segment ?? "");
        let segmentMatch = false;

        if (segLower === "sedan") {
          segmentMatch =
            canonical === "SEDAN" ||
            includesAny(rawSegment, ["sedan", "sedán", "berlina", "pasajeros", "auto"]) ||
            includesAny(haystack, ["sedan", "sedán", "alsvin", "dzire", "mazda 3", "mazda3", "mazda 6", "mazda6", "v7", "v3", "eado"]);
        } else if (segLower === "pickup") {
          segmentMatch =
            canonical === "PICKUP" ||
            includesAny(rawSegment, ["pickup", "pick up", "pick-up", "camioneta"]) ||
            includesAny(haystack, ["pickup", "pick up", "pick-up", "camioneta", "cabina doble", "poer", "wingle", "hunter", "hilux", "dmax", "ranger", "d-max", "triton", "bt-50", "bt 50"]);
        } else if (segLower === "suv") {
          const isPickup = canonical === "PICKUP" || includesAny(rawSegment, ["pickup", "camioneta"]) ||
            includesAny(haystack, ["pickup", "camioneta", "pick up", "poer", "wingle", "hunter", "bt-50"]);
          segmentMatch =
            !isPickup && (
              canonical === "SUV" ||
              includesAny(rawSegment, ["suv", "crossover", "todoterreno", "todo terreno", "station wagon", "s.w."]) ||
              includesAny(haystack, [
                "suv", "crossover", "todoterreno", "station wagon", "s.w.",
                "cx-", "cx30", "cx5", "cx50", "cx90", "vitara", "s-cross", "scross", "fronx", "ignis", "jimny",
                "cs15", "cs35", "cs55", "cs75", "uni-k", "uni-t", "jolion", "h6", "haval", "tank", "ora",
                "500", "580", "600", "glory", "fengon"
              ])
            );
        } else if (segLower === "hatchback") {
          segmentMatch =
            canonical === "HATCHBACK" ||
            includesAny(rawSegment, ["hatchback", "hb", "compacto"]) ||
            includesAny(haystack, ["hatchback", "swift", "alto", "celerio"]);
        } else if (segLower === "citycar") {
          segmentMatch =
            includesAny(rawSegment, ["citycar", "city car", "microcar", "urbano"]) ||
            includesAny(haystack, ["citycar", "city car", "alto", "celerio", "s-presso", "spresso"]);
        } else if (segLower === "comercial") {
          segmentMatch =
            canonical === "COMERCIAL" ||
            includesAny(rawSegment, ["comercial", "furgon", "van", "cargo"]) ||
            includesAny(haystack, ["furgon", "van", "comercial", "cargo", "truck"]);
        } else {
          segmentMatch = rawSegment.includes(segLower) || haystack.includes(segLower);
        }

        if (segmentMatch) {
          reasons.push(`✅ Carrocería: ${segment}`);
        } else {
          hardFiltered = true;
          hardFilterReasons.push(`No es ${segment}`);
        }
      }


      // ── 2. Filtro Obligatorio de Marca ─────────────────────────────────────
      if (preferredBrandId && version.brandId !== preferredBrandId) {
        hardFiltered = true;
        hardFilterReasons.push("No es la marca seleccionada");
      }

      // ── 3. Presupuesto Máximo Obligatorio ────────────────────────────────────
      if (budget) {
        if (!price) {
          hardFiltered = true;
          hardFilterReasons.push("Sin precio vigente para evaluar presupuesto");
        } else if (price <= budget) {
          reasons.push(`✅ Precio considerado: ${formatCLP(price)} (Dentro del presupuesto de ${formatCLP(budget)})`);
        } else {
          hardFiltered = true;
          hardFilterReasons.push(`Supera el presupuesto por ${formatCLP(price - budget)}`);
        }
      }

      // ── 4. Transmisión Obligatoria ──────────────────────────────────────────
      if (box && box !== "Indiferente") {
        const wantsAutomatic = normalizeText(box).includes("automat");
        const isAutomatic = includesAny(haystack, ["at", "cvt", "dct", "amt", "automatica", "aut"]);
        const isManual = includesAny(haystack, ["mt", "manual", "mecanica", "mecanico"]);

        const matchesBox = wantsAutomatic ? isAutomatic : isManual && !isAutomatic;
        if (matchesBox) {
          reasons.push(`✅ Transmisión: ${box}`);
        } else {
          hardFiltered = true;
          hardFilterReasons.push(`No es caja ${box}`);
        }
      }

      // 4. Tracción Obligatoria (si exige 4WD o AWD)
      if (traction && (traction === "4WD" || traction === "AWD")) {
        const has4x4 = includesAny(haystack, ["4wd", "awd", "4x4"]);
        if (has4x4) {
          reasons.push(`✅ Tracción: ${traction}`);
        } else {
          hardFiltered = true;
          hardFilterReasons.push(`No posee tracción ${traction}`);
        }
      }

      // SCORING DE PREFERENCIAS (para los vehículos que pasan)
      if (fuel && fuel !== "Indiferente" && haystack.includes(normalizeText(fuel))) {
        score += 15;
        reasons.push(`✅ Combustible: ${fuel}`);
      }

      if (use === "Ciudad" && includesAny(haystack, ["citycar", "hatchback", "sedan", "hibrido", "electrico", "cvt", "automatica"])) score += 12;
      if (use === "Familia" && includesAny(haystack, ["suv", "airbags", "adas", "isofix", "camara", "sensores", "climatizador"])) score += 14;
      if (use === "Carretera" && includesAny(haystack, ["crucero", "adas", "turbo", "diesel", "awd", "hibrido"])) score += 12;
      if (use === "Trabajo" && includesAny(haystack, ["pickup", "comercial", "diesel", "carga", "truck", "4x4"])) score += 16;
      if ((use === "Campo" || use === "4x4") && includesAny(haystack, ["4wd", "awd", "pickup", "diesel", "4x4"])) score += 16;

      if (familySize === "5 o mas" && includesAny(haystack, ["5", "6", "7", "suv", "cx-90", "h7", "tank"])) score += 10;
      if (familySize === "Carga/herramientas" && includesAny(haystack, ["pickup", "carga", "cargo", "truck", "comercial"])) score += 12;

      if (priority === "Precio" && detectedBonus > 0) score += 12;
      if (priority === "Economia" && includesAny(haystack, ["hibrido", "hybrid", "electrico", "diesel", "consumo"])) score += 14;
      if (priority === "Equipamiento" && (version.equipmentSummary || includesAny(haystack, ["pantalla", "techo", "camara", "sensores", "carplay", "android"]))) score += 14;
      if (priority === "Seguridad" && (version.safetySummary || includesAny(haystack, ["airbags", "adas", "camara", "sensores", "crucero"]))) score += 14;
      if (priority === "Espacio" && includesAny(haystack, ["7", "6", "suv", "maletero", "espacio", "pickup"])) {
        score += 14;
        reasons.push("✅ Calza con necesidad de espacio");
      }
      if (priority === "Potencia") {
        if (version.power || includesAny(haystack, ["turbo", "2.0", "2.4", "2.5", "3.3"])) score += 12;
        addReason(reasons, "hay argumento de respuesta y motor");
      }
      if (priority === "Tecnologia") {
        if (includesAny(haystack, ["pantalla", "carplay", "android", "adas", "camara", "sensores"])) score += 14;
        addReason(reasons, "puedes mostrar tecnologia en sala");
      }

      // PENALIZACIÓN DFSK: Ordenar siempre al final según instrucción comercial
      const isDfsk = normalizeText(version.brand.name).includes("dfsk");
      if (isDfsk) {
        score -= 40;
        warnings.push("Marca DFSK ponderada al final por política de preferencia comercial.");
      }

      if (financing.includes("Credito") && financingPrice) {

        score += 8;
        addReason(reasons, "tiene precio o foco de financiamiento cargado");
      }

      if (detectedBonus > 0) addReason(reasons, `bono/precio campaña detectado: ${formatCLP(detectedBonus)}`);
      if (version.sapCode) score += 2;
      else warnings.push("Codigo CIT pendiente para impuesto verde.");

      const aids = commercialAidAlerts.filter((alert) => commercialAidMatchesVehicle(alert, version.brand.name, version.model.name));
      const hasGiftcardOrReward =
        includesAny(haystack, ["giftcard", "gift card", "premio", "premios", "regalo", "experiencia", "bono especial"]) ||
        aids.some((a) => includesAny(normalizeText(`${a.title} ${a.detail} ${a.rawText}`), ["giftcard", "gift card", "premio", "premios", "regalo"]));

      if (hasGiftcardOrReward) {
        score += 25; // Prioridad especial para giftcards y premios
        reasons.unshift("🎁 PRIORIDAD: Incluye Giftcard / Premio Especial");
      }

      if (aids.length) {
        score += aids.length * 5;
        reasons.push("tiene ayuda comercial detectada");
      }

      return {
        version,
        price,
        listPrice,
        detectedBonus,
        score,
        hardFiltered,
        hardFilterReasons,
        hasGiftcardOrReward,
        fit: clamp(Math.round(score), 0, 100),
        reasons: reasons.slice(0, 6),
        warnings: warnings.slice(0, 3),
        aids
      };
    });

  const compliantVehicles = scored
    .filter((item) => Boolean(item.price) && !item.hardFiltered)
    .sort((a, b) => {
      // Regla Comercial Obligatoria: DFSK SIEMPRE AL FINAL
      const isDfskA = normalizeText(a.version.brand.name).includes("dfsk");
      const isDfskB = normalizeText(b.version.brand.name).includes("dfsk");
      if (isDfskA !== isDfskB) return isDfskA ? 1 : -1;
      return b.score - a.score || (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER);
    });

  const alternativeVehicles = scored
    .filter((item) => item.price && item.hardFiltered)
    .sort((a, b) => {
      const isDfskA = normalizeText(a.version.brand.name).includes("dfsk");
      const isDfskB = normalizeText(b.version.brand.name).includes("dfsk");
      if (isDfskA !== isDfskB) return isDfskA ? 1 : -1;
      return (a.price ?? 0) - (b.price ?? 0);
    })
    .slice(0, 5);


  const displayVehicles = compliantVehicles;
  const top = displayVehicles[0] ?? alternativeVehicles[0];

  const compareHref = scored.length >= 2 ? buildCompareHref(scored.map((item) => item.version.id)) : "/comparador";
  const currentPath = `/cliente-frente-a-mi?${new URLSearchParams(
    Object.entries(searchParams).flatMap(([key, value]) => {
      if (!value) return [];
      if (Array.isArray(value)) return value.map((item) => [key, item]);
      return [[key, value]];
    })
  ).toString()}`;

  const sellerAdvice = top
    ? `Partir con ${top.version.brand.name} ${top.version.model.name}: ${top.reasons[0] ?? "calza mejor con el perfil cargado"}. Luego comparar contra la segunda opcion para justificar precio/equipamiento.`
    : "Hacer dos preguntas mas: presupuesto real y uso principal. Con eso el sistema ordena alternativas.";

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Perfilador express"
        description="Una pauta rapida para entender al cliente, elegir que ofrecerle primero y pasar directo a comparar, cotizar, rentabilidad o credito."
      />

      <Notice>
        La recomendacion usa solo versiones, precios vigentes, fichas cargadas y ayudas comerciales detectadas. Sirve como apoyo de venta; antes de cerrar revisa disponibilidad, vigencia y condiciones.
      </Notice>

      {firstParam(searchParams, "guardado") ? <Notice>Perfil guardado en el CRM del cliente.</Notice> : null}

      <Panel>
        <form className="grid gap-5">
          <div className="grid gap-3 lg:grid-cols-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-black uppercase text-steel">Cliente</span>
              <select className="input" name="customerId" defaultValue={customerId}>
                <option value="">Cliente no creado aun</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.firstName} {customer.lastName ?? ""} | {customer.status?.name ?? "Sin estado"}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-black uppercase text-steel">Marca preferida</span>
              <select className="input" name="brandId" defaultValue={preferredBrandId}>
                <option value="">Todas las marcas</option>
                {allBrands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-black uppercase text-steel">Presupuesto</span>
              <select className="input" name="budget" defaultValue={budgetRaw}>
                {budgets.map(([value, label]) => (
                  <option key={label} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-black uppercase text-steel">Cuando compra</span>

              <select className="input" name="purchaseTiming" defaultValue={purchaseTiming}>
                <option value="">Momento de compra</option>
                {timings.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-black uppercase text-steel">Uso principal</span>
              <select className="input" name="use" defaultValue={use}>
                <option value="">Uso</option>
                {uses.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-black uppercase text-steel">Tipo ideal</span>
              <select className="input" name="type" defaultValue={segment}>
                <option value="">Tipo</option>
                {types.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-black uppercase text-steel">Familia o carga</span>
              <select className="input" name="familySize" defaultValue={familySize}>
                <option value="">No preguntado</option>
                {familySizes.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-black uppercase text-steel">Prioridad</span>
              <select className="input" name="priority" defaultValue={priority}>
                <option value="">Lo mas importante</option>
                {priorities.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="grid gap-1.5">
              <span className="text-xs font-black uppercase text-steel">Combustible</span>
              <select className="input" name="fuel" defaultValue={fuel}>
                <option value="">Combustible</option>
                {fuels.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-black uppercase text-steel">Caja</span>
              <select className="input" name="box" defaultValue={box}>
                <option value="">Caja</option>
                {boxes.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-black uppercase text-steel">Traccion</span>
              <select className="input" name="traction" defaultValue={traction}>
                <option value="">Traccion</option>
                {tractions.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-black uppercase text-steel">Pago</span>
              <select className="input" name="financing" defaultValue={financing}>
                {financingModes.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-black uppercase text-steel">Retoma</span>
              <select className="input" name="tradeIn" defaultValue={tradeIn}>
                {tradeInOptions.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="grid gap-1.5">
            <span className="text-xs font-black uppercase text-steel">Notas rapidas del cliente</span>
            <input className="input" name="profileNotes" defaultValue={profileNotes} placeholder="Ej: quiere automatico, maletero grande, no quiere pasar de cuota X" />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" type="submit">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Perfilar y recomendar
            </button>
            <Link className="btn btn-secondary" href="/clientes">
              <UsersRound className="h-4 w-4" aria-hidden="true" />
              Crear cliente
            </Link>
            <p className="text-sm font-semibold text-steel">
              Preguntas minimas: presupuesto, uso y prioridad. Lo demas afina la recomendacion.
            </p>
          </div>
        </form>
      </Panel>

      {!hasFilters ? (
        <EmptyState
          title="Haz 3 preguntas y el sistema ordena las opciones."
          description="Parte por presupuesto, uso principal y prioridad. Despues puedes afinar con caja, combustible, traccion, credito o retoma."
        />
      ) : scored.length ? (
        <>
          <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
            <Panel>
              <p className="text-xs font-black uppercase text-copper">Lectura del cliente</p>
              <h2 className="mt-1 text-xl font-black text-ink">{selectedCustomer ? `${selectedCustomer.firstName} ${selectedCustomer.lastName ?? ""}` : "Cliente aun no asociado"}</h2>
              <div className="mt-4 grid gap-3 text-sm font-semibold text-graphite">
                <p><strong className="text-ink">Presupuesto:</strong> {budgetLabel(budgetRaw)}</p>
                <p><strong className="text-ink">Necesidad:</strong> {[use, segment, familySize, priority].filter(Boolean).join(" | ") || "No definida"}</p>
                <p><strong className="text-ink">Pago:</strong> {[financing, tradeIn, purchaseTiming].filter(Boolean).join(" | ") || "No definido"}</p>
              </div>
              <div className="mt-4 rounded-lg border border-signal/20 bg-signal/5 p-4">
                <p className="flex items-center gap-2 text-sm font-black text-ink">
                  <MessageSquareText className="h-4 w-4 text-signal" aria-hidden="true" />
                  Que decir primero
                </p>
                <p className="mt-2 text-sm font-semibold leading-6 text-graphite">{sellerAdvice}</p>
              </div>
              <form action={saveClientProfile} className="mt-4 grid gap-2">
                <input type="hidden" name="customerId" value={customerId} />
                <input type="hidden" name="budget" value={budgetRaw} />
                <input type="hidden" name="budgetLabel" value={budgetLabel(budgetRaw)} />
                <input type="hidden" name="use" value={use} />
                <input type="hidden" name="type" value={segment} />
                <input type="hidden" name="fuel" value={fuel} />
                <input type="hidden" name="box" value={box} />
                <input type="hidden" name="traction" value={traction} />
                <input type="hidden" name="priority" value={priority} />
                <input type="hidden" name="familySize" value={familySize} />
                <input type="hidden" name="purchaseTiming" value={purchaseTiming} />
                <input type="hidden" name="financing" value={financing} />
                <input type="hidden" name="tradeIn" value={tradeIn} />
                <input type="hidden" name="profileNotes" value={profileNotes} />
                <input type="hidden" name="recommendedBrand" value={top.version.brand.name} />
                <input type="hidden" name="recommendedModel" value={top.version.model.name} />
                <input type="hidden" name="recommendedVersion" value={top.version.name} />
                <input type="hidden" name="recommendedVehicleLabel" value={`${top.version.brand.name} ${top.version.model.name} ${top.version.name}`} />
                <input type="hidden" name="sellerAdvice" value={sellerAdvice} />
                <input type="hidden" name="returnTo" value={currentPath} />
                <button className="btn btn-primary w-fit" type="submit" disabled={!customerId}>
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Guardar perfil en CRM
                </button>
                {!customerId ? <p className="text-xs font-semibold text-steel">Selecciona o crea un cliente para guardar este perfil.</p> : null}
              </form>
            </Panel>

            <Panel>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase text-copper">Siguiente paso</p>
                  <h2 className="mt-1 text-xl font-black text-ink">Trabajar las opciones recomendadas</h2>
                </div>
                <StatusPill tone="good">{scored.length} alternativas</StatusPill>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Link href={compareHref} className="btn btn-secondary">
                  <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
                  Comparar estas
                </Link>
                <Link href={`/cotizador?versionId=${top.version.id}${customerId ? `&customerId=${customerId}` : ""}`} className="btn btn-primary">
                  <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                  Cotizar la mejor
                </Link>
                <Link href={`/rentabilidad?versionId=${top.version.id}`} className="btn btn-secondary">
                  <Calculator className="h-4 w-4" aria-hidden="true" />
                  Ver margen
                </Link>
                <Link
                  href={`/creditos?vehicleLabel=${encodeURIComponent(`${top.version.brand.name} ${top.version.model.name} ${top.version.name}`)}&saleAmount=${top.price ?? ""}${customerId ? `&customerId=${customerId}` : ""}`}
                  className="btn btn-secondary"
                >
                  <CreditCard className="h-4 w-4" aria-hidden="true" />
                  Evaluar credito
                </Link>
              </div>
              <div className="mt-4 grid gap-3">
                {top.aids.length ? (
                  top.aids.map((aid: CommercialAidAlert) => (
                    <div key={aid.id} className="rounded-lg border border-graphite/10 bg-white p-3">
                      <p className="flex items-center gap-2 text-sm font-black text-ink">
                        <BadgeDollarSign className="h-4 w-4 text-signal" aria-hidden="true" />
                        {aid.title}
                      </p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-steel">{aid.detail}</p>
                    </div>
                  ))
                ) : (
                  <p className="rounded-lg border border-graphite/10 bg-white p-3 text-sm font-semibold text-steel">
                    Sin ayuda comercial asociada automaticamente a la primera opcion. Revisa plan comercial si quieres forzar una campana.
                  </p>
                )}
              </div>
            </Panel>
          </div>

          {/* Seccion 1: Vehiculos que cumplen 100% de Filtros Obligatorios */}
          {compliantVehicles.length === 0 ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
              <div className="flex items-center gap-3 text-rose-800">
                <AlertTriangle className="h-6 w-6 shrink-0" aria-hidden="true" />
                <div>
                  <h3 className="text-base font-black">No encontramos vehículos que cumplan el 100% de los filtros obligatorios.</h3>
                  <p className="mt-1 text-sm font-semibold leading-6 text-rose-700">
                    No existen {segment ? `${segment}s` : "vehículos"} dentro de un presupuesto máximo de {formatCLP(budget)} {box && box !== "Indiferente" ? `con caja ${box}` : ""}. A continuación te presentamos las <strong>alternativas más cercanas</strong> que superan el presupuesto o varían ligeramente el criterio.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {/* Grid de Vehiculos Recomendados (Cumplimiento 100%) */}
          {compliantVehicles.length > 0 ? (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-black text-ink">
                  Vehículos Recomendados ({compliantVehicles.length} cumplen 100% tus criterios)
                </h3>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                {compliantVehicles.map((item, index) => {
                  const label = `${item.version.brand.name} ${item.version.model.name} ${item.version.name}`;
                  const breakdown = getPricingBreakdown({
                    brandName: item.version.brand.name,
                    modelName: item.version.model.name,
                    versionName: item.version.name,
                    segment: item.version.model.segment,
                    equipmentSummary: item.version.equipmentSummary,
                    citCode: item.version.sapCode,
                    prices: item.version.prices ?? []
                  });

                  return (
                    <Panel key={item.version.id} className={`border-2 ${item.hasGiftcardOrReward ? "border-amber-400 bg-amber-50/20" : "border-emerald-500/20"} shadow-panel`}>
                      {item.hasGiftcardOrReward ? (
                        <div className="mb-2 rounded bg-amber-500 px-2.5 py-1 text-center text-xs font-black text-white shadow-sm">
                          🎁 GIFT CARD / PREMIO COMERCIAL ACTIVO
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between gap-3">
                        <StatusPill tone={item.hasGiftcardOrReward ? "warn" : "good"}>
                          {index === 0 ? "🏆 Opción Principal #1" : `Opción #${index + 1}`}
                        </StatusPill>
                        <div className="flex items-center gap-1 text-sm font-black text-signal">
                          <Gauge className="h-4 w-4" aria-hidden="true" />
                          {item.fit}% Calce
                        </div>
                      </div>
                      <h2 className="mt-4 text-xl font-black text-ink">{item.version.brand.name} {item.version.model.name}</h2>
                      <p className="mt-1 text-sm font-black text-graphite">{item.version.name}</p>
                      
                      {/* DESGLOSE PRECIO CONTADO Y FINANCIAMIENTO CON TODOS LOS BONOS */}
                      <div className="mt-3 grid gap-1.5 rounded-lg bg-mist p-3 text-xs">
                        <div className="flex justify-between font-semibold text-graphite">
                          <span>Precio Lista:</span>
                          <span>{formatCLP(breakdown.listPrice)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-ink">
                          <span>Precio Contado:</span>
                          <span className="text-signal">{formatCLP(breakdown.cashPrice)}</span>
                        </div>
                        <div className="flex justify-between font-black text-emerald-700 bg-emerald-100 p-1.5 rounded">
                          <span>Financiamiento (Todos Bonos):</span>
                          <span>{formatCLP(breakdown.financingPrice)}</span>
                        </div>
                      </div>

                      {/* CAJA DE VALOR SIN IVA PARA CAMIONETAS */}
                      {breakdown.isCommercialVehicle && breakdown.cashNetPrice ? (
                        <div className="mt-2 rounded bg-emerald-900 p-2.5 text-white">
                          <p className="text-[10px] font-black uppercase text-emerald-300">💼 Valor Empresa / Factura (Sin IVA)</p>
                          <p className="text-lg font-black text-emerald-400">{formatCLP(breakdown.cashNetPrice)} <span className="text-xs font-normal text-emerald-200">+ IVA (19%)</span></p>
                        </div>
                      ) : null}

                      {/* GASTOS PUESTA EN CALLE */}
                      <div className="mt-2 text-[11px] font-semibold text-steel flex justify-between border-t border-graphite/10 pt-2">
                        <span>Puesta en calle est.:</span>
                        <strong className="text-graphite">{formatCLP(breakdown.estimatedKeyInHandCash)}</strong>
                      </div>

                      {/* ALERTAS DE BONO MARCA + CREDITO */}
                      {breakdown.creditBonusAlert ? (
                        <p className="mt-2 rounded bg-sky-100 p-1.5 text-[11px] font-bold text-sky-900 border border-sky-300">
                          💳 {breakdown.creditBonusAlert}
                        </p>
                      ) : null}


                      <div className="mt-4 grid gap-2">
                        {item.reasons.map((reason) => (
                          <p key={reason} className="flex gap-2 text-sm font-semibold leading-5 text-graphite">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                            {reason}
                          </p>
                        ))}
                      </div>

                      <div className="mt-4 rounded-lg bg-mist p-3">
                        <p className="flex items-center gap-2 text-xs font-black uppercase text-steel">
                          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                          Detalles Técnicos
                        </p>
                        <p className="mt-2 text-sm font-semibold leading-6 text-graphite">
                          Transmisión: {missing(item.version.transmission)} | Motor: {missing(item.version.engine)} | Tracción: {missing(item.version.traction)}
                        </p>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link className="btn btn-primary" href={`/cotizador?versionId=${item.version.id}${customerId ? `&customerId=${customerId}` : ""}`}>
                          Cotizar esta
                        </Link>
                        <Link className="btn btn-secondary" href={`/rentabilidad?versionId=${item.version.id}`}>
                          Margen
                        </Link>
                        <Link className="btn btn-secondary" href={`/buscar?q=${encodeURIComponent(label)}`}>
                          Ver datos
                        </Link>
                      </div>
                    </Panel>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Seccion 2: Alternativas Cercanas (Si aplica) */}
          {alternativeVehicles.length > 0 ? (
            <div className="mt-6">
              <div className="mb-3">
                <h3 className="text-lg font-black text-amber-900 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
                  Alternativas Cercanas {compliantVehicles.length === 0 ? "(Ver si el cliente puede flexibilizar presupuesto o criterio)" : "(Opciones fuera de presupuesto)"}
                </h3>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                {alternativeVehicles.slice(0, 3).map((item) => {
                  const label = `${item.version.brand.name} ${item.version.model.name} ${item.version.name}`;
                  return (
                    <Panel key={item.version.id} className="border border-amber-300 bg-amber-50/30">
                      <div className="flex items-center justify-between gap-3">
                        <StatusPill tone="warn">Alternativa Cercana</StatusPill>
                        <span className="text-xs font-black text-amber-800">Supera / Desvía</span>
                      </div>
                      <h2 className="mt-4 text-xl font-black text-ink">{item.version.brand.name} {item.version.model.name}</h2>
                      <p className="mt-1 text-sm font-black text-graphite">{item.version.name}</p>
                      <p className="mt-4 text-2xl font-black text-ink">{formatCLP(item.price)}</p>

                      <div className="mt-3 grid gap-1.5">
                        {item.hardFilterReasons.map((reason) => (
                          <p key={reason} className="rounded bg-amber-100 p-2 text-xs font-bold text-amber-900 flex items-center gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0" aria-hidden="true" />
                            {reason}
                          </p>
                        ))}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link className="btn btn-secondary" href={`/cotizador?versionId=${item.version.id}${customerId ? `&customerId=${customerId}` : ""}`}>
                          Cotizar alternativa
                        </Link>
                        <Link className="btn btn-secondary" href={`/buscar?q=${encodeURIComponent(label)}`}>
                          Ver datos
                        </Link>
                      </div>
                    </Panel>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="No hay una recomendacion seria con estos datos."
          description="Prueba ampliar presupuesto, dejar tipo como indiferente o cambiar traccion/combustible. Prefiero no recomendar algo que no calza."
          actionHref="/vehiculos"
          actionLabel="Revisar catalogo"
        />
      )}
    </div>
  );
}
