import { NextResponse, type NextRequest } from "next/server";

const authCookieName = "aca_session";
// /api/acceso-panel360 es la entrada desde Panel360 (bloque S.058): tiene
// que ser publica porque justamente su trabajo es crear la sesion. No
// valida con la cookie sino con un token firmado de corta vida.
const publicPrefixes = ["/login", "/recuperar-clave", "/api/acceso-panel360"];

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.VERCEL) return "";
  return "local-development-auth-secret-change-before-vercel";
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function base64UrlEncode(bytes: ArrayBuffer) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function constantTimeEquals(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

async function sign(body: string) {
  const secret = getAuthSecret();
  if (!secret) return "";

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return base64UrlEncode(signature);
}

async function verifySession(token?: string) {
  if (!token || !token.includes(".")) return false;
  const [body, signature] = token.split(".");
  if (!body || !signature) return false;

  const expectedSignature = await sign(body);
  if (!expectedSignature || !constantTimeEquals(expectedSignature, signature)) return false;

  try {
    const payload = JSON.parse(base64UrlDecode(body)) as { exp?: number; sub?: string };
    return Boolean(payload.sub && payload.exp && payload.exp >= Math.floor(Date.now() / 1000));
  } catch {
    return false;
  }
}

function isPublicPath(pathname: string) {
  return publicPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAuthenticated = await verifySession(request.cookies.get(authCookieName)?.value);

  if (isPublicPath(pathname)) {
    if (isAuthenticated && pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }

    return NextResponse.next();
  }

  if (!isAuthenticated) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sesion requerida." }, { status: 401 });
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|mp3|mp4|woff|woff2|ttf|otf)$).*)"]
};
