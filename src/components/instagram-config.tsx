"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { Panel } from "@/components/ui";
import { cambiarModoAprobacion, conectarInstagram, desconectarInstagram } from "@/lib/actions/social";

export function InstagramConfig({
  conectado,
  requiereAprobacion,
}: {
  conectado: boolean;
  requiereAprobacion: boolean;
}) {
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  return (
    <div className="grid gap-6">
      {aviso ? (
        <div
          className={clsx(
            "rounded-lg border p-4 text-sm font-semibold",
            aviso.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"
          )}
        >
          {aviso.texto}
        </div>
      ) : null}

      <Panel>
        <h2 className="text-xl font-black text-ink">{conectado ? "Reemplazar credenciales" : "Conectar cuenta"}</h2>
        <p className="mt-1 text-sm font-semibold text-steel">
          El token se verifica contra Meta antes de guardarse, y se guarda cifrado. No se muestra completo en ninguna
          pantalla ni queda en los logs.
        </p>
        <form
          className="mt-4 grid gap-3"
          onSubmit={(evento) => {
            evento.preventDefault();
            const fd = new FormData(evento.currentTarget);
            iniciar(async () => {
              const r = await conectarInstagram(fd);
              setAviso({ ok: r.ok, texto: r.mensaje });
            });
          }}
        >
          <label className="grid gap-1">
            <span className="text-xs font-black uppercase text-steel">ID de la cuenta Instagram Business</span>
            <input name="igUserId" className="input" placeholder="17841400000000000" required />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-black uppercase text-steel">Token de acceso de larga duracion</span>
            <input name="token" type="password" className="input" placeholder="EAAG..." required autoComplete="off" />
          </label>
          <div>
            <button className="btn btn-primary" type="submit" disabled={pendiente}>
              Verificar y guardar
            </button>
          </div>
        </form>
      </Panel>

      <Panel>
        <h2 className="text-xl font-black text-ink">Modo de publicacion</h2>
        <p className="mt-1 text-sm font-semibold text-steel">
          Con revision activada, ninguna publicacion sale sin que una persona la apruebe, ni siquiera las programadas.
        </p>
        <form
          className="mt-4 flex flex-wrap items-center gap-3"
          onSubmit={(evento) => {
            evento.preventDefault();
            const fd = new FormData(evento.currentTarget);
            iniciar(async () => {
              await cambiarModoAprobacion(fd);
              setAviso({ ok: true, texto: "Modo actualizado." });
            });
          }}
        >
          <select name="requiereAprobacion" className="input max-w-sm" defaultValue={String(requiereAprobacion)}>
            <option value="true">Exigir aprobacion antes de publicar (recomendado)</option>
            <option value="false">Publicar sin aprobacion</option>
          </select>
          <button className="btn" type="submit" disabled={pendiente}>
            Guardar
          </button>
        </form>
      </Panel>

      {conectado ? (
        <Panel>
          <h2 className="text-xl font-black text-ink">Desconectar</h2>
          <p className="mt-1 text-sm font-semibold text-steel">
            Borra el token guardado en el panel. No toca la cuenta de Instagram ni lo ya publicado.
          </p>
          <button
            className="btn btn-danger mt-3"
            type="button"
            disabled={pendiente}
            onClick={() =>
              iniciar(async () => {
                await desconectarInstagram();
                setAviso({ ok: true, texto: "Cuenta desconectada." });
              })
            }
          >
            Desconectar cuenta
          </button>
        </Panel>
      ) : null}
    </div>
  );
}
