"use client";

import { useMemo, useState, useTransition } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ImagePlus,
  Instagram,
  RefreshCw,
  Send,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import clsx from "clsx";
import { Panel, StatusPill } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import {
  agregarImagen,
  aprobarPost,
  crearBorradorDesdeVehiculo,
  eliminarPost,
  guardarBorrador,
  publicarAhora,
  quitarImagen,
  regenerarCaption,
  subirImagen,
} from "@/lib/actions/social";

export type PostEnLista = {
  id: string;
  formato: string;
  estado: string;
  plantilla: string;
  caption: string;
  programadoPara: string | null;
  publicadoEn: string | null;
  igPermalink: string | null;
  error: string | null;
  aprobadoPor: string | null;
  aprobadoEn: string | null;
  vehiculo: string | null;
  medias: { id: string; url: string; tipo: string }[];
};

export type OpcionVehiculo = {
  id: string;
  etiqueta: string;
  conPrecio: boolean;
};

const TONO_ESTADO: Record<string, "neutral" | "good" | "warn" | "bad"> = {
  BORRADOR: "neutral",
  PENDIENTE_APROBACION: "warn",
  PROGRAMADO: "warn",
  PUBLICANDO: "warn",
  PUBLICADO: "good",
  ERROR: "bad",
  CANCELADO: "neutral",
};

const ETIQUETA_ESTADO: Record<string, string> = {
  BORRADOR: "Borrador",
  PENDIENTE_APROBACION: "Aprobado, sin fecha",
  PROGRAMADO: "Programado",
  PUBLICANDO: "Publicando",
  PUBLICADO: "Publicado",
  ERROR: "Con error",
  CANCELADO: "Cancelado",
};

export function PublicacionesWorkspace({
  posts,
  vehiculos,
  plantillas,
  formatos,
  cuentaConectada,
  requiereAprobacion,
  publicadosHoy,
  topeDiario,
}: {
  posts: PostEnLista[];
  vehiculos: OpcionVehiculo[];
  plantillas: readonly (readonly [string, string])[];
  formatos: readonly (readonly [string, string])[];
  cuentaConectada: boolean;
  requiereAprobacion: boolean;
  publicadosHoy: number;
  topeDiario: number;
}) {
  const [seleccionado, setSeleccionado] = useState<string | null>(posts[0]?.id ?? null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  const post = useMemo(() => posts.find((p) => p.id === seleccionado) ?? null, [posts, seleccionado]);

  function ejecutar(accion: (fd: FormData) => Promise<{ ok: boolean; mensaje: string } | void>, fd: FormData) {
    iniciar(async () => {
      const resultado = await accion(fd);
      if (resultado) setAviso({ ok: resultado.ok, texto: resultado.mensaje });
      else setAviso(null);
    });
  }

  function manejar(accion: (fd: FormData) => Promise<{ ok: boolean; mensaje: string } | void>) {
    return (evento: React.FormEvent<HTMLFormElement>) => {
      evento.preventDefault();
      const form = evento.currentTarget;
      ejecutar(accion, new FormData(form));
    };
  }

  return (
    <div className="grid gap-6">
      {aviso ? (
        <div
          className={clsx(
            "rounded-lg border p-4 text-sm font-semibold",
            aviso.ok
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-red-300 bg-red-50 text-red-900"
          )}
        >
          {aviso.texto}
        </div>
      ) : null}

      {!cuentaConectada ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <p className="font-black text-amber-900">La cuenta de Instagram todavia no esta conectada.</p>
            <p className="mt-1 text-sm font-semibold text-amber-900">
              Puede preparar y aprobar publicaciones igual: quedan en la cola y salen en la primera corrida diaria despues de que conecte la cuenta en{" "}
              <a className="underline" href="/configuracion/instagram">
                Configuracion &gt; Instagram
              </a>
              .
            </p>
          </div>
        </div>
      ) : null}

      <Panel>
        <h2 className="text-xl font-black text-ink">Nuevo post desde el catalogo</h2>
        <p className="mt-1 text-sm font-semibold text-steel">
          El texto se arma con la ficha y el precio vigente del vehiculo. Sale como borrador para que usted lo edite.
        </p>
        <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={manejar(crearBorradorDesdeVehiculo)}>
          <label className="md:col-span-2 grid gap-1">
            <span className="text-xs font-black uppercase text-steel">Vehiculo</span>
            <select name="versionId" className="input" required defaultValue="">
              <option value="" disabled>
                Elija una version
              </option>
              {vehiculos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.etiqueta}
                  {v.conPrecio ? "" : "  (sin precio vigente)"}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-black uppercase text-steel">Plantilla</span>
            <select name="plantilla" className="input" defaultValue="LANZAMIENTO">
              {plantillas.map(([clave, etiqueta]) => (
                <option key={clave} value={clave}>
                  {etiqueta}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-black uppercase text-steel">Formato</span>
            <select name="formato" className="input" defaultValue="FEED">
              {formatos.map(([clave, etiqueta]) => (
                <option key={clave} value={clave}>
                  {etiqueta}
                </option>
              ))}
            </select>
          </label>
          <div className="md:col-span-4">
            <button className="btn btn-primary" type="submit" disabled={pendiente}>
              Generar borrador
            </button>
          </div>
        </form>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Panel className="h-fit">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-ink">Cola</h2>
            <span className="text-xs font-black uppercase text-steel">
              {publicadosHoy}/{topeDiario} hoy
            </span>
          </div>
          <div className="mt-3 grid gap-2">
            {posts.length ? (
              posts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSeleccionado(p.id)}
                  className={clsx(
                    "rounded-lg border p-3 text-left transition",
                    p.id === seleccionado
                      ? "border-copper bg-copper/5"
                      : "border-graphite/10 hover:border-copper/40"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black uppercase text-steel">{p.formato}</span>
                    <StatusPill tone={TONO_ESTADO[p.estado] ?? "neutral"}>
                      {ETIQUETA_ESTADO[p.estado] ?? p.estado}
                    </StatusPill>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm font-bold text-ink">
                    {p.vehiculo ?? p.caption.slice(0, 60)}
                  </p>
                  {p.programadoPara && p.estado === "PROGRAMADO" ? (
                    <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-steel">
                      <CalendarClock className="h-3 w-3" /> {formatDateTime(p.programadoPara)}
                    </p>
                  ) : null}
                </button>
              ))
            ) : (
              <p className="text-sm font-semibold text-steel">No hay publicaciones todavia.</p>
            )}
          </div>
        </Panel>

        {post ? (
          <div className="grid gap-4">
            <Panel>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-ink">{post.vehiculo ?? "Publicacion libre"}</h2>
                  <p className="mt-1 text-sm font-semibold text-steel">
                    {ETIQUETA_ESTADO[post.estado] ?? post.estado}
                    {post.aprobadoPor ? ` · aprobado por ${post.aprobadoPor}` : ""}
                    {post.publicadoEn ? ` · publicado ${formatDateTime(post.publicadoEn)}` : ""}
                  </p>
                </div>
                {post.igPermalink ? (
                  <a className="btn" href={post.igPermalink} target="_blank" rel="noreferrer">
                    <Instagram className="h-4 w-4" /> Ver en Instagram
                  </a>
                ) : null}
              </div>

              {post.error ? (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                  <p className="text-sm font-semibold text-red-900">{post.error}</p>
                </div>
              ) : null}

              {post.estado !== "PUBLICADO" ? (
                <form className="mt-4 grid gap-3" onSubmit={manejar(guardarBorrador)}>
                  <input type="hidden" name="postId" value={post.id} />
                  <label className="grid gap-1">
                    <span className="text-xs font-black uppercase text-steel">Caption</span>
                    <textarea
                      key={`${post.id}-${post.caption.length}`}
                      name="caption"
                      className="input min-h-[220px] font-medium"
                      defaultValue={post.caption}
                    />
                  </label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="grid gap-1">
                      <span className="text-xs font-black uppercase text-steel">Formato</span>
                      <select name="formato" className="input" defaultValue={post.formato}>
                        {formatos.map(([clave, etiqueta]) => (
                          <option key={clave} value={clave}>
                            {etiqueta}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1">
                      <span className="text-xs font-black uppercase text-steel">Programar para</span>
                      <input
                        type="datetime-local"
                        name="programadoPara"
                        className="input"
                        defaultValue={post.programadoPara ? post.programadoPara.slice(0, 16) : ""}
                      />
                      <span className="text-xs font-semibold text-steel">
                        La revision de programados corre una vez al dia, a las 10:00 de Chile. Un post con hora
                        anterior sale en esa corrida, no a la hora exacta. Para que salga al instante, usa
                        &ldquo;Publicar ahora&rdquo;.
                      </span>
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-primary" type="submit" disabled={pendiente}>
                      Guardar
                    </button>
                    <button
                      className="btn"
                      type="button"
                      disabled={pendiente}
                      onClick={() => {
                        const fd = new FormData();
                        fd.set("postId", post.id);
                        ejecutar(regenerarCaption, fd);
                      }}
                    >
                      <RefreshCw className="h-4 w-4" /> Regenerar con datos de hoy
                    </button>
                  </div>
                </form>
              ) : (
                <p className="mt-4 whitespace-pre-wrap text-sm font-medium text-ink">{post.caption}</p>
              )}
            </Panel>

            <Panel>
              <h3 className="text-lg font-black text-ink">Imagenes</h3>
              <p className="mt-1 text-sm font-semibold text-steel">
                Instagram descarga las imagenes desde una URL publica HTTPS. Un archivo del computador no sirve: subalo
                primero (por ejemplo a Documentos del panel) y pegue el enlace.
              </p>
              <div className="mt-3 grid gap-2">
                {post.medias.length ? (
                  post.medias.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-graphite/10 p-2"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.url} alt="" className="h-14 w-14 rounded object-cover" />
                      <span className="flex-1 truncate text-xs font-semibold text-steel">{m.url}</span>
                      {post.estado !== "PUBLICADO" ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={pendiente}
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("mediaId", m.id);
                            ejecutar(quitarImagen, fd);
                          }}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm font-semibold text-steel">Sin imagenes. Un post sin imagen no se puede publicar.</p>
                )}
              </div>

              {post.estado !== "PUBLICADO" ? (
                <div className="mt-3 grid gap-2">
                  <form className="flex flex-wrap gap-2" onSubmit={manejar(subirImagen)}>
                    <input type="hidden" name="postId" value={post.id} />
                    <input
                      type="file"
                      name="archivo"
                      accept="image/jpeg,image/png,image/webp,video/mp4"
                      className="input flex-1"
                      required
                    />
                    <button className="btn btn-primary" type="submit" disabled={pendiente}>
                      <ImagePlus className="h-4 w-4" /> Subir archivo
                    </button>
                  </form>
                  <form className="flex gap-2" onSubmit={manejar(agregarImagen)}>
                    <input type="hidden" name="postId" value={post.id} />
                    <input
                      name="url"
                      className="input flex-1"
                      placeholder="...o pega una URL https publica"
                      required
                    />
                    <button className="btn" type="submit" disabled={pendiente}>
                      Agregar URL
                    </button>
                  </form>
                </div>
              ) : null}
            </Panel>

            {post.estado !== "PUBLICADO" ? (
              <Panel>
                <h3 className="text-lg font-black text-ink">Publicar</h3>
                <p className="mt-1 text-sm font-semibold text-steel">
                  {requiereAprobacion
                    ? "La cuenta esta en modo revision: nada sale sin aprobacion."
                    : "La cuenta publica sin aprobacion previa."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="btn"
                    type="button"
                    disabled={pendiente || Boolean(post.aprobadoEn)}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("postId", post.id);
                      ejecutar(aprobarPost, fd);
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {post.aprobadoEn ? "Ya aprobado" : "Aprobar"}
                  </button>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={pendiente || !cuentaConectada}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("postId", post.id);
                      ejecutar(publicarAhora, fd);
                    }}
                  >
                    <Send className="h-4 w-4" /> Publicar ahora
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={pendiente}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("postId", post.id);
                      ejecutar(eliminarPost, fd);
                      setSeleccionado(null);
                    }}
                  >
                    <Trash2 className="h-4 w-4" /> Eliminar
                  </button>
                </div>
              </Panel>
            ) : null}
          </div>
        ) : (
          <Panel>
            <p className="text-sm font-semibold text-steel">Elija una publicacion de la cola o genere un borrador nuevo.</p>
          </Panel>
        )}
      </div>
    </div>
  );
}
