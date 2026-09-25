import { Globe } from "lucide-react";
import { formatCLP } from "@/lib/format";

// ============================================================
// COMPARATIVO CON DERCO.CL
// ============================================================
//
// El cliente llega habiendo visto la web. Si derco.cl publica un precio
// mas bajo que el que el ejecutivo esta ofreciendo, lo va a pedir -- y
// es mejor saberlo ANTES de sentarse a negociar, no cuando el cliente
// saca el celular.
//
// Por eso esto va siempre a la vista en la hoja, al lado del precio, y
// compara contra las cifras VIVAS de la hoja (si el ejecutivo cambia el
// bono, la diferencia se recalcula).

type Fila = { etiqueta: string; interno: number | null; derco: number | null };

function fechaCorta(iso: string | null | undefined) {
  if (!iso) return null;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" });
}

function Diferencia({ interno, derco }: { interno: number; derco: number }) {
  const diferencia = derco - interno;
  if (diferencia === 0) {
    return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700">Igual</span>;
  }
  const pct = interno ? (diferencia / interno) * 100 : 0;
  // La web mas barata es la alerta que importa: el cliente la va a pedir.
  const webMasBarata = diferencia < 0;
  return (
    <span
      className={
        webMasBarata
          ? "rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-800"
          : "rounded-full bg-mist px-2 py-0.5 text-[11px] font-black text-graphite"
      }
    >
      {diferencia > 0 ? "+" : "−"}
      {formatCLP(Math.abs(diferencia))} ({pct > 0 ? "+" : "−"}
      {Math.abs(pct).toFixed(1)}%)
    </span>
  );
}

export function ComparativoDerco({
  listaInterna,
  conBonosInterno,
  listaDerco,
  conBonosDerco,
  actualizado,
}: {
  listaInterna: number | null;
  conBonosInterno: number | null;
  listaDerco: number | null | undefined;
  conBonosDerco: number | null | undefined;
  actualizado?: string | null;
}) {
  const sinDatos = !listaDerco && !conBonosDerco;
  const filas: Fila[] = [
    { etiqueta: "Precio lista", interno: listaInterna, derco: listaDerco ?? null },
    { etiqueta: "Precio con bonos", interno: conBonosInterno, derco: conBonosDerco ?? null },
  ];

  const webMasBarata = filas.some((f) => f.interno && f.derco && f.derco < f.interno);
  const fecha = fechaCorta(actualizado);

  return (
    <div
      className={
        webMasBarata
          ? "rounded-lg border border-amber-300 bg-amber-50/60 p-3"
          : "rounded-lg border border-graphite/10 bg-white p-3"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-ink">
          <Globe className="h-3.5 w-3.5 text-copper" aria-hidden="true" />
          Comparativo derco.cl
        </p>
        {fecha ? <span className="text-[11px] font-semibold text-steel">revisado {fecha}</span> : null}
      </div>

      {sinDatos ? (
        <p className="mt-2 text-xs font-semibold text-steel">
          Esta versión no tiene precio publicado en derco.cl, o la web todavía no se revisa.
        </p>
      ) : (
        <div className="mt-2 grid gap-2">
          {filas.map((fila) => (
            <div key={fila.etiqueta} className="grid gap-1 rounded-md bg-white/70 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-black uppercase text-steel">{fila.etiqueta}</span>
                {fila.interno && fila.derco ? <Diferencia interno={fila.interno} derco={fila.derco} /> : null}
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
                <span className="font-semibold text-graphite">
                  Hoja: <strong className="text-ink">{fila.interno ? formatCLP(fila.interno) : "—"}</strong>
                </span>
                <span className="font-semibold text-graphite">
                  Web: <strong className="text-ink">{fila.derco ? formatCLP(fila.derco) : "—"}</strong>
                </span>
              </div>
            </div>
          ))}
          {webMasBarata ? (
            <p className="text-[11px] font-bold leading-4 text-amber-900">
              La web publica un precio más bajo: el cliente puede llegar pidiéndolo.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
