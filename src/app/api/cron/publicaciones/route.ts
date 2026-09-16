import { NextResponse } from "next/server";
import { verificarCron } from "@/lib/cron-auth";
import { procesarProgramados } from "@/lib/social/cola";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Corre UNA VEZ AL DIA (13:00 UTC = 10:00 en Chile). Publica todo lo que
// quedo programado para un momento que ya paso, asi que recupera el
// atraso completo en cada corrida.
//
// Era cada hora, y eso ROMPIA TODOS LOS DESPLIEGUES: el plan Hobby de
// Vercel solo admite cron diario, y rechazaba el deploy entero con
// "Hobby accounts are limited to daily cron jobs". Estuvo cinco dias
// bloqueando cualquier publicacion a produccion, no solo esta funcion.
//
// El costo real es la precision: un post programado para las 15:00 sale
// al dia siguiente a las 10:00. Para recuperar la granularidad por hora
// hay que pasar al plan Pro.
export async function GET(request: Request) {
  const noAutorizado = verificarCron(request);
  if (noAutorizado) return noAutorizado;

  const resultados = await procesarProgramados();

  return NextResponse.json({
    ok: true,
    procesados: resultados.length,
    publicados: resultados.filter((r) => r.ok).length,
    fallidos: resultados.filter((r) => !r.ok),
  });
}
