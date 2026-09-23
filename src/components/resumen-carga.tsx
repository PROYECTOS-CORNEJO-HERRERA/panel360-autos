import type { ResumenCarga } from "@/lib/importers/resumen-carga";

/**
 * Lo que trae un archivo, antes de confirmarlo (Bloque C).
 *
 * Aprobar una lista mete cientos de precios de una vez a las pantallas
 * que el ejecutivo usa frente al cliente. Esto permite mirar primero
 * que se detecto -- sobre todo cuantos precios quedaron marcados como
 * netos y cuantos vehiculos comerciales hay, que es donde se cuela el
 * error del 19%.
 */
export function ResumenCargaPanel({ resumen }: { resumen: ResumenCarga }) {
  const dato = (etiqueta: string, valor: string | number, alerta = false) => (
    <div key={etiqueta}>
      <p className="text-[11px] font-black uppercase tracking-wide text-steel">{etiqueta}</p>
      <p className={`text-lg font-black ${alerta ? "text-red-700" : "text-ink"}`}>{valor}</p>
    </div>
  );

  return (
    <div className="mt-3 rounded-lg border border-graphite/10 bg-porcelain/60 p-4">
      <p className="text-xs font-black uppercase text-copper">Qué trae este archivo</p>

      <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        {dato("Marca", resumen.marcas.length ? resumen.marcas.join(", ") : "No detectada")}
        {dato("Período", resumen.periodo ?? "No detectado")}
        {dato("Modelos", resumen.modelos)}
        {dato("Versiones", resumen.versiones)}
        {dato("Precios", resumen.precios)}
        {dato("Con IVA", resumen.preciosConIva)}
        {dato("Netos (sin IVA)", resumen.preciosNetos, resumen.preciosNetos > 0)}
        {dato("Comerciales", resumen.comerciales)}
        {resumen.bonos > 0 && dato("Bonos", resumen.bonos)}
        {resumen.campanas > 0 && dato("Campañas", resumen.campanas)}
        {dato("Requieren revisión", resumen.inconsistencias, resumen.inconsistencias > 0)}
      </div>

      {resumen.porTipo.length > 0 && (
        <div className="mt-4 rounded-lg border border-graphite/10 bg-white/60 p-3">
          <p className="text-[11px] font-black uppercase text-steel">
            De que se componen esos {resumen.precios} precios
          </p>
          <p className="mt-1 text-xs font-semibold text-steel">
            Cada version trae varios precios (lista, contado, financiamiento, bonos). Por eso el total es mayor que la
            cantidad de vehiculos.
          </p>
          <ul className="mt-2 grid gap-1">
            {resumen.porTipo.map(({ tipo, filas }) => (
              <li key={tipo} className="flex items-center justify-between gap-3 text-xs font-bold text-graphite">
                <span>{tipo}</span>
                <span className="text-ink">{filas}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {resumen.motivos.length > 0 && (
        <div className="mt-4 border-t border-graphite/10 pt-3">
          <p className="text-xs font-black uppercase text-steel">Por qué requieren revisión</p>
          <ul className="mt-2 grid gap-1">
            {resumen.motivos.slice(0, 5).map(({ motivo, filas }) => (
              <li key={motivo} className="text-xs font-semibold leading-5 text-graphite">
                <span className="font-black text-red-700">{filas}</span> {filas === 1 ? "fila" : "filas"} — {motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
