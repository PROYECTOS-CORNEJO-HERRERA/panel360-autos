import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieName, createSessionToken, sessionMaxAge } from "@/lib/auth-core";
import { prisma } from "@/lib/prisma";

// Entrada desde Panel360 (bloque S.058).
//
// Panel360 no reimplementa este sistema: genera un token firmado de
// corta vida con el correo del usuario y redirige aca. Esta ruta lo
// valida, confirma que ese correo exista como usuario activo, y crea la
// cookie de sesion de siempre (aca_session). El usuario entra directo a
// su sistema completo, sin escribir clave de nuevo.
//
// El secreto es propio de este canal (PANEL360_SSO_SECRET), distinto de
// AUTH_SECRET: si se filtrara uno, no sirve para lo del otro.

const MAX_EDAD_TOKEN_SEGUNDOS = 60;

function secretoSso() {
  const secreto = process.env.PANEL360_SSO_SECRET;
  if (!secreto || secreto.length < 32) return null;
  return secreto;
}

function firmar(cuerpo: string, secreto: string) {
  return createHmac("sha256", secreto).update(cuerpo).digest("base64url");
}

function firmaValida(cuerpo: string, firma: string, secreto: string) {
  const esperada = Buffer.from(firmar(cuerpo, secreto));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length) return false;
  return timingSafeEqual(esperada, recibida);
}

function alLogin(request: NextRequest, motivo: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", motivo);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const secreto = secretoSso();
  if (!secreto) {
    // Sin secreto configurado el canal no existe: no se degrada a
    // "entrar sin validar", se rechaza.
    return alLogin(request, "acceso-no-configurado");
  }

  const token = request.nextUrl.searchParams.get("token");
  if (!token || !token.includes(".")) return alLogin(request, "token-invalido");

  const [cuerpo, firma] = token.split(".");
  if (!cuerpo || !firma || !firmaValida(cuerpo, firma, secreto)) {
    return alLogin(request, "token-invalido");
  }

  let datos: { email?: string; iat?: number };
  try {
    datos = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
  } catch {
    return alLogin(request, "token-invalido");
  }

  const ahora = Math.floor(Date.now() / 1000);
  if (!datos.email || !datos.iat || ahora - datos.iat > MAX_EDAD_TOKEN_SEGUNDOS || datos.iat > ahora + 30) {
    return alLogin(request, "token-vencido");
  }

  // El usuario tiene que existir aca y estar activo. No se crea al
  // vuelo: dar de alta usuarios es una decision explicita, no un efecto
  // secundario de hacer clic en un enlace.
  const usuario = await prisma.appUser.findUnique({
    where: { email: datos.email.toLowerCase() }
  });

  if (!usuario || usuario.status !== "ACTIVO") {
    return alLogin(request, "sin-acceso");
  }

  const sesion = createSessionToken({
    id: usuario.id,
    email: usuario.email,
    name: usuario.name,
    role: usuario.role
  });

  // "?bienvenido" es lo que dispara la intro del vehiculo (ver
  // src/app/page.tsx). El login normal la agrega; al entrar desde
  // Panel360 hay que agregarla igual, si no se entra sin el efecto.
  const respuesta = NextResponse.redirect(new URL("/?bienvenido=1", request.url));
  respuesta.cookies.set({
    name: authCookieName,
    value: sesion,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAge()
  });
  return respuesta;
}
