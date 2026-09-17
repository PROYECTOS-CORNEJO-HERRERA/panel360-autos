"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

// Sin este archivo, cualquier error del servidor mostraba la pantalla negra
// "500 Internal Server Error" de Vercel: sin decir que paso, sin decir que
// hacer, y sin forma de volver. Aca al menos se explica y se puede salir.
//
// El caso mas frecuente no es un error de verdad: es que la pagina lleva
// rato abierta y mientras tanto se publico una version nueva del sistema.
// Next.js identifica cada accion de formulario con un codigo que cambia en
// cada publicacion, asi que el boton de una pestaña vieja apunta a algo que
// ya no existe. Se arregla recargando, y eso es lo que decimos.

const MENSAJE_DESFASE =
  "Esta pagina se abrio antes de la ultima actualizacion del sistema, asi que el boton que apretaste ya no existe en el servidor. No se perdio nada: recarga la pagina y vuelve a intentarlo.";

function esDesfaseDeVersion(error: Error) {
  return /Failed to find Server Action|older or newer deployment/i.test(error.message);
}

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const desfase = esDesfaseDeVersion(error);

  return (
    <div className="mx-auto grid max-w-xl gap-4 p-8">
      <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-5">
        <TriangleAlert className="mt-0.5 h-6 w-6 shrink-0 text-amber-700" aria-hidden="true" />
        <div>
          <h1 className="text-lg font-black text-amber-900">
            {desfase ? "La pagina esta desactualizada" : "Algo fallo al procesar esto"}
          </h1>
          <p className="mt-2 text-sm font-semibold text-amber-900">
            {desfase ? MENSAJE_DESFASE : "El servidor no pudo completar la operacion. Puedes reintentar; si vuelve a fallar, avisa con el codigo de abajo."}
          </p>
          {error.digest ? (
            <p className="mt-3 text-xs font-bold text-amber-800">
              Codigo del error: <span className="font-mono">{error.digest}</span>
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Recargar la pagina
        </button>
        <button className="btn" type="button" onClick={reset}>
          Reintentar
        </button>
        <a className="btn" href="/">
          Volver al inicio
        </a>
      </div>
    </div>
  );
}
