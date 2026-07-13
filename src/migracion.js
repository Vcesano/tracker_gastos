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

/**
 * Inspección READ-ONLY de las pestañas legacy_* (It 1, paso canónico).
 * No escribe nada. Por cada pestaña legacy: headers, conteo de filas de
 * datos y hasta 5 filas de muestra. Corré desde el editor y pegame el log.
 */
function inspeccionarLegacy() {
  var ss = SpreadsheetApp.openById(getSheetId_());
  var out = [];

  ss.getSheets().forEach(function (h) {
    var nombre = h.getName();
    if (nombre.indexOf('legacy_') !== 0) return;

    out.push('===== ' + nombre + ' =====');
    var lastRow = h.getLastRow();
    var lastCol = h.getLastColumn();
    if (lastRow < 1 || lastCol < 1) {
      out.push('(vacía)');
      out.push('');
      return;
    }

    var headers = h.getRange(1, 1, 1, lastCol).getValues()[0];
    out.push('Headers (' + lastCol + '): ' + headers.join(' | '));
    out.push('Filas de datos: ' + (lastRow - 1));

    var n = Math.min(5, lastRow - 1);
    if (n > 0) {
      var muestra = h.getRange(2, 1, n, lastCol).getValues();
      muestra.forEach(function (fila, i) {
        var celdas = fila.map(function (v) { return String(v); });
        out.push('  fila ' + (i + 1) + ': ' + celdas.join(' | '));
      });
    }
    out.push('');
  });

  var salida = out.join('\n');
  console.log(salida);
  return salida;
}

/** Devuelve {header: indiceColumna} a partir de la fila de headers. */
function indexar_(headers) {
  var idx = {};
  headers.forEach(function (h, i) { idx[String(h).trim()] = i; });
  return idx;
}

/** Fecha ISO yyyy-MM-dd si es Date; si no, el valor tal cual como texto. */
function fechaISO_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'America/Argentina/Tucuman', 'yyyy-MM-dd');
  }
  return String(v);
}

/** Lee una pestaña legacy como {headers, idx, rows}. */
function leerLegacy_(ss, nombre) {
  var h = ss.getSheetByName(nombre);
  var lr = h.getLastRow(), lc = h.getLastColumn();
  var headers = h.getRange(1, 1, 1, lc).getValues()[0];
  var rows = lr > 1 ? h.getRange(2, 1, lr - 1, lc).getValues() : [];
  return { headers: headers, idx: indexar_(headers), rows: rows };
}

/**
 * Inspección READ-ONLY dirigida al mapeo de It 1. No escribe nada.
 * Vuelca: (A) las 28 compras de crédito con cuotas_previas ya calculado,
 * (B) el catálogo completo de categorías, (C) muestra de pagos de cuota
 * reales (filas de Gastos con ID_Credito_Enlazado). Corré y pegame el log.
 */
function inspeccionarParaMapeo() {
  var ss = SpreadsheetApp.openById(getSheetId_());
  var out = [];

  var gastos = leerLegacy_(ss, 'legacy_Gastos');
  var gEnlace = gastos.idx['ID_Credito_Enlazado'];

  // Contar pagos vinculados por compra (para cuotas_previas)
  var pagosPorCompra = {};
  gastos.rows.forEach(function (r) {
    var link = String(r[gEnlace] || '').trim();
    if (link) pagosPorCompra[link] = (pagosPorCompra[link] || 0) + 1;
  });

  // (A) Compras de crédito completas
  var cc = leerLegacy_(ss, 'legacy_Consumos_Credito');
  var c = cc.idx;
  out.push('##### (A) CONSUMOS_CREDITO (' + cc.rows.length + ')');
  out.push('# ID | Fecha | Descripcion | Monto_Total | Cuotas_Total | Cuotas_Pagadas | pagos_en_Gastos | cuotas_previas_calc | mp | Notas');
  cc.rows.forEach(function (r) {
    var id = String(r[c['ID']]);
    var pagados = Number(r[c['Cuotas_Pagadas']]) || 0;
    var enlazados = pagosPorCompra[id] || 0;
    var previas = Math.max(0, pagados - enlazados);
    out.push([
      'A', id, fechaISO_(r[c['Fecha']]), r[c['Descripcion']], r[c['Monto_Total']],
      r[c['Cuotas_Total']], pagados, enlazados, previas,
      r[c['ID_Entidad_Metodo_de_Pago']], r[c['Notas']]
    ].join(' | '));
  });
  out.push('');

  // (B) Catálogo de categorías
  var cat = leerLegacy_(ss, 'legacy_Lista_Tipo_de_Gasto');
  var k = cat.idx;
  out.push('##### (B) CATEGORIAS (' + cat.rows.length + ')');
  out.push('# ID | Tipo | Categoria | Subcategoria');
  cat.rows.forEach(function (r) {
    out.push(['B', r[k['ID']], r[k['Tipo_de_Gasto']], r[k['Categoria']], r[k['Subcategoria']]].join(' | '));
  });
  out.push('');

  // (C) Muestra de pagos de cuota (Gastos con ID_Credito_Enlazado), hasta 25
  var g = gastos.idx;
  var pagos = gastos.rows.filter(function (r) { return String(r[gEnlace] || '').trim(); });
  out.push('##### (C) PAGOS DE CUOTA en legacy_Gastos (total ' + pagos.length + ', muestra 25)');
  out.push('# compra_enlazada | Fecha | Descripcion | Monto | categoria_id | mp');
  pagos.slice(0, 25).forEach(function (r) {
    out.push([
      'C', r[gEnlace], fechaISO_(r[g['Fecha']]), r[g['Descripcion']], r[g['Monto']],
      r[g['ID_Subcategoria_Tipo_de_Gasto']], r[g['ID_Entidad_Metodo_de_Pago']]
    ].join(' | '));
  });

  var salida = out.join('\n');
  console.log(salida);
  return salida;
}
