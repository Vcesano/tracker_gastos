# CLAUDE.md — App de Tracking de Gastos + Power BI as code

## Contexto y roles

Proyecto personal de Valentin con dos piezas en un mismo repo: (1) una app web de registro de gastos y (2) el proyecto de Power BI que la analiza, versionado como código.

- **Valentin**: Senior BI/Data Analytics Engineer (Power BI, DAX, SQL, dbt, Databricks). Domina modelado de datos y análisis. **No es developer full-stack**: explicá decisiones de infra/web en términos simples, sin subestimarlo en la parte de datos.
- **Claude Code (vos)**: ejecutás TODO — escribís el código de la app, lo pusheás y deployás con clasp, y desarrollás el proyecto de Power BI editando sus archivos TMDL/PBIR. Valentin supervisa, prueba y decide. Lo único que Claude Code no puede operar es Power BI Desktop: Valentin lo usa como "compilador" (abrir, validar, refrescar, publicar).
- Comunicación en español (Argentina).

## Restricciones innegociables

1. **Costo $0 total** (creación, infraestructura y mantenimiento). Solo se usan: Google Sheets, Google Apps Script, clasp, GitHub, Power BI Desktop + licencia free. **No agregar ningún servicio nuevo** (ni free-tiers de terceros) sin aprobación explícita de Valentin.
2. **La spreadsheet original de AppSheet es intocable** y sigue alimentando la app vieja hasta el cutover. Este proyecto trabaja sobre una **copia** que provee Valentin (la copia está desconectada de AppSheet: se puede editar libremente). Nada del proyecto se conecta jamás a la original.
3. **Privado**: web app deployada con `Execute as: Me` y `Who has access: Only myself`. Nunca cambiar el acceso.
4. **Accesible desde cualquier celular o PC** con el login de Google de Valentin. Diseño mobile-first: la carga se hace principalmente desde el celu.
5. **Dos modelos de datos separados, cada uno optimizado para su objetivo**: el modelo operacional (Sheets, optimizado para captura/CRUD) y el modelo dimensional (Power BI, star schema optimizado para análisis). La app nunca conoce el modelo dimensional; Power BI nunca escribe en la Sheet. La transformación operacional → dimensional vive únicamente en Power Query, dentro del proyecto PBIP.
6. **Los headers de la Sheet operacional son el contrato con Power Query**: renombrar/eliminar columnas o pestañas requiere aprobación previa, actualización de este archivo y ajuste coordinado del PBIP.
7. **Refresh manual asumido**: Valentin refresca apretando un botón (Desktop o "Actualizar ahora" en el Service). No se usa Looker Studio ni se agregan mecanismos de refresh.
8. **Sin conversión de moneda**: los montos se guardan y analizan en su moneda original (`ARS`/`USD`). Unificar monedas con tabla de cotizaciones queda explícitamente fuera de alcance salvo pedido futuro de Valentin.
9. **Nunca operaciones destructivas sobre datos reales** sin backup previo (copia de la spreadsheet de trabajo) y aprobación.

## Stack

- **Base de datos operacional**: Google Sheets (la copia de trabajo) — una pestaña por tabla, fila 1 = headers.
- **Backend + Frontend de la app**: Google Apps Script (V8). SPA servida con `HtmlService`; cliente en **vanilla JS + CSS, sin frameworks, sin build step, sin CDNs**. Cliente ↔ servidor vía `google.script.run`.
- **BI**: proyecto Power BI en formato **PBIP** dentro del repo — semantic model en **TMDL**, reporte en **PBIR**. Power BI Desktop solo para validar, refrescar y publicar.
- **Versionado**: GitHub, un solo repo. Deploy de la app con `clasp`.

## Estructura del repo

```
/CLAUDE.md
/src/                      # app (Apps Script)
  appsscript.json          # timeZone America/Argentina/Tucuman, V8, webapp MYSELF/USER_DEPLOYING
  Code.js  api.js  db.js  logic.js  migracion.js
  index.html  styles.html  app-js.html
/powerbi/                  # Power BI as code
  Gastos.pbip
  Gastos.SemanticModel/    # definition/*.tmdl  ← Claude Code edita acá
  Gastos.Report/           # definition/**/*.json (PBIR) ← y acá
.gitignore                 # .clasprc.json, node_modules/, **/.pbi/localSettings.json, **/.pbi/cache.abf
```

- `SHEET_ID` (de la copia de trabajo) va en **Script Properties**, nunca hardcodeado ni commiteado.
- Nunca editar nada bajo carpetas `.pbi/` del proyecto Power BI.

## Modelo operacional (app / Sheets) — fuente de verdad de captura

Convenciones: **todos los ids son opacos de 8 hex estilo `035ef75a`** (uuid corto). En la app, altas nuevas con `nuevoId_()` (aleatorio, `Utilities.getUuid()` truncado). En la migración, `ComprasCredito`/`Gastos` conservan su id legacy (ya son uuid corto) y `MediosPago`/`Categorias` reciben un id nuevo determinístico (`hash8_` del id legacy `mp-XXX`/`tg-XXX`) con todas las FKs remapeadas — así queda un único estilo de id sin romper el re-run. Fechas como texto ISO `yyyy-mm-dd`. Montos como número (punto decimal). Headers en snake_case sin acentos.

### Pestaña `MediosPago`
| columna | tipo | nota |
|---|---|---|
| id | texto | legacy `mp-XXX` conservados; nuevos uuid |
| tipo_medio | texto | `Efectivo` \| `Debito - Transferencia` \| `Credito` (valores actuales de Valentin; el único con semántica estructural es `Credito`) |
| entidad | texto | **etiqueta visible en toda la app** (ej: "Galicia Visa Adh. Papa"); no existe campo `nombre` |
| activo | bool | soft delete |

### Pestaña `Categorias`
| columna | tipo | nota |
|---|---|---|
| id | texto | legacy `tg-XXX` conservados |
| tipo | texto | `Diario` \| `Mensual` |
| categoria | texto | |
| subcategoria | texto | opcional |
| activo | bool | soft delete |

Jerarquía **Tipo > Categoría > Subcategoría**, gestionada por ABM; la app nunca hardcodea categorías.

### Pestaña `ComprasCredito` (header de compras en cuotas)
| columna | tipo | nota |
|---|---|---|
| id | texto | |
| fecha_compra | fecha ISO | |
| descripcion | texto | |
| medio_pago_id | fk | la tarjeta; debe ser tipo_medio = `Credito` |
| categoria_id | fk | **categoría default que heredan sus cuotas** (prellenada en el batch, editable por fila). Motivo: sin esto, las cuotas caen en una categoría genérica "Credito" y el análisis pierde en qué se gastó realmente |
| monto_total | número | |
| n_cuotas | entero | >= 1 |
| moneda | texto | `ARS` \| `USD` |
| cuotas_previas | entero | default 0. **Shim de migración**: cuotas pagadas antes de este sistema que no tienen fila en `Gastos`. Hacia adelante siempre 0 |
| nota | texto | libre; los "compartido con X" viven acá, no se modelan splits |

**El estado no se persiste**: `pagadas = cuotas_previas + COUNT(Gastos con compra_credito_id = id)`; `pendientes = n_cuotas − pagadas`; completa cuando pendientes = 0. (Reemplaza la columna legacy `Cuotas_Pagadas`.)

### Pestaña `Gastos` (grano = un pago real)
| columna | tipo | nota |
|---|---|---|
| id | texto | |
| fecha | fecha ISO | fecha del pago |
| descripcion | texto | |
| categoria_id | fk | **única** referencia de categoría; tipo/categoria/subcategoria se dereferencian (no se duplican como texto, como hacía la tabla legacy) |
| medio_pago_id | fk | **medio con el que salió la plata realmente** (en una cuota: la cuenta con la que se pagó el resumen). La tarjeta de una cuota NO se repite acá: se deriva vía compra_credito_id → ComprasCredito.medio_pago_id |
| monto | número | > 0; monto REAL pagado |
| moneda | texto | `ARS` \| `USD`; **independiente de la moneda de la compra vinculada** — caso típico: compra en USD, cuotas pagadas en ARS a la cotización del día |
| compra_credito_id | fk | opcional: solo si es pago de cuota |
| nro_cuota | entero | opcional: sugerido = pagadas + 1, editable |
| creado_en | timestamp ISO | |

Decisiones de diseño: **las cuotas NO se pre-generan** — se registran pagos reales al llegar el resumen (los montos reales difieren del teórico por impuestos/sellados). "Mensual" es un tipo de categoría; no implica crédito, y el vínculo `compra_credito_id` es independiente del tipo. "Cuánto pago de cuotas" se responde con el flag derivado `EsCuota` (compra_credito_id no vacío), no con una categoría.

## Migración desde `legacy_*` (confirmada y corrida — It 1, 2026-07-13)

Implementada en `src/migracion.js` (`migrar()`), aprobada por Valentin sobre la inspección real. Re-ejecutable, read-only sobre `legacy_*`, escritura batch con lock. Fuentes: 5 pestañas legacy (`legacy_Pagos_Credito_Header` estaba vacía → descartada). Nombres reales de columnas en los headers listados en el registro de decisiones. Resultado de la corrida: MediosPago 14, Categorias 74 (67 legacy + 7 nuevas), ComprasCredito 25 (+3 filas vacías salteadas), Gastos 345 (+1 vacía).

- `legacy_Lista_Metodo_de_Pago` → `MediosPago`: tipo_medio = Metodo_de_Pago; entidad = Entidad; activo = TRUE. **id regenerado** (8-hex).
- `legacy_Lista_Tipo_de_Gasto` → `Categorias`: 1:1 (Tipo_de_Gasto, Categoria, Subcategoria); activo = TRUE. **id regenerado**. Cambios de catálogo aprobados: rename subcategoría `Ropa`→`Ropa-Indumentaria`; **7 categorías nuevas** (`CATEGORIAS_NUEVAS`): Compras>Skincare, Compras>Libros, Viajes>{Estadia, Transporte, Entretenimiento, Otros}, Otro>Suscripciones.
- `legacy_Consumos_Credito` → `ComprasCredito`: fecha_compra ISO; monto_total normalizado; medio_pago_id = ID_Entidad_Metodo_de_Pago (remapeado); moneda = `USD` si Notas/Descripcion lo indican, sino `ARS` (7 detectadas USD); **cuotas_previas = max(0, Cuotas_Pagadas − COUNT(pagos vinculados en legacy_Gastos))** — dio **0 en las 25**; nota = Notas. **categoria_id asignada por compra** (`CATEGORIA_POR_COMPRA`, dato nuevo aprobado).
- `legacy_Gastos` → `Gastos`: categoria_id = ID_Subcategoria_Tipo_de_Gasto (remapeado; descartar Tipo_de_Gasto/Categoria texto); medio_pago_id = ID_Entidad_Metodo_de_Pago (remapeado); compra_credito_id = ID_Credito_Enlazado; **descartar ID_Metodo_Pago_Credito e ID_Pagos_Credito_Header**; nro_cuota = regex `cuota N`, fallback secuencial por fecha; **moneda = `ARS` por defecto** (los resúmenes se pagan en pesos, aunque la compra sea USD; los "indicio USD" del reporte son precios de referencia de cripto, quedan ARS).
- Validaciones post-migración (en el reporte): fks huérfanas, conteos, USD detectados, compras con cuotas_previas > 0.
- **La migración es re-ejecutable** (trunca las tablas nuevas y reconstruye desde `legacy_*`): al cutover se re-copian las pestañas frescas desde la spreadsheet original a `legacy_*` y se corre de nuevo. Los ids de dimensiones son estables entre corridas (hash del id legacy).

## Modelo dimensional (Power BI) — star schema, vive como código en /powerbi

Materialización: **Power Query (M)** transforma las pestañas operacionales al refrescar; relaciones y medidas en **TMDL**. No se materializa nada en Sheets. Nombres del modelo en PascalCase amigable; el renombrado operacional → dimensional ocurre en Power Query.

- **DimCalendario**: generada en Power Query, desde MIN(fecha de datos) hasta hoy + 24 meses (cubre el horizonte de compromisos). Columnas: Fecha, Anio, MesNum, NombreMes, AnioMes (`YYYY-MM`), Trimestre. Marcada como tabla de fechas.
- **DimCategoria** ← `Categorias`: CategoriaId, Tipo, Categoria, Subcategoria (vacía → "(sin subcategoría)"). Jerarquía Tipo > Categoria > Subcategoria.
- **DimMedioPago** ← `MediosPago`: MedioPagoId, Entidad (etiqueta), TipoMedio.
- **DimCompraCredito** ← `ComprasCredito` (+ join a MediosPago en PQ): CompraCreditoId, Descripcion, FechaCompra, **Tarjeta** (entidad de la tarjeta, denormalizada), NCuotas, CuotasPrevias, MontoTotal, MontoCuotaTeorico (= MontoTotal / NCuotas), Moneda.
- **FactPagos** ← `Gastos`: Fecha, CategoriaId, MedioPagoId, CompraCreditoId, NroCuota, Monto, Moneda, **EsCuota** (flag: CompraCreditoId no vacío), Descripcion (dimensión degenerada). Grano: un pago real.
- **FactCompromisos** (derivada 100% en Power Query): grano = **cuota pendiente proyectada por mes futuro**. Por compra: pendientes = NCuotas − CuotasPrevias − pagos vinculados; generar esa cantidad de filas con FechaProyeccion = primer día del mes siguiente al último pago (o al mes de FechaCompra si no hay pagos) + k; MontoEstimado = MontoCuotaTeorico; Moneda de la compra.

Relaciones: dims 1 → * facts, single direction. DimCalendario[Fecha] → FactPagos[Fecha] y → FactCompromisos[FechaProyeccion]. "Gasto por tarjeta" se responde por DimCompraCredito[Tarjeta]; "por dónde salió la plata" por DimMedioPago.

Medidas en tabla dedicada `_Medidas`, con format strings y display folders en TMDL. Núcleo: `Total Gasto`, `Gasto Mes Anterior`, `Var MoM %`, `Total Cuotas del Mes` (EsCuota), `Pagado` (por compra), `Cuotas Pagadas`, `Cuotas Pendientes`, `% Avance Compra` (por conteo de cuotas, válido entre monedas), `Compromiso Futuro`. **Todas las medidas de monto respetan la moneda**: default ARS, con slicer/segmentación por Moneda; nunca sumar ARS + USD.

## Reglas de negocio de la app

1. **Selects en cascada**: tipo → categoría → subcategoría; en pantallas de crédito, tarjeta → compras activas de esa tarjeta. Solo registros `activo = TRUE`.
2. **Pantalla estrella — "Cargar resumen de tarjeta" (batch)**: tarjeta + una única fecha de pago + medio con el que se paga el resumen (una sola vez) → grilla con una fila por compra activa de esa tarjeta, prellenada (descripción, próxima cuota `k/N`, monto estimado editable, categoría heredada de la compra editable; para compras en USD, la cuota teórica en USD se muestra solo como referencia y el monto a cargar es lo realmente pagado en la moneda del pago). Valentin ajusta montos reales, destilda las que no entran, puede sumar gastos sueltos de la tarjeta. **Confirmar inserta todos los Gastos en una sola escritura batch atómica** (un lock, un `setValues`). Si ya existe un pago de esa compra con la misma fecha, advertir antes de duplicar.
3. **Validaciones**: monto > 0; no vincular más pagos que los pendientes (bloquear con mensaje y ofrecer editar la compra); moneda del pago default = `ARS` siempre (los resúmenes se pagan en pesos aunque la compra sea USD), editable.
4. **Historial de gastos**: filtros por mes, categoría y medio; edición y borrado con confirmación (borrado físico solo en `Gastos`).
5. **Vista Compras con crédito**: progreso pagadas/N (incluye cuotas_previas; **el avance se calcula siempre por conteo de cuotas, nunca por ratio de montos**), pagado mostrado en la moneda de los pagos y total en la moneda de la compra — no comparar montos entre monedas distintas.
6. **Vista Cuotas pendientes**: por tarjeta, compras activas, próxima cuota, total restante estimado.
7. **ABM de maestros**: alta, edición y desactivación de Categorías y MediosPago. Desactivar, nunca borrar, si hay referencias.

## Convenciones de código

**App (Apps Script):**
- JS moderno compatible V8; sin TypeScript, sin dependencias.
- UI mobile-first: targets táctiles grandes, fecha default = hoy, teclado numérico para montos. Preferencias de usuario en `PropertiesService.getUserProperties()`, no localStorage.
- `db.js`: leer tabla completa mapeando por header row, operar en memoria, escribir en batch. **Prohibido escribir fila por fila en loops.** Toda escritura con `LockService` (tryLock ~10s).
- `api.js` devuelve siempre `{ok, data?|error?}`; el cliente muestra errores claros.

**Power BI (PBIP):**
- Claude Code edita únicamente `*.SemanticModel/definition/*.tmdl` y `*.Report/definition/**/*.json` (PBIR). Los schemas JSON de PBIR dan validación/IntelliSense en VS Code.
- Loop de trabajo: Claude Code edita archivos → commit → **Valentin abre el .pbip en Power BI Desktop, verifica que carga sin errores, refresca y publica a Mi área de trabajo**. Incluir en cada entrega qué debería ver Valentin al abrirlo.
- Cambios chicos y atómicos (una medida, una página por commit) para aislar fácil un error de sintaxis TMDL/PBIR.
- Nota de contexto: PBIR es el formato default de Desktop desde la versión de marzo 2026 (aún en preview, GA estimada Q3 2026). Si al guardar como proyecto no se usa PBIR, habilitarlo en Opciones > Características en versión preliminar.

**Git:** rama `main`, commits chicos con mensaje claro; commit + push al cerrar cada iteración aprobada.

## Comandos

```bash
# Setup app (una sola vez)
npm i -g @google/clasp
clasp login                        # OAuth: lo autoriza Valentin
# Valentin habilita la Apps Script API en: https://script.google.com/home/usersettings
clasp create --type webapp --title "Gastos" --rootDir ./src
# Valentin pega el SHEET_ID (de la COPIA) en Apps Script > Project Settings > Script properties

# Loop de desarrollo de la app
clasp push
clasp deploy                       # SOLO la primera vez (crea deployment y URL)
clasp deploy -i <DEPLOYMENT_ID>    # siguientes: misma URL, nueva versión
```

Power BI no tiene CLI en este proyecto: el "deploy" de BI es Valentin publicando desde Desktop.

## Flujo de trabajo con Valentin

- Al arrancar cada iteración: plan corto (qué archivos, qué cambia, cómo se prueba). Decisiones de producto, de esquema o que toquen el contrato con Power Query: proponer con el trade-off en 2 líneas y **esperar aprobación**.
- Iteraciones chicas y siempre deployables. Al cerrar cada una: **checklist de prueba** explícito (celu y PC para la app; pasos de validación en Desktop para BI).
- Ante ambigüedad chica: decidir por simplicidad y avisar. Ante ambigüedad que afecte datos: preguntar primero.
- Nunca pedirle a Valentin que edite código; sus intervenciones manuales son solo autorizaciones (OAuth, Script Properties, abrir/publicar en Desktop).

## Qué NO hacer

- No conectar NADA a la spreadsheet original de AppSheet. Solo se trabaja con la copia.
- No agregar dependencias, CDNs, frameworks, servicios pagos ni free-tiers de terceros.
- No renombrar/eliminar columnas ni pestañas operacionales sin aprobación (rompe Power Query).
- No editar archivos bajo `.pbi/` ni commitear `localSettings.json` / `cache.abf`.
- No cambiar el acceso del deployment ni exponer la app públicamente.
- No borrar ni migrar datos reales sin copia previa de la spreadsheet de trabajo.
- No escrituras fila-por-fila contra la Sheet dentro de loops.
- No sumar montos de monedas distintas en ninguna vista ni medida.

## Estado y roadmap

- [x] **It 0 — Andamiaje + copia de datos** (2026-07-12): repo GitHub sincronizado, clasp 3.x conectado (proyecto standalone), `SHEET_ID` → copia en Script Properties. `doGet` mínimo deployado privado (Execute as Me / Only myself) y probado desde el celu (✓ verde; incógnito niega acceso). `setupIt0()` corrida: pestañas legacy renombradas y 4 pestañas nuevas creadas con headers.
- [ ] **It 1 — Migración + maestros + gasto diario**: primero la inspección de `legacy_*` (headers + ~5 filas de muestra por pestaña) para confirmar el mapeo borrador de arriba; **esperar aprobación** antes de migrar (incluye propuesta de categoria_id por compra). Después: ABM de Categorías y MediosPago, form de carga rápida de gastos, historial con filtros.
- [ ] **It 2 — Crédito**: alta de ComprasCredito, pantalla batch "Cargar resumen de tarjeta", vistas de compras y cuotas pendientes.
- [ ] **It 3 — Pulido UX**: defaults y últimos usados, edición de registros, validaciones, velocidad de carga percibida.
- [ ] **It 4 — Power BI as code**: Valentin crea el esqueleto UNA vez en Desktop (Obtener datos > Google Sheets → copia de trabajo; guardar como proyecto PBIP con PBIR en `/powerbi`; commit). Desde ahí, Claude Code desarrolla el modelo dimensional completo (Power Query + TMDL: dims, facts, FactCompromisos, `_Medidas`) y la primera página del reporte en PBIR. Loop: Claude edita → Valentin abre, valida, refresca, publica.
- [ ] **It 5 — Reporte + resguardo**: páginas restantes del reporte (mensual por categoría/medio, tendencias MoM, tablero de cuotas y compromisos futuros, corte por moneda), backup semanal automático de la copia de trabajo (trigger horario de GAS), re-corrida de migración para el cutover.

Al completar una iteración, marcarla acá y anotar lo decidido en "Registro de decisiones".

## Registro de decisiones

- 2026-07: Modelo con pagos reales vinculados a compras (sin pre-generar cuotas), para reflejar montos reales del resumen. La proyección futura se reconstruye como FactCompromisos en Power Query.
- 2026-07: Dos modelos separados: operacional en Sheets (captura) y dimensional en el PBIP (análisis). La transformación vive solo en Power Query; no se materializa el star schema en Sheets (escape hatch futuro: pestañas analíticas con Apps Script).
- 2026-07: Power BI versionado en el repo con PBIP (TMDL + PBIR); Claude Code como desarrollador BI; Desktop como validador/publicador. Refresh manual; Looker Studio descartado.
- 2026-07: La spreadsheet original de AppSheet queda intacta y desconectada; el proyecto opera sobre una copia con pestañas `legacy_*` como fuente de migración re-ejecutable (cutover = re-copiar y re-correr).
- 2026-07 (ajustes con tablas reales): `MediosPago` sin campo nombre (entidad = etiqueta) y tipo_medio con los 3 valores actuales. `moneda` real en Gastos y ComprasCredito (había USD oculto en Notas), sin conversión. `categoria_id` en ComprasCredito confirmado: las cuotas heredan la categoría real de la compra (hoy caían todas en "Credito"); el corte "cuánto pago en cuotas" sale del flag EsCuota. `cuotas_previas` como shim para historia sin filas de pago; deja de persistirse Cuotas_Pagadas. Se elimina ID_Metodo_Pago_Credito de Gastos (tarjeta derivable vía la compra); medio_pago_id = medio real con el que salió la plata. Splits "compartido con" quedan como nota libre.
- 2026-07: Compra en USD pagada en ARS es el caso esperado, no un edge case: la moneda del gasto es independiente de la de la compra (default de pago = ARS). Todo avance/progreso de compras se calcula por conteo de cuotas, nunca por ratio de montos entre monedas.
- 2026-07-12 (It 0, nombres reales de la copia): la spreadsheet es "Copia de Gastos App" con **5** pestañas legacy (el mapeo borrador asumía 4). Nombres reales → destino: `legacy_Lista_Metodo_de_Pago`→`MediosPago`, `legacy_Lista_Tipo_de_Gasto`→`Categorias`, `legacy_Gastos`→`Gastos`, `legacy_Consumos_Credito`→`ComprasCredito` (compras en cuotas). Aparece `legacy_Pagos_Credito_Header` (cabecera de pagos de resumen del AppSheet viejo) que **no estaba en el mapeo**: el modelo nuevo no tiene tabla de cabecera de pagos (los pagos son filas de `Gastos` con `compra_credito_id`). **Pendiente It 1**: inspeccionar headers + filas de `legacy_Pagos_Credito_Header` y `legacy_Consumos_Credito` para redefinir el mapeo de crédito antes de migrar; la sección "Migración desde legacy_*" de arriba queda como borrador a corregir con esa inspección.
- 2026-07-13 (It 1, migración corrida y validada): `legacy_Pagos_Credito_Header` vacía → descartada (modelo simple, pagos = filas de `Gastos`). `cuotas_previas = 0` en las 25 compras (toda cuota pagada tiene su fila de pago). 7 compras en USD; el resto de "indicio USD" en Gastos son precios de referencia de cripto → quedan ARS (compra USD siempre se paga en ARS). Categorías: se aprobaron 7 nuevas (Skincare, Libros, Viajes>{Estadia,Transporte,Entretenimiento,Otros}, Otro>Suscripciones) y el rename Ropa→Ropa-Indumentaria. Una única fila corrupta en `legacy_Gastos` (columnas corridas, "Andi a casa") → Valentin la corrigió en el origen.
- 2026-07-13 (It 1, ids uniformes): decisión que **reemplaza** "los ids legacy se conservan". Todos los ids pasan a ser opacos de 8 hex estilo `035ef75a`. La migración regenera los de `MediosPago`/`Categorias` (eran `mp-XXX`/`tg-XXX`) con `hash8_` (determinístico → re-run estable) y remapea todas las FKs; `ComprasCredito`/`Gastos` ya eran uuid corto y conservan su id. Altas nuevas en la app con `nuevoId_()` (aleatorio).
