# Checklist manual — It 4g

Matriz de casos que **ningún test automático cubre**: gestos táctiles, teclado
nativo, calendario del sistema, rotación, sesión vencida, red lenta y todo lo
que solo se ve con un dedo o un mouse de verdad.

Los tests de `correrTests()` verifican la lógica; esto verifica la *experiencia*.
Es el entregable con el que se cierra It 4.

- **Dónde**: la web app real → `https://script.google.com/macros/s/AKfycbw-i6THWm1pnIyFXNBzYpS5nQ31gJX84RjrtQkCbxHxE6LXuyldhgNbIWWF-Fqgjl1m/exec`
- **Dispositivos**: 📱 celu (Android/iOS, Chrome o Safari) y 💻 PC (Chrome).
- **Datos**: se carga y se borra sobre la **copia de trabajo**. Todo lo que se
  crea acá se borra al final (paso F3). Nada destructivo sin backup.
- **Cómo marcar**: `[x]` pasa · `[!]` falla (anotá qué pasó abajo del caso).

---

## A. Preparación

- [ ] **A1** — Antes de empezar, correr `reporteDiagnostico()` en el editor de
      Apps Script. **Esperado**: `✓ Sin problemas de integridad.` Si aparecen
      problemas, anotarlos: son datos preexistentes, no algo que rompa la prueba.
- [ ] **A2** — Correr `correrTests()`. **Esperado**: `70 PASS / 0 FAIL`.
- [ ] **A3** — Abrir la app en el celu y en la PC en paralelo, ambas ya logueadas.

---

## B. Gestos y entrada táctil 📱

| # | Caso | Cómo | Esperado |
|---|---|---|---|
| B1 | Pinch-zoom | Hacer zoom con dos dedos en cualquier pantalla | **Amplía**. Antes de @25 estaba bloqueado; si no amplía, volvió el bug |
| B2 | Teclado numérico | Tocar el campo **Monto** en Cargar | Abre el teclado **numérico**, no el alfabético |
| B3 | Separador de miles | Tipear `123456` en Monto | Se ve `123.456` mientras escribís, sin saltos del cursor |
| B4 | Decimales | Tipear `1234,5` | Queda `1.234,5`. Tipear una coma más: **no** se agrega |
| B5 | Calendario nativo | Tocar el campo **Fecha** | Abre el date picker del sistema; elegir una fecha la deja bien escrita |
| B6 | Atajos Hoy/Ayer | Tocar **Hoy** y después **Ayer** | La fecha cambia al día correcto (ojo con el corrimiento de un día) |
| B7 | Targets del Historial | Tocar **✎ Editar** y **🗑 Borrar** con el pulgar, sin apuntar | Se acierta sin errarle al de al lado (son 36px desde @31) |
| B8 | Scroll con modal abierto | Abrir el modal de borrado e intentar scrollear el fondo | El fondo **no** scrollea; solo se mueve el modal si hace falta |
| B9 | Cerrar modal tocando afuera | Abrir el modal y tocar el fondo oscuro | Se cierra **cancelando** (no borra nada) |
| B10 | Desplegables | Abrir Tipo → Categoría → Subcategoría | Se ve la flecha propia, y la cascada se llena en orden |
| B11 | Grilla de Pago Bulk | Generar una grilla y scrollear tildando checkboxes | Los checkboxes responden al toque y no se pierde el scroll |

---

## C. Teclado y navegación 💻

| # | Caso | Cómo | Esperado |
|---|---|---|---|
| C1 | Foco visible | Apretar **Tab** repetidamente desde el inicio | Se ve un **anillo verde** claro en cada control. Ninguno queda sin marca |
| C2 | Foco al tocar | Clickear un botón con el mouse | **No** aparece el anillo (es `:focus-visible`, a propósito) |
| C3 | Tabs con flechas | Enfocar una pestaña y usar **← →** | Cambia de pestaña. **Inicio/Fin** van a la primera/última |
| C4 | Roving tabindex | Desde una pestaña, apretar **Tab** | Salta **al contenido**, no a las otras 4 pestañas |
| C5 | Modal: foco inicial | Abrir el modal de borrado | El foco arranca en **Confirmar** |
| C6 | Modal: focus trap | Con el modal abierto, apretar Tab varias veces | El foco cicla entre **Cancelar** y **Confirmar**, nunca se escapa al fondo |
| C7 | Modal: Escape | Apretar **Esc** | Cierra cancelando |
| C8 | Modal: foco devuelto | Cerrar el modal | El foco vuelve al botón que lo abrió |
| C9 | Submit con Enter | En Cargar, completar y apretar **Enter** en Monto | Envía el formulario (no recarga la página) |
| C10 | Zoom del navegador | Ctrl + `+` hasta 200% | Nada se superpone ni se corta; la app sigue usable |

---

## D. Casos de borde de datos

> Estos tocan la copia de trabajo. Todo lo creado acá se borra en F3.

| # | Caso | Cómo | Esperado |
|---|---|---|---|
| D1 | Monto 0 | Cargar un gasto con monto `0` | Error claro del server: "mayor a 0". No se inserta |
| D2 | Descripción larguísima | Pegar 300 caracteres en Descripción | El campo corta en 140 (`maxlength`). Si llegara al server, lo rechaza con "máximo 140 caracteres" |
| D3 | Fecha futura | Cargar un gasto con fecha del mes que viene | **Se permite** (es un caso válido: pago adelantado). Aparece primero en el Historial |
| D4 | Fecha retroactiva | Cargar un gasto de hace 3 meses | Aparece **en su día**, agrupado con los de esa fecha, no arriba de todo |
| D5 | Editar sin cambiar nada | Editar un gasto y guardar sin tocar nada | El monto queda **idéntico** (round-trip del formato es-AR) |
| D6 | Cuota duplicada | En Pago Bulk, cargar una cuota; repetir la misma compra con la **misma fecha** | Aparece el modal de aviso de duplicado; **Cancelar** no inserta nada |
| D7 | Más cuotas que pendientes | En Pago Bulk, agregar la misma compra más veces que sus pendientes | Error del server nombrando la compra y cuántas quedan. **No entra ninguna** |
| D8 | Atomicidad | En Pago Bulk, armar 3 filas y hacer que una tenga monto vacío | Rebota **todo**: el Historial no gana ni una fila |
| D9 | Compra en USD | Registrar el pago en ARS de una cuota de una compra USD | La cuota teórica en USD se ve **solo como referencia**; el pago queda en ARS |
| D10 | Progreso entre monedas | Ver esa compra en Crédito → Compras | El avance es por **conteo de cuotas**; el pagado se muestra separado por moneda, nunca sumado |
| D11 | Maestro con referencias | Intentar **eliminar** una categoría que tiene gastos | Se niega y ofrece **Desactivar**. Desactivarla la saca de Cargar pero el gasto viejo sigue mostrándola |
| D12 | Categorías homónimas | Filtrar el Historial por una categoría que existe en Diario **y** Mensual | Trae **solo la del Tipo elegido**, no las dos mezcladas |
| D13 | Filtros combinados | Poner rango de fechas + categoría + Solo cuotas + tarjeta | El contador del botón "Filtros" muestra la cantidad correcta; "Limpiar filtros" los saca todos de una |
| D14 | Búsqueda por texto | Escribir rápido en Buscar del Historial | Filtra sin trabarse (hay debounce de 150ms) y **no** hace viajes al server |

---

## E. Red, sesión y estados raros

| # | Caso | Cómo | Esperado |
|---|---|---|---|
| E1 | Red lenta | DevTools → Network → **Slow 3G**, y cambiar de pestaña | Aparecen los **skeletons**; no queda una pantalla en blanco sin explicación |
| E2 | Sin red | Modo avión, y tocar Guardar | Mensaje de **error de conexión** claro. Al volver la red, reintentar funciona |
| E3 | Doble submit | Tocar Guardar dos veces rápido | Se inserta **un solo** gasto |
| E4 | Filtros veloces | Cambiar 3 filtros del Historial muy rápido seguido | Gana el **último** filtro. No se pinta el resultado de uno viejo |
| E5 | Sesión vencida | Dejar la app abierta varias horas y operar | Si Google pide re-login, el mensaje es entendible; recargar la página resuelve |
| E6 | Salir de Pago Bulk | Generar una grilla y cambiar de pestaña sin confirmar | Avisa que se pierde y pide confirmación |
| E7 | Botón ↻ | Editar la Sheet a mano (agregar un gasto) y tocar ↻ en la app | Gira mientras carga y **aparece** el gasto nuevo |
| E8 | Cache stale | Cargar un gasto y volver al Historial enseguida | Se ve **inmediatamente** el gasto nuevo (la escritura invalida el cache) |
| E9 | Precarga | Recargar la app y tocar Historial / Crédito / Maestros al toque | Aparecen **instantáneas** (se precargaron al arrancar, @30) |

---

## F. Tamaños, rotación y cierre

| # | Caso | Cómo | Esperado |
|---|---|---|---|
| F1 | Rotación 📱 | Rotar el celu en cada una de las 5 pestañas | Nada se corta ni se superpone; el scroll horizontal **nunca** aparece |
| F2 | Desktop ancho 💻 | Maximizar la ventana | El contenedor se ensancha y los formularios pasan a **2 columnas** (≥900px) |
| F3 | **Limpieza** | Borrar todos los gastos, compras y maestros creados durante la prueba | El Historial vuelve al estado previo |
| F4 | Diagnóstico final | Correr `reporteDiagnostico()` otra vez | **Mismo resultado que A1**: la prueba no dejó datos rotos |

---

## Resultado

- Fecha: ______________
- Dispositivos usados: ______________
- Casos fallados: ______________
- Decisión: [ ] It 4 cerrada · [ ] hace falta otra vuelta
