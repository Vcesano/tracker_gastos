/**
 * Capa de datos operacional (It 1, slice 1a).
 *
 * Reglas (CLAUDE.md > Convenciones de código):
 *  - Leer la tabla completa mapeando por la fila de headers y operar en memoria.
 *  - Escribir SIEMPRE en batch (un solo setValues). Prohibido fila por fila en loop.
 *  - Toda escritura protegida con LockService (tryLock ~10s).
 *
 * Reusa globals que ya viven en el scope global de Apps Script (migracion.js):
 *  getSheetId_ (SHEET_ID de la copia), nuevoId_ (id 8-hex aleatorio),
 *  indexar_, SCHEMA. No se redeclaran acá.
 */

/** Abre la spreadsheet de trabajo (la COPIA). */
function abrirSS_() {
  return SpreadsheetApp.openById(getSheetId_());
}

/**
 * Lee una pestaña operacional completa como array de objetos, con las claves
 * tomadas de la fila 1 (el contrato de headers). Vacía → [].
 */
function leerTabla_(nombre) {
  var hoja = abrirSS_().getSheetByName(nombre);
  if (!hoja) throw new Error('No existe la pestaña "' + nombre + '".');
  var lr = hoja.getLastRow(), lc = hoja.getLastColumn();
  if (lr < 1 || lc < 1) return [];
  var headers = hoja.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h).trim(); });
  if (lr < 2) return [];
  var rows = hoja.getRange(2, 1, lr - 1, lc).getValues();
  return rows.map(function (r) {
    var o = {};
    headers.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}

/**
 * Inserta filas al final de una pestaña, en batch y con lock. `objetos` es un
 * array de objetos {header: valor}; se ordenan según la fila de headers real de
 * la hoja (headers ausentes en el objeto quedan ''). Devuelve la cantidad
 * escrita. No valida negocio: eso es responsabilidad de api.js/logic.js.
 */
function insertarFilas_(nombre, objetos) {
  if (!objetos || !objetos.length) return 0;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('No se pudo tomar el lock (otra escritura en curso). Probá de nuevo.');
  }
  try {
    var hoja = abrirSS_().getSheetByName(nombre);
    if (!hoja) throw new Error('No existe la pestaña "' + nombre + '".');
    var lc = hoja.getLastColumn();
    var headers = hoja.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h).trim(); });
    var filas = objetos.map(function (o) {
      return headers.map(function (h) {
        return Object.prototype.hasOwnProperty.call(o, h) ? o[h] : '';
      });
    });
    var start = hoja.getLastRow() + 1;
    hoja.getRange(start, 1, filas.length, headers.length).setValues(filas);
    SpreadsheetApp.flush();
    return filas.length;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Actualiza una fila (identificada por su columna `id`) aplicando `cambios`
 * {header: valor}. Solo se tocan los headers presentes en `cambios`. Escritura
 * de una sola fila (no es loop de escritura) con lock. Devuelve true si la
 * encontró y actualizó, false si no existe ese id.
 */
function actualizarFila_(nombre, id, cambios) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('No se pudo tomar el lock (otra escritura en curso). Probá de nuevo.');
  }
  try {
    var hoja = abrirSS_().getSheetByName(nombre);
    if (!hoja) throw new Error('No existe la pestaña "' + nombre + '".');
    var lc = hoja.getLastColumn(), lr = hoja.getLastRow();
    var headers = hoja.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h).trim(); });
    var idCol = headers.indexOf('id');
    if (idCol < 0) throw new Error('La pestaña "' + nombre + '" no tiene columna id.');
    if (lr < 2) return false;
    var valores = hoja.getRange(2, 1, lr - 1, lc).getValues();
    for (var i = 0; i < valores.length; i++) {
      if (String(valores[i][idCol]) !== String(id)) continue;
      headers.forEach(function (h, ci) {
        if (Object.prototype.hasOwnProperty.call(cambios, h)) valores[i][ci] = cambios[h];
      });
      hoja.getRange(i + 2, 1, 1, lc).setValues([valores[i]]);
      SpreadsheetApp.flush();
      return true;
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Borra FÍSICAMENTE la fila con ese `id` (deleteRow). Con lock. Devuelve true
 * si la encontró y borró, false si no existe. Borrado físico permitido solo en
 * `Gastos` (los maestros usan soft delete activo=FALSE, ver ABM en 1c).
 */
function borrarFila_(nombre, id) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('No se pudo tomar el lock (otra escritura en curso). Probá de nuevo.');
  }
  try {
    var hoja = abrirSS_().getSheetByName(nombre);
    if (!hoja) throw new Error('No existe la pestaña "' + nombre + '".');
    var lc = hoja.getLastColumn(), lr = hoja.getLastRow();
    var headers = hoja.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h).trim(); });
    var idCol = headers.indexOf('id');
    if (idCol < 0) throw new Error('La pestaña "' + nombre + '" no tiene columna id.');
    if (lr < 2) return false;
    var ids = hoja.getRange(2, idCol + 1, lr - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) {
        hoja.deleteRow(i + 2);
        SpreadsheetApp.flush();
        return true;
      }
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

/**
 * true si el valor de la columna `activo` cuenta como activo. La migración
 * escribe booleanos, pero una edición manual en la Sheet puede dejar el texto
 * "TRUE"/"VERDADERO": se contemplan ambos.
 */
function esActivo_(v) {
  if (v === true) return true;
  var s = String(v).trim().toUpperCase();
  return s === 'TRUE' || s === 'VERDADERO';
}

/** Timestamp ISO local (America/Argentina/Tucuman) para creado_en. */
function ahoraISO_() {
  return Utilities.formatDate(new Date(), 'America/Argentina/Tucuman', "yyyy-MM-dd'T'HH:mm:ss");
}
