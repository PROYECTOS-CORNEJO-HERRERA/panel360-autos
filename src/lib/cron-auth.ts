import { NextResponse } from "next/server";

// Guarda unica para los endpoints /api/cron/*.
//
// Antes cada ruta hacia `if (cronSecret && authHeader !== ...)`, o sea que
// si la variable NO estaba definida la puerta quedaba ABIERTA: cualquiera
// podia disparar las publicaciones o las notificaciones diarias. Fallaba
// abierto, que es justo al reves de lo que debe hacer una guarda.
//
// Ahora falla cerrada: sin CRON_SECRET en produccion el endpoint responde
// 401. En desarrollo local se deja pasar para poder probar los crons a
// mano sin montar el secreto.
export function verificarCron(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { ok: false, error: "CRON_SECRET no esta configurado en el servidor" },
        { status: 401 }
      );
    }
    return null;
  }

  if (request.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
