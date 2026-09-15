import { InstagramConfig } from "@/components/instagram-config";
import { Notice, PageHeader, Panel, StatusPill } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { estadoInstagram } from "@/lib/social/instagram";

export const dynamic = "force-dynamic";

const PASOS = [
  {
    titulo: "1. Pasar el Instagram a cuenta de empresa",
    detalle:
      "En la app de Instagram: Configuracion > Tipo de cuenta > Cambiar a cuenta profesional > Empresa. Una cuenta personal no puede publicar por la API, no hay forma de saltarse este paso.",
  },
  {
    titulo: "2. Crear una Pagina de Facebook y vincularla",
    detalle:
      "Meta exige que el Instagram Business este ligado a una Pagina. La Pagina puede quedar sin contenido: existe para que el permiso pase por ahi. Se vincula desde la propia app de Instagram, en Configuracion > Compartir en otras aplicaciones.",
  },
  {
    titulo: "3. Crear la app en developers.facebook.com",
    detalle:
      "Tipo 'Empresa'. Agregar el producto 'Instagram Graph API'. Pedir los permisos instagram_basic, instagram_content_publish y pages_show_list.",
  },
  {
    titulo: "4. Pasar App Review",
    detalle:
      "Meta revisa la app antes de dejarla publicar en cuentas que no sean de prueba. Suele tardar dias. Mientras tanto se puede probar todo con la cuenta propia agregada como rol de desarrollador.",
  },
  {
    titulo: "5. Obtener el ID de la cuenta y el token largo",
    detalle:
      "En el Explorador de la API de Graph: consultar me/accounts para llegar a la Pagina, y luego {page-id}?fields=instagram_business_account para obtener el ID de Instagram. El token corto se intercambia por uno de larga duracion (~60 dias) con el endpoint oauth/access_token de tipo fb_exchange_token.",
  },
  {
    titulo: "6. Pegarlos aqui",
    detalle:
      "El panel los verifica contra Meta y los guarda cifrados. Si el token esta malo, lo dice ahora y no a las 9 de la manana con un post encolado.",
  },
];

export default async function InstagramConfigPage() {
  const estado = await estadoInstagram();

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="ADMINISTRACION"
        title="Instagram"
        description="Conexion con la API oficial de Meta para publicar desde el panel."
      />

      <Notice>
        Panel360 publica solo por la API oficial. No se automatiza la app con usuario y clave: eso funciona hasta que
        Meta lo detecta y cierra la cuenta, y una cuenta que representa a la marca no se expone a eso.
      </Notice>

      <Panel>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-black uppercase text-copper">Estado</p>
            <h2 className="mt-1 flex items-center gap-3 text-2xl font-black text-ink">
              {estado.etiqueta}
              <StatusPill tone={estado.conectado ? "good" : "warn"}>
                {estado.conectado ? "OPERATIVO" : "SIN PUBLICAR"}
              </StatusPill>
            </h2>
            <p className="mt-1 text-sm font-semibold text-steel">{estado.detalle}</p>
            {estado.username ? (
              <p className="mt-1 text-sm font-semibold text-steel">Cuenta: @{estado.username}</p>
            ) : null}
            {estado.tokenPreview ? (
              <p className="mt-1 text-sm font-semibold text-steel">Token: {estado.tokenPreview}</p>
            ) : null}
            {estado.expiraEn ? (
              <p className="mt-1 text-sm font-semibold text-steel">
                El token caduca el {formatDate(estado.expiraEn)}. Renuevelo antes de esa fecha o las publicaciones
                programadas van a fallar.
              </p>
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel>
        <h2 className="text-xl font-black text-ink">Lo que hay que hacer una sola vez en Meta</h2>
        <ol className="mt-4 grid gap-4">
          {PASOS.map((paso) => (
            <li key={paso.titulo} className="rounded-lg border border-graphite/10 p-4">
              <p className="font-black text-ink">{paso.titulo}</p>
              <p className="mt-1 text-sm font-semibold text-steel">{paso.detalle}</p>
            </li>
          ))}
        </ol>
      </Panel>

      <InstagramConfig conectado={estado.conectado} requiereAprobacion={estado.requiereAprobacion} />

      <Panel>
        <h2 className="text-xl font-black text-ink">Limites que impone Meta</h2>
        <ul className="mt-3 grid gap-2 text-sm font-semibold text-steel">
          <li>25 publicaciones cada 24 horas por cuenta. El panel frena antes de llegar al tope.</li>
          <li>Las imagenes y videos deben estar en una URL publica HTTPS: Instagram los descarga desde su servidor.</li>
          <li>Carrusel: entre 2 y 10 imagenes. Caption: hasta 2.200 caracteres y 30 hashtags.</li>
          <li>La API no responde comentarios ni mensajes directos con estos permisos. Eso sigue siendo a mano.</li>
        </ul>
      </Panel>
    </div>
  );
}
