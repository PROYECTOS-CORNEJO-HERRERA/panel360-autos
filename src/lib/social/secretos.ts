import crypto from "node:crypto";

// ============================================================
// CIFRADO DEL TOKEN DE INSTAGRAM
// ============================================================
//
// El token de Meta es, en la practica, la llave de la cuenta: quien lo
// tiene publica. Guardarlo en texto plano en la base significa que
// cualquier copia de seguridad, cualquier export de datos y cualquier
// consulta accidental lo expone.
//
// Se cifra con AES-256-GCM usando PANEL360_SECRET_KEY. GCM y no CBC
// porque ademas de cifrar autentica: si alguien altera la fila en la
// base, el descifrado falla en vez de devolver basura silenciosa.
//
// Si la llave no esta configurada NO se cifra con una llave por
// defecto: se rechaza guardar. Una llave por defecto daria la
// sensacion de seguridad sin darla.

const ALGORITMO = "aes-256-gcm";

export class SecretoNoConfigurado extends Error {
  constructor() {
    super(
      "Falta PANEL360_SECRET_KEY. Sin esa variable el token de Instagram no se puede guardar cifrado, y guardarlo en claro no es una opcion."
    );
    this.name = "SecretoNoConfigurado";
  }
}

function llave() {
  const bruta = process.env.PANEL360_SECRET_KEY;
  if (!bruta || bruta.length < 16) throw new SecretoNoConfigurado();
  // Se deriva a 32 bytes para aceptar llaves de cualquier largo sin
  // pedirle al usuario que genere exactamente 32 caracteres.
  return crypto.createHash("sha256").update(bruta).digest();
}

export function haySecretoConfigurado() {
  const bruta = process.env.PANEL360_SECRET_KEY;
  return Boolean(bruta && bruta.length >= 16);
}

export function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITMO, llave(), iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), cifrado.toString("base64")].join(".");
}

export function descifrar(guardado: string): string {
  const partes = guardado.split(".");
  if (partes.length !== 3) {
    throw new Error("El token guardado no tiene el formato esperado. Vuelva a conectar la cuenta.");
  }
  const [iv, tag, cifrado] = partes.map((p) => Buffer.from(p, "base64"));
  const decipher = crypto.createDecipheriv(ALGORITMO, llave(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString("utf8");
}

/** Para mostrar en pantalla sin revelar el token. */
export function enmascarar(token: string) {
  if (!token) return "";
  if (token.length <= 12) return "********";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}
