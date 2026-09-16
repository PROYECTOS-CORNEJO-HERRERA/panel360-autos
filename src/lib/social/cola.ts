import { prisma } from "@/lib/prisma";
import { datosParaPost } from "@/lib/social/plantillas";
import {
  TOPE_DIARIO_META,
  obtenerCuenta,
  publicacionesUltimas24h,
  publicarEnInstagram,
} from "@/lib/social/instagram";
import { writeAudit } from "@/lib/services/audit";

// ============================================================
// LA COLA: QUIEN DECIDE SI UN POST SALE
// ============================================================
//
// El cliente de la API publica lo que le pasen. Toda la decision de si
// corresponde publicar vive aqui, en un solo lugar, porque son tres
// caminos distintos los que terminan publicando (el boton "publicar
// ahora", el cron de programados, y un reintento) y si cada uno
// validara por su cuenta terminarian validando distinto.
//
// Tres guardas, y ninguna es decorativa:
//
//  1. APROBACION. Si la cuenta esta en modo "requiere aprobacion", un
//     post que nadie aprobo no sale. Es una cuenta que representa a
//     una marca: la publicacion automatica sin revision humana es como
//     se publican los errores caros.
//
//  2. PRECIO DESFASADO. Entre que se redacta el post y que se publica
//     pueden pasar dias, y en automotriz la lista cambia con el mes.
//     Si el precio vigente ya no es el que dice el caption, el post NO
//     sale: queda en ERROR con el motivo. Publicar un precio viejo es
//     exactamente el problema que el Bloque B arreglo en pantalla; no
//     tiene sentido reintroducirlo por Instagram.
//
//  3. TOPE DE META. 25 publicaciones cada 24 horas por cuenta. Si se
//     pasa, Meta rechaza y el post queda en ERROR sin explicacion
//     clara. Mejor frenar antes y decir por que.

export type ResultadoCola = {
  ok: boolean;
  mensaje: string;
};

const ESTADOS_PUBLICABLES = ["PROGRAMADO", "PENDIENTE_APROBACION", "BORRADOR", "ERROR"];

/**
 * Comprueba que el precio del caption siga siendo el vigente.
 * Devuelve null si esta todo bien, o el motivo si no.
 */
async function precioDesfasado(post: { versionId: string | null; precioSnapshot: number | null }) {
  if (!post.versionId || post.precioSnapshot === null) return null;
  const datos = await datosParaPost(post.versionId);
  if (!datos) return "El vehiculo del post ya no existe en el catalogo.";
  if (datos.precio === null) {
    return "El vehiculo ya no tiene precio vigente cargado. Revise el caption antes de publicar.";
  }
  if (datos.precio !== post.precioSnapshot) {
    return `El precio cambio despues de redactar el post (el caption dice ${post.precioSnapshot.toLocaleString(
      "es-CL"
    )} y hoy rige ${datos.precio.toLocaleString(
      "es-CL"
    )}). Vuelva a generar el texto antes de publicar.`;
  }
  return null;
}

/**
 * Intenta publicar un post concreto. `forzadoPorUsuario` significa que
 * hay una persona apretando el boton en pantalla: eso satisface la
 * guarda de aprobacion, pero NO la de precio ni la de tope.
 */
export async function publicarPost(postId: string, opciones?: { forzadoPorUsuario?: boolean }): Promise<ResultadoCola> {
  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    include: { medias: { orderBy: { orden: "asc" } } },
  });

  if (!post) return { ok: false, mensaje: "La publicacion no existe." };
  if (post.estado === "PUBLICADO") {
    return { ok: false, mensaje: "Esta publicacion ya salio. No se vuelve a publicar." };
  }
  if (post.estado === "PUBLICANDO") {
    return { ok: false, mensaje: "Esta publicacion ya esta en proceso de salida." };
  }
  if (!ESTADOS_PUBLICABLES.includes(post.estado)) {
    return { ok: false, mensaje: `Una publicacion en estado ${post.estado} no se puede publicar.` };
  }

  const cuenta = await obtenerCuenta();
  const requiereAprobacion = cuenta?.requiereAprobacion ?? true;

  // Guarda 1: aprobacion.
  if (requiereAprobacion && !post.aprobadoEn && !opciones?.forzadoPorUsuario) {
    return {
      ok: false,
      mensaje: "La publicacion no esta aprobada. La cuenta exige revision humana antes de publicar.",
    };
  }

  // Guarda 2: precio desfasado.
  const desfase = await precioDesfasado(post);
  if (desfase) {
    await prisma.socialPost.update({
      where: { id: post.id },
      data: { estado: "ERROR", error: desfase, intentos: { increment: 1 } },
    });
    return { ok: false, mensaje: desfase };
  }

  // Guarda 3: tope de Meta.
  const publicadosHoy = await publicacionesUltimas24h();
  if (publicadosHoy >= TOPE_DIARIO_META) {
    const mensaje = `Se alcanzo el tope de Instagram: ${TOPE_DIARIO_META} publicaciones en 24 horas. Esta queda en espera y sale en la proxima corrida.`;
    // OJO: hay que dejar `programadoPara` escrito. El cron busca
    // `{ estado: "PROGRAMADO", programadoPara: { lte: ahora } }`, y esa
    // condicion NO incluye los nulos: un post devuelto a la cola sin
    // fecha quedaba huerfano para siempre, en espera eterna y sin error
    // visible. Se le pone la hora actual para que la proxima corrida lo
    // tome de inmediato.
    await prisma.socialPost.update({
      where: { id: post.id },
      data: { estado: "PROGRAMADO", programadoPara: post.programadoPara ?? new Date(), error: mensaje },
    });
    return { ok: false, mensaje };
  }

  // Marcar PUBLICANDO antes de llamar a Meta. Si el proceso se cae a
  // mitad de camino, el post queda visible en ese estado en vez de
  // volver a la cola y publicarse dos veces.
  await prisma.socialPost.update({ where: { id: post.id }, data: { estado: "PUBLICANDO", error: null } });

  const resultado = await publicarEnInstagram({
    formato: post.formato,
    caption: post.caption,
    medias: post.medias.map((m) => ({ url: m.url, tipo: m.tipo })),
  });

  if (!resultado.ok) {
    await prisma.socialPost.update({
      where: { id: post.id },
      data: { estado: "ERROR", error: resultado.error, intentos: { increment: 1 } },
    });
    return { ok: false, mensaje: resultado.error };
  }

  await prisma.socialPost.update({
    where: { id: post.id },
    data: {
      estado: "PUBLICADO",
      publicadoEn: new Date(),
      igMediaId: resultado.igMediaId,
      igPermalink: resultado.permalink,
      error: null,
      intentos: { increment: 1 },
    },
  });

  await writeAudit({
    entityType: "SocialPost",
    entityId: post.id,
    fieldModified: "estado",
    previousValue: "PUBLICANDO",
    newValue: "PUBLICADO",
    source: "Instagram",
    observation: `Publicacion ${post.formato} publicada en Instagram (media ${resultado.igMediaId}).`,
  }).catch(() => {
    // La auditoria no debe tumbar una publicacion que ya salio.
  });

  return { ok: true, mensaje: "Publicado en Instagram." };
}

/**
 * Lo que corre el cron: publica todo lo programado cuya hora ya paso.
 * Secuencial a proposito -- en paralelo se atropellan contra el limite
 * de llamadas de Meta y los errores salen confusos.
 */
export async function procesarProgramados(ahora = new Date()) {
  const pendientes = await prisma.socialPost.findMany({
    where: { estado: "PROGRAMADO", programadoPara: { lte: ahora } },
    orderBy: { programadoPara: "asc" },
    take: TOPE_DIARIO_META,
    select: { id: true },
  });

  const resultados: { id: string; ok: boolean; mensaje: string }[] = [];
  for (const pendiente of pendientes) {
    const r = await publicarPost(pendiente.id);
    resultados.push({ id: pendiente.id, ...r });
  }
  return resultados;
}
