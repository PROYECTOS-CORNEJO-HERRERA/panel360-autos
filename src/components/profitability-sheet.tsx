"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, ExternalLink, FolderOpen, Mail, Printer, RotateCcw, Save, Search, Trash2 } from "lucide-react";
import { formatCLP } from "@/lib/format";
import { sendRentabilidadEmail } from "@/app/rentabilidad/email-action";
import { saveProfitabilitySheet, deleteProfitabilitySheet, type SavedSheetSummary } from "@/app/rentabilidad/sheet-actions";

export type ProfitabilityVehicle = {
  id: string;
  label: string;
  brandName: string;
  modelName: string;
  versionName: string;
  segment?: string | null;
  equipmentSummary?: string | null;
  citCode: string | null;
  listPrice: number | null;
  campaignPrice: number | null;
  cashPrice?: number | null;
  financingPrice?: number | null;
  prices?: Array<{
    priceType: string;
    amount: number;
    status?: string | null;
    channel?: string | null;
    bonusName?: string | null;
    bonusAmount?: number | null;
    hasIva?: boolean | null;
    effectiveFrom?: Date | string | null;
  }>;
};

type ProfitabilitySheetProps = {
  vehicles: ProfitabilityVehicle[];
  today: string;
  initialState?: Partial<FormState>;
  syncKey?: string;
  hideVehicleSelector?: boolean;
  savedSheets?: SavedSheetSummary[];
};

export type FormState = {
  selectedVersionId: string;
  orderNumber: string;
  internalNumber: string;
  customerName: string;
  customerEmail: string;
  jefaturaEmail: string;
  invoiceDate: string;
  priceListGross: number;
  brandBonusGross: number;
  salePriceWithVat: number;
  fleteOsorno: number;
  rubberFloor: number;
  safetyKit: number;
  trins: number;
  registration: number;
  greenTax: number;
  soap: number;
  circulationPermit: number;
  accGrabado: number;
  maintenance: number;
  interests: number;
  others: number;
  discountSergio: number;
  amicarSergio: number;
  amicarMarca: number;
  aporteAdicMarca: number;
  aportePtteMarca: number;
  creditMargin: number;
  marginPercent: number;
  tradeInValue: number;
  // Caja RETOMA del informe.
  tradeInBrand: string;
  tradeInModel: string;
  tradeInPlate: string;
  tradeInAppraisal: number;
  tradeInBonus: number;
  // Caja CREDITO del informe.
  creditBalance: number;
  creditPrepayment: number;
  creditSpread: number;
  notes: string;
};

const vatRate = 1.19;
const utmByMonth2026: Record<number, number> = {
  1: 69751,
  2: 69611,
  3: 69889,
  4: 69889,
  5: 70588,
  6: 71506,
  7: 71649,
  8: 71649
};

const defaultState: FormState = {
  selectedVersionId: "",
  orderNumber: "",
  internalNumber: "",
  customerName: "",
  customerEmail: "",
  jefaturaEmail: "",
  invoiceDate: "",
  priceListGross: 0,
  brandBonusGross: 0,
  salePriceWithVat: 0,
  fleteOsorno: 380600,
  rubberFloor: 35988,
  safetyKit: 23988,
  trins: 34280,
  registration: 82230,
  greenTax: 0,
  soap: 22000,
  circulationPermit: 0,
  accGrabado: 35000, // Grabado de patentes: va siempre, por eso viene puesto.
  maintenance: 0,
  interests: 0,
  others: 0,
  discountSergio: 0,
  amicarSergio: 0,
  amicarMarca: 0,
  aporteAdicMarca: 0,
  aportePtteMarca: 0,
  creditMargin: 0,
  marginPercent: 8, // El margen de un negocio es 8% por defecto.
  tradeInValue: 0,
  tradeInBrand: "",
  tradeInModel: "",
  tradeInPlate: "",
  tradeInAppraisal: 0,
  tradeInBonus: 0,
  creditBalance: 0,
  creditPrepayment: 0,
  creditSpread: 0,
  notes: ""
};

function mergeDefinedState(state: FormState, updates?: Partial<FormState>) {
  if (!updates) return state;
  const next = { ...state };
  for (const [key, value] of Object.entries(updates) as Array<[keyof FormState, FormState[keyof FormState]]>) {
    if (value !== undefined) {
      next[key] = value as never;
    }
  }
  return next;
}

function stateWithVehicle(state: FormState, vehicles: ProfitabilityVehicle[], versionId: string) {
  const vehicle = vehicles.find((item) => item.id === versionId);
  if (!vehicle) return { ...state, selectedVersionId: "" };

  const listPrice = vehicle.listPrice ?? 0;
  const salePrice = vehicle.cashPrice ?? vehicle.campaignPrice ?? listPrice;
  const detectedBonus = listPrice && salePrice && listPrice > salePrice ? listPrice - salePrice : 0;

  return {
    ...state,
    selectedVersionId: versionId,
    priceListGross: listPrice,
    brandBonusGross: detectedBonus,
    salePriceWithVat: salePrice || listPrice
  };
}

function buildState(vehicles: ProfitabilityVehicle[], today: string, initialState?: Partial<FormState>) {
  const merged = mergeDefinedState({ ...defaultState, invoiceDate: today }, initialState);
  const withVehicle = merged.selectedVersionId ? stateWithVehicle(merged, vehicles, merged.selectedVersionId) : merged;
  return mergeDefinedState(withVehicle, initialState);
}

function round(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0);
}

// Normaliza texto (sin tildes, minusculas) para buscar por marca/modelo/version/CIT.
function foldText(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function net(value: number) {
  return round(value / vatRate);
}

function estimateCirculationPermit(netPrice: number, invoiceDate: string) {
  const month = Number.parseInt(invoiceDate.slice(5, 7), 10);
  const utm = utmByMonth2026[month];
  if (!netPrice || !month || !utm) return null;

  const priceInUtm = netPrice / utm;
  let annualPermit = 0;
  if (priceInUtm > 0 && priceInUtm <= 60) annualPermit = round(netPrice * 0.01);
  if (priceInUtm > 60 && priceInUtm <= 120) annualPermit = round(netPrice * 0.02 - 0.6 * utm);
  if (priceInUtm > 120 && priceInUtm <= 250) annualPermit = round(netPrice * 0.03 - 1.8 * utm);
  if (priceInUtm > 250 && priceInUtm <= 400) annualPermit = round(netPrice * 0.04 - 4.3 * utm);
  if (priceInUtm > 400) annualPermit = round(netPrice * 0.045 - 6.3 * utm);

  return round((annualPermit / 12) * (13 - month));
}

function numberValue(value: string) {
  return Number.parseInt(value || "0", 10) || 0;
}

function MoneyInput({
  label,
  value,
  onChange,
  helper
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  helper?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-black uppercase text-steel">{label}</span>
      <input className="input" type="number" inputMode="numeric" value={value || ""} onChange={(event) => onChange(numberValue(event.target.value))} />
      <span className="text-xs font-semibold text-steel">{helper ?? formatCLP(value)}</span>
    </label>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-black uppercase text-steel">{label}</span>
      <input className="input" type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SummaryLine({ label, value, strong = false }: { label: string; value: number | string; strong?: boolean }) {
  return (
    <div className={strong ? "flex items-center justify-between gap-4 border-t border-graphite/10 pt-3 text-base font-black text-ink" : "flex items-center justify-between gap-4 text-sm font-semibold text-graphite"}>
      <span>{label}</span>
      <span>{typeof value === "number" ? formatCLP(value) : value}</span>
    </div>
  );
}

type PrintRow = { label: string; value: number | string; neto?: number; strong?: boolean };

function PrintTable({
  title,
  rows,
  showNeto = false,
  amountLabel
}: {
  title: string;
  rows: PrintRow[];
  showNeto?: boolean;
  amountLabel?: string;
}) {
  return (
    <table className="pr-table">
      <thead>
        <tr>
          <th>{title}</th>
          <th className="pr-amount">{amountLabel ?? (showNeto ? "Bruto" : "Monto")}</th>
          {showNeto ? <th className="pr-amount">Neto</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${title}-${index}`} className={row.strong ? "pr-strong" : undefined}>
            <td>{row.label}</td>
            <td className="pr-amount">{typeof row.value === "number" ? formatCLP(row.value) : row.value}</td>
            {showNeto ? <td className="pr-amount">{row.neto != null ? formatCLP(row.neto) : ""}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const pctText = (value: number) => `${value.toFixed(1)}%`;

// Etiquetas legibles de los precios de origen (los que vienen de la lista cargada).
const ETIQUETA_PRECIO: Record<string, string> = {
  LIST: "Precio lista",
  CASH: "Contado",
  FINANCING: "Financiado",
  CAMPAIGN: "Campana",
  PREVENTA: "Preventa",
  PREVENTA_FINANCING: "Preventa financiada",
  DERCO_CL: "Publicado derco.cl",
  DERCO_CL_FINANCING: "derco.cl financiado"
};

const ETIQUETA_CANAL: Record<string, string> = {
  REGULAR: "Lista interna",
  DERCO_CL: "derco.cl",
  PREVENTA: "Preventa",
  CONCESIONARIO: "Concesionario"
};

function fechaCorta(valor?: Date | string | null) {
  if (!valor) return "-";
  const fecha = typeof valor === "string" ? new Date(valor) : valor;
  if (Number.isNaN(fecha.getTime())) return "-";
  return fecha.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function ProfitabilitySheet({ vehicles, today, initialState, syncKey, hideVehicleSelector = false, savedSheets = [] }: ProfitabilitySheetProps) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => buildState(vehicles, today, initialState));
  const [permitStatus, setPermitStatus] = useState("");
  const [greenTaxStatus, setGreenTaxStatus] = useState("");
  const [loadingPermit, setLoadingPermit] = useState(false);
  const [loadingGreenTax, setLoadingGreenTax] = useState(false);
  const [emailStatus, setEmailStatus] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [brandFilter, setBrandFilter] = useState("");
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === state.selectedVersionId) ?? null;

  const brandOptions = useMemo(
    () => Array.from(new Set(vehicles.map((vehicle) => vehicle.brandName))).sort((a, b) => a.localeCompare(b)),
    [vehicles]
  );

  const filteredVehicles = useMemo(() => {
    const query = foldText(vehicleQuery.trim());
    return vehicles.filter((vehicle) => {
      const matchesBrand = !brandFilter || vehicle.brandName === brandFilter;
      const matchesQuery = !query || foldText(`${vehicle.label} ${vehicle.citCode ?? ""}`).includes(query);
      return matchesBrand && matchesQuery;
    });
  }, [vehicles, brandFilter, vehicleQuery]);

  useEffect(() => {
    if (!syncKey) return;
    setState((current) => {
      const versionChanged = initialState?.selectedVersionId && initialState.selectedVersionId !== current.selectedVersionId;
      const base = versionChanged ? { ...current, greenTax: 0, circulationPermit: 0 } : current;
      const merged = mergeDefinedState(base, initialState);
      const withVehicle = merged.selectedVersionId ? stateWithVehicle(merged, vehicles, merged.selectedVersionId) : merged;
      return mergeDefinedState(withVehicle, initialState);
    });
    setPermitStatus("");
    setGreenTaxStatus("");
  }, [initialState, syncKey, vehicles]);

  const update = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setState((current) => ({ ...current, [key]: value }));
  };

  const selectVehicle = (versionId: string) => {
    const vehicle = vehicles.find((item) => item.id === versionId);
    if (!vehicle) {
      update("selectedVersionId", "");
      return;
    }

    setState((current) => stateWithVehicle(current, vehicles, versionId));
  };

  const totals = useMemo(() => {
    const priceListFinalGross = Math.max(0, state.priceListGross - state.brandBonusGross);
    const invoiceableExtras = state.fleteOsorno + state.rubberFloor + state.safetyKit + state.trins + state.accGrabado + state.maintenance + state.interests + state.others;
    const invoiceableGross = priceListFinalGross + invoiceableExtras;
    const invoiceableNet =
      net(priceListFinalGross) +
      net(state.fleteOsorno) +
      net(state.rubberFloor) +
      net(state.safetyKit) +
      net(state.trins) +
      net(state.accGrabado) +
      net(state.maintenance) +
      net(state.interests) +
      net(state.others);
    const nonInvoiceable = state.registration + state.greenTax + state.soap + state.circulationPermit;
    const totalIncome = invoiceableGross + nonInvoiceable;
    const totalDiscounts = state.discountSergio + state.amicarSergio + state.amicarMarca + state.aporteAdicMarca + state.aportePtteMarca;
    const saleTotal = totalIncome - totalDiscounts;
    const vehicleMarginGross = round(priceListFinalGross * (state.marginPercent / 100));
    const totalMarginGross = vehicleMarginGross + state.creditMargin - state.discountSergio - state.amicarSergio;
    const marginNet = net(totalMarginGross);
    const customerPayment = saleTotal - state.tradeInValue;
    const priceListFinalNet = net(priceListFinalGross);

    // Porcentajes: se calculan siempre desde las mismas cifras de arriba, no
    // se escriben a mano. Si el denominador es 0 devolvemos 0 en vez de NaN
    // para que la hoja impresa nunca muestre "NaN%".
    const pct = (numerador: number, denominador: number) => (denominador ? (numerador / denominador) * 100 : 0);
    const aporteMarca = state.amicarMarca + state.aporteAdicMarca + state.aportePtteMarca;
    const costoCasa = state.discountSergio + state.amicarSergio;
    const rebajaTotalCliente = state.brandBonusGross + totalDiscounts;

    return {
      priceListFinalGross,
      priceListFinalNet,
      invoiceableGross,
      invoiceableNet,
      nonInvoiceable,
      totalIncome,
      totalDiscounts,
      saleTotal,
      vehicleMarginGross,
      totalMarginGross,
      marginNet,
      customerPayment,
      aporteMarca,
      costoCasa,
      rebajaTotalCliente,
      marginRatio: priceListFinalGross ? totalMarginGross / priceListFinalGross : 0,
      // --- Porcentajes comerciales ---
      pctBonoMarca: pct(state.brandBonusGross, state.priceListGross),
      pctRebajaCliente: pct(rebajaTotalCliente, state.priceListGross),
      pctDescuentos: pct(totalDiscounts, totalIncome),
      pctAporteMarca: pct(aporteMarca, state.priceListGross),
      pctCostoCasa: pct(costoCasa, state.priceListGross),
      pctNoFacturables: pct(nonInvoiceable, totalIncome),
      pctRentabilidadLista: pct(totalMarginGross, priceListFinalGross),
      pctRentabilidadVenta: pct(totalMarginGross, saleTotal),
      pctMargenNeto: pct(marginNet, net(saleTotal)),
      pctCredito: pct(state.creditMargin, totalMarginGross),
      pctRetoma: pct(state.tradeInValue, saleTotal)
    };
  }, [state]);

  const siiSalePrice = state.salePriceWithVat || totals.priceListFinalGross;

  // Precios tal como quedaron guardados desde la lista cargada, para poder
  // contrastar la hoja contra su origen sin salir de la pantalla.
  const preciosOrigen = selectedVehicle?.prices ?? [];

  // Las filas del informe, en el MISMO orden y con las MISMAS etiquetas
  // del informe oficial de Sergio Escobar. Un solo lugar las define para
  // que la pantalla, la impresion y el correo no se desalineen nunca.
  const filasIngresos: PrintRow[] = [
    { label: "Precio Lista Unidad", value: state.priceListGross, neto: net(state.priceListGross) },
    { label: "- ZQDA (Bono Marca)", value: state.brandBonusGross, neto: net(state.brandBonusGross) },
    { label: "Precio de Lista Final", value: totals.priceListFinalGross, neto: totals.priceListFinalNet, strong: true },
    { label: "+ Flete", value: state.fleteOsorno, neto: net(state.fleteOsorno) },
    { label: "+ Pisos de goma", value: state.rubberFloor, neto: net(state.rubberFloor) },
    { label: "+ Set de seguridad", value: state.safetyKit, neto: net(state.safetyKit) },
    { label: "+ Trins", value: state.trins, neto: net(state.trins) },
    { label: "Inscripcion", value: state.registration, neto: net(state.registration) },
    { label: "Imp. Fuentes Movs.", value: state.greenTax, neto: net(state.greenTax) },
    { label: "Seguro Obligatorio", value: state.soap, neto: net(state.soap) },
    { label: "Permiso de Circulacion", value: state.circulationPermit, neto: net(state.circulationPermit) },
    { label: "+ Accesorios", value: state.accGrabado, neto: net(state.accGrabado) },
    { label: "+ Mantencion", value: state.maintenance, neto: net(state.maintenance) },
    { label: "+ Intereses", value: state.interests, neto: net(state.interests) },
    { label: "+ Otros", value: state.others, neto: net(state.others) }
  ];

  const filasDescuentos: PrintRow[] = [
    { label: "ZQDV Desct. S. Escobar", value: state.discountSergio, neto: net(state.discountSergio) },
    { label: "Z104 Amicar S. Escobar", value: state.amicarSergio, neto: net(state.amicarSergio) },
    { label: "Z127 Amicar Marca", value: state.amicarMarca, neto: net(state.amicarMarca) },
    { label: "Z126 Aporte adic. Marca", value: state.aporteAdicMarca, neto: net(state.aporteAdicMarca) },
    { label: "Z124 Aporte Ptte. Marca", value: state.aportePtteMarca, neto: net(state.aportePtteMarca) }
  ];

  // Un solo lugar define los porcentajes: se usan igual en pantalla, en el
  // correo a jefatura y en la hoja impresa.
  const filasPorcentajes: PrintRow[] = [
    { label: "Bono marca sobre lista", value: pctText(totals.pctBonoMarca) },
    { label: "Rebaja total al cliente sobre lista", value: pctText(totals.pctRebajaCliente), strong: true },
    { label: "Aporte marca sobre lista", value: pctText(totals.pctAporteMarca) },
    { label: "Costo automotora sobre lista", value: pctText(totals.pctCostoCasa) },
    { label: "Descuentos sobre total ingresos", value: pctText(totals.pctDescuentos) },
    { label: "No facturables sobre total ingresos", value: pctText(totals.pctNoFacturables) },
    { label: "Rentabilidad sobre lista final", value: pctText(totals.pctRentabilidadLista), strong: true },
    { label: "Rentabilidad sobre precio de venta", value: pctText(totals.pctRentabilidadVenta), strong: true },
    { label: "Margen neto sobre venta neta", value: pctText(totals.pctMargenNeto) },
    { label: "Aporte del credito al margen", value: pctText(totals.pctCredito) },
    { label: "Retoma sobre precio de venta", value: pctText(totals.pctRetoma) }
  ];
  const estimatedPermit = estimateCirculationPermit(totals.priceListFinalNet, state.invoiceDate);
  const lasCondesText = `Valor neto: ${totals.priceListFinalNet} | Fecha factura: ${state.invoiceDate}${estimatedPermit ? ` | Permiso estimado: ${estimatedPermit}` : ""}`;
  const siiText = `Marca: ${selectedVehicle?.brandName ?? ""} | Modelo: ${selectedVehicle?.modelName ?? ""} ${selectedVehicle?.versionName ?? ""} | CIT: ${selectedVehicle?.citCode ?? "PENDIENTE"} | Precio venta con IVA: ${siiSalePrice}`;
  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  // Imprimir / Descargar PDF: usa el dialogo del navegador (destino "Guardar como PDF").
  // Ajustamos el titulo del documento para que el PDF quede con un nombre util.
  const printSheet = () => {
    const previousTitle = document.title;
    const cleanLabel = (selectedVehicle?.label ?? "vehiculo").replace(/[^a-zA-Z0-9]+/g, "-");
    const cleanClient = (state.customerName || "cliente").replace(/[^a-zA-Z0-9]+/g, "-");
    document.title = `Rentabilidad_${cleanLabel}_${cleanClient}_${state.invoiceDate || today}`;
    window.print();
    window.setTimeout(() => {
      document.title = previousTitle;
    }, 1500);
  };

  // Genera el HTML del correo agrupado en secciones (igual que la hoja en pantalla),
  // para que jefatura lo lea y autorice facilmente.
  const buildEmailHtml = () => {
    type Row = { label: string; value: number | string; neto?: number; strong?: boolean };
    const money = (value: number | string) => (typeof value === "number" ? formatCLP(value) : value);
    const th = "padding:6px 10px;background:#111827;color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:.04em;text-align:left";
    const thR = th + ";text-align:right";
    const td = "padding:5px 10px;border-bottom:1px solid #e5e7eb;font-size:13px";
    const tdR = td + ";text-align:right;white-space:nowrap";
    const section = (title: string, rows: Row[], showNeto: boolean) => {
      const head = showNeto
        ? `<tr><th style="${th}">${title}</th><th style="${thR}">Bruto</th><th style="${thR}">Neto</th></tr>`
        : `<tr><th style="${th}">${title}</th><th style="${thR}">Monto</th></tr>`;
      const body = rows
        .map((row) => {
          const strong = row.strong ? "font-weight:bold;background:#f3f4f6;" : "";
          return showNeto
            ? `<tr><td style="${td};${strong}">${row.label}</td><td style="${tdR};${strong}">${money(row.value)}</td><td style="${tdR};${strong}">${row.neto != null ? formatCLP(row.neto) : ""}</td></tr>`
            : `<tr><td style="${td};${strong}">${row.label}</td><td style="${tdR};${strong}">${money(row.value)}</td></tr>`;
        })
        .join("");
      return `<table style="width:100%;border-collapse:collapse;margin:0 0 18px">${head}${body}</table>`;
    };

    const ingresos: Row[] = [
      ...filasIngresos.map((f) => ({ label: f.label, value: f.value, neto: f.neto, strong: f.strong })),
      { label: "TOTAL BRUTO", value: totals.totalIncome, neto: net(totals.totalIncome), strong: true }
    ];
    const noFact: Row[] = [
      { label: "Inscripcion", value: state.registration },
      { label: "Imp. Fuentes Movs. (verde)", value: state.greenTax },
      { label: "Seguro Obligatorio (SOAP)", value: state.soap },
      { label: "Permiso Circulacion", value: state.circulationPermit },
      { label: "Total no facturables", value: totals.nonInvoiceable, strong: true }
    ];
    const descuentos: Row[] = [
      ...filasDescuentos.map((f) => ({ label: f.label, value: f.value, neto: f.neto, strong: f.strong })),
      { label: "TOTAL DESCUENTOS", value: totals.totalDiscounts, neto: net(totals.totalDiscounts), strong: true }
    ];
    const resumen: Row[] = [
      { label: "Total ingresos", value: totals.totalIncome },
      { label: "Total descuentos", value: totals.totalDiscounts },
      { label: "Precio de venta", value: totals.saleTotal, strong: true },
      { label: "Retoma", value: state.tradeInValue },
      { label: "A pagar cliente", value: totals.customerPayment, strong: true }
    ];
    const margenes: Row[] = [
      { label: "Margen unidad %", value: `${state.marginPercent}%` },
      { label: "Margen vehiculo bruto", value: totals.vehicleMarginGross },
      { label: "Utilidad credito", value: state.creditMargin },
      { label: "Margen total bruto", value: totals.totalMarginGross, strong: true },
      { label: "Margen total neto", value: totals.marginNet },
      { label: "Rentabilidad", value: `${(totals.marginRatio * 100).toFixed(2)}%`, strong: true }
    ];

    return `<div style="font-family:Arial,sans-serif;color:#111827;max-width:660px;margin:0 auto">
      <h2 style="margin:0 0 4px">Solicitud de autorizacion — Hoja de Rentabilidad</h2>
      <p style="margin:0 0 10px;color:#b45309;font-weight:bold">Sergio Escobar Automotriz</p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:13px;color:#374151;line-height:1.6">
        <div><strong>Vehiculo:</strong> ${selectedVehicle?.label ?? "No seleccionado"}</div>
        <div><strong>Codigo CIT:</strong> ${selectedVehicle?.citCode ?? "Pendiente"} &nbsp;·&nbsp; <strong>Precio venta c/IVA (SII):</strong> ${formatCLP(siiSalePrice)}</div>
        <div><strong>Cliente:</strong> ${state.customerName || "-"} &nbsp;·&nbsp; <strong>Nota venta:</strong> ${state.orderNumber || "-"} &nbsp;·&nbsp; <strong>Interno:</strong> ${state.internalNumber || "-"}</div>
        <div><strong>Fecha factura:</strong> ${state.invoiceDate || "-"}</div>
      </div>
      <p style="margin:0 0 14px;color:#374151;font-size:13px">Estimada jefatura, se solicita <strong>autorizacion</strong> de la siguiente hoja de rentabilidad:</p>
      ${section("Ingresos", ingresos, true)}
      ${section("No facturables", noFact, false)}
      ${section("Descuentos", descuentos, true)}
      ${section("Resumen de venta", resumen, false)}
      ${section("Margenes", margenes, false)}
      ${section("Porcentajes", filasPorcentajes.map((fila) => ({ label: fila.label, value: fila.value, strong: fila.strong })), false)}
      ${state.notes ? `<p style="margin-top:6px;color:#374151;font-size:13px"><strong>Notas:</strong> ${state.notes}</p>` : ""}
      <p style="margin-top:18px;color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:8px">Documento generado por Panel360 Autos · Sistema creado por Victor Herrera</p>
    </div>`;
  };

  const handleSendEmail = async () => {
    setEmailStatus("");
    if (!selectedVehicle) {
      setEmailStatus("⚠️ Selecciona un vehiculo primero.");
      return;
    }
    const to = state.jefaturaEmail.trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setEmailStatus("⚠️ Ingresa el correo de jefatura para enviar la autorizacion.");
      return;
    }
    setSendingEmail(true);
    try {
      const result = await sendRentabilidadEmail({
        to,
        subject: `Autorizacion hoja de rentabilidad - ${selectedVehicle?.label ?? ""}${state.customerName ? ` - ${state.customerName}` : ""}`.trim(),
        html: buildEmailHtml()
      });
      if (result.ok) {
        setEmailStatus(`✅ Enviado a jefatura (${to})`);
      } else if (result.reason === "RESEND_NOT_CONFIGURED") {
        setEmailStatus("⚠️ El envio de correo aun no esta activado en el servidor.");
      } else {
        setEmailStatus(`No se pudo enviar: ${result.reason ?? "error desconocido"}`);
      }
    } catch (error) {
      setEmailStatus(error instanceof Error ? error.message : "No se pudo enviar el correo.");
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSaveSheet = async () => {
    setSaveStatus("");
    if (!selectedVehicle) {
      setSaveStatus("⚠️ Selecciona un vehiculo antes de guardar.");
      return;
    }
    setSaving(true);
    try {
      const result = await saveProfitabilitySheet({
        versionId: state.selectedVersionId || null,
        vehicleLabel: selectedVehicle.label,
        customerName: state.customerName || null,
        customerEmail: state.customerEmail || null,
        orderNumber: state.orderNumber || null,
        internalNumber: state.internalNumber || null,
        invoiceDate: state.invoiceDate || null,
        salePrice: totals.saleTotal,
        marginTotal: totals.totalMarginGross,
        data: JSON.stringify(state)
      });
      if (result.ok) {
        setSaveStatus("✅ Hoja guardada");
        router.refresh();
      } else if (result.reason === "TABLA_NO_CREADA") {
        setSaveStatus("⚠️ Falta activar el guardado en la base de datos (ejecutar el SQL de despliegue).");
      } else {
        setSaveStatus(`No se pudo guardar: ${result.reason ?? "error"}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const reopenSheet = (sheet: SavedSheetSummary) => {
    try {
      const parsed = JSON.parse(sheet.data) as FormState;
      setState({ ...defaultState, ...parsed });
      setSaveStatus(`Hoja de ${sheet.vehicleLabel} reabierta.`);
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setSaveStatus("No se pudo reabrir la hoja (datos invalidos).");
    }
  };

  const removeSheet = async (id: string) => {
    await deleteProfitabilitySheet(id);
    router.refresh();
  };

  const consultPermit = async () => {
    setLoadingPermit(true);
    setPermitStatus("");
    try {
      const response = await fetch("/api/taxes/permit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          netPrice: totals.priceListFinalNet,
          invoiceDate: state.invoiceDate
        })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message ?? "No se pudo consultar Las Condes.");
      update("circulationPermit", result.amount);
      if (result.isEstimated) {
        setPermitStatus(`⚠️ VALOR ESTIMADO REFERENCIAL: ${formatCLP(result.amount)} (${result.message})`);
      } else {
        setPermitStatus(`✅ VALOR OFICIAL CONFIRMADO (Las Condes API): ${formatCLP(result.amount)}`);
      }
    } catch (error) {
      setPermitStatus(error instanceof Error ? error.message : "No se pudo consultar Las Condes.");
    } finally {
      setLoadingPermit(false);
    }
  };

  const consultGreenTax = async () => {
    setLoadingGreenTax(true);
    setGreenTaxStatus("");
    try {
      if (!selectedVehicle?.citCode) throw new Error("Esta versión no tiene Código CIT cargado.");
      const response = await fetch("/api/taxes/green", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          citCode: selectedVehicle.citCode,
          salePriceWithVat: siiSalePrice,
          calculationDate: state.invoiceDate
        })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message ?? "No se pudo calcular el impuesto verde.");
      update("greenTax", result.amountClp);
      const detail = result.exempt
        ? "Exento de Impuesto Verde"
        : `${Number(result.taxUtm).toFixed(4)} UTM (UTM: ${formatCLP(result.utm)})`;
      setGreenTaxStatus(`✅ VALOR OFICIAL CONFIRMADO (Listado SII): ${formatCLP(result.amountClp)} — ${detail}`);
    } catch (error) {
      setGreenTaxStatus(error instanceof Error ? error.message : "No se pudo calcular el impuesto verde.");
    } finally {
      setLoadingGreenTax(false);
    }
  };

  return (
    <div className="grid gap-6">
      <section className="panel no-print rounded-lg p-5">
        <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="grid gap-3 md:grid-cols-2">
            {!hideVehicleSelector ? (
              <div className="grid gap-2 md:col-span-2">
                <span className="text-xs font-black uppercase text-steel">Vehiculo</span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setBrandFilter("")}
                    className={
                      brandFilter === ""
                        ? "rounded-full border border-teal-600 bg-teal-600 px-3 py-1 text-xs font-bold text-white"
                        : "rounded-full border border-graphite/20 px-3 py-1 text-xs font-bold text-graphite transition hover:bg-mist"
                    }
                  >
                    Todas
                  </button>
                  {brandOptions.map((brand) => (
                    <button
                      key={brand}
                      type="button"
                      onClick={() => setBrandFilter((current) => (current === brand ? "" : brand))}
                      className={
                        brandFilter === brand
                          ? "rounded-full border border-teal-600 bg-teal-600 px-3 py-1 text-xs font-bold text-white"
                          : "rounded-full border border-graphite/20 px-3 py-1 text-xs font-bold text-graphite transition hover:bg-mist"
                      }
                    >
                      {brand}
                    </button>
                  ))}
                </div>
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" aria-hidden="true" />
                  <input
                    className="input pl-9"
                    value={vehicleQuery}
                    onChange={(event) => setVehicleQuery(event.target.value)}
                    placeholder="Buscar por marca, modelo, version o Codigo CIT..."
                    aria-label="Buscar vehiculo"
                    autoComplete="off"
                  />
                </span>
                <select className="input" value={state.selectedVersionId} onChange={(event) => selectVehicle(event.target.value)} aria-label="Seleccionar version">
                  <option value="">
                    {filteredVehicles.length ? "Selecciona marca, modelo y version" : "Sin resultados para el filtro"}
                  </option>
                  {filteredVehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.label} {vehicle.citCode ? `| CIT ${vehicle.citCode}` : "| CIT pendiente"}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <TextInput label="Nota venta" value={state.orderNumber} onChange={(value) => update("orderNumber", value)} placeholder="Nro. nota venta" />
            <TextInput label="Interno" value={state.internalNumber} onChange={(value) => update("internalNumber", value)} placeholder="Interno o unidad" />
            <TextInput label="Cliente" value={state.customerName} onChange={(value) => update("customerName", value)} placeholder="Nombre cliente" />
            <TextInput label="Correo cliente" type="email" value={state.customerEmail} onChange={(value) => update("customerEmail", value)} placeholder="correo@cliente.cl" />
            <TextInput label="Correo jefatura (autorizacion)" type="email" value={state.jefaturaEmail} onChange={(value) => update("jefaturaEmail", value)} placeholder="jefatura@sergioescobar.cl" />
            <TextInput label="Fecha factura" type="date" value={state.invoiceDate} onChange={(value) => update("invoiceDate", value)} />
          </div>

          <div className="rounded-lg border border-graphite/10 bg-white p-4">
            <p className="text-xs font-black uppercase text-copper">Datos para consultas externas</p>
            <div className="mt-3 grid gap-3 text-sm font-semibold text-graphite">
              <div>
                <p className="font-black text-ink">Permiso circulacion</p>
                <p>Usar Precio Lista Final neto y fecha factura de hoy.</p>
                <p className="mt-1 rounded-lg bg-mist p-2 text-xs">{lasCondesText}</p>
              </div>
              <div>
                <p className="font-black text-ink">Imp. Fuentes Movs.</p>
                <p>Usar marca, modelo, Codigo CIT y precio venta con IVA.</p>
                <p className="mt-1 rounded-lg bg-mist p-2 text-xs">{siiText}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary" type="button" onClick={consultPermit} disabled={loadingPermit || !totals.priceListFinalNet}>
                  {loadingPermit ? "Consultando..." : "Consultar permiso"}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => copyText(lasCondesText)}>
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  Copiar permiso
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => estimatedPermit !== null && update("circulationPermit", estimatedPermit)} disabled={estimatedPermit === null}>
                  Usar estimado
                </button>
                <a className="btn btn-secondary" href="https://www.lascondesonline.cl/Permisos%20Circulacion/asp/convalper.asp" target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Las Condes
                </a>
                <button className="btn btn-primary" type="button" onClick={consultGreenTax} disabled={loadingGreenTax || !selectedVehicle?.citCode || !siiSalePrice}>
                  {loadingGreenTax ? "Calculando..." : "Calcular impuesto verde"}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => copyText(siiText)}>
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  Copiar SII
                </button>
                <a className="btn btn-secondary" href="https://www4.sii.cl/calcImpVehiculoNuevoInternet/internet.html" target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  SII
                </a>
              </div>
              {permitStatus ? <p className="rounded-lg bg-mist p-2 text-xs font-bold text-graphite">{permitStatus}</p> : null}
              {greenTaxStatus ? <p className="rounded-lg bg-mist p-2 text-xs font-bold text-graphite">{greenTaxStatus}</p> : null}
            </div>
          </div>
        </div>
      </section>

      <section className="print-page panel rounded-lg p-5">
        <div className="flex flex-col gap-4 border-b border-graphite/10 pb-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-black uppercase text-copper">Informe de rentabilidad</p>
            <h2 className="mt-1 text-2xl font-black text-ink">{selectedVehicle?.label ?? "Vehiculo no seleccionado"}</h2>
            <p className="mt-1 text-sm font-semibold text-steel">
              Nota venta: {state.orderNumber || "-"} | Interno: {state.internalNumber || "-"} | Fecha factura: {state.invoiceDate}
            </p>
            <p className="mt-1 text-sm font-semibold text-steel">
              Cliente: {state.customerName || "-"} | Codigo CIT: {selectedVehicle?.citCode ?? "Pendiente en lista"}
            </p>
          </div>
          <div className="no-print flex flex-col items-end gap-2">
            <div className="flex flex-wrap justify-end gap-2">
              <button className="btn btn-secondary" type="button" onClick={() => setState({ ...defaultState, invoiceDate: today })}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Limpiar
              </button>
              <button className="btn btn-primary" type="button" onClick={handleSaveSheet} disabled={saving}>
                <Save className="h-4 w-4" aria-hidden="true" />
                {saving ? "Guardando..." : "Guardar hoja"}
              </button>
              <button className="btn btn-secondary" type="button" onClick={printSheet}>
                <Printer className="h-4 w-4" aria-hidden="true" />
                Imprimir
              </button>
              <button className="btn btn-primary" type="button" onClick={printSheet} title='En el dialogo elige destino "Guardar como PDF"'>
                <Download className="h-4 w-4" aria-hidden="true" />
                Descargar PDF
              </button>
              <button className="btn btn-secondary" type="button" onClick={handleSendEmail} disabled={sendingEmail}>
                <Mail className="h-4 w-4" aria-hidden="true" />
                {sendingEmail ? "Enviando..." : "Enviar a jefatura"}
              </button>
            </div>
            {emailStatus ? <p className="text-xs font-bold text-graphite">{emailStatus}</p> : null}
            {saveStatus ? <p className="text-xs font-bold text-graphite">{saveStatus}</p> : null}
          </div>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_0.8fr]">
          <div className="grid gap-5">
            <div className="print-avoid rounded-lg border border-graphite/10 bg-white p-4">
              <h3 className="text-lg font-black text-ink">Ingresos</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <MoneyInput label="Precio Lista Unidad" value={state.priceListGross} onChange={(value) => update("priceListGross", value)} />
                <MoneyInput label="ZQDA Bono Marca" value={state.brandBonusGross} onChange={(value) => update("brandBonusGross", value)} />
                <MoneyInput label="Flete Osorno" value={state.fleteOsorno} onChange={(value) => update("fleteOsorno", value)} />
                <MoneyInput label="Pisos de goma" value={state.rubberFloor} onChange={(value) => update("rubberFloor", value)} />
                <MoneyInput label="Set de Seguridad" value={state.safetyKit} onChange={(value) => update("safetyKit", value)} />
                <MoneyInput label="Trins" value={state.trins} onChange={(value) => update("trins", value)} />
                <MoneyInput label="ACC Grabado PPU + Gardex" value={state.accGrabado} onChange={(value) => update("accGrabado", value)} />
                <MoneyInput label="Mantencion" value={state.maintenance} onChange={(value) => update("maintenance", value)} />
                <MoneyInput label="Intereses / gastos" value={state.interests} onChange={(value) => update("interests", value)} />
                <MoneyInput label="Otros" value={state.others} onChange={(value) => update("others", value)} />
              </div>
            </div>

            <div className="print-avoid rounded-lg border border-graphite/10 bg-white p-4">
              <h3 className="text-lg font-black text-ink">No facturables</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <MoneyInput label="Inscripcion" value={state.registration} onChange={(value) => update("registration", value)} />
                <MoneyInput label="Imp. Fuentes Movs." value={state.greenTax} onChange={(value) => update("greenTax", value)} helper="Impuesto verde informado por SII" />
                <MoneyInput label="Seguro Obligatorio" value={state.soap} onChange={(value) => update("soap", value)} />
                <MoneyInput label="Permiso Circulacion" value={state.circulationPermit} onChange={(value) => update("circulationPermit", value)} helper="Resultado de Las Condes" />
              </div>
            </div>

            <div className="print-avoid rounded-lg border border-graphite/10 bg-white p-4">
              <h3 className="text-lg font-black text-ink">Descuentos</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <MoneyInput label="ZQDV Desct. S. Escobar" value={state.discountSergio} onChange={(value) => update("discountSergio", value)} />
                <MoneyInput label="Z104 Amicar S. Escobar" value={state.amicarSergio} onChange={(value) => update("amicarSergio", value)} />
                <MoneyInput label="Z127 Amicar Marca" value={state.amicarMarca} onChange={(value) => update("amicarMarca", value)} />
                <MoneyInput label="Z126 Aporte adic. Marca" value={state.aporteAdicMarca} onChange={(value) => update("aporteAdicMarca", value)} />
                <MoneyInput label="Z124 Aporte Ptte. Marca" value={state.aportePtteMarca} onChange={(value) => update("aportePtteMarca", value)} />
                <MoneyInput label="Retoma" value={state.tradeInValue} onChange={(value) => update("tradeInValue", value)} />
              </div>
            </div>
          </div>

          <aside className="grid gap-5">
            <div className="print-avoid rounded-lg border border-graphite/10 bg-white p-4">
              <h3 className="text-lg font-black text-ink">Resumen</h3>
              <div className="mt-4 grid gap-3">
                <SummaryLine label="Precio Lista Final bruto" value={totals.priceListFinalGross} />
                <SummaryLine label="Precio Lista Final neto" value={totals.priceListFinalNet} />
                <SummaryLine label="Ingresos facturables bruto" value={totals.invoiceableGross} />
                <SummaryLine label="Ingresos facturables neto" value={totals.invoiceableNet} />
                <SummaryLine label="No facturables" value={totals.nonInvoiceable} />
                <SummaryLine label="Total ingresos" value={totals.totalIncome} />
                <SummaryLine label="Total descuentos" value={totals.totalDiscounts} />
                <SummaryLine label="Precio de venta" value={totals.saleTotal} strong />
                <SummaryLine label="A pagar cliente" value={totals.customerPayment} />
              </div>
            </div>

            <div className="print-avoid rounded-lg border border-graphite/10 bg-white p-4">
              <h3 className="text-lg font-black text-ink">Margenes</h3>
              <div className="mt-4 grid gap-4">
                <label className="grid gap-1.5">
                  <span className="text-xs font-black uppercase text-steel">Margen unidad %</span>
                  <input className="input" type="number" value={state.marginPercent} onChange={(event) => update("marginPercent", Number.parseFloat(event.target.value) || 0)} />
                </label>
                <MoneyInput label="Utilidad credito" value={state.creditMargin} onChange={(value) => update("creditMargin", value)} />
                <div className="grid gap-3">
                  <SummaryLine label="Margen vehiculo bruto" value={totals.vehicleMarginGross} />
                  <SummaryLine label="Margen total bruto" value={totals.totalMarginGross} strong />
                  <SummaryLine label="Margen total neto" value={totals.marginNet} />
                  <SummaryLine label="Rentabilidad" value={`${(totals.marginRatio * 100).toFixed(2)}%`} />
                </div>
              </div>
            </div>

            <div className="print-avoid rounded-lg border border-graphite/10 bg-white p-4">
              <h3 className="text-lg font-black text-ink">Retoma</h3>
              <p className="mt-1 text-xs font-semibold text-steel">Los datos del vehiculo que entrega el cliente. Salen en la caja RETOMA del informe.</p>
              <div className="mt-4 grid gap-4">
                <TextInput label="Marca" value={state.tradeInBrand} onChange={(value) => update("tradeInBrand", value)} />
                <TextInput label="Modelo" value={state.tradeInModel} onChange={(value) => update("tradeInModel", value)} />
                <TextInput label="Patente" value={state.tradeInPlate} onChange={(value) => update("tradeInPlate", value)} />
                <MoneyInput label="Tasacion" value={state.tradeInAppraisal} onChange={(value) => update("tradeInAppraisal", value)} />
                <MoneyInput label="Bono retoma" value={state.tradeInBonus} onChange={(value) => update("tradeInBonus", value)} />
                <MoneyInput label="Valor retoma" value={state.tradeInValue} onChange={(value) => update("tradeInValue", value)} />
              </div>
            </div>

            <div className="print-avoid rounded-lg border border-graphite/10 bg-white p-4">
              <h3 className="text-lg font-black text-ink">Credito</h3>
              <div className="mt-4 grid gap-4">
                <MoneyInput label="Saldo precio" value={state.creditBalance} onChange={(value) => update("creditBalance", value)} />
                <MoneyInput label="Prepago sin 2%" value={state.creditPrepayment} onChange={(value) => update("creditPrepayment", value)} />
                <MoneyInput label="Spread" value={state.creditSpread} onChange={(value) => update("creditSpread", value)} />
                <MoneyInput label="Margen credito" value={state.creditMargin} onChange={(value) => update("creditMargin", value)} />
              </div>
            </div>

            <div className="print-avoid rounded-lg border border-graphite/10 bg-white p-4">
              <h3 className="text-lg font-black text-ink">Porcentajes</h3>
              <p className="mt-1 text-xs font-semibold text-steel">Todos salen de las cifras de esta hoja; ninguno se escribe a mano.</p>
              <div className="mt-4 grid gap-3">
                {filasPorcentajes.map((fila) => (
                  <SummaryLine key={fila.label} label={fila.label} value={fila.value} strong={fila.strong} />
                ))}
              </div>
            </div>

            <div className="print-avoid rounded-lg border border-graphite/10 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-black text-ink">Lista de precios origen</h3>
                <a className="btn btn-secondary no-print px-2 py-1 text-xs" href="/historial-precios">
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  Historial
                </a>
              </div>
              {preciosOrigen.length === 0 ? (
                <p className="mt-3 text-xs font-semibold text-steel">
                  {selectedVehicle
                    ? "Este vehiculo no tiene precios cargados para el mes en uso."
                    : "Selecciona un vehiculo para ver de que lista salen sus precios."}
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="data-table min-w-[420px]">
                    <thead>
                      <tr>
                        <th>Precio</th>
                        <th>Canal</th>
                        <th>IVA</th>
                        <th>Vigencia</th>
                        <th>Estado</th>
                        <th>Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preciosOrigen.map((precio, index) => (
                        <tr key={`origen-pantalla-${index}`}>
                          <td className="font-black text-ink">{ETIQUETA_PRECIO[precio.priceType] ?? precio.priceType}</td>
                          <td>{ETIQUETA_CANAL[precio.channel ?? ""] ?? precio.channel ?? "-"}</td>
                          <td>{precio.hasIva ? "Neto (+IVA)" : "Con IVA"}</td>
                          <td>{fechaCorta(precio.effectiveFrom)}</td>
                          <td>{precio.status ?? "-"}</td>
                          <td className="font-black text-ink">{formatCLP(precio.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <a className="btn btn-secondary no-print px-2 py-1 text-xs" href="/actualizaciones">
                  Ver listas cargadas
                </a>
                <a className="btn btn-secondary no-print px-2 py-1 text-xs" href="/cambios">
                  Que cambio este mes
                </a>
              </div>
            </div>

            <div className="print-avoid rounded-lg border border-graphite/10 bg-white p-4">
              <h3 className="text-lg font-black text-ink">Impuesto verde SII</h3>
              <div className="mt-4 grid gap-4">
                <MoneyInput label="Precio venta con IVA" value={state.salePriceWithVat} onChange={(value) => update("salePriceWithVat", value)} />
                <SummaryLine label="Marca" value={selectedVehicle?.brandName ?? "-"} />
                <SummaryLine label="Modelo" value={selectedVehicle ? `${selectedVehicle.modelName} ${selectedVehicle.versionName}` : "-"} />
                <SummaryLine label="Codigo CIT" value={selectedVehicle?.citCode ?? "Pendiente"} />
                <button className="btn btn-primary no-print" type="button" onClick={consultGreenTax} disabled={loadingGreenTax || !selectedVehicle?.citCode || !siiSalePrice}>
                  {loadingGreenTax ? "Calculando..." : "Calcular Imp. Fuentes Movs."}
                </button>
                {greenTaxStatus ? <p className="text-xs font-bold leading-5 text-steel">{greenTaxStatus}</p> : null}
              </div>
            </div>

            <label className="print-avoid grid gap-1.5 rounded-lg border border-graphite/10 bg-white p-4">
              <span className="text-xs font-black uppercase text-steel">Notas internas</span>
              <textarea className="input min-h-28" value={state.notes} onChange={(event) => update("notes", event.target.value)} />
            </label>
          </aside>
        </div>

        <div className="mt-5 hidden border-t border-graphite/10 pt-8 print:block">
          <p className="text-sm font-semibold text-ink">Nombre y firma jefe sucursal:</p>
          <div className="mt-10 h-px w-80 bg-graphite/40" />
        </div>
      </section>

      {!hideVehicleSelector ? (
        <section className="panel no-print rounded-lg p-5">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-copper" aria-hidden="true" />
            <h3 className="text-lg font-black text-ink">Hojas guardadas</h3>
            <span className="rounded-full bg-mist px-2 py-0.5 text-xs font-bold text-steel">{savedSheets.length}</span>
          </div>
          {savedSheets.length === 0 ? (
            <p className="mt-3 text-sm font-semibold text-steel">
              Aun no hay hojas guardadas. Completa una hoja y presiona <strong>Guardar hoja</strong> para almacenarla y poder reabrirla despues.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-black uppercase text-steel">
                    <th className="pb-2 pr-3">Fecha</th>
                    <th className="pb-2 pr-3">Vehiculo</th>
                    <th className="pb-2 pr-3">Cliente</th>
                    <th className="pb-2 pr-3 text-right">Precio venta</th>
                    <th className="pb-2 pr-3 text-right">Margen</th>
                    <th className="pb-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {savedSheets.map((sheet) => (
                    <tr key={sheet.id} className="border-t border-graphite/10">
                      <td className="py-2 pr-3 font-semibold text-steel">{new Date(sheet.createdAt).toLocaleDateString("es-CL")}</td>
                      <td className="py-2 pr-3 font-bold text-ink">{sheet.vehicleLabel}</td>
                      <td className="py-2 pr-3 font-semibold text-graphite">{sheet.customerName || "-"}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-graphite">{sheet.salePrice != null ? formatCLP(sheet.salePrice) : "-"}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-graphite">{sheet.marginTotal != null ? formatCLP(sheet.marginTotal) : "-"}</td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button className="btn btn-secondary px-2 py-1 text-xs" type="button" onClick={() => reopenSheet(sheet)}>
                            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                            Reabrir
                          </button>
                          <button className="btn btn-secondary px-2 py-1 text-xs" type="button" onClick={() => removeSheet(sheet.id)} aria-label="Eliminar hoja">
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* ============================================================
          INFORME DE RENTABILIDAD (solo al imprimir)
          ============================================================
          Formato calcado del informe oficial de Sergio Escobar: mismo
          orden, mismas etiquetas y las dos columnas BRUTO / NETO. Los
          conceptos que se suman llevan "+" adelante y los no facturables
          van sin signo, igual que en el original. */}
      <section className="print-report">
        <div className="pr-head">
          <h1>INFORME DE RENTABILIDAD</h1>
          <p className="pr-brand">Sergio Escobar Automotriz</p>
        </div>

        <div className="pr-pedido">
          <div>
            <strong>PEDIDO DE VENTA:</strong> {state.orderNumber || "-"}
          </div>
          <div>
            <strong>INT:</strong> {state.internalNumber || "-"}
          </div>
        </div>

        <p className="pr-vehiculo">
          {selectedVehicle?.label ?? "Vehiculo no seleccionado"}
          {selectedVehicle?.citCode ? " · CIT: " + selectedVehicle.citCode : ""}
          {state.customerName ? " · Cliente: " + state.customerName : ""}
          {state.invoiceDate ? " · Factura: " + state.invoiceDate : ""}
        </p>

        <div className="pr-cuerpo">
          <div className="pr-col-principal">
            <table className="pr-table">
              <thead>
                <tr>
                  <th>INGRESOS</th>
                  <th className="pr-amount">BRUTO</th>
                  <th className="pr-amount">NETO</th>
                </tr>
              </thead>
              <tbody>
                {filasIngresos.map((fila, indice) => (
                  <tr key={"ing-" + indice} className={fila.strong ? "pr-strong" : undefined}>
                    <td>{fila.label}</td>
                    <td className="pr-amount">{formatCLP(Number(fila.value))}</td>
                    <td className="pr-amount">{fila.neto != null ? formatCLP(fila.neto) : ""}</td>
                  </tr>
                ))}
                <tr className="pr-total">
                  <td>TOTAL BRUTO</td>
                  <td className="pr-amount">{formatCLP(totals.totalIncome)}</td>
                  <td className="pr-amount">{formatCLP(net(totals.totalIncome))}</td>
                </tr>
              </tbody>
            </table>

            <table className="pr-table">
              <thead>
                <tr>
                  <th>DESCUENTOS</th>
                  <th className="pr-amount">BRUTO</th>
                  <th className="pr-amount">NETO</th>
                </tr>
              </thead>
              <tbody>
                {filasDescuentos.map((fila, indice) => (
                  <tr key={"desc-" + indice} className={fila.strong ? "pr-strong" : undefined}>
                    <td>{fila.label}</td>
                    <td className="pr-amount">{formatCLP(Number(fila.value))}</td>
                    <td className="pr-amount">{fila.neto != null ? formatCLP(fila.neto) : ""}</td>
                  </tr>
                ))}
                <tr className="pr-total">
                  <td>TOTAL DESCUENTOS</td>
                  <td className="pr-amount">{formatCLP(totals.totalDiscounts)}</td>
                  <td className="pr-amount">{formatCLP(net(totals.totalDiscounts))}</td>
                </tr>
              </tbody>
            </table>

            <table className="pr-table">
              <thead>
                <tr>
                  <th>RESULTADO</th>
                  <th className="pr-amount">BRUTO</th>
                  <th className="pr-amount">NETO</th>
                </tr>
              </thead>
              <tbody>
                <tr className="pr-strong">
                  <td>PRECIO DE VENTA</td>
                  <td className="pr-amount">{formatCLP(totals.saleTotal)}</td>
                  <td className="pr-amount">{formatCLP(net(totals.saleTotal))}</td>
                </tr>
                <tr>
                  <td>Retoma</td>
                  <td className="pr-amount">{formatCLP(state.tradeInValue)}</td>
                  <td className="pr-amount">{formatCLP(net(state.tradeInValue))}</td>
                </tr>
                <tr className="pr-total">
                  <td>A PAGAR CLIENTE</td>
                  <td className="pr-amount">{formatCLP(totals.customerPayment)}</td>
                  <td className="pr-amount">{formatCLP(net(totals.customerPayment))}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="pr-col-lateral">
            <table className="pr-box">
              <thead>
                <tr>
                  <th colSpan={2}>RETOMA</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Marca</td>
                  <td>{state.tradeInBrand}</td>
                </tr>
                <tr>
                  <td>Modelo</td>
                  <td>{state.tradeInModel}</td>
                </tr>
                <tr>
                  <td>Patente</td>
                  <td>{state.tradeInPlate}</td>
                </tr>
                <tr>
                  <td>Tasacion</td>
                  <td>{formatCLP(state.tradeInAppraisal)}</td>
                </tr>
                <tr>
                  <td>Bono Retoma</td>
                  <td>{formatCLP(state.tradeInBonus)}</td>
                </tr>
                <tr>
                  <td>Valor Retoma</td>
                  <td>{formatCLP(state.tradeInValue)}</td>
                </tr>
              </tbody>
            </table>

            <table className="pr-box">
              <thead>
                <tr>
                  <th colSpan={2}>CREDITO</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Saldo Precio</td>
                  <td>{formatCLP(state.creditBalance)}</td>
                </tr>
                <tr>
                  <td>Retoma</td>
                  <td>{formatCLP(state.tradeInValue)}</td>
                </tr>
                <tr>
                  <td>Prepago sin 2%</td>
                  <td>{formatCLP(state.creditPrepayment)}</td>
                </tr>
                <tr>
                  <td>Spread</td>
                  <td>{formatCLP(state.creditSpread)}</td>
                </tr>
                <tr>
                  <td>Margen Cred.</td>
                  <td>{formatCLP(state.creditMargin)}</td>
                </tr>
              </tbody>
            </table>

            <table className="pr-box">
              <thead>
                <tr>
                  <th colSpan={2}>MARGENES</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Margen unidad</td>
                  <td>{state.marginPercent}%</td>
                </tr>
                <tr>
                  <td>Margen vehiculo</td>
                  <td>{formatCLP(totals.vehicleMarginGross)}</td>
                </tr>
                <tr>
                  <td>Margen total bruto</td>
                  <td>{formatCLP(totals.totalMarginGross)}</td>
                </tr>
                <tr>
                  <td>Margen total neto</td>
                  <td>{formatCLP(totals.marginNet)}</td>
                </tr>
              </tbody>
            </table>

            <table className="pr-box">
              <thead>
                <tr>
                  <th colSpan={2}>PORCENTAJES</th>
                </tr>
              </thead>
              <tbody>
                {filasPorcentajes.map((fila) => (
                  <tr key={"pct-" + fila.label}>
                    <td>{fila.label}</td>
                    <td>{fila.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {preciosOrigen.length > 0 ? (
          <table className="pr-table pr-origen">
            <thead>
              <tr>
                <th>LISTA DE PRECIOS ORIGEN</th>
                <th>Canal</th>
                <th>IVA</th>
                <th>Vigencia</th>
                <th>Estado</th>
                <th className="pr-amount">Monto</th>
              </tr>
            </thead>
            <tbody>
              {preciosOrigen.map((precio, index) => (
                <tr key={"origen-" + index}>
                  <td>{ETIQUETA_PRECIO[precio.priceType] ?? precio.priceType}</td>
                  <td>{ETIQUETA_CANAL[precio.channel ?? ""] ?? precio.channel ?? "-"}</td>
                  <td>{precio.hasIva ? "Neto (+IVA)" : "Con IVA"}</td>
                  <td>{fechaCorta(precio.effectiveFrom)}</td>
                  <td>{precio.status ?? "-"}</td>
                  <td className="pr-amount">{formatCLP(precio.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {state.notes ? (
          <p className="pr-notes">
            <strong>Notas:</strong> {state.notes}
          </p>
        ) : null}

        <div className="pr-sign">
          <div className="pr-sign-line" />
          <p>Nombre y firma jefe sucursal</p>
        </div>

        <p className="pr-foot">Panel360 Autos &middot; {today}</p>
      </section>
    </div>
  );
}
