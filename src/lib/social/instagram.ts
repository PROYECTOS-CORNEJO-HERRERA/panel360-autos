import { prisma } from "@/lib/prisma";
import { cifrar, descifrar, enmascarar, haySecretoConfigurado } from "@/lib/social/secretos";

// ============================================================
// CLIENTE DE LA INSTAGRAM GRAPH API (via oficial de Meta)
// ============================================================
//
// Publicar en Instagram por la API son SIEMPRE dos llamadas:
//
//   1. POST /{ig-user-id}/media           -> crea un "contenedor"
//   2. POST /{ig-user-id}/media_publish   -> lo publica
//
// Entre medio Instagram descarga la imagen o el video desde la URL que
// se le entrego. Para imagenes suele ser inmediato; para video o Reel
// puede tardar. Por eso los dos pasos estan separados aqui y hay una
// espera con consulta de status_code para los formatos de video.
//
// El carrusel agrega un nivel: cada foto es su propio contenedor con
// is_carousel_item=true, y despues se crea un contenedor CAROUSEL que
// los agrupa.

const VERSION_API = "v21.0";
const BASE = `https://graph.facebook.com/${VERSION_API}`;

export const TOPE_DIARIO_META = 25; // limite duro de Meta por cuenta / 24h

export type ResultadoPublicacion =
  | { ok: true; igMediaId: string; permalink: string | null }
  | { ok: false; error: string };

type CuentaConectada = {
  igUserId: string;
  token: string;
  username: string | null;
  requiereAprobacion: boolean;
};

export async function obtenerCuenta() {
  return prisma.socialAccount.findUnique({ where: { provider: "INSTAGRAM" } });
}

export async function estadoInstagram() {
  const cuenta = await obtenerCuenta();

  if (!haySecretoConfigurado()) {
    return {
      conectado: false,
      etiqueta: "FALTA LLAVE DE CIFRADO",
      detalle:
        "Configure PANEL360_SECRET_KEY antes de conectar la cuenta. Sin esa llave el token no se puede guardar de forma segura.",
      username: null as string | null,
      tokenPreview: "",
      expiraEn: null as Date | null,
      requiereAprobacion: true,
    };
  }

  if (!cuenta?.tokenCifrado || !cuenta.igUserId) {
    return {
      conectado: false,
      etiqueta: "NO CONECTADO",
      detalle: "Pegue el token de larga duracion y el ID de la cuenta Instagram Business.",
      username: cuenta?.username ?? null,
      tokenPreview: "",
      expiraEn: null as Date | null,
      requiereAprobacion: cuenta?.requiereAprobacion ?? true,
    };
  }

  let preview = "";
  try {
    preview = enmascarar(descifrar(cuenta.tokenCifrado));
  } catch {
    return {
      conectado: false,
      etiqueta: "TOKEN ILEGIBLE",
      detalle:
        "El token guardado no se pudo descifrar. Suele pasar si cambio PANEL360_SECRET_KEY. Vuelva a conectar la cuenta.",
      username: cuenta.username,
      tokenPreview: "",
      expiraEn: cuenta.tokenExpiraEn,
      requiereAprobacion: cuenta.requiereAprobacion,
    };
  }

  const vencido = cuenta.tokenExpiraEn ? cuenta.tokenExpiraEn.getTime() < Date.now() : false;

  return {
    conectado: !vencido,
    etiqueta: vencido ? "TOKEN VENCIDO" : "CONECTADO",
    detalle: vencido
      ? "El token de larga duracion caduco. Genere uno nuevo en developers.facebook.com y vuelva a pegarlo."
      : "Listo para publicar.",
    username: cuenta.username,
    tokenPreview: preview,
    expiraEn: cuenta.tokenExpiraEn,
    requiereAprobacion: cuenta.requiereAprobacion,
  };
}

async function cuentaConectada(): Promise<CuentaConectada | null> {
  const cuenta = await obtenerCuenta();
  if (!cuenta?.tokenCifrado || !cuenta.igUserId) return null;
  try {
    return {
      igUserId: cuenta.igUserId,
      token: descifrar(cuenta.tokenCifrado),
      username: cuenta.username,
      requiereAprobacion: cuenta.requiereAprobacion,
    };
  } catch {
    return null;
  }
}

/** Error de Meta legible. La API devuelve el detalle util dentro de
 *  error.message; mostrar solo "HTTP 400" no le sirve a nadie. */
async function leerError(respuesta: Response) {
  const cuerpo = await respuesta.text().catch(() => "");
  try {
    const json = JSON.parse(cuerpo);
    const e = json?.error;
    if (e?.message) {
      return `Meta respondio: ${e.message}${e.code ? ` (codigo ${e.code})` : ""}`;
    }
  } catch {
    /* el cuerpo no era JSON */
  }
  return `Meta respondio HTTP ${respuesta.status}. ${cuerpo.slice(0, 300)}`;
}

async function llamar(ruta: string, token: string, params: Record<string, string>) {
  const cuerpo = new URLSearchParams({ ...params, access_token: token });
  const respuesta = await fetch(`${BASE}/${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: cuerpo,
  });
  if (!respuesta.ok) throw new Error(await leerError(respuesta));
  return (await respuesta.json()) as Record<string, string>;
}

/**
 * Verifica token y cuenta contra Meta, y devuelve el nombre de usuario.
 * Se usa al conectar: es preferible fallar aqui, con el usuario
 * mirando la pantalla de configuracion, que a las 9 de la manana
 * cuando el cron intente publicar.
 */
export async function verificarCredenciales(igUserId: string, token: string) {
  const url = `${BASE}/${igUserId}?fields=id,username,account_type&access_token=${encodeURIComponent(token)}`;
  const respuesta = await fetch(url);
  if (!respuesta.ok) {
    return { ok: false as const, error: await leerError(respuesta) };
  }
  const datos = (await respuesta.json()) as { id: string; username?: string; account_type?: string };
  return { ok: true as const, username: datos.username ?? null, accountType: datos.account_type ?? null };
}

export async function guardarCredenciales(igUserId: string, token: string, username: string | null) {
  // Meta entrega tokens de larga duracion de ~60 dias. Se registra la
  // fecha estimada para poder avisar ANTES de que deje de publicar.
  const expira = new Date();
  expira.setDate(expira.getDate() + 60);

  const cifrado = cifrar(token);

  await prisma.socialAccount.upsert({
    where: { provider: "INSTAGRAM" },
    create: {
      provider: "INSTAGRAM",
      igUserId,
      username,
      tokenCifrado: cifrado,
      tokenExpiraEn: expira,
      connectedAt: new Date(),
    },
    update: {
      igUserId,
      username,
      tokenCifrado: cifrado,
      tokenExpiraEn: expira,
      connectedAt: new Date(),
    },
  });
}

export async function desconectarCuenta() {
  await prisma.socialAccount.updateMany({
    where: { provider: "INSTAGRAM" },
    data: { tokenCifrado: null, igUserId: null, tokenExpiraEn: null, connectedAt: null },
  });
}

/** Espera a que un contenedor de video termine de procesarse. */
async function esperarContenedor(contenedorId: string, token: string, intentosMax = 12) {
  for (let i = 0; i < intentosMax; i += 1) {
    const url = `${BASE}/${contenedorId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url);
    if (r.ok) {
      const d = (await r.json()) as { status_code?: string; status?: string };
      if (d.status_code === "FINISHED") return;
      if (d.status_code === "ERROR") {
        throw new Error(`Instagram no pudo procesar el archivo: ${d.status ?? "sin detalle"}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(
    "Instagram sigue procesando el video despues de un minuto. Quedo sin publicar; reintente mas tarde."
  );
}

/**
 * Publica de verdad. Recibe el post ya validado por quien llama: esta
 * funcion no decide si corresponde publicar, solo publica.
 */
export async function publicarEnInstagram(entrada: {
  formato: string;
  caption: string;
  medias: { url: string; tipo: string }[];
}): Promise<ResultadoPublicacion> {
  const cuenta = await cuentaConectada();
  if (!cuenta) {
    return { ok: false, error: "La cuenta de Instagram no esta conectada o el token no se pudo leer." };
  }
  if (!entrada.medias.length) {
    return { ok: false, error: "El post no tiene ninguna imagen. Instagram no acepta publicaciones sin media." };
  }

  const noPublicas = entrada.medias.filter(
    (m) => !/^https:\/\//i.test(m.url) || /localhost|127\.0\.0\.1/i.test(m.url)
  );
  if (noPublicas.length) {
    return {
      ok: false,
      error:
        "Las imagenes deben estar en una URL publica HTTPS. Instagram las descarga desde sus servidores: no llega a localhost ni a un archivo del computador.",
    };
  }

  try {
    let contenedorFinal: string;

    if (entrada.formato === "CARRUSEL") {
      if (entrada.medias.length < 2) {
        return { ok: false, error: "Un carrusel necesita al menos 2 imagenes." };
      }
      if (entrada.medias.length > 10) {
        return { ok: false, error: "Instagram acepta como maximo 10 imagenes por carrusel." };
      }
      const hijos: string[] = [];
      for (const media of entrada.medias) {
        const hijo = await llamar(`${cuenta.igUserId}/media`, cuenta.token, {
          image_url: media.url,
          is_carousel_item: "true",
        });
        hijos.push(hijo.id);
      }
      const padre = await llamar(`${cuenta.igUserId}/media`, cuenta.token, {
        media_type: "CAROUSEL",
        children: hijos.join(","),
        caption: entrada.caption,
      });
      contenedorFinal = padre.id;
    } else if (entrada.formato === "REEL") {
      const creado = await llamar(`${cuenta.igUserId}/media`, cuenta.token, {
        media_type: "REELS",
        video_url: entrada.medias[0].url,
        caption: entrada.caption,
      });
      await esperarContenedor(creado.id, cuenta.token);
      contenedorFinal = creado.id;
    } else if (entrada.formato === "STORY") {
      const esVideo = entrada.medias[0].tipo === "VIDEO";
      const creado = await llamar(`${cuenta.igUserId}/media`, cuenta.token, {
        media_type: "STORIES",
        ...(esVideo ? { video_url: entrada.medias[0].url } : { image_url: entrada.medias[0].url }),
      });
      if (esVideo) await esperarContenedor(creado.id, cuenta.token);
      contenedorFinal = creado.id;
    } else {
      const creado = await llamar(`${cuenta.igUserId}/media`, cuenta.token, {
        image_url: entrada.medias[0].url,
        caption: entrada.caption,
      });
      contenedorFinal = creado.id;
    }

    const publicado = await llamar(`${cuenta.igUserId}/media_publish`, cuenta.token, {
      creation_id: contenedorFinal,
    });

    let permalink: string | null = null;
    try {
      const r = await fetch(
        `${BASE}/${publicado.id}?fields=permalink&access_token=${encodeURIComponent(cuenta.token)}`
      );
      if (r.ok) permalink = ((await r.json()) as { permalink?: string }).permalink ?? null;
    } catch {
      // El permalink es comodidad, no parte de la publicacion. Si esta
      // consulta falla el post YA salio, y reportarlo como error haria
      // que el sistema reintente y termine publicando dos veces.
    }

    return { ok: true, igMediaId: publicado.id, permalink };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Error desconocido al publicar." };
  }
}

/** Cuantas publicaciones salieron en las ultimas 24h (tope de Meta). */
export async function publicacionesUltimas24h() {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return prisma.socialPost.count({ where: { estado: "PUBLICADO", publicadoEn: { gte: desde } } });
}
