import { nombreMesComercial } from "@/lib/mes-comercial";
import type { MesEnUso } from "@/lib/precios";

/**
 * Avisa cuando los precios en pantalla son de un mes que ya paso
 * (Bloque B).
 *
 * Antes el sistema mostraba la lista de agosto en septiembre sin decir
 * nada, y el ejecutivo no tenia como saber que estaba cotizando con
 * precios vencidos. Vive en un componente y no repetido en cada
 * pantalla para que el mensaje sea identico en cotizador, comparador y
 * rentabilidad.
 */
export function AvisoMes({ mesEnUso }: { mesEnUso: MesEnUso }) {
  if (!mesEnUso.aviso) return null;

  return (
    <div className="no-print rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
      <p className="text-sm font-black uppercase tracking-wide text-amber-700">
        {mesEnUso.esDesactualizado ? `Precios de ${nombreMesComercial(mesEnUso.mes)}` : "Sin listas de precios"}
      </p>
      <p className="mt-1 text-sm font-semibold leading-relaxed text-amber-900">{mesEnUso.aviso}</p>
    </div>
  );
}
