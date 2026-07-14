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
 * Categorías NUEVAS que no existen en legacy (decididas con Valentin en It 1).
 * IDs sintéticos ESTABLES (no uuid) para que la migración sea re-ejecutable y
 * los categoria_id de ComprasCredito sigan siendo válidos entre corridas.
 * Todas tipo "Diario" (gasto corriente).
 */
var CATEGORIAS_NUEVAS = [
  { id: 'nc-skincare',                tipo: 'Diario', categoria: 'Compras', subcategoria: 'Skincare' },
  { id: 'nc-libros',                  tipo: 'Diario', categoria: 'Compras', subcategoria: 'Libros' },
  { id: 'nc-viajes-estadia',          tipo: 'Diario', categoria: 'Viajes',  subcategoria: 'Estadia' },
  { id: 'nc-viajes-transporte',       tipo: 'Diario', categoria: 'Viajes',  subcategoria: 'Transporte' },
  { id: 'nc-viajes-entretenimiento',  tipo: 'Diario', categoria: 'Viajes',  subcategoria: 'Entretenimiento' },
  { id: 'nc-viajes-otros',            tipo: 'Diario', categoria: 'Viajes',  subcategoria: 'Otros' },
  { id: 'nc-otro-suscripciones',      tipo: 'Diario', categoria: 'Otro',    subcategoria: 'Suscripciones' }
];

/**
 * Renombres de subcategoría sobre categorías legacy (id conservado, cambia la
 * etiqueta). Decidido con Valentin: "Ropa" → "Ropa-Indumentaria".
 */
var RENOMBRES_SUBCATEGORIA = {
  'tg-008': 'Ropa-Indumentaria'
};

/**
 * Asignación de categoría por compra de crédito (dato NUEVO: no existe en
 * legacy). Aprobado por Valentin en It 1. compra_id → categoria_id.
 * Las cuotas de cada compra heredan esta categoría en el análisis (Power BI),
 * en vez de caer todas en la genérica "Credito".
 */
var CATEGORIA_POR_COMPRA = {
  '5ca1f825': 'nc-skincare',               // Farmaonline
  'c7f7d71a': 'tg-008',                    // Anteojos de sol → Ropa-Indumentaria
  'ec252c28': 'nc-viajes-transporte',      // Pasaje Tuc-Baires
  'f42cfb8f': 'tg-008',                    // Chanclas puma
  '522418a9': 'tg-010',                    // Cafetera → Electronica
  '1fe58e2d': 'tg-003',                    // Worms Steam → Ocio>Otro
  '42432a84': 'tg-011',                    // Cafe molido → Comestibles-Bebidas
  '07e6b04f': 'nc-viajes-entretenimiento', // Entradas oktober fedt
  'c88dcd73': 'nc-libros',                 // Libro Make Time
  '3df0d8fb': 'nc-viajes-transporte',      // Pago 2da parte buzios
  '364cf1c7': 'nc-viajes-estadia',         // Hotel san javier
  '5f0cf37d': 'nc-viajes-estadia',         // Noche Hotel Rio
  '75407fbb': 'tg-002',                    // Guantes Venum Kick → Ocio>Kickboxing
  '2465dbe0': 'nc-viajes-estadia',         // Noche Hotel Rio Ida - Andi
  '346b1bd3': 'tg-028',                    // Entrad Tan Bionica
  '4b2be2f6': 'nc-viajes-entretenimiento', // Fiesta Buzios
  '322a5f23': 'tg-012',                    // Regalo Machi
  'ae46bf52': 'tg-012',                    // Regalo cumple andi
  'c3dd6eb2': 'tg-028',                    // Entrada fundamentalistas del aire
  '8c453fc6': 'nc-otro-suscripciones',     // Suscripcion Claude
  '555db081': 'nc-skincare',               // skin care
  '524e0ee9': 'tg-012',                    // regalo maxi y catu
  '3c7bb1b2': 'tg-008',                    // buzos old mon
  '82b8e3f2': 'tg-028',                    // Entradas LPDA
  'f4e36c48': 'tg-008'                     // Zapas Adidas
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

/**
 * Normaliza un monto a número. Si ya es number, lo devuelve. Si es texto,
 * maneja decimal con coma (es-AR) y separador de miles. Si no parsea, devuelve
 * el valor original (para que la validación lo marque en el reporte).
 */
function numero_(v) {
  if (typeof v === 'number') return v;
  var s = String(v).trim();
  if (!s) return '';
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? v : n;
}

/** true si el texto tiene indicio de USD (USD, u$s, dolar/dólar). */
function detectarUSD_(texto) {
  return /\b(usd|u\$s|d[oó]lares?|d[oó]lar)\b/i.test(String(texto || ''));
}

/** Extrae N de "cuota N" en una descripción; null si no matchea. */
function nroCuotaDeDescripcion_(desc) {
  var m = /cuota\s*(\d+)/i.exec(String(desc || ''));
  return m ? Number(m[1]) : null;
}

/**
 * Genera un id opaco de 8 hex (estilo "035ef75a") DETERMINÍSTICO a partir de
 * un `seed` (el id legacy). Mismo seed → mismo id entre corridas: la migración
 * sigue siendo re-ejecutable sin romper referencias. `usados` es el set global
 * de ids ya asignados; ante colisión (rarísimo) alarga el id un carácter.
 */
function hash8_(seed, usados) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(seed), Utilities.Charset.UTF_8);
  var hex = raw.map(function (b) {
    var v = (b & 0xff).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
  var len = 8, id = hex.slice(0, len);
  while (usados[id]) { len++; id = hex.slice(0, len); }
  usados[id] = true;
  return id;
}

/**
 * Id ALEATORIO de 8 hex para altas nuevas desde la app (mismo estilo que los
 * ids migrados, pero no determinístico). Se refactoriza a db.js en el ABM.
 */
function nuevoId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

/**
 * MIGRACIÓN It 1 — reconstruye las 4 pestañas operacionales desde legacy_*.
 *
 * RE-EJECUTABLE: trunca las tablas nuevas (deja headers) y las regenera. En el
 * cutover se re-copian las pestañas frescas a legacy_* y se corre de nuevo.
 * NO toca las pestañas legacy_ (solo lectura). Escritura en batch, con lock.
 *
 * IDs: MediosPago y Categorias reciben un id nuevo de 8-hex (hash8_, estable
 * por hash del id legacy) y se remapean todas las FKs. ComprasCredito y Gastos
 * conservan su id (ya son uuid corto). Así todas las tablas quedan con ids del
 * mismo estilo opaco (035ef75a) sin romper relaciones ni el re-run.
 *
 * Mapeo (aprobado por Valentin, ver CATEGORIA_POR_COMPRA y CATEGORIAS_NUEVAS):
 *  - MediosPago  ← legacy_Lista_Metodo_de_Pago (activo=TRUE).
 *  - Categorias  ← legacy_Lista_Tipo_de_Gasto 1:1 + renombres + categorías nuevas.
 *  - ComprasCredito ← legacy_Consumos_Credito; categoria_id asignada por compra;
 *    moneda USD si notas/desc lo indican; cuotas_previas = max(0, pagadas − pagos vinculados).
 *  - Gastos ← legacy_Gastos; categoria_id = ID_Subcategoria; medio = ID_Entidad;
 *    compra_credito_id = ID_Credito_Enlazado; nro_cuota por regex "cuota N";
 *    moneda ARS por defecto (los resúmenes se pagan en pesos).
 *
 * Devuelve un REPORTE (no escribe nada roto): conteos, USD detectados, fks
 * huérfanas, filas salteadas y compras con cuotas_previas > 0.
 * Corré desde el editor (migrar → Run) y pegame el log.
 */
function migrar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('No se pudo tomar el lock (otra ejecución en curso).');
  try {
    var ss = SpreadsheetApp.openById(getSheetId_());
    var rep = [];
    var ahora = Utilities.formatDate(new Date(), 'America/Argentina/Tucuman', "yyyy-MM-dd'T'HH:mm:ss");

    // ---------- Lecturas legacy ----------
    var mp = leerLegacy_(ss, 'legacy_Lista_Metodo_de_Pago');
    var cat = leerLegacy_(ss, 'legacy_Lista_Tipo_de_Gasto');
    var cc = leerLegacy_(ss, 'legacy_Consumos_Credito');
    var gastos = leerLegacy_(ss, 'legacy_Gastos');
    var m = mp.idx, k = cat.idx, c = cc.idx, g = gastos.idx;
    var gEnlace = g['ID_Credito_Enlazado'];

    // ids que se CONSERVAN (ComprasCredito y Gastos ya usan uuid corto estilo
    // 035ef75a). Se siembran en idsUsados para que los ids nuevos generados
    // para las dimensiones no colisionen con ellos.
    var idsUsados = {};
    cc.rows.forEach(function (r) { var id = String(r[c['ID']]).trim(); if (id) idsUsados[id] = true; });
    gastos.rows.forEach(function (r) { var id = String(r[g['ID']]).trim(); if (id) idsUsados[id] = true; });

    // ---------- MediosPago (id nuevo 8-hex, estable por hash del id legacy) ----------
    var mediosOut = [];
    var medioIds = {};   // set de ids NUEVOS (para validar fks)
    var medioMap = {};   // id legacy (mp-XXX / uuid) -> id nuevo
    mp.rows.forEach(function (r) {
      var legacyId = String(r[m['ID']]).trim();
      if (!legacyId) return;
      var nid = hash8_(legacyId, idsUsados);
      medioMap[legacyId] = nid;
      medioIds[nid] = true;
      mediosOut.push([nid, String(r[m['Metodo_de_Pago']]).trim(), String(r[m['Entidad']]).trim(), true]);
    });

    // ---------- Categorias (id nuevo 8-hex; 1:1 + renombres + nuevas) ----------
    var catsOut = [];
    var catIds = {};     // set de ids NUEVOS
    var catMap = {};     // id legacy (tg-XXX / uuid / nc-*) -> id nuevo
    cat.rows.forEach(function (r) {
      var legacyId = String(r[k['ID']]).trim();
      if (!legacyId) return;
      var sub = String(r[k['Subcategoria']]);
      if (RENOMBRES_SUBCATEGORIA[legacyId]) sub = RENOMBRES_SUBCATEGORIA[legacyId];
      var nid = hash8_(legacyId, idsUsados);
      catMap[legacyId] = nid;
      catIds[nid] = true;
      catsOut.push([nid, String(r[k['Tipo_de_Gasto']]), String(r[k['Categoria']]), sub, true]);
    });
    CATEGORIAS_NUEVAS.forEach(function (cn) {
      var nid = hash8_(cn.id, idsUsados);   // seed = slug estable ("nc-...")
      catMap[cn.id] = nid;
      catIds[nid] = true;
      catsOut.push([nid, cn.tipo, cn.categoria, cn.subcategoria, true]);
    });

    // ---------- Contar pagos vinculados por compra (para cuotas_previas) ----------
    var pagosPorCompra = {};
    gastos.rows.forEach(function (r) {
      var link = String(r[gEnlace] || '').trim();
      if (link) pagosPorCompra[link] = (pagosPorCompra[link] || 0) + 1;
    });

    // ---------- ComprasCredito (id conservado; medio y categoria remapeados) ----------
    var comprasOut = [];
    var compraIds = {};
    var usdCompras = [];
    var previasList = [];
    var comprasSinCategoria = [];
    var comprasSalteadas = 0;
    cc.rows.forEach(function (r) {
      var id = String(r[c['ID']]).trim();
      if (!id) { comprasSalteadas++; return; }
      var notas = String(r[c['Notas']] || '');
      var desc = String(r[c['Descripcion']] || '');
      var moneda = detectarUSD_(notas + ' ' + desc) ? 'USD' : 'ARS';
      var pagadas = Number(r[c['Cuotas_Pagadas']]) || 0;
      var vinculados = pagosPorCompra[id] || 0;
      var previas = Math.max(0, pagadas - vinculados);
      var legacyMedio = String(r[c['ID_Entidad_Metodo_de_Pago']]).trim();
      var medioId = medioMap[legacyMedio] || legacyMedio;   // remap; si no mapea queda crudo y se reporta
      var legacyCat = CATEGORIA_POR_COMPRA[id] || '';
      var categoriaId = catMap[legacyCat] || legacyCat;
      if (!legacyCat) comprasSinCategoria.push(id + ' (' + desc + ')');
      if (moneda === 'USD') usdCompras.push(id + ' | ' + desc + ' | ' + numero_(r[c['Monto_Total']]));
      if (previas > 0) previasList.push(id + ' | ' + desc + ' | previas=' + previas + ' (pagadas=' + pagadas + ', vinculados=' + vinculados + ')');
      compraIds[id] = true;
      comprasOut.push([
        id, fechaISO_(r[c['Fecha']]), desc, medioId,
        categoriaId, numero_(r[c['Monto_Total']]), Number(r[c['Cuotas_Total']]) || '',
        moneda, previas, notas
      ]);
    });

    // ---------- Gastos ----------
    // nro_cuota: regex "cuota N"; para los que no matchean, relleno secuencial
    // por fecha dentro de cada compra (huecos 1..N no usados).
    var pagosDeCompra = {}; // compraId -> [{i, fecha, regexN}]
    gastos.rows.forEach(function (r, i) {
      var link = String(r[gEnlace] || '').trim();
      if (!link) return;
      (pagosDeCompra[link] = pagosDeCompra[link] || []).push({
        i: i, fecha: fechaISO_(r[g['Fecha']]), regexN: nroCuotaDeDescripcion_(r[g['Descripcion']])
      });
    });
    var nroCuotaPorFila = {}; // indice de fila legacy -> nro_cuota
    Object.keys(pagosDeCompra).forEach(function (link) {
      var arr = pagosDeCompra[link].slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; });
      var usados = {};
      arr.forEach(function (p) { if (p.regexN) usados[p.regexN] = true; });
      var next = 1;
      arr.forEach(function (p) {
        if (p.regexN) { nroCuotaPorFila[p.i] = p.regexN; return; }
        while (usados[next]) next++;
        usados[next] = true;
        nroCuotaPorFila[p.i] = next;
      });
    });

    var gastosOut = [];
    var gastosSalteados = 0;
    var usdGastos = [];
    var orphCat = [], orphMedio = [], orphCompra = [];
    gastos.rows.forEach(function (r, i) {
      var id = String(r[g['ID']]).trim();
      if (!id) { gastosSalteados++; return; }
      var desc = String(r[g['Descripcion']] || '');
      var legacyCat = String(r[g['ID_Subcategoria_Tipo_de_Gasto']]).trim();
      var legacyMedio = String(r[g['ID_Entidad_Metodo_de_Pago']]).trim();
      var categoriaId = catMap[legacyCat] || legacyCat;     // remap a id nuevo
      var medioId = medioMap[legacyMedio] || legacyMedio;
      var compraId = String(r[gEnlace] || '').trim();
      var nroCuota = compraId ? (nroCuotaPorFila[i] || '') : '';
      var moneda = detectarUSD_(desc) ? 'USD' : 'ARS';
      if (moneda === 'USD') usdGastos.push(id + ' | ' + desc);
      // Validación de fks (reporta el id legacy que no mapeó, no bloquea)
      if (legacyCat && !catMap[legacyCat]) orphCat.push(id + ' → categoria_id(legacy)=' + legacyCat);
      if (legacyMedio && !medioMap[legacyMedio]) orphMedio.push(id + ' → medio_pago_id(legacy)=' + legacyMedio);
      if (compraId && !compraIds[compraId]) orphCompra.push(id + ' → compra_credito_id="' + compraId + '"');
      gastosOut.push([
        id, fechaISO_(r[g['Fecha']]), desc, categoriaId, medioId,
        numero_(r[g['Monto']]), moneda, compraId, nroCuota, ahora
      ]);
    });

    // Validación de fks en ComprasCredito
    var orphCompraMedio = [], orphCompraCat = [];
    comprasOut.forEach(function (row) {
      if (row[3] && !medioIds[row[3]]) orphCompraMedio.push(row[0] + ' → medio_pago_id=' + row[3]);
      if (row[4] && !catIds[row[4]]) orphCompraCat.push(row[0] + ' → categoria_id=' + row[4]);
    });

    // ---------- Escritura batch (truncate + setValues) ----------
    escribirTabla_(ss, 'MediosPago', mediosOut);
    escribirTabla_(ss, 'Categorias', catsOut);
    escribirTabla_(ss, 'ComprasCredito', comprasOut);
    escribirTabla_(ss, 'Gastos', gastosOut);

    // ---------- Reporte ----------
    rep.push('===== MIGRACIÓN OK (' + ahora + ') =====');
    rep.push('Conteos escritos:');
    rep.push('  MediosPago:     ' + mediosOut.length);
    rep.push('  Categorias:     ' + catsOut.length + ' (' + cat.rows.length + ' legacy + ' + CATEGORIAS_NUEVAS.length + ' nuevas)');
    rep.push('  ComprasCredito: ' + comprasOut.length + '  (salteadas por ID vacío: ' + comprasSalteadas + ')');
    rep.push('  Gastos:         ' + gastosOut.length + '  (salteados por ID vacío: ' + gastosSalteados + ')');
    rep.push('IDs de MediosPago y Categorias regenerados a 8-hex; FKs remapeadas. ComprasCredito y Gastos conservan su id.');
    rep.push('');
    rep.push('Compras en USD (' + usdCompras.length + '):');
    usdCompras.forEach(function (s) { rep.push('  ' + s); });
    rep.push('');
    rep.push('Gastos con indicio USD (default ARS igual — revisá) (' + usdGastos.length + '):');
    usdGastos.forEach(function (s) { rep.push('  ' + s); });
    rep.push('');
    rep.push('Compras con cuotas_previas > 0 (' + previasList.length + '):');
    previasList.forEach(function (s) { rep.push('  ' + s); });
    rep.push('');
    rep.push('--- FKs huérfanas (a revisar) ---');
    rep.push('Gastos.categoria_id inexistente (' + orphCat.length + '): ' + (orphCat.join('  |  ') || 'ninguna'));
    rep.push('Gastos.medio_pago_id inexistente (' + orphMedio.length + '): ' + (orphMedio.join('  |  ') || 'ninguna'));
    rep.push('Gastos.compra_credito_id inexistente (' + orphCompra.length + '): ' + (orphCompra.join('  |  ') || 'ninguna'));
    rep.push('ComprasCredito.medio_pago_id inexistente (' + orphCompraMedio.length + '): ' + (orphCompraMedio.join('  |  ') || 'ninguna'));
    rep.push('ComprasCredito.categoria_id inexistente (' + orphCompraCat.length + '): ' + (orphCompraCat.join('  |  ') || 'ninguna'));
    rep.push('Compras sin categoría asignada (' + comprasSinCategoria.length + '): ' + (comprasSinCategoria.join('  |  ') || 'ninguna'));

    var salida = rep.join('\n');
    console.log(salida);
    return salida;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Trunca los datos de una pestaña operacional (deja la fila 1 de headers) y
 * escribe `filas` en batch. `filas` = array de arrays en el orden de SCHEMA.
 */
function escribirTabla_(ss, nombre, filas) {
  var hoja = ss.getSheetByName(nombre);
  if (!hoja) throw new Error('Falta la pestaña "' + nombre + '" (corré setupIt0 primero).');
  var headers = SCHEMA[nombre];
  var lastRow = hoja.getLastRow();
  if (lastRow > 1) hoja.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  if (filas.length) hoja.getRange(2, 1, filas.length, headers.length).setValues(filas);
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
