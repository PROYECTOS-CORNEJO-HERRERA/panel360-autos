"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { actualizarPreciosDerco } from "@/lib/derco/actualizar-precios";

// Revisar derco.cl a pedido, sin esperar la corrida automatica de cada
// mañana. Util cuando la marca avisa de una campaña nueva en la web.
export async function actualizarDercoAhora() {
  await requireUser();

  let destino = "/cambios?derco=error";
  try {
    const r = await actualizarPreciosDerco({ presupuestoMs: 45_000 });
    const params = new URLSearchParams({
      derco: "ok",
      cambiados: String(r.preciosCambiados),
      calzadas: String(r.versionesCalzadas),
      sinCalce: String(r.sinCalce.length),
      incompleta: r.incompleta ? "1" : "0",
    });
    destino = `/cambios?${params.toString()}`;
  } catch (error) {
    console.error("No se pudo revisar derco.cl:", error);
  }

  for (const ruta of ["/cambios", "/rentabilidad", "/cotizador", "/vehiculos"]) revalidatePath(ruta);
  // redirect() fuera del try: por dentro lanza una excepcion propia que el
  // catch se tragaria.
  redirect(destino);
}
