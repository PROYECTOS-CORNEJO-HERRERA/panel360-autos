# Publicaciones a Instagram desde Panel360 (Bloque F)

## Qué hace

Panel360 arma el post con la ficha y el **precio vigente** del catálogo, lo deja en
una cola con fecha, y lo publica en Instagram por la **API oficial de Meta**.

Pantallas:

- `/publicaciones` — generar borradores, editar, aprobar, programar, publicar.
- `/configuracion/instagram` — conectar la cuenta y ver los límites de Meta.

## Por qué solo la vía oficial

Existen librerías que automatizan Instagram con usuario y clave (`instagrapi` y
similares). Funcionan hasta que Meta las detecta y cierra la cuenta. Una cuenta
que representa a la marca no se expone a eso, así que el sistema **no** las usa y
no hay una opción para activarlas.

El costo de esa decisión es el trámite inicial en Meta. No hay atajo.

## Lo que hay que hacer una sola vez en Meta

1. **Pasar el Instagram a cuenta de empresa.**
   App de Instagram → Configuración → Tipo de cuenta → Cambiar a cuenta
   profesional → Empresa. Una cuenta personal no puede publicar por la API.

2. **Crear una Página de Facebook y vincularla.**
   Meta exige que el Instagram Business esté ligado a una Página. La Página puede
   quedar sin contenido: existe para que el permiso pase por ahí. Se vincula desde
   la propia app de Instagram, en Configuración → Compartir en otras aplicaciones.

3. **Crear la app en developers.facebook.com.**
   Tipo "Empresa". Agregar el producto *Instagram Graph API*. Pedir los permisos
   `instagram_basic`, `instagram_content_publish` y `pages_show_list`.

4. **Pasar App Review.**
   Meta revisa la app antes de dejarla publicar en cuentas que no sean de prueba.
   Suele tardar días. Mientras tanto se puede probar todo agregando la propia
   cuenta con rol de desarrollador en la app.

5. **Obtener el ID de la cuenta y el token largo.**
   En el Explorador de la API de Graph:
   - `me/accounts` → da el `page-id`.
   - `{page-id}?fields=instagram_business_account` → da el **ID de Instagram**
     (empieza con `1784...`).
   - El token corto se cambia por uno de **larga duración** (~60 días) con
     `oauth/access_token?grant_type=fb_exchange_token`.

6. **Pegarlos en `/configuracion/instagram`.**
   El panel los verifica contra Meta antes de guardarlos. Si el token está malo,
   lo dice ahí y no a las 9 de la mañana con un post encolado.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `PANEL360_SECRET_KEY` | Llave con la que se cifra el token (AES-256-GCM). Mínimo 16 caracteres. Sin esto el panel **se niega** a guardar el token. |
| `CRON_SECRET` | Protege `/api/cron/publicaciones`. |

Si `PANEL360_SECRET_KEY` cambia, el token guardado deja de poder descifrarse y hay
que volver a conectar la cuenta. Es el comportamiento buscado: es una llave, no un
valor de configuración cualquiera.

## Las tres guardas antes de publicar

Viven en `src/lib/social/cola.ts`, en un solo lugar, porque son tres caminos los
que terminan publicando (botón "publicar ahora", cron de programados, reintento).

1. **Aprobación.** Si la cuenta está en modo revisión (por defecto), un post que
   nadie aprobó no sale. Editar el texto de un post ya aprobado **anula** la
   aprobación: aprobar un texto y publicar otro vaciaría de sentido el paso.

2. **Precio desfasado.** Al redactar se guarda un *snapshot* del precio. Si al
   momento de publicar el precio vigente ya no es ese, el post **no sale** y queda
   en ERROR diciendo las dos cifras. Publicar un precio viejo es exactamente el
   problema que el Bloque B arregló en pantalla; no tiene sentido reintroducirlo
   por Instagram.

3. **Tope de Meta.** 25 publicaciones cada 24 horas por cuenta. El panel frena
   antes y lo dice, en vez de dejar que Meta rechace con un error críptico.

## Límites que impone Meta

- 25 publicaciones / 24 h por cuenta.
- Las imágenes y videos deben estar en una **URL pública HTTPS**: Instagram los
  descarga desde su servidor. Un archivo del computador o un `localhost` no sirve.
- Carrusel: entre 2 y 10 imágenes.
- Caption: hasta 2.200 caracteres y 30 hashtags (el panel valida ambos).
- La API **no** responde comentarios ni mensajes directos con estos permisos. Eso
  sigue siendo a mano.

## Programación

El cron `/api/cron/publicaciones` corre cada hora (`vercel.json`) y publica lo que
quedó programado para una hora que ya pasó. La granularidad es de una hora a
propósito: programar al minuto exacto obligaría a un cron por minuto y para un
post de catálogo eso no aporta nada.

## Archivos

```
prisma/schema.prisma              SocialAccount, SocialPost, SocialPostMedia
src/lib/social/secretos.ts        cifrado del token (AES-256-GCM)
src/lib/social/instagram.ts       cliente de la Graph API
src/lib/social/plantillas.ts      redacción del caption desde el catálogo
src/lib/social/cola.ts            las tres guardas + procesado del cron
src/lib/actions/social.ts         server actions
src/app/publicaciones/            pantalla de cola y composición
src/app/configuracion/instagram/  conexión de la cuenta
src/app/api/cron/publicaciones/   cron horario
```
