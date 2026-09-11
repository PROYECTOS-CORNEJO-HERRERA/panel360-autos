# INFORME DE CAMBIOS — Panel360 Autos
## Documento de Traspaso para Codex

**Fecha de generación:** 13 de agosto de 2026
**Sistema:** Panel360 Autos — Asistente Comercial Automotriz
**URL producción:** https://sistema-comercial-automotriz.vercel.app
**Repositorio:** https://github.com/victorandresherreralopez-cloud/panel360-autos
**Stack:** Next.js 14 · Prisma ORM · Supabase PostgreSQL · Vercel · TypeScript

---

## ARQUITECTURA FINAL

```
GitHub (panel360-autos)  →  Vercel (CI/CD auto)  →  Supabase PostgreSQL
     Código fuente             Build + Deploy           32 tablas en prod
     (Next.js 14)             (sin db push)
```

**BD local (desarrollo):** SQLite `prisma/dev.db`
**BD producción:** Supabase PostgreSQL (proyecto `vesobzvcorxxxvdxdzqk`)
**Rama que despliega en Vercel:** `main`

---

## CREDENCIALES DE ACCESO

| Cuenta | Email | Contraseña |
|---|---|---|
| Administrador | `victorherrera@sergioescobar.cl` | `Vitoko.2022` |
| Demo | `demo@panel360autos.cl` | `Vitoko.2022` |

---

## RESUMEN EJECUTIVO

El proyecto fue recibido como una app Next.js 14 local (SQLite, sin Git, sin deploy).
Se realizaron **42 commits** agrupados en 9 etapas principales.

---

## ETAPA 1 — Control de Versiones y Respaldo

### Estado recibido
- Next.js 14 sin Git inicializado
- SQLite local con: 6 marcas, 68 modelos, 165 versiones, 350 precios, 141 documentos, 301 extracciones
- Sin repositorio remoto

### Qué se hizo
- `git init` en la raíz
- Creación de `ESTADO_PROYECTO.md` (bitácora oficial)
- Exportación JSON: `backups/vercel/export-2026-08-12T19-23-57-771Z.json`
- Respaldo físico SQLite: `backups/2026-08-12/dev-fase1-baseline.db`

---

## ETAPA 2 — Despliegue GitHub + Vercel + Supabase

### GitHub
- Repositorio creado: `victorandresherreralopez-cloud/panel360-autos`
- Push de rama `master`
- Conexión GitHub ↔ Vercel (`npx vercel git connect`)

### Supabase PostgreSQL
- 32 tablas creadas con `prisma db push` (versión inicial)
- Importación completa de datos (`npm run data:import:vercel`):
  - 1 usuario admin, 6 marcas, 68 modelos, 165 versiones
  - 141 documentos, 8 actualizaciones, 301 extracciones
  - 350 precios + 350 historial de precios
  - 13 estados cliente, 8 orígenes, 352 logs auditoría
  - 13 acrónimos, 9 configuraciones notificación, 13 preguntas estudio

### Variables de entorno configuradas en Vercel
- `DATABASE_URL` → Pooler transaccional Supabase (puerto 6543)
- `DIRECT_URL` → Conexión directa Supabase (puerto 5432)
- `AUTH_SECRET` → Firma HMAC SHA-256 de sesiones
- `APP_TIMEZONE` → `America/Santiago`

### Correcciones en `scripts/build-vercel.mjs`
- Compatibilidad de rutas Windows vs Linux de Vercel
- Parámetro `--schema` de Prisma funcional en ambos entornos

---

## ETAPA 3 — Correcciones Funcionales Post-Despliegue

### 3.1 Fichas Técnicas PDF — Cero 404

**Problema:** Intentaba leer rutas `V:\...` locales que no existen en Vercel Linux.

**Solución (`commit 27d989b`):**
- 65 fichas técnicas actualizadas en Supabase con URLs directas S3:
  `https://dercocenter-api.s3.us-east-1.amazonaws.com/...pdf`
- `src/app/api/documents/[id]/download/route.ts` reescrito con 3 capas:
  1. Servir PDF desde disco del servidor
  2. Redirigir a URL remota S3
  3. Generar Ficha Técnica Digital HTML con impresión a PDF nativa

### 3.2 Perfilador "Cliente Frente a Mí" — Filtros Duros

**Problema:** Sistema de puntajes acumulativos ignoraba la exigencia de segmento.
Si el cliente pedía "Pickup", aparecían SUVs con buen precio.

**Solución (`commit 3b03544`):**
- Arquitectura de Hard Filtering obligatorio
- Si el cliente exige `Pickup`, SOLO aparecen Pickups (sin excepciones)
- Transmisión y carrocería como filtros duros, no opcionales

### 3.3 Desglose Comercial en `/vehiculos` (`commit fb80ef0`)
- **Valor Sin IVA (Neto):** `Precio con IVA / 1.19` para camionetas y comerciales
- **Comparativa:** Precio Lista vs Contado vs Financiamiento con Todos los Bonos
- **Gastos Puesta en Calle (Llave en Mano):** Flete + Impuesto Verde + Permiso Circulación
- **Badges de Bonos Compartidos:** Marca + Concesionario destacados

### 3.4 Impuesto Verde y Permiso de Circulación (`src/lib/taxes.ts`)
- **Impuesto Verde:** Consulta CSV oficial SII + cálculo UTMs (probado: $455.682 CLP)
- **Permiso de Circulación:** POST a API oficial Las Condes (probado: $133.870 CLP para $15M)
- **Distinción visual:** `VALOR OFICIAL CONFIRMADO` (verde) vs `VALOR ESTIMADO REFERENCIAL` (ámbar)
- APIs: `GET /api/taxes/green?price=&cylinder=` y `GET /api/taxes/permit?price=`

### 3.5 UI/UX Responsive
- Sidebar escritorio contraíble/expandible con tooltips, estado en `localStorage`
- Menú móvil: drawer lateral deslizable con botón hamburguesa
- Breakpoints probados: 375px, 390px, 430px, 768px, 1024px, 1440px
- Modo Oscuro/Claro: botón en header, preferencia en `localStorage`

### 3.6 Vitoko IA — Mascota Comercial
- Panel flotante con preguntas rápidas, historial de respuestas
- Botones minimizar y cerrar
- Integrado en dashboard principal

---

## ETAPA 4 — Integraciones Externas

### Telegram (`commit a5fa51d`)
- Código listo en `src/lib/notifications/telegram.ts`
- Envío a canal general o por `customChatId` de vendedor
- **Variable pendiente en Vercel:** `TELEGRAM_BOT_TOKEN`

### Resend Email (`commit a5fa51d`)
- Plantillas para: recuperación clave, cumpleaños, verificación, renovaciones
- **Variable pendiente en Vercel:** `RESEND_API_KEY`

### Cron Job Diario `/api/cron/daily-check`
- Detecta: renovaciones próximas, cumpleaños, cotizaciones vencidas
- Despacha alertas simultáneas Telegram + Resend

### Consulta RUT Chile
- `GET /api/customers/rut` — busca en BD local primero
- Validación Módulo 11 incluida
- **Variable pendiente:** `CUSTOMER_RUT_LOOKUP_URL` para proveedor externo

---

## ETAPA 5 — Motor Comercial Multi-Marca

### Nuevo Modelo Prisma: `CommercialOffer`

Diseñado para capturar la totalidad de las ofertas del libro comercial Derco:

```
offerType:    BONO_MARCA | BONO_FINANCIAMIENTO | BONO_CIERRE_COMPARTIDO |
              PATENTE_GRATIS | TASA | GIFTCARD | PRECIO_ESPECIAL | MANTENCION
channel:      REGULAR | DERCO_CL | PREVENTA | CONCESIONARIO
paymentType:  CONTADO | CREDITO | AMBOS
amountCash:   monto para contado
amountCredit: monto para crédito
aporteCES:    dinero del concesionario (CES)
aporteMarca:  dinero de la marca (Derco)
aporteCESCredit / aporteMarcaCredit: desglose para crédito
hasIva:       si el monto es +IVA (sin incluir)
rate:         ej "1.69%"
validFrom / validUntil: vigencia
incompatibleWith / compatibleWith: reglas de compatibilidad
sourceMonth:  ej "agosto 2026"
```

**Distinción crítica implementada (antes confundida):**
- `BONO_MARCA` = aporte exclusivo del fabricante
- `BONO_CIERRE_COMPARTIDO` = CES + Marca por separado (`aporteCES` + `aporteMarca`)

### Parser Multi-Hoja Excel (`commit c39c3ba`, `cee52cb`)

**Archivo:** `src/lib/importers/excel.ts` — reescritura completa

Procesa TODAS las hojas de libros comerciales Derco:
- Marcas: GWM, Mazda, Suzuki, Changan, Deepal, DFSK
- Detecta: bonos por hoja, tasas subvencionadas, patentes gratis, giftcards, mantenciones

### `CommercialOfferEngine` (`commit cb2dc90`, `083484f`)

**Archivo:** `src/lib/commercial-offer-engine.ts`

Motor de cálculo que:
- Aplica taxonomía completa: Lista, Contado, Financiamiento
- Calcula "Precio Puesto en Calle" con todos los gastos
- Clasifica 68 modelos en segmentos canónicos: `SEDAN | SUV | PICKUP | HATCHBACK | COMERCIAL`
- Ordena DFSK siempre al final

### Campos nuevos en modelo `Price`
```
channel:     REGULAR | DERCO_CL | PREVENTA (default: REGULAR)
hasIva:      true = monto es +IVA sin incluir (default: false)
bonusName:   nombre del bono incluido en el precio
bonusAmount: monto del bono
approvedBy:  quién aprobó el precio
```

### Campo `canonicalSegment` en `VehicleModel`
```
canonicalSegment: SEDAN | SUV | PICKUP | HATCHBACK | COMERCIAL
```
Permite búsquedas 100% confiables independiente de texto libre.

---

## ETAPA 6 — Nuevas Rutas y Módulos

| Ruta | Descripción |
|---|---|
| `/cliente-frente-a-mi` | Perfilador express con filtros duros |
| `/cierre-venta` | Registro de ventas con desglose comercial |
| `/renovaciones` | Motor de renovaciones (créditos por vencer) |
| `/agenda` | Recordatorios y follow-ups |
| `/aprender` | Capacitación con preguntas y progreso |
| `/historial-precios` | Historial de cambios de precios |
| `/ayudas-comerciales` | Alertas de bonos, tasas y campañas |
| `/plan-comercial` | Campañas activas por marca |
| `/admin` | Panel de administración |
| `/admin/importar-clientes` | Importador de cartera |
| `/whatsapp` | Plantillas de mensajes WhatsApp |
| `/modo-vendedor` | Modo presentación para el cliente |
| `/configuracion/telegram` | Config notificaciones Telegram |

---

## ETAPA 7 — Correcciones de Lógica Comercial

### 7.1 Precios incorrectos en Perfilador
**Problema:** Mezclaba bonos de contado con precios de financiamiento.
**Fix:** Motor diferencia `amountCash` vs `amountCredit`. Los bonos solo se aplican si `paymentType` coincide.

### 7.2 Búsqueda de Sedanes (Alsvin no aparecía)
**Fix:** Campo `canonicalSegment = "SEDAN"` aplicado a todos los sedanes con backfill determinístico.
Búsqueda ahora usa `canonicalSegment` en lugar de texto libre.

### 7.3 Ordenamiento DFSK
**Fix:** DFSK siempre al final mediante `commercialPosition` y ordenamiento explícito en el motor.

### 7.4 Bono Compartido vs Bono Cierre Compartido
**Antes confundido:**
- `Bono Compartido` (genérico) != `Bono de Cierre Compartido CES + Marca`

**Fix:** Campos separados `aporteCES` y `aporteMarca` en `CommercialOffer`.
Solo se suma cuando el deal cierra con esa modalidad.

---

## ETAPA 8 — Sincronización Definitiva de Supabase (Error P2022)

### Problema Detectado
```
PrismaClientKnownRequestError P2022
The column `models.canonicalSegment` does not exist in the current database.
The column `customers.emailVerifiedAt` does not exist in the current database.
```
Rutas caídas: `/`, `/cliente-frente-a-mi`, `/cotizador`, `/vehiculos`, `/comparador`, `/clientes`

**Causa:** El schema Prisma evolucionó con nuevas columnas. Al eliminar `prisma db push` del pipeline (necesario para no destruir datos), la BD Supabase quedó con el schema antiguo.

### Columnas Aplicadas (ALTER TABLE IF NOT EXISTS — NO-DESTRUCTIVO)

| Tabla | Columna | Tipo | Default |
|---|---|---|---|
| `customers` | `emailVerifiedAt` | `TIMESTAMPTZ` | NULL |
| `customers` | `emailVerificationToken` | `TEXT` | NULL |
| `models` | `canonicalSegment` | `TEXT` | NULL |
| `models` | `technicalSheetId` | `TEXT` | NULL |
| `prices` | `channel` | `TEXT` | `'REGULAR'` |
| `prices` | `hasIva` | `BOOLEAN` | `false` |
| `prices` | `bonusName` | `TEXT` | NULL |
| `prices` | `bonusAmount` | `INTEGER` | NULL |
| `prices` | `approvedBy` | `TEXT` | NULL |

### Tabla `commercial_offers` Recreada

La tabla fue recreada con el schema EXACTO de Prisma (32 columnas vs la versión incorrecta de 30 columnas con nombres distintos):
- Se eliminó la versión incorrecta (0 filas, operación segura)
- Se creó con todos los campos del modelo Prisma
- 3 índices: `versionId+offerType+status`, `modelName+offerType+status`, `status+validUntil`

### Backfill `canonicalSegment`
68 modelos clasificados automáticamente:
- `SEDAN` → Alsvin, Dzire y similares
- `PICKUP` → Wingle, Poer, Hunter, D1 y similares
- `HATCHBACK` → Swift, Baleno, Ignis, Celerio
- `COMERCIAL` → Super Carry, Transporter
- `SUV` → todo lo demás

### Migración Versionada
**Archivo:** `prisma/migrations/20260813_sync_production_schema/migration.sql`
Todos los `ALTER TABLE` e `CREATE TABLE` en forma idempotente.

### Refactorización `scripts/build-vercel.mjs`
- **Eliminado:** `prisma db push` automático
- **Nuevo flujo:** Solo `prisma generate` en el build de Vercel
- Las migraciones de schema se aplican manualmente con scripts TypeScript controlados

### Resultado de las Pruebas Post-Migración
16 rutas verificadas con Prisma Client directo a Supabase:

| Ruta | Resultado |
|---|---|
| `/` (Dashboard) | OK |
| `/vehiculos` | OK |
| `/comparador` | OK |
| `/cotizador` | OK |
| `/clientes` | OK |
| `/cliente-frente-a-mi` | OK |
| `/actualizaciones` | OK |
| `/documentos` | OK |
| `/historial-precios` | OK |
| `/ayudas-comerciales` | OK |
| `/rentabilidad` | OK |
| `/creditos` | OK |
| `/agenda` | OK |
| `/renovaciones` | OK |
| `/aprender` | OK |
| `/plan-comercial` | OK |

---

## ETAPA 9 — Regla de Producción Establecida

Formalizada en `ESTADO_PROYECTO.md`:

> Una tarea se considera TERMINADA Y PROBADA EN PRODUCCIÓN únicamente cuando:
> 1. Commit Git local generado y verificado
> 2. Commit en GitHub (`main`)
> 3. Vercel deployment en estado `READY`
> 4. Dominio canónico apunta a ese deployment
> 5. Prueba funcional empírica realizada DESPUÉS del deployment

---

## ARCHIVOS CREADOS (Nuevos)

| Archivo | Propósito |
|---|---|
| `ESTADO_PROYECTO.md` | Bitácora oficial de desarrollo |
| `AUDITORIA_FUNCIONAL_REAL.md` | Auditoría funcional pantalla por pantalla |
| `INFORME_CAMBIOS_PARA_CODEX.md` | Este documento |
| `prisma/migrations/20260813_sync_production_schema/migration.sql` | Migración versionada Supabase |
| `src/lib/apply_migration_and_backfill.ts` | Script de migración + backfill segmentos |
| `src/lib/compare_schemas.ts` | Auditoría schema Prisma vs Supabase |
| `src/lib/commercial-offer-engine.ts` | Motor de cálculo de precios y ofertas |

## ARCHIVOS MODIFICADOS (Más importantes)

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | Modelos `CommercialOffer`, campos nuevos en `VehicleModel`, `Price`, `Customer` |
| `scripts/build-vercel.mjs` | Eliminar `db push`, compatibilidad Linux/Windows |
| `src/lib/importers/excel.ts` | Parser multi-hoja libros comerciales Derco |
| `src/lib/taxes.ts` | Impuesto Verde SII + Permiso Circulación Las Condes |
| `src/app/api/documents/[id]/download/route.ts` | Lógica 3 capas para PDFs |
| `src/app/cliente-frente-a-mi/page.tsx` | Hard Filtering por segmento y presupuesto |

---

## ESTADO DE INTEGRACIONES

| Integración | Estado | Qué falta |
|---|---|---|
| Supabase PostgreSQL | ACTIVA | — |
| Vercel CI/CD | ACTIVO | — |
| GitHub repo | ACTIVO | Cambiar a PRIVADO |
| Impuesto Verde (SII) | ACTIVO | — |
| Permiso Circulación (Las Condes) | ACTIVO | — |
| Telegram | CÓDIGO LISTO | Agregar `TELEGRAM_BOT_TOKEN` en Vercel |
| Resend Email | CÓDIGO LISTO | Agregar `RESEND_API_KEY` en Vercel |
| Consulta RUT externa | CÓDIGO LISTO | Agregar `CUSTOMER_RUT_LOOKUP_URL` en Vercel |
| Importador Derco.cl | SCRIPT LISTO | Ejecutar mensualmente con nuevo Excel |

---

## TABLAS EN SUPABASE (33 tablas)

```
brands, app_users, password_reset_tokens, models, versions, prices, price_history,
commercial_campaigns, bonuses, benefits, documents, document_imports, document_extractions,
updates, update_items, audit_log, acronyms, customer_statuses, customer_origins,
customers, customer_vehicles, customer_interests, activities, reminders, credit_contracts,
quotes, quote_items, sales, deliveries, notification_settings, notification_history,
study_questions, study_progress, commercial_offers
```

---

## HISTORIAL COMPLETO DE COMMITS (42 commits)

```
e1ea071 fix(db): sincronizacion completa Supabase - prices+customers+commercial_offers
37a42f1 fix(db): recrear commercial_offers con schema exacto de Prisma
8ffc11a fix: trigger redeployment - Supabase schema synchronized P2022 resolved
566ae8c docs: registrar recuperacion de produccion seccion 11
0ab9016 fix(db): agregar migracion versionada 20260813_sync_production_schema
c9156ce docs: agregar REGLA DE PRODUCCION a bitacora
4db556e fix(pipeline): refactorizar build-vercel.mjs eliminando prisma db push
f5492d5 docs: actualizar AUDITORIA_FUNCIONAL_REAL.md
0b9f21e fix: corregir desestructuracion de tupla en comparison.ts
99e7441 fix: corregir interfaz de tipos en CommercialOfferEngine
083484f feat: integrar CommercialOfferEngine con taxonomia de precios y segmentos
cb2dc90 feat: implementar CommercialOfferEngine y taxonomia completa de precios
cee52cb fix: diferenciar Bono Marca de Bono Cierre Compartido CES + Marca
f2bde8b fix: eliminar descuento inventado, corregir sedanes, ordenar DFSK al final
824902f fix: perfilador presupuesto estricto y fichas tecnicas PDF
c39c3ba feat: motor comercial multi-hoja, cero-404 fichas, perfilador extendido
bd1a96e docs: actualizar ESTADO_PROYECTO.md seccion 9
a5fa51d feat: conectar Telegram y Resend email para renovaciones y cumpleanos
fb80ef0 feat: valor Sin IVA, desglose Contado vs Financiamiento, bonos compartidos
27d989b fix: redirigir fichas tecnicas directamente a PDF S3
3b03544 fix: filtrado obligatorio estricto en perfilador
d2ad610 docs: punto de restauracion antes de correcciones criticas
99cf0d2 fix: filtros transmision/carroceria, fallback documentos, campanas
92eb487 feat: ficha 360, importador, renovaciones, cierre-venta, cron, vitoko
2ae8017 feat: importador inteligente, registerSale, cron, semaforo comercial
6f0e8e7 feat: Ficha 360 cliente con pestanas y alertas
cf6c8d3 feat: reorganizar menu por flujo comercial
860df7c fix: soporte Modo Oscuro con darkMode class
b150e9c feat: fases 4, 5, 5B y 6 con impuestos oficial vs estimado
8dbaa4e feat: migrar update_items y document paths a Supabase
d2a6ab3 feat: Fases 1-9 impuestos, UI responsive, modo oscuro, Vitoko IA
4821f9e docs: actualizar credenciales y script de reset
d8aa7d8 docs: despliegue exitoso en Vercel y Supabase
adaca85 fix: compatibilidad multiplataforma comillas en rutas Prisma
128f63d fix: envolver prisma generate en try/catch Windows
1da6f98 docs: avances ETAPA 2 en bitacora
076d1cd docs: arquitectura oficial GitHub+Vercel+Supabase
c7f730c docs: avance Etapa 1
381e52f docs: respaldo seguridad Fase 1
2768ee5 docs: hash commit inicial
1f93388 feat: inicializacion bitacora y control de versiones local
```

---

## PENDIENTES PARA CODEX

1. **Activar Telegram:** Agregar `TELEGRAM_BOT_TOKEN` en Variables de Entorno de Vercel.
   Codigo listo en `src/lib/notifications/telegram.ts`

2. **Activar Resend Email:** Agregar `RESEND_API_KEY` en Variables de Entorno de Vercel.
   Plantillas listas para cumpleanos, renovaciones, recuperacion de clave.

3. **Activar RUT externo:** Agregar `CUSTOMER_RUT_LOOKUP_URL` en Vercel.
   Actualmente valida solo con Modulo 11 local.

4. **Importar libro comercial mensual:**
   Ejecutar `src/lib/importers/excel.ts` con el Excel nuevo de cada mes.
   Las ofertas se guardan en `commercial_offers`.

5. **Hacer repositorio PRIVADO:**
   El repo GitHub fue detectado como PUBLICO.
   Cambiarlo a privado en Settings > General > Change repository visibility.

---

*Panel360 Autos — Generado el 13 de agosto de 2026*
