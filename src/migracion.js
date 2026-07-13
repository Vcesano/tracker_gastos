/**
 * Setup / migración (It 0 → It 1).
 *
 * SCHEMA es el contrato de headers con Power Query: los nombres y el orden
 * de las columnas de las 4 pestañas operacionales. Snake_case, sin acentos.
 * Ver CLAUDE.md (Modelo operacional).
 */
var SCHEMA = {
  MediosPago: ['id', 'tipo_medio', 'entidad', 'activo'],
  Categorias: ['id', 'tipo', 'categoria', 'subcategoria', 'activo'],
  ComprasCredito: [
    'id', 'fecha_compra', 'descripcion', 'medio_pago_id', 'categoria_id',
    'monto_total', 'n_cuotas', 'moneda', 'cuotas_previas', 'nota'
  ],
  Gastos: [
    'id', 'fecha', 'descripcion', 'categoria_id', 'medio_pago_id', 'monto',
    'moneda', 'compra_credito_id', 'nro_cuota', 'creado_en'
  ]
};

/**
 * Lee el SHEET_ID de Script Properties (la COPIA de trabajo).
 * Nunca hardcodear el id. Se refactoriza a db.js en It 1.
 */
function getSheetId_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) {
    throw new Error('Falta la Script Property "SHEET_ID". Cargala en Project Settings.');
  }
  return id;
}

/**
 * Setup de It 0. SEGURA (no borra nada) e IDEMPOTENTE (re-ejecutable).
 *
 * 1) Si todavía no hay pestañas "legacy_*", le pone ese prefijo a TODAS las
 *    pestañas actuales (las de AppSheet). Renombrar preserva los datos.
 * 2) Crea las 4 pestañas operacionales nuevas (SCHEMA) con su fila de headers,
 *    si no existen ya. Header en negrita y fila 1 congelada.
 *
 * Corré esta función desde el editor (dropdown de funciones → setupIt0 → Run)
 * y pegame el Registro de ejecución.
 */
function setupIt0() {
  var ss = SpreadsheetApp.openById(getSheetId_());
  var log = [];
  log.push('Spreadsheet: "' + ss.getName() + '"');

  var hojas = ss.getSheets();
  var nombresActuales = hojas.map(function (h) { return h.getName(); });
  log.push('Pestañas antes: ' + nombresActuales.join(', '));

  var yaHayLegacy = nombresActuales.some(function (n) { return n.indexOf('legacy_') === 0; });

  // Paso 1: prefijar legacy_ (solo primera corrida)
  if (yaHayLegacy) {
    log.push('Ya existen pestañas legacy_ → no se renombra nada (re-ejecución).');
  } else {
    hojas.forEach(function (h) {
      var viejo = h.getName();
      h.setName('legacy_' + viejo);
      log.push('Renombrada: "' + viejo + '" → "legacy_' + viejo + '"');
    });
  }

  // Paso 2: crear las 4 pestañas nuevas con headers (si faltan)
  Object.keys(SCHEMA).forEach(function (nombre) {
    if (ss.getSheetByName(nombre)) {
      log.push('Ya existe la pestaña "' + nombre + '" → se deja como está.');
      return;
    }
    var headers = SCHEMA[nombre];
    var hoja = ss.insertSheet(nombre);
    hoja.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    hoja.setFrozenRows(1);
    log.push('Creada: "' + nombre + '" con headers [' + headers.join(', ') + ']');
  });

  var final = ss.getSheets().map(function (h) { return h.getName(); });
  log.push('Pestañas después: ' + final.join(', '));

  var salida = log.join('\n');
  Logger.log(salida);
  console.log(salida);
  return salida;
}
