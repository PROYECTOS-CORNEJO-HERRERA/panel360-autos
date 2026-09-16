"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { publicarPost } from "@/lib/social/cola";
import {
  desconectarCuenta,
  guardarCredenciales,
  verificarCredenciales,
} from "@/lib/social/instagram";
import { SecretoNoConfigurado } from "@/lib/social/secretos";
import {
  ClavePlantilla,
  datosParaPost,
  redactarCaption,
  validarCaption,
} from "@/lib/social/plantillas";

const RUTA_PUBLICACIONES = "/publicaciones";
const RUTA_CONFIG = "/configuracion/instagram";

function texto(formData: FormData, clave: string) {
  const valor = formData.get(clave);
  return valor ? String(valor).trim() : "";
}

// ------------------------------------------------------------
// CONEXION DE LA CUENTA
// ------------------------------------------------------------

export async function conectarInstagram(formData: FormData) {
  const igUserId = texto(formData, "igUserId");
  const token = texto(formData, "token");

  if (!igUserId || !token) {
    return { ok: false, mensaje: "Faltan el ID de la cuenta o el token." };
  }

  // Se verifica contra Meta ANTES de guardar. Guardar un token que no
  // funciona deja la pantalla diciendo "conectado" y el fallo aparece
  // recien cuando alguien intenta publicar.
  const verificacion = await verificarCredenciales(igUserId, token);
  if (!verificacion.ok) {
    return { ok: false, mensaje: verificacion.error };
  }

  if (verificacion.accountType && verificacion.accountType !== "BUSINESS") {
    return {
      ok: false,
      mensaje: `La cuenta responde como ${verificacion.accountType}. La API oficial solo publica en cuentas Business vinculadas a una Pagina de Facebook.`,
    };
  }

  try {
    await guardarCredenciales(igUserId, token, verificacion.username);
  } catch (error) {
    if (error instanceof SecretoNoConfigurado) {
      return { ok: false, mensaje: error.message };
    }
    throw error;
  }

  revalidatePath(RUTA_CONFIG);
  return { ok: true, mensaje: `Cuenta @${verificacion.username ?? igUserId} conectada.` };
}

export async function desconectarInstagram() {
  await desconectarCuenta();
  revalidatePath(RUTA_CONFIG);
}

export async function cambiarModoAprobacion(formData: FormData) {
  const requiere = texto(formData, "requiereAprobacion") === "true";
  await prisma.socialAccount.upsert({
    where: { provider: "INSTAGRAM" },
    create: { provider: "INSTAGRAM", requiereAprobacion: requiere },
    update: { requiereAprobacion: requiere },
  });
  revalidatePath(RUTA_CONFIG);
}

// ------------------------------------------------------------
// BORRADORES
// ------------------------------------------------------------

export async function crearBorradorDesdeVehiculo(formData: FormData) {
  const versionId = texto(formData, "versionId");
  const plantilla = (texto(formData, "plantilla") || "LANZAMIENTO") as ClavePlantilla;
  const formato = texto(formData, "formato") || "FEED";

  if (!versionId) return { ok: false, mensaje: "Elija un vehiculo." };

  const datos = await datosParaPost(versionId);
  if (!datos) return { ok: false, mensaje: "El vehiculo no existe en el catalogo." };

  const caption = redactarCaption(plantilla, datos);

  const cuenta = await prisma.socialAccount.findUnique({ where: { provider: "INSTAGRAM" } });

  const post = await prisma.socialPost.create({
    data: {
      accountId: cuenta?.id ?? null,
      formato,
      plantilla,
      caption,
      versionId,
      // El snapshot es lo que despues permite detectar que el precio
      // cambio entre la redaccion y la publicacion.
      precioSnapshot: datos.precio,
      mesComercial: datos.mesComercial,
      estado: "BORRADOR",
    },
  });

  revalidatePath(RUTA_PUBLICACIONES);
  return {
    ok: true,
    mensaje: datos.precio === null
      ? "Borrador creado, pero el vehiculo no tiene precio vigente: el texto lo dice y conviene revisarlo."
      : "Borrador creado.",
    postId: post.id,
  };
}

export async function guardarBorrador(formData: FormData) {
  const postId = texto(formData, "postId");
  const caption = texto(formData, "caption");
  const formato = texto(formData, "formato") || "FEED";
  const programadoPara = texto(formData, "programadoPara");

  if (!postId) return { ok: false, mensaje: "Falta la publicacion." };

  const problema = validarCaption(caption);
  if (problema) return { ok: false, mensaje: problema };

  const actual = await prisma.socialPost.findUnique({ where: { id: postId } });
  if (!actual) return { ok: false, mensaje: "La publicacion no existe." };
  if (actual.estado === "PUBLICADO") {
    return { ok: false, mensaje: "Esta publicacion ya salio: editarla aqui no cambia lo que esta en Instagram." };
  }

  // Editar el texto invalida la aprobacion anterior. Aprobar un texto y
  // que se publique otro distinto vaciaria de sentido la aprobacion.
  const cambioTexto = caption !== actual.caption;

  await prisma.socialPost.update({
    where: { id: postId },
    data: {
      caption,
      formato,
      programadoPara: programadoPara ? new Date(programadoPara) : null,
      estado: programadoPara ? "PROGRAMADO" : actual.estado === "ERROR" ? "BORRADOR" : actual.estado,
      error: null,
      ...(cambioTexto ? { aprobadoEn: null, aprobadoPor: null } : {}),
    },
  });

  revalidatePath(RUTA_PUBLICACIONES);
  return {
    ok: true,
    mensaje: cambioTexto && actual.aprobadoEn
      ? "Guardado. Como cambio el texto, la aprobacion anterior quedo sin efecto."
      : "Guardado.",
  };
}

export async function regenerarCaption(formData: FormData) {
  const postId = texto(formData, "postId");
  const post = await prisma.socialPost.findUnique({ where: { id: postId } });
  if (!post?.versionId) {
    return { ok: false, mensaje: "Este post no esta ligado a un vehiculo del catalogo." };
  }
  const datos = await datosParaPost(post.versionId);
  if (!datos) return { ok: false, mensaje: "El vehiculo ya no existe." };

  await prisma.socialPost.update({
    where: { id: postId },
    data: {
      caption: redactarCaption(post.plantilla as ClavePlantilla, datos),
      precioSnapshot: datos.precio,
      mesComercial: datos.mesComercial,
      estado: post.estado === "ERROR" ? "BORRADOR" : post.estado,
      error: null,
      aprobadoEn: null,
      aprobadoPor: null,
    },
  });

  revalidatePath(RUTA_PUBLICACIONES);
  return { ok: true, mensaje: "Texto regenerado con los datos vigentes de hoy." };
}

export async function agregarImagen(formData: FormData) {
  const postId = texto(formData, "postId");
  const url = texto(formData, "url");

  if (!postId || !url) return { ok: false, mensaje: "Falta la URL de la imagen." };
  if (!/^https:\/\//i.test(url)) {
    return {
      ok: false,
      mensaje: "La URL debe empezar con https://. Instagram descarga la imagen desde sus servidores, no acepta archivos locales.",
    };
  }

  const cuantas = await prisma.socialPostMedia.count({ where: { postId } });
  if (cuantas >= 10) return { ok: false, mensaje: "Instagram acepta como maximo 10 imagenes." };

  await prisma.socialPostMedia.create({
    data: {
      postId,
      url,
      tipo: /\.(mp4|mov)(\?|$)/i.test(url) ? "VIDEO" : "IMAGEN",
      orden: cuantas,
    },
  });

  revalidatePath(RUTA_PUBLICACIONES);
  return { ok: true, mensaje: "Imagen agregada." };
}

// Subir un archivo desde el computador. Antes solo se podia pegar una URL
// https a mano, y como aprobar exige al menos una imagen, en la practica
// no se podia publicar nada sin tener la foto ya alojada en otro lado.
//
// La imagen queda PUBLICA a proposito: Instagram no recibe el archivo, lo
// descarga el desde sus servidores, asi que una URL privada no le sirve.
const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp"];
const TIPOS_VIDEO = ["video/mp4", "video/quicktime"];
const PESO_MAXIMO = 8 * 1024 * 1024;

export async function subirImagen(formData: FormData) {
  const postId = texto(formData, "postId");
  const archivo = formData.get("archivo");

  if (!postId) return { ok: false, mensaje: "Falta la publicacion." };
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { ok: false, mensaje: "Elige un archivo para subir." };
  }

  const esVideo = TIPOS_VIDEO.includes(archivo.type);
  if (!TIPOS_IMAGEN.includes(archivo.type) && !esVideo) {
    return { ok: false, mensaje: "Instagram acepta JPG, PNG, WEBP o MP4." };
  }
  if (archivo.size > PESO_MAXIMO) {
    return { ok: false, mensaje: "El archivo pesa mas de 8 MB. Reducelo antes de subirlo." };
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      ok: false,
      mensaje:
        "La subida de archivos no esta disponible en este entorno (falta el almacenamiento). Pega una URL https publica.",
    };
  }

  const cuantas = await prisma.socialPostMedia.count({ where: { postId } });
  if (cuantas >= 10) return { ok: false, mensaje: "Instagram acepta como maximo 10 imagenes." };

  try {
    const { put } = await import("@vercel/blob");
    const extension = archivo.name.split(".").pop()?.toLowerCase() || (esVideo ? "mp4" : "jpg");
    const blob = await put(`instagram/${postId}/${Date.now()}.${extension}`, archivo, {
      access: "public",
      contentType: archivo.type,
    });

    await prisma.socialPostMedia.create({
      data: { postId, url: blob.url, tipo: esVideo ? "VIDEO" : "IMAGEN", orden: cuantas },
    });
  } catch (error) {
    // El motivo real importa: sin el, el usuario no sabe si reintentar,
    // cambiar el archivo o avisar que el almacenamiento esta caido.
    const motivo = error instanceof Error ? error.message : "error desconocido";
    return { ok: false, mensaje: `No se pudo subir el archivo: ${motivo}` };
  }

  revalidatePath(RUTA_PUBLICACIONES);
  return { ok: true, mensaje: "Archivo subido." };
}

export async function quitarImagen(formData: FormData) {
  const mediaId = texto(formData, "mediaId");
  if (!mediaId) return;
  await prisma.socialPostMedia.delete({ where: { id: mediaId } }).catch(() => null);
  revalidatePath(RUTA_PUBLICACIONES);
}

export async function eliminarPost(formData: FormData) {
  const postId = texto(formData, "postId");
  const post = await prisma.socialPost.findUnique({ where: { id: postId } });
  if (!post) return;
  if (post.estado === "PUBLICADO") {
    // Borrar la fila no borra el post de Instagram. Dejarlo desaparecer
    // del panel daria la impresion contraria.
    return;
  }
  await prisma.socialPost.delete({ where: { id: postId } }).catch(() => null);
  revalidatePath(RUTA_PUBLICACIONES);
}

// ------------------------------------------------------------
// APROBACION Y PUBLICACION
// ------------------------------------------------------------

export async function aprobarPost(formData: FormData) {
  const postId = texto(formData, "postId");
  const usuario = await getCurrentUser();

  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    include: { medias: true },
  });
  if (!post) return { ok: false, mensaje: "La publicacion no existe." };
  if (!post.medias.length) {
    return { ok: false, mensaje: "No se puede aprobar un post sin imagenes." };
  }

  // Un post aprobado SIN fecha quedaba en PENDIENTE_APROBACION, y el cron
  // solo procesa los PROGRAMADO: no salia nunca, aunque la pantalla
  // prometia que saldria apenas la cuenta estuviera conectada. Aprobar
  // sin fecha significa "sale en la proxima corrida", asi que se deja
  // programado para ahora mismo.
  const programadoPara = post.programadoPara ?? new Date();

  await prisma.socialPost.update({
    where: { id: postId },
    data: {
      aprobadoEn: new Date(),
      aprobadoPor: usuario?.name ?? usuario?.email ?? "Sistema",
      estado: "PROGRAMADO",
      programadoPara,
      error: null,
    },
  });

  revalidatePath(RUTA_PUBLICACIONES);
  return {
    ok: true,
    mensaje: post.programadoPara
      ? "Aprobado. Sale en la fecha programada."
      : "Aprobado. Sale en la proxima corrida diaria, o puedes usar “Publicar ahora”.",
  };
}

export async function publicarAhora(formData: FormData) {
  const postId = texto(formData, "postId");
  const resultado = await publicarPost(postId, { forzadoPorUsuario: true });
  revalidatePath(RUTA_PUBLICACIONES);
  return resultado;
}
