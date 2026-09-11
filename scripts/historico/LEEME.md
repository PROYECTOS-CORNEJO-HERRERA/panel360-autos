# SQL ya aplicado — NO volver a correr

Estos scripts se corrieron **una sola vez**, en agosto de 2026, contra la
base de datos Supabase **antigua** de este proyecto (`vesobzvcorxxxvdxdzqk`),
la que se dio de baja.

Se guardan como registro de cómo entraron esos datos, no como
herramienta. **No sirven tal cual hoy**: buscan las tablas en el esquema
`public`, y desde la migración de septiembre de 2026 este sistema vive en
el esquema `autos` de la Supabase de Panel360.

| Archivo | Qué hizo |
|---|---|
| `sync-precios-prod.sql` / `.txt` | Cargó los precios de agosto (lista, contado y financiamiento), 537 filas |
| `crear-tabla-hojas-rentabilidad.txt` | Creó la tabla `profitability_sheets` |
| `agregar-cargovan-dfsk.txt` | Agregó las 3 versiones DFSK Cargo Van con sus precios |

Los datos que generaron **sí siguen vivos**: se migraron al esquema
`autos` y están verificados (6 marcas, 68 modelos, 165 versiones, 1.961
precios, 7 hojas de rentabilidad).

Si algún día hace falta algo parecido, escribir un script nuevo apuntando
al esquema correcto; no reutilizar estos.
