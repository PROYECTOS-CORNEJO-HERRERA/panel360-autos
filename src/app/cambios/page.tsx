import { compararMeses, ETIQUETA_TIPO, type TipoCambio } from "@/lib/comparacion-meses";
import { formatCLP } from "@/lib/format";
import { EmptyState, PageHeader, Panel, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";

// ============================================================
// ¿QUE CAMBIO ESTE MES? (Bloque D)
// ============================================================
//
// Responde en pocos segundos la pregunta del ejecutivo comercial al
// empezar el mes: que subio, que bajo, que aparecio y que ya no esta.
// Todo sale de comparar el mes en curso contra el anterior; no hay
// datos calculados aparte ni cifras escritas a mano.

function filtroActivo(searchParams?: Record<string, string | string[] | undefined>): TipoCambio | "TODOS" {
  const raw = searchParams?.tipo;
  const valor = Array.isArray(raw) ? raw[0] : raw;
  if (valor === "SUBIO" || valor === "BAJO" || valor === "NUEVO" || valor === "RETIRADO" || valor === "IGUAL") {
    return valor;
  }
  return "TODOS";
}

const COLOR_POR_TIPO: Record<TipoCambio, string> = {
  SUBIO: "text-red-700",
  BAJO: "text-emerald-700",
  IGUAL: "text-steel",
  NUEVO: "text-blue-700",
  RETIRADO: "text-graphite",
};

const ETIQUETA_CAMBIO: Record<TipoCambio, string> = {
  SUBIO: "Subió",
  BAJO: "Bajó",
  IGUAL: "Sin cambio",
  NUEVO: "Nuevo",
  RETIRADO: "Retirado",
};

export default async function CambiosPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const resumen = await compararMeses();
  const filtro = filtroActivo(searchParams);

  const visibles = filtro === "TODOS" ? resumen.cambios : resumen.cambios.filter((c) => c.tipo === filtro);

  const tarjetas: { tipo: TipoCambio | "TODOS"; etiqueta: string; cantidad: number }[] = [
    { tipo: "TODOS", etiqueta: "Todos", cantidad: resumen.cambios.length },
    { tipo: "SUBIO", etiqueta: "Subieron", cantidad: resumen.subieron },
    { tipo: "BAJO", etiqueta: "Bajaron", cantidad: resumen.bajaron },
    { tipo: "IGUAL", etiqueta: "Sin cambio", cantidad: resumen.iguales },
    { tipo: "NUEVO", etiqueta: "Nuevos", cantidad: resumen.nuevos },
    { tipo: "RETIRADO", etiqueta: "Retirados", cantidad: resumen.retirados },
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="INTELIGENCIA COMERCIAL"
        title="¿Qué cambió este mes?"
        description={`${resumen.nombreMesActual} comparado con ${resumen.nombreMesAnterior}, versión por versión.`}
      />

      {resumen.sinComparacion ? (
        // Sin datos del mes anterior no se inventa una comparacion: 165
        // "versiones nuevas" que en realidad son las de siempre seria
        // peor que no mostrar nada.
        <EmptyState
          title={`No hay datos de ${resumen.nombreMesAnterior} para comparar.`}
          description={`El sistema compara cada mes contra el anterior usando el historial de precios. Cuando exista más de un mes cargado, acá aparecerá qué subió, qué bajó y qué cambió respecto al mes previo.`}
          actionHref="/actualizaciones"
          actionLabel="Cargar una lista de precios"
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {tarjetas.map(({ tipo, etiqueta, cantidad }) => {
              const activo = filtro === tipo;
              return (
                <a
                  key={tipo}
                  href={tipo === "TODOS" ? "/cambios" : `/cambios?tipo=${tipo}`}
                  className={`rounded-xl border p-4 transition ${
                    activo ? "border-ink bg-ink text-white" : "border-graphite/15 bg-white hover:border-graphite/40"
                  }`}
                >
                  <p className={`text-[11px] font-black uppercase ${activo ? "text-white/70" : "text-steel"}`}>
                    {etiqueta}
                  </p>
                  <p className="mt-1 text-3xl font-black">{cantidad}</p>
                </a>
              );
            })}
          </div>

          <Panel>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-black text-ink">Detalle</h2>
              <StatusPill>{visibles.length} filas</StatusPill>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="data-table min-w-[900px]">
                <thead>
                  <tr>
                    <th>Vehículo</th>
                    <th>Precio</th>
                    <th>{resumen.nombreMesAnterior}</th>
                    <th>{resumen.nombreMesActual}</th>
                    <th>Diferencia</th>
                    <th>Variación</th>
                    <th>Cambio</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.slice(0, 200).map((c) => (
                    <tr key={`${c.versionId}-${c.tipoPrecio}`}>
                      <td>
                        <p className="font-black text-ink">
                          {c.marca} {c.modelo}
                        </p>
                        <p className="text-xs font-semibold text-steel">{c.version}</p>
                      </td>
                      <td className="font-semibold text-graphite">{ETIQUETA_TIPO[c.tipoPrecio] ?? c.tipoPrecio}</td>
                      <td className="font-semibold text-steel">
                        {c.montoAnterior === null ? "—" : formatCLP(c.montoAnterior)}
                      </td>
                      <td className="font-black text-ink">
                        {c.montoActual === null ? "—" : formatCLP(c.montoActual)}
                      </td>
                      <td className={`font-black ${COLOR_POR_TIPO[c.tipo]}`}>
                        {c.diferencia === null ? "—" : `${c.diferencia > 0 ? "+" : ""}${formatCLP(c.diferencia)}`}
                      </td>
                      <td className={`font-black ${COLOR_POR_TIPO[c.tipo]}`}>
                        {c.variacionPct === null
                          ? "—"
                          : `${c.variacionPct > 0 ? "+" : ""}${c.variacionPct.toFixed(1)}%`}
                      </td>
                      <td>
                        <span className={`text-xs font-black uppercase ${COLOR_POR_TIPO[c.tipo]}`}>
                          {ETIQUETA_CAMBIO[c.tipo]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {visibles.length > 200 && (
                <p className="mt-3 text-xs font-semibold text-steel">
                  Mostrando las 200 filas con mayor diferencia, de {visibles.length}.
                </p>
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
