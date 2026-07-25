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
  tests.js                 # It 4: suite server (correrTests / medirPerf), corre en sandbox
  index.html  styles.html  app-js.html
/tests/                    # It 4: NO se pushea con clasp (vive fuera de /src)
  client-tests.js          # asserts de la lógica pura del front, para pegar en la consola
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
4. **Historial de gastos**: **agrupado por día** (total del día por moneda) y con **búsqueda por texto** (client-side sobre lo traído); filtros por **rango de fechas** (Desde/Hasta), categoría + subcategoría, medio de pago, **Crédito** (Todos / Solo cuotas / Solo directos) y **Tarjeta**, dentro de un panel colapsable; edición y borrado con confirmación (borrado físico solo en `Gastos`). La tarjeta de una cuota es **derivada** (compra_credito_id → ComprasCredito.medio_pago_id), no una columna de `Gastos`.
5. **Vista Compras con crédito**: progreso pagadas/N (incluye cuotas_previas; **el avance se calcula siempre por conteo de cuotas, nunca por ratio de montos**), pagado mostrado en la moneda de los pagos y total en la moneda de la compra — no comparar montos entre monedas distintas.
6. **Vista Cuotas pendientes**: por tarjeta, compras activas, próxima cuota, total restante estimado.
7. **ABM de maestros**: alta, edición y desactivación de Categorías y MediosPago (con búsqueda por texto, filtro por estado y —solo en Categorías— filtros de categoría/subcategoría en cascada). Borrado físico permitido **solo si el maestro no tiene referencias** en `Gastos`/`ComprasCredito`; si las tiene, se niega y se ofrece desactivar (soft delete `activo=FALSE`), nunca dejar FKs huérfanas.

## Mapa de pantallas (estado al cierre de It 3, deploy @24)

SPA de una sola página con 5 tabs (`index.html` → secciones `.view`, ruteo en `app-js.html` por `data-view`):

| Tab | Qué hace | Backend que consume |
|---|---|---|
| **Cargar** | Alta/edición de un gasto directo. Cascada Tipo→Categoría→Subcategoría + Tipo de medio→Medio (**excluye `Credito`**, con guarda server-side). Fecha = hoy con atajos **Hoy/Ayer**, moneda ARS, monto con separador es-AR. Al **editar una cuota**: caja con el vínculo read-only a la compra + `nro_cuota` editable. | `getCatalogos`, `crearGasto`, `actualizarGasto` |
| **Historial** | Lista de `Gastos` **agrupada por día** (encabezado con fecha + día de semana y total del día por moneda) desc por fecha, con los filtros del punto 4 dentro de un panel colapsable + **Buscar por texto** siempre visible; editar (reusa el form de Cargar, que expone `nro_cuota` si es cuota) y borrar físico con confirmación. | `listarGastos`, `borrarGasto` |
| **Crédito** | Subtabs **Compras** (ABM de `ComprasCredito` + progreso derivado pagadas/N y pagado por moneda) y **Pendientes** (agrupado por tarjeta: total restante estimado por moneda, próxima cuota `k/N` y monto restante por compra). Ambas con **Buscar por texto**. | `listarCompras`, `crearCompra`, `actualizarCompra`, `borrarCompra` |
| **Pago Bulk** | Pantalla estrella (punto 2): header tarjeta + fecha de pago + cuenta que paga → grilla de cuotas pendientes editable + gastos sueltos → inserción batch atómica. Si se sale con la grilla generada sin confirmar, **avisa antes de descartarla**. | `listarCompras` (estado=pendientes), `confirmarResumen` |
| **Maestros** | Subtabs Categorías / Medios de pago (punto 7); filtros Buscar + Estado (y Categoría/Subcategoría en cascada solo para Categorías). | `getMaestros`, `crearCategoria`/`actualizarCategoria`/`borrarCategoria`/`setActivoCategoria` y sus equivalentes `*Medio` |

Botón global **"↻ Actualizar"**: tira el cache de vistas, re-sincroniza catálogos en caliente y recarga la vista/subvista activa; gira mientras carga.

**UX transversal (It 3):** tema **dark de marca** con colores de estado convencionales (verde=ok/positivo, ámbar=alerta reversible p.ej. Desactivar, rojo=destructivo, azul=barra de progreso); **responsive** mobile + desktop (≥900px: contenedor ancho, formularios en 2 columnas); **modal de confirmación propio** (no `window.confirm` del navegador); toda pestaña con filtros tiene **"Limpiar filtros"** (deshabilitado si nada se aparta del default). Las **búsquedas por texto y los filtros de Maestros son client-side** sobre lo ya traído del server (no viajan ni tocan el cache).

## Convenciones de código

**App (Apps Script):**
- JS moderno compatible V8; sin TypeScript, sin dependencias.
- UI mobile-first: targets táctiles grandes, fecha default = hoy, teclado numérico para montos. Preferencias de usuario en `PropertiesService.getUserProperties()`, no localStorage.
- `db.js`: leer tabla completa mapeando por header row, operar en memoria, escribir en batch. **Prohibido escribir fila por fila en loops.** Toda escritura con `LockService` (tryLock ~10s). **Memoización por ejecución** (It 3b): `abrirSS_` cachea la spreadsheet abierta (`SS_MEMO_`) y `leerTabla_` cachea la tabla leída (`TABLA_MEMO_`, devuelve referencia compartida → **no mutar**); toda escritura llama `invalidarTabla_`.
- `api.js` devuelve siempre `{ok, data?|error?}`; el cliente muestra errores claros.
- **Performance del cliente (It 3b)**: `doGet` inyecta los catálogos en el HTML (`bootJSON_` → `window.__BOOT__`) para arrancar sin roundtrip; cache de vistas client-side stale-while-revalidate (`cacheVistas`, revalida a los 90s), invalidado por toda escritura (`invalidarCache`) y por el botón ↻. Búsquedas por texto y filtros de Maestros: **client-side**, no tocan cache ni server.
- **CSS**: tema dark con custom properties en `:root` (`styles.html`); `color-scheme: dark` para widgets nativos. El reset `input, select { appearance:none; width:100% }` obliga a: flecha de desplegable propia (SVG data-URI en `background-image`) y override de `input[type="checkbox"]` — **no borrar ninguno**. Botones de acción por severidad: `.btn.danger` (rojo, destructivo), `.btn.warn` (ámbar, reversible). Confirmaciones con el modal propio `confirmar({titulo, mensaje, ok, danger|warn})` (promesa true/false), **nunca `window.confirm`**.

**Tests (desde It 4):**
- `src/tests.js` es la suite del server: `correrTests()` (unitarios puros + integración) y `medirPerf()`. Se corre desde el editor de Apps Script y reporta PASS/FAIL en el Logger.
- **Los tests de integración NUNCA tocan la copia de trabajo**: usan una spreadsheet sandbox propia (Script Property `TEST_SHEET_ID`) vía un override temporal de `getSheetId_`. Si falta la property, la suite de integración se saltea con un aviso en vez de caer sobre datos reales.
- Al tocar `api.js` / `logic.js` / `db.js`, agregar o ajustar su test en la misma entrega. Antes de cerrar una iteración: `correrTests()` en verde + el checklist manual.
- La lógica pura del cliente se expone en `window.__TEST__` y se verifica con `tests/client-tests.js` pegado en la consola del navegador.

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
- [x] **It 1 — Migración + maestros + gasto diario** (COMPLETA 2026-07-22, deploy @8):
  - [x] **Migración** (2026-07-13): inspección de `legacy_*` + mapeo aprobado + `migrar()` corrida y validada (0 fks huérfanas; 14 MediosPago / 74 Categorias / 25 ComprasCredito / 345 Gastos; ids uniformes 8-hex). Ver sección "Migración desde legacy_*" y registro de decisiones. Re-ejecutable para el cutover.
  - [x] **1a — capa de datos + carga rápida** (deploy @2): `db.js` (`abrirSS_`, `leerTabla_`, `insertarFilas_`, `actualizarFila_`, `borrarFila_`, `esActivo_`, `ahoraISO_`; reusa globals de `migracion.js`). `api.js` con `getCatalogos`/`crearGasto`. Form de gasto con cascada Tipo→Categoria→Subcategoria (solo activos), tipo de medio (excluye Credito) → medio, monto con separador de miles es-AR, fecha=hoy, moneda=ARS. Todos los desplegables ordenados alfabéticamente.
  - [x] **1b — historial** (deploy @5): lista de `Gastos` con filtros por rango de fechas (Desde/Hasta con calendario), Categoría + Subcategoría y Medio de pago; editar (reusa el form) y borrar físico con confirmación. Fechas normalizadas a ISO en el server (`fechaISO_`) y mostradas dd/mm/yyyy; orden descendente por fecha.
  - [x] **1c — ABM maestros** (deploy @7-@8): alta/edición/**desactivar** (soft delete) de `Categorias` y `MediosPago` con `logic.js` (validaciones + duplicados). Búsqueda + filtro Activos/Inactivos/Todos. Borrado **físico** permitido solo si no hay referencias en `Gastos`/`ComprasCredito` (sino sugiere desactivar). Refresco de catálogos en caliente tras cada cambio + botón global "↻ Actualizar" (arregla que un maestro nuevo/desactivado no se reflejaba en Cargar/Historial sin recargar).
  - Probado y aprobado por Valentin (celu + PC). El `ping()` de It 0 fue removido de `Code.js` en 1a.
- [x] **It 2 — Crédito** (COMPLETA 2026-07-23, deploy @12, commits `cce7008` / `a5d60aa` / `36e1e40`): alta de ComprasCredito, pantalla batch "Cargar resumen de tarjeta", vistas de compras y cuotas pendientes. Probada y aprobada por Valentin (celu + PC).
  - [x] **2a — alta de compras + vista Crédito** (deploy @9, 2026-07-22): tab "Crédito" con alta/edición/eliminación de `ComprasCredito` y lista con progreso derivado. `getCatalogos` ahora también devuelve `tarjetas` (medios activos `Credito`). Backend en `api.js` (`crearCompra`, `listarCompras`, `actualizarCompra`, `borrarCompra`) + `logic.js` (`validarCompraPayload_`, `contarPagosDeCompra_`). Estado (pagadas/pendientes/completa) 100% derivado de los pagos vinculados, nunca persistido; avance por conteo de cuotas; pagado agrupado por moneda (nunca se suman monedas). `cuotas_previas = 0` fijo en altas (no se expone). Validaciones: tarjeta debe ser `tipo_medio = Credito`; editar no puede dejar `n_cuotas < pagadas`; borrar solo si no hay cuotas pagadas.
  - [x] **2b — pantalla batch "Cargar resumen de tarjeta"** (deploy @10-@11, 2026-07-22): tab **"Pago Bulk"**. Ajustes post-review de Valentin (@11): (1) descripción de cuota por default `Cuota N/M - <compra>` calculada en `confirmarResumen` cuando el ítem no trae texto; (2) Historial ahora deriva la **tarjeta** de cada cuota (vía compra_credito_id → ComprasCredito.medio_pago_id) y filtra por **Crédito** (Todos / Solo cuotas / Solo directos) y por **Tarjeta**; la tarjeta se muestra en el meta de la cuota (💳). La categoría del pago **se mantiene la real de la compra** (no se cambia a "Crédito"): el corte "cuánto de crédito" sale del flag EsCuota + la tarjeta, conviviendo con el gasto por categoría. Header (tarjeta + fecha de pago única + cuenta que paga, NO crédito) → "Generar grilla" (reusa `listarCompras` con estado=pendientes) → una fila por cuota pendiente, prellenada (checkbox incluir, cuota k/N, categoría heredada editable, monto/moneda). Categoría por fila = **select plano** "Categoría › Subcat" (simplificación aprobada: la cascada de 3 niveles por fila era inusable en mobile). Compras ARS prellenan la cuota teórica; compras USD van con monto vacío + teórica en USD como referencia (pago default ARS). Botón "➕ Agregar gasto suelto" (fila sin vínculo a compra, con descripción propia). Total en vivo por moneda. `confirmarResumen(payload, forzar)` en `api.js`: valida, calcula `nro_cuota` server-side (pagadas+seq, no confía en el cliente), bloquea vincular más cuotas que las pendientes, y **inserta todo en una sola escritura batch atómica** (`insertarFilas_`). Si una cuota ya tiene pago con la misma fecha y no se forzó, devuelve `{requiereConfirmacion, duplicados}` y el cliente pide confirmación antes de duplicar.
  - [x] **2c — vista Cuotas pendientes** (deploy @12, 2026-07-22): la pestaña "Crédito" pasa a tener subtabs **Compras** | **Pendientes**. Pendientes agrupa por tarjeta (reusa `listarCompras` estado=pendientes, agrupa en el cliente): por tarjeta muestra total restante estimado por moneda (Σ pendientes × cuota teórica, sin sumar monedas), y por compra la próxima cuota `k/N`, cuotas restantes y monto restante estimado. Filtro por tarjeta. Cierra It 2.
- [x] **It 3 — Pulido UX** (COMPLETA 2026-07-25, deploy @24): la app ya era funcionalmente completa; It 3 la hizo linda y rápida de usar desde el celu. El plan original (últimos usados / velocidad / edición fina) se reemplazó por lo que Valentin fue pidiendo al probar. Probada y aprobada (celu + PC).
  - [x] **3a — tema + responsive + detalles visuales** (deploys @13-@15): tema **dark de marca** (paleta en `:root`, base `#57CC99` acento) con colores de estado convencionales (verde=ok, ámbar=alerta reversible, rojo=destructivo, **azul** en la barra de progreso; el rosa de marca quedó solo como detalle puntual, tras 2 rondas de feedback — "muy abusivo"). **Responsive** mobile + desktop (`@media min-width:900px`: contenedor ancho, formularios en 2 columnas, grilla de Pago Bulk en 2 col). Flecha propia en todo desplegable (SVG data-URI, porque `appearance:none`) e ícono de calendario claro. Fix de spacing botón→filtros.
  - [x] **3b — performance de navegación + feedback de carga** (deploy @16): server memoiza spreadsheet abierta (`SS_MEMO_`) y tablas leídas (`TABLA_MEMO_` + `invalidarTabla_`) por ejecución (`listarGastos` abría la Sheet 4×/request); `doGet` inyecta catálogos en el HTML (`bootJSON_` → `window.__BOOT__`, arranca sin roundtrip); cache de vistas client-side stale-while-revalidate (90s, `invalidarCache` en toda escritura y en ↻); precarga del historial en background; skeletons; el botón ↻ gira mientras carga.
  - [x] **3c — historial agrupado por día + filtros colapsables** (deploys @17-@19): Historial agrupa por día (encabezado fecha con día de semana + total del día por moneda, sin sumar monedas; misma jerarquía visual aplicada a Crédito-Pendientes); los 7 filtros arrancan colapsados tras el botón "Filtros" (muestra cuántos hay puestos); "Limpiar filtros" afuera del panel; etiquetas de "todo seleccionado" estandarizadas a "Todas"/"Todos".
  - [x] **3d — modal de confirmación propio** (deploy @20): `confirmar({titulo, mensaje, ok, danger|warn})` (promesa true/false, cierra con backdrop/Escape) reemplaza los 5 `window.confirm` del navegador (borrar gasto, activar/desactivar y eliminar maestro, eliminar compra, aviso de cuota duplicada). Rojo para destructivo; ámbar para Desactivar (reversible).
  - [x] **3e — filtros extra + "Limpiar filtros" en todas las pestañas** (deploys @21-@22): Maestros gana filtros de categoría/subcategoría en cascada (solo subtab Categorías); búsqueda por texto en Historial (siempre visible), Crédito-Compras y Crédito-Pendientes (client-side, no toca cache ni server); "Limpiar filtros" en Compras, Pendientes y Maestros (deshabilitado si nada se aparta del default).
  - [x] **3f — atajos finos** (rama `it3e-opcional` → merge a main, deploy @24): del 3e opcional original Valentin dejó solo tres cosas (probó los cinco en una rama y descartó los otros dos). (1) **Atajos de fecha Hoy/Ayer** en el form de Cargar. (2) **Editar `nro_cuota` de una cuota**: al editar en el Historial un gasto que es cuota, aparece una caja con el vínculo read-only a la compra (`compra_label`, tarjeta) y un campo editable; el server (`actualizarGasto`) valida entero 1..`n_cuotas`. `listarGastos` ahora devuelve `compra_credito_id`, `compra_label`, `compra_ncuotas`. (3) **Aviso al salir de Pago Bulk** con una grilla generada sin confirmar (cambiar de pestaña o "Cambiar tarjeta") — usa el modal `confirmar`. **Descartados**: prellenado por último usado y chips de recientes (`getSugerencias` y su cableado se quitaron) — a Valentin no le sumaban.
- [ ] **It 4 — QA, hardening y accesibilidad** (antes de Power BI): la app está funcionalmente completa y linda, pero nunca fue testeada sistemáticamente ni tiene red de seguridad ante regresiones. It 4 la audita a fondo (correctitud, performance medida, UX/UI, accesibilidad, robustez de datos), arregla lo que salga y deja una **suite de tests re-ejecutable** para que It 5/It 6 no rompan nada en silencio. Regla de oro de la iteración: **ningún test toca la copia de trabajo** — los tests de integración corren contra una spreadsheet sandbox aparte.
  - [x] **4a — arreglo de los bugs ya detectados en la auditoría estática** (deploy @25, 2026-07-25): cerrados los hallazgos **1, 2, 3, 6, 9, 10, 12** y el debounce del **5** (la paginación del Historial queda para 4d, con datos de `medirPerf`). Detalle:
    - **#1** Los listeners y el toggle de `switchMaster` pasan a `.subtab[data-master]`: los subtabs de Crédito ya no llaman `switchMaster(null)` ni pierden su `active` al entrar a Maestros.
    - **#2** Cada vista pide con un **token por zona** (`pedirZona`/`respuestaVigente`): una respuesta que llega tarde se descarta en vez de pisar la vista, y no se dispara un pedido si ya viaja uno idéntico (misma zona + misma clave de filtros). `precargarHistorial()` pasó a ser `cargarHistorial()` a secas — el guard de duplicados hace innecesaria la lógica paralela que tenía.
    - **#3** Fuera `maximum-scale=1` del viewport (`Code.js`): vuelve el pinch-zoom.
    - **#5 (parcial)** `debounce(fn, 150)` en las cuatro búsquedas por texto (Historial, Maestros, Compras, Pendientes).
    - **#6** Modal con **focus trap** (Tab cicla entre Cancelar/Confirmar), foco devuelto al elemento que lo abrió, y `body.modal-abierto { overflow:hidden }` para que el fondo no scrollee. Toast con `role="status" aria-live="polite"`.
    - **#9** Volver a Crédito respeta la subtab en la que estabas (`switchCredSub(credSubActual)`).
    - **#10** El filtro de categoría del Historial viaja como **`"Tipo|Categoria"`**: `Diario › Comida` y `Mensual › Comida` dejan de mezclarse. La etiqueta del desplegable solo antepone el Tipo cuando el nombre está repetido. `listarGastos` acepta el nombre pelado por compatibilidad.
    - **#12** `leerTabla_` cachea también la tabla vacía.
  - [x] **4b — suite de tests server (`src/tests.js`)** (2026-07-25): **52 tests**, runner `correrTests()` con PASS/FAIL en el Logger y contador final. Dos capas:
    - **Unitarios (34)** — no abren ninguna spreadsheet. Truco: `leerTabla_` devuelve `TABLA_MEMO_[nombre]` si la clave existe, así que `conFixtures_()` siembra ese memo con datos en memoria; eso permite testear no solo `logic.js` sino también los **lectores derivados** (`listarGastos`, `listarCompras`, `getCatalogos`, `getMaestros`) y los caminos de error de `confirmarResumen`. Como red de seguridad, durante los unitarios se pisa `getSheetId_` con una función que **tira**: si alguna función intentara abrir una Sheet, el test falla en vez de escribir.
    - **Integración (18)** — `db.js` y los endpoints contra la **sandbox** (`TEST_SHEET_ID`), con override temporal de `getSheetId_`, truncado antes de cada test y restauración garantizada en `finally`.
    - **Guarda dura**: si `TEST_SHEET_ID` faltara, la capa de integración se **saltea** con aviso; si fuera **igual a `SHEET_ID`**, se **aborta**. Verificado que ambas ramas disparan.
    - Los fixtures cubren a propósito lo que más se rompe: categorías homónimas en distinto Tipo, maestros inactivos, compra con `cuotas_previas`, compra en USD pagada en ARS, y compra ya completa.
    - **La suite ya pagó su costo en la primera corrida real**: encontró el hallazgo **#13** (round-trip de fechas por la timezone de la spreadsheet), que la revisión estática no podía ver porque solo aparece contra Sheets de verdad. Arreglado con `tzSheet_()` en `db.js` (memoizada por ejecución junto a `SS_MEMO_`) + `fechaISO_` formateando con esa tz; `setupSandbox()` además alinea la tz de la sandbox con la del proyecto. Hay test de regresión (`round-trip exacto`) y se verificó que aguanta incluso con la spreadsheet clavada en otra zona.
  - [ ] **4c — tests de la lógica pura del cliente**: exponer las funciones puras del front (`formatMonto`, `parseMonto`, `montoAInput`, `fmtFecha`, `fmtFechaLarga`, agrupación por día, filtros por texto) en `window.__TEST__` y `tests/client-tests.js`: script que Valentin pega en la consola del navegador (PC) sobre la app real y que imprime PASS/FAIL. Sin build step, sin duplicar código, corre contra lo que está deployado.
  - [ ] **4d — performance medida** (no percibida): `medirPerf()` en `tests.js` cronometra cada endpoint N veces sobre la sandbox (p50 / máx) y **prueba de carga con ~5.000 gastos sembrados** para ver dónde se cae `listarGastos` y el render del Historial. En el cliente, `performance.now()` alrededor de cada `google.script.run` bajo un flag (`window.__PERF__`). Salida: tabla de tiempos antes/después de los arreglos.
  - [ ] **4e — accesibilidad y pulido de UI**: zoom habilitado en mobile, foco visible en botones/tabs/chips (`:focus-visible`), roles y estados ARIA (tabs, subtabs, toast `role="status"`, modal con focus trap + devolución de foco + scroll bloqueado), contraste verificado de `--muted` y de los estados sobre `--card`, targets táctiles, y navegación completa con teclado en desktop.
  - [ ] **4f — robustez de datos**: atomicidad real de `confirmarResumen` (leer y escribir dentro del mismo lock), unicidad de id verificada al insertar, límites de longitud validados server-side (hoy la única barrera es el `maxlength` del cliente), y comportamiento defensivo ante una Sheet editada a mano (filas con FKs rotas, `activo` en texto, montos como texto).
  - [ ] **4g — checklist manual guiada** (celu + PC): matriz de casos de borde que ningún test automático cubre (gestos táctiles, teclado numérico, calendario nativo, rotación, sesión vencida, red lenta), con resultado esperado por caso. Es el entregable con el que Valentin cierra la iteración.
- [ ] **It 5 — Power BI as code**: Valentin crea el esqueleto UNA vez en Desktop (Obtener datos > Google Sheets → copia de trabajo; guardar como proyecto PBIP con PBIR en `/powerbi`; commit). Desde ahí, Claude Code desarrolla el modelo dimensional completo (Power Query + TMDL: dims, facts, FactCompromisos, `_Medidas`) y la primera página del reporte en PBIR. Loop: Claude edita → Valentin abre, valida, refresca, publica.
- [ ] **It 6 — Reporte + resguardo**: páginas restantes del reporte (mensual por categoría/medio, tendencias MoM, tablero de cuotas y compromisos futuros, corte por moneda), backup semanal automático de la copia de trabajo (trigger horario de GAS), re-corrida de migración para el cutover.

## Hallazgos de la auditoría It 4 (2026-07-25, revisión estática de `src/`)

Detectados leyendo el código, **antes** de correr ningún test. Prioridad: 🔴 rompe algo, 🟡 degrada, ⚪ pulido.

| # | Prio | Dónde | Qué pasa | Estado |
|---|---|---|---|---|
| 1 | 🔴 | `app-js.html` (listener de `.subtab`) | El listener se engancha a **todos** los `.subtab`, así que tocar Compras/Pendientes en Crédito llama `switchMaster(null)`: deja `masterActual = null`, desmarca los subtabs de Maestros y hace que Maestros muestre **Medios** con los filtros de Categoría visibles. | ✅ 4a |
| 2 | 🔴 | `cargarHistorial` / `cargarCompras` / `cargarPendientes` | No se verifica que la respuesta corresponda a los filtros vigentes: cambiar dos filtros rápido puede pintar el resultado del **filtro viejo** si llega último. Tampoco se deduplican requests en vuelo (`precargarHistorial` + entrar al Historial = 2 llamadas). | ✅ 4a |
| 3 | 🔴 | `Code.js` → `doGet` (`addMetaTag('viewport', …)`) | `maximum-scale=1` bloquea el pinch-zoom en el celu. Es una barrera de accesibilidad real y no aporta nada. | ✅ 4a |
| 4 | 🟡 | `confirmarResumen` (`api.js`) | Lee el estado de pagos **fuera** del lock y escribe adentro: ventana de carrera si se confirma desde dos pestañas. Poco probable con un solo usuario, pero es la escritura más cara de deshacer. | → 4f |
| 5 | 🟡 | `listarGastos` + `renderHistorial` | Sin límite ni paginación: siempre trae y **renderiza los 345 gastos** (y crece para siempre). Además la búsqueda por texto no tiene debounce → re-render completo del DOM por tecla. | 🟠 debounce ✅ 4a; paginación → 4d |
| 6 | 🟡 | Modal / toast | El modal no atrapa el foco, no lo devuelve al cerrar y no bloquea el scroll del fondo; el toast no es anunciado (`role="status"`). | ✅ 4a |
| 7 | 🟡 | `insertarFilas_` / `nuevoId_` | El id de 8 hex no se verifica contra los existentes. Con ~5.000 filas la probabilidad acumulada de colisión ronda 0,3%: barato chequearlo al insertar. | → 4f |
| 8 | 🟡 | `validarGastoPayload_` / `validarCompraPayload_` / `validarCategoria_` | No hay límite de longitud server-side: el `maxlength` del cliente es la única barrera. | → 4f |
| 9 | ⚪ | `navegarTab('credito')` | Volver a Crédito siempre resetea a la subtab Compras, aunque hayas salido desde Pendientes. | ✅ 4a |
| 10 | ⚪ | Filtro Categoría del Historial | Filtra por **nombre**, no por id: dos categorías con el mismo nombre en distinto Tipo (`Diario › Comida` y `Mensual › Comida`) se mezclan. | ✅ 4a |
| 11 | ⚪ | `styles.html` | `.btn` / `.tab` / `.icon-btn` / `.chip` no declaran `:focus-visible`; el placeholder de `r-tarjeta` / `r-medio` es una opción seleccionable con value vacío en vez de un placeholder deshabilitado. | → 4e |
| 12 | ⚪ | `leerTabla_` | El caso "tabla vacía" sale sin cachearse: se relee en cada llamada de la misma ejecución. | ✅ 4a |
| 13 | 🔴 | `fechaISO_` (`migracion.js`) | **No salió de la revisión estática: lo encontraron los tests de 4b al correr contra Sheets de verdad.** Formateaba con `America/Argentina/Tucuman` hardcodeada. `getValues()` devuelve una celda de fecha con su **hora de pared etiquetada como UTC** (medido con `diagnosticoFechas()`), así que formatear con cualquier otra tz corre la fecha un día — y de paso el guard de duplicados de Pago Bulk deja de funcionar **en silencio**, porque compara `compra\|fecha` contra la fecha ya corrida. | ✅ 4b (deploy @27) |

Al completar una iteración, marcarla acá y anotar lo decidido en "Registro de decisiones".

## Registro de decisiones

- 2026-07-25 (It 4b, fechas y timezone): **`fechaISO_` formatea en `UTC`, y eso NO es arbitrario.** Medido con `diagnosticoFechas()` contra Sheets real: `getValues()` sobre una celda de fecha devuelve un `Date` con la **hora de pared de la celda etiquetada como UTC**, sin intervención de la tz del script ni de la de la spreadsheet (celda que muestra `2026-01-01` → `2026-01-01T00:00:00.000Z`; celda que muestra `2025-12-31 19:00` → `2025-12-31T19:00:00.000Z`). Formatear en UTC es entonces lo único que recupera lo que la celda muestra, y es **independiente de ambas timezones**. Antes estaba hardcodeada la tz del proyecto → toda fecha guardada como `Date` volvía corrida un día. Método que valió la pena: se probaron dos hipótesis equivocadas (tz del script, tz de la spreadsheet) antes de dejar de suponer y **medir**; el diagnóstico queda en `tests.js` para no re-derivarlo. Corolario: todo dato que viaje por Sheets y vuelva necesita test de **round-trip**, no solo de escritura.

- 2026-07: Modelo con pagos reales vinculados a compras (sin pre-generar cuotas), para reflejar montos reales del resumen. La proyección futura se reconstruye como FactCompromisos en Power Query.
- 2026-07: Dos modelos separados: operacional en Sheets (captura) y dimensional en el PBIP (análisis). La transformación vive solo en Power Query; no se materializa el star schema en Sheets (escape hatch futuro: pestañas analíticas con Apps Script).
- 2026-07: Power BI versionado en el repo con PBIP (TMDL + PBIR); Claude Code como desarrollador BI; Desktop como validador/publicador. Refresh manual; Looker Studio descartado.
- 2026-07: La spreadsheet original de AppSheet queda intacta y desconectada; el proyecto opera sobre una copia con pestañas `legacy_*` como fuente de migración re-ejecutable (cutover = re-copiar y re-correr).
- 2026-07 (ajustes con tablas reales): `MediosPago` sin campo nombre (entidad = etiqueta) y tipo_medio con los 3 valores actuales. `moneda` real en Gastos y ComprasCredito (había USD oculto en Notas), sin conversión. `categoria_id` en ComprasCredito confirmado: las cuotas heredan la categoría real de la compra (hoy caían todas en "Credito"); el corte "cuánto pago en cuotas" sale del flag EsCuota. `cuotas_previas` como shim para historia sin filas de pago; deja de persistirse Cuotas_Pagadas. Se elimina ID_Metodo_Pago_Credito de Gastos (tarjeta derivable vía la compra); medio_pago_id = medio real con el que salió la plata. Splits "compartido con" quedan como nota libre.
- 2026-07: Compra en USD pagada en ARS es el caso esperado, no un edge case: la moneda del gasto es independiente de la de la compra (default de pago = ARS). Todo avance/progreso de compras se calcula por conteo de cuotas, nunca por ratio de montos entre monedas.
- 2026-07-12 (It 0, nombres reales de la copia): la spreadsheet es "Copia de Gastos App" con **5** pestañas legacy (el mapeo borrador asumía 4). Nombres reales → destino: `legacy_Lista_Metodo_de_Pago`→`MediosPago`, `legacy_Lista_Tipo_de_Gasto`→`Categorias`, `legacy_Gastos`→`Gastos`, `legacy_Consumos_Credito`→`ComprasCredito` (compras en cuotas). Aparece `legacy_Pagos_Credito_Header` (cabecera de pagos de resumen del AppSheet viejo) que **no estaba en el mapeo**: el modelo nuevo no tiene tabla de cabecera de pagos (los pagos son filas de `Gastos` con `compra_credito_id`). **Pendiente It 1**: inspeccionar headers + filas de `legacy_Pagos_Credito_Header` y `legacy_Consumos_Credito` para redefinir el mapeo de crédito antes de migrar; la sección "Migración desde legacy_*" de arriba queda como borrador a corregir con esa inspección.
- 2026-07-13 (It 1, migración corrida y validada): `legacy_Pagos_Credito_Header` vacía → descartada (modelo simple, pagos = filas de `Gastos`). `cuotas_previas = 0` en las 25 compras (toda cuota pagada tiene su fila de pago). 7 compras en USD; el resto de "indicio USD" en Gastos son precios de referencia de cripto → quedan ARS (compra USD siempre se paga en ARS). Categorías: se aprobaron 7 nuevas (Skincare, Libros, Viajes>{Estadia,Transporte,Entretenimiento,Otros}, Otro>Suscripciones) y el rename Ropa→Ropa-Indumentaria. Una única fila corrupta en `legacy_Gastos` (columnas corridas, "Andi a casa") → Valentin la corrigió en el origen.
- 2026-07-13 (It 1, ids uniformes): decisión que **reemplaza** "los ids legacy se conservan". Todos los ids pasan a ser opacos de 8 hex estilo `035ef75a`. La migración regenera los de `MediosPago`/`Categorias` (eran `mp-XXX`/`tg-XXX`) con `hash8_` (determinístico → re-run estable) y remapea todas las FKs; `ComprasCredito`/`Gastos` ya eran uuid corto y conservan su id. Altas nuevas en la app con `nuevoId_()` (aleatorio).
- 2026-07-22 (It 2, review 2b): (a) La cuota **conserva la categoría real de la compra** — se ratifica la decisión de diseño frente a la alternativa de categorizarla como `Mensual → Crédito → Tarjeta`. Motivo: así conviven "gasto por categoría real" (en qué gastó) y "cuánto paga de crédito por mes/tarjeta" (flag EsCuota + DimCompraCredito.Tarjeta) sin perder ninguno ni mezclar dimensiones. (b) Para dar esa visibilidad **en la app**, el Historial gana filtros "Crédito" (solo cuotas / solo directos) y "Tarjeta", más la tarjeta derivada visible en cada cuota. (c) Descripción de cuota autogenerada `Cuota N/M - <compra>`. (d) La pestaña batch se llama "Pago Bulk".
- 2026-07-23 (It 2 cerrada): la app queda **funcionalmente completa** para el uso diario (carga directa, historial, crédito, pago de resúmenes, maestros). Decisiones de implementación que conviene no re-discutir: (a) **sin endpoints nuevos por vista** — tanto la grilla de Pago Bulk como la vista de Pendientes reusan `listarCompras` y agrupan/derivan en el cliente; (b) el **estado de una compra nunca se persiste**, se deriva en cada lectura de los pagos vinculados; (c) `confirmarResumen` **no confía en el cliente**: recalcula `nro_cuota` server-side desde lecturas frescas y bloquea vincular más cuotas que las pendientes; (d) la categoría por fila en la grilla batch es un **select plano** "Categoría › Subcat" (la cascada de 3 niveles por fila era inusable en mobile). Nota de CSS: el reset global `input, select { appearance:none; width:100% }` rompe los checkboxes — hay un override explícito para `input[type="checkbox"]` en `styles.html`, no borrarlo.
- 2026-07-22 (It 1, app cerrada): decisiones de UX/negocio surgidas de las pruebas de Valentin. (a) **Un gasto directo nunca se paga con tarjeta de crédito**: el select del form parte de "Tipo de medio" con solo `Efectivo`/`Debito - Transferencia` (excluye `Credito`), reforzado con guarda en el server; los pagos de cuota (con medio real = la cuenta que paga el resumen) llegan en It 2. (b) Historial filtra por **rango de fechas** (no por mes) porque el filtro de mes no cubría el uso real. (c) **Fechas**: Sheets guarda el texto ISO como `Date`; se normaliza siempre en el server con `fechaISO_` antes de mandar al cliente (afecta orden, filtro por rango y edición). (d) **ABM permite borrado físico condicional** (solo sin referencias) además del soft delete, para poder limpiar altas de prueba sin arriesgar integridad. (e) Los catálogos se **refrescan en caliente** tras cada cambio de ABM y con un botón "↻ Actualizar"; antes quedaban cacheados de la carga inicial y un maestro nuevo no aparecía en Cargar hasta recargar la página.
- 2026-07-25 (It 3 cerrada): pulido de UX sobre una app ya funcional. (a) **Tema dark de marca** con colores de estado **convencionales**, no de marca: verde=ok/positivo, ámbar=alerta reversible (Desactivar), rojo=destructivo (Borrar/Eliminar), azul=barra de progreso. El rosa de marca resultó "muy abusivo" y quedó como detalle puntual (2 rondas de feedback). (b) **Performance sin agregar servicios**: la lentitud al cambiar de pestaña se atacó con memoización server por ejecución (spreadsheet + tablas), inyección de catálogos en el HTML inicial y **cache de vistas client-side stale-while-revalidate** (90s) invalidado por toda escritura y por ↻ — la app es el único escritor, así que el cache no se desfasa salvo edición manual de la Sheet (para eso está ↻). (c) **Búsquedas por texto y filtros de Maestros = client-side** sobre lo ya traído: no viajan al server (que cuesta ~1s) ni ensucian la clave de cache (que depende solo de los filtros del server). (d) **Modal de confirmación propio** reemplaza `window.confirm` (en el celu se veía como un cartel ajeno a la app). (e) Historial **agrupado por día** con total por moneda; el total del grupo manda en jerarquía visual sobre el detalle. (f) Del **3e opcional planificado** (últimos usados, chips de recientes, atajos Hoy/Ayer, editar nro_cuota, avisar al salir de Pago Bulk) se probaron los cinco en la rama `it3e-opcional` y Valentin dejó solo tres (Hoy/Ayer, editar nro_cuota, aviso de Pago Bulk); **descartó el prellenado por último usado y los chips de recientes** por no aportar. Método útil para features "nice to have": rama aparte, deploy a prueba sobre la URL real, y merge selectivo de lo que se queda.
