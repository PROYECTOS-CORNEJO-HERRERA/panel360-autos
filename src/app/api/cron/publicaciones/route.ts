import { NextResponse } from "next/server";
import { procesarProgramados } from "@/lib/social/cola";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Corre cada hora. Publica lo que quedo programado para una hora que ya
// paso. La granularidad es de una hora a proposito: programar al minuto
// exacto obligaria a un cron por minuto, y para un post de catalogo eso
// no aporta nada.
export async function GET(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const resultados = await procesarProgramados();

  return NextResponse.json({
    ok: true,
    procesados: resultados.length,
    publicados: resultados.filter((r) => r.ok).length,
    fallidos: resultados.filter((r) => !r.ok),
  });
}
