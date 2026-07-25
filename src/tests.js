/**
 * Suite de tests del server (It 4b).
 *
 * Se corre desde el editor de Apps Script: dropdown de funciones → correrTests
 * → Run, y el resultado sale en el Registro de ejecución (Logger).
 *
 * REGLA DE ORO DE It 4: ningún test toca la copia de trabajo.
 *  - Capa 1 (unitarios): no abren NINGUNA spreadsheet. Se apoyan en que
 *    `leerTabla_` devuelve `TABLA_MEMO_[nombre]` si la clave existe: se siembra
 *    ese memo con fixtures en memoria. Como red de seguridad, mientras corren
 *    se pisa `getSheetId_` con una función que TIRA: si algún día una de estas
 *    funciones intentara abrir una Sheet, el test falla en vez de escribir.
 *  - Capa 2 (integración): corren contra una spreadsheet SANDBOX propia, cuyo
 *    id vive en la Script Property `TEST_SHEET_ID`, vía un override temporal de
 *    `getSheetId_`. Si esa property falta, la capa se saltea con un aviso. Si
 *    coincidiera con `SHEET_ID`, se aborta.
 *
 * Puesta a punto de la sandbox (una sola vez):
 *   1. Valentin crea una spreadsheet nueva y VACÍA en su Drive.
 *   2. Pega su id en Apps Script > Project Settings > Script properties como
 *      `TEST_SHEET_ID`.
 *   3. Corre `setupSandbox()` una vez (crea las 4 pestañas con sus headers).
 */

/* ===================== Runner ===================== */

var T_ = null;   // estado de la corrida actual

/** Punto de entrada. Corré esta función desde el editor. */
function correrTests() {
  T_ = { pass: 0, fail: 0, salida: [], fallos: [], suite: '' };
  log_('═══ Tests del server — ' + ahoraISO_() + ' ═══');

  suite_('Helpers puros', testsHelpers_);
  suite_('Validadores (fixtures en memoria)', testsValidadores_);
  suite_('Lecturas derivadas (fixtures en memoria)', testsLecturas_);
  suite_('confirmarResumen — validaciones (fixtures en memoria)', testsConfirmarResumen_);

  if (!idSandbox_()) {
    log_('');
    log_('⚠ Integración SALTEADA: falta la Script Property "TEST_SHEET_ID".');
    log_('  Creá una spreadsheet vacía, pegá su id ahí y corré setupSandbox().');
    log_('  (Se saltea a propósito: los tests nunca caen sobre la copia de trabajo.)');
  } else {
    try {
      conSandbox_(function () {
        suite_('db.js contra la sandbox', testsDb_);
        suite_('Endpoints contra la sandbox', testsEndpoints_);
      });
    } catch (e) {
      T_.fail++;
      T_.fallos.push('Integración abortada: ' + e.message);
      log_('');
      log_('✗ Integración ABORTADA: ' + e.message);
    }
  }

  log_('');
  log_('═══ RESULTADO: ' + T_.pass + ' PASS / ' + T_.fail + ' FAIL ═══');
  if (T_.fallos.length) {
    log_('Fallos:');
    T_.fallos.forEach(function (f) { log_('  · ' + f); });
  }
  return T_.salida.join('\n');
}

function log_(linea) {
  T_.salida.push(linea);
  Logger.log(linea);
}

function suite_(nombre, fn) {
  T_.suite = nombre;
  log_('');
  log_('── ' + nombre + ' ──');
  fn();
}

function test_(nombre, fn) {
  try {
    fn();
    T_.pass++;
    log_('  PASS  ' + nombre);
  } catch (e) {
    T_.fail++;
    T_.fallos.push(T_.suite + ' › ' + nombre + ': ' + e.message);
    log_('  FAIL  ' + nombre + ' → ' + e.message);
  }
}

/* ===================== Asserts ===================== */

function ok_(cond, msg) {
  if (!cond) throw new Error(msg || 'se esperaba una condición verdadera');
}

function eq_(actual, esperado, msg) {
  if (actual !== esperado) {
    throw new Error((msg ? msg + ' — ' : '') +
      'esperaba ' + JSON.stringify(esperado) + ' y vino ' + JSON.stringify(actual));
  }
}

/** El resultado debe ser {ok:true}; devuelve su `data`. */
function resOk_(res, msg) {
  if (!res || !res.ok) {
    throw new Error((msg ? msg + ' — ' : '') +
      'esperaba ok:true y vino error "' + (res && res.error) + '"');
  }
  return res.data;
}

/** El resultado debe ser {ok:false}; opcionalmente el error menciona `frag`. */
function resErr_(res, frag, msg) {
  if (!res || res.ok) {
    throw new Error((msg ? msg + ' — ' : '') + 'esperaba un error y vino ok:true');
  }
  if (frag && String(res.error).toLowerCase().indexOf(String(frag).toLowerCase()) < 0) {
    throw new Error((msg ? msg + ' — ' : '') +
      'el error no menciona "' + frag + '" → "' + res.error + '"');
  }
  return res.error;
}

/* ===================== Fixtures en memoria ===================== */

/**
 * Datos de las 4 tablas para los unitarios. Cubren a propósito los casos que
 * más se rompen: dos categorías HOMÓNIMAS en distinto Tipo (Diario › Comida y
 * Mensual › Comida), maestros inactivos, una compra con cuotas_previas, una
 * compra en USD pagada en ARS, y una compra ya completa.
 */
function fixtures_() {
  return {
    Categorias: [
      { id: 'cat00001', tipo: 'Diario', categoria: 'Comida', subcategoria: 'Almuerzo', activo: true },
      { id: 'cat00002', tipo: 'Mensual', categoria: 'Comida', subcategoria: 'Delivery', activo: true },
      { id: 'cat00003', tipo: 'Diario', categoria: 'Transporte', subcategoria: '', activo: true },
      { id: 'cat00004', tipo: 'Diario', categoria: 'Obsoleta', subcategoria: '', activo: false }
    ],
    MediosPago: [
      { id: 'med00001', tipo_medio: 'Efectivo', entidad: 'Efectivo', activo: true },
      { id: 'med00002', tipo_medio: 'Debito - Transferencia', entidad: 'Galicia Debito', activo: true },
      { id: 'med00003', tipo_medio: 'Credito', entidad: 'Galicia Visa', activo: true },
      { id: 'med00004', tipo_medio: 'Debito - Transferencia', entidad: 'Cuenta vieja', activo: false },
      { id: 'med00005', tipo_medio: 'Credito', entidad: 'Galicia Amex', activo: true }
    ],
    ComprasCredito: [
      // 6 cuotas, 2 pagadas → 4 pendientes, teórico 10000 ARS.
      {
        id: 'com00001', fecha_compra: '2026-05-10', descripcion: 'Heladera',
        medio_pago_id: 'med00003', categoria_id: 'cat00001', monto_total: 60000,
        n_cuotas: 6, moneda: 'ARS', cuotas_previas: 0, nota: ''
      },
      // USD, 1 cuota previa + 2 pagos en ARS = 3 de 3 → completa.
      {
        id: 'com00002', fecha_compra: '2026-04-01', descripcion: 'Notebook',
        medio_pago_id: 'med00005', categoria_id: 'cat00003', monto_total: 300,
        n_cuotas: 3, moneda: 'USD', cuotas_previas: 1, nota: 'compartido con Juan'
      }
    ],
    Gastos: [
      { id: 'gas00001', fecha: '2026-07-01', descripcion: 'Milanesa', categoria_id: 'cat00001', medio_pago_id: 'med00001', monto: 5000, moneda: 'ARS', compra_credito_id: '', nro_cuota: '', creado_en: '2026-07-01T10:00:00' },
      { id: 'gas00002', fecha: '2026-07-01', descripcion: 'Pedido ya', categoria_id: 'cat00002', medio_pago_id: 'med00002', monto: 8000, moneda: 'ARS', compra_credito_id: '', nro_cuota: '', creado_en: '2026-07-01T21:00:00' },
      { id: 'gas00003', fecha: '2026-06-15', descripcion: 'Cuota 1/6 - Heladera', categoria_id: 'cat00001', medio_pago_id: 'med00002', monto: 10500, moneda: 'ARS', compra_credito_id: 'com00001', nro_cuota: 1, creado_en: '2026-06-15T09:00:00' },
      { id: 'gas00004', fecha: '2026-07-15', descripcion: 'Cuota 2/6 - Heladera', categoria_id: 'cat00001', medio_pago_id: 'med00002', monto: 10800, moneda: 'ARS', compra_credito_id: 'com00001', nro_cuota: 2, creado_en: '2026-07-15T09:00:00' },
      { id: 'gas00005', fecha: '2026-07-15', descripcion: 'Cuota 2/3 - Notebook', categoria_id: 'cat00003', medio_pago_id: 'med00002', monto: 90000, moneda: 'ARS', compra_credito_id: 'com00002', nro_cuota: 2, creado_en: '2026-07-15T09:00:00' },
      { id: 'gas00006', fecha: '2026-07-20', descripcion: 'Cuota 3/3 - Notebook', categoria_id: 'cat00003', medio_pago_id: 'med00002', monto: 91000, moneda: 'ARS', compra_credito_id: 'com00002', nro_cuota: 3, creado_en: '2026-07-20T09:00:00' }
    ]
  };
}

/**
 * Corre `fn` con las 4 tablas servidas desde memoria y con `getSheetId_`
 * bloqueado. Restaura todo al salir, incluso si `fn` tira.
 */
function conFixtures_(fn) {
  var memo = TABLA_MEMO_, ss = SS_MEMO_, tz = TZ_MEMO_, gs = getSheetId_;
  TABLA_MEMO_ = fixtures_();
  SS_MEMO_ = null;
  TZ_MEMO_ = null;
  getSheetId_ = function () {
    throw new Error('Un test unitario intentó abrir una spreadsheet real (no debería).');
  };
  try {
    return fn();
  } finally {
    TABLA_MEMO_ = memo;
    SS_MEMO_ = ss;
    TZ_MEMO_ = tz;
    getSheetId_ = gs;
  }
}

/* ===================== Capa 1: unitarios ===================== */

function testsHelpers_() {
  test_('fechaISO_ formatea un Date a yyyy-mm-dd', function () {
    eq_(fechaISO_(new Date(2026, 6, 25)), '2026-07-25');
  });

  test_('fechaISO_ deja pasar un texto ISO tal cual', function () {
    eq_(fechaISO_('2026-07-25'), '2026-07-25');
  });

  test_('numero_ parsea montos es-AR (miles "." y decimal ",")', function () {
    eq_(numero_('1.234,56'), 1234.56);
    eq_(numero_('1234.56'), 1234.56);
    eq_(numero_(1234.56), 1234.56);
    eq_(numero_(''), '');
  });

  test_('esActivo_ acepta boolean, TRUE y VERDADERO (Sheet editada a mano)', function () {
    eq_(esActivo_(true), true);
    eq_(esActivo_('TRUE'), true);
    eq_(esActivo_('true'), true);
    eq_(esActivo_('VERDADERO'), true);
    eq_(esActivo_(false), false);
    eq_(esActivo_('FALSE'), false);
    eq_(esActivo_(''), false);
  });

  test_('nuevoId_ devuelve 8 hex y no se repite', function () {
    var a = nuevoId_(), b = nuevoId_();
    ok_(/^[0-9a-f]{8}$/.test(a), 'formato inesperado: ' + a);
    ok_(a !== b, 'dos ids seguidos salieron iguales');
  });

  test_('hash8_ es determinístico y esquiva colisiones', function () {
    eq_(hash8_('mp-001', {}), hash8_('mp-001', {}), 'mismo seed → mismo id');
    var usados = {};
    var primero = hash8_('mp-001', usados);
    var segundo = hash8_('mp-001', usados);   // ya usado: se alarga
    ok_(primero !== segundo, 'ante colisión debería alargar el id');
    eq_(primero.length, 8);
    eq_(segundo.length, 9);
  });

  test_('indexar_ mapea headers a índices', function () {
    var idx = indexar_(['id', ' fecha ', 'monto']);
    eq_(idx.id, 0);
    eq_(idx.fecha, 1, 'debería trimear el header');
    eq_(idx.monto, 2);
  });

  test_('ahoraISO_ tiene forma de timestamp local', function () {
    ok_(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(ahoraISO_()), 'formato inesperado');
  });

  test_('SCHEMA mantiene el contrato de headers con Power Query', function () {
    eq_(SCHEMA.MediosPago.join(','), 'id,tipo_medio,entidad,activo');
    eq_(SCHEMA.Categorias.join(','), 'id,tipo,categoria,subcategoria,activo');
    eq_(SCHEMA.ComprasCredito.join(','),
      'id,fecha_compra,descripcion,medio_pago_id,categoria_id,monto_total,n_cuotas,moneda,cuotas_previas,nota');
    eq_(SCHEMA.Gastos.join(','),
      'id,fecha,descripcion,categoria_id,medio_pago_id,monto,moneda,compra_credito_id,nro_cuota,creado_en');
  });
}

function testsValidadores_() {
  test_('validarGastoPayload_ acepta un gasto válido y normaliza', function () {
    conFixtures_(function () {
      var v = validarGastoPayload_({
        fecha: '2026-07-25', descripcion: '  Café  ', categoria_id: 'cat00001',
        medio_pago_id: 'med00001', monto: '1500', moneda: 'ars'
      });
      resOk_(v);
      eq_(v.data.descripcion, 'Café', 'debería trimear');
      eq_(v.data.monto, 1500, 'debería venir como número');
      eq_(v.data.moneda, 'ARS', 'debería normalizar a mayúsculas');
    });
  });

  test_('validarGastoPayload_ rechaza fecha, monto y moneda inválidos', function () {
    conFixtures_(function () {
      var base = { fecha: '2026-07-25', categoria_id: 'cat00001', medio_pago_id: 'med00001', monto: 100, moneda: 'ARS' };
      resErr_(validarGastoPayload_(merge_(base, { fecha: '25/07/2026' })), 'fecha');
      resErr_(validarGastoPayload_(merge_(base, { fecha: '' })), 'fecha');
      resErr_(validarGastoPayload_(merge_(base, { monto: 0 })), 'monto');
      resErr_(validarGastoPayload_(merge_(base, { monto: -5 })), 'monto');
      resErr_(validarGastoPayload_(merge_(base, { monto: 'abc' })), 'monto');
      resErr_(validarGastoPayload_(merge_(base, { moneda: 'EUR' })), 'moneda');
    });
  });

  test_('validarGastoPayload_ rechaza maestros inexistentes o inactivos', function () {
    conFixtures_(function () {
      var base = { fecha: '2026-07-25', categoria_id: 'cat00001', medio_pago_id: 'med00001', monto: 100, moneda: 'ARS' };
      resErr_(validarGastoPayload_(merge_(base, { categoria_id: 'noexiste' })), 'categoría');
      resErr_(validarGastoPayload_(merge_(base, { categoria_id: 'cat00004' })), 'inactiva', 'categoría inactiva');
      resErr_(validarGastoPayload_(merge_(base, { medio_pago_id: 'med00004' })), 'inactiv', 'medio inactivo');
      resErr_(validarGastoPayload_(merge_(base, { categoria_id: '' })), 'categoría');
      resErr_(validarGastoPayload_(merge_(base, { medio_pago_id: '' })), 'medio');
    });
  });

  test_('validarGastoPayload_ NO deja pagar un gasto directo con tarjeta de crédito', function () {
    conFixtures_(function () {
      resErr_(validarGastoPayload_({
        fecha: '2026-07-25', categoria_id: 'cat00001', medio_pago_id: 'med00003',
        monto: 100, moneda: 'ARS'
      }), 'crédito');
    });
  });

  test_('validarCompraPayload_ acepta una compra válida', function () {
    conFixtures_(function () {
      var v = validarCompraPayload_({
        fecha_compra: '2026-07-01', descripcion: 'TV', medio_pago_id: 'med00003',
        categoria_id: 'cat00001', monto_total: 120000, n_cuotas: 12, moneda: 'ARS'
      });
      resOk_(v);
      eq_(v.data.n_cuotas, 12);
      eq_(v.data.moneda, 'ARS');
    });
  });

  test_('validarCompraPayload_ exige que la tarjeta sea tipo Credito y activa', function () {
    conFixtures_(function () {
      var base = { fecha_compra: '2026-07-01', medio_pago_id: 'med00003', categoria_id: 'cat00001', monto_total: 1000, n_cuotas: 3, moneda: 'ARS' };
      resErr_(validarCompraPayload_(merge_(base, { medio_pago_id: 'med00002' })), 'no es una tarjeta');
      resErr_(validarCompraPayload_(merge_(base, { medio_pago_id: 'noexiste' })), 'no existe');
      resErr_(validarCompraPayload_(merge_(base, { medio_pago_id: '' })), 'tarjeta');
    });
  });

  test_('validarCompraPayload_ exige n_cuotas entero >= 1', function () {
    conFixtures_(function () {
      var base = { fecha_compra: '2026-07-01', medio_pago_id: 'med00003', categoria_id: 'cat00001', monto_total: 1000, n_cuotas: 3, moneda: 'ARS' };
      resErr_(validarCompraPayload_(merge_(base, { n_cuotas: 0 })), 'cuotas');
      resErr_(validarCompraPayload_(merge_(base, { n_cuotas: 2.5 })), 'cuotas');
      resErr_(validarCompraPayload_(merge_(base, { n_cuotas: 'muchas' })), 'cuotas');
      resErr_(validarCompraPayload_(merge_(base, { monto_total: 0 })), 'monto');
    });
  });

  test_('validarCategoria_ detecta duplicados sin importar mayúsculas', function () {
    conFixtures_(function () {
      resErr_(validarCategoria_({ tipo: 'diario', categoria: 'COMIDA', subcategoria: 'almuerzo' }), 'ya existe');
      // Mismo Categoría+Subcategoría pero otro Tipo: NO es duplicado.
      resOk_(validarCategoria_({ tipo: 'Mensual', categoria: 'Comida', subcategoria: 'Almuerzo' }));
      // Editándose a sí misma tampoco choca.
      resOk_(validarCategoria_({ tipo: 'Diario', categoria: 'Comida', subcategoria: 'Almuerzo' }, 'cat00001'));
      resErr_(validarCategoria_({ tipo: '', categoria: 'X' }), 'tipo');
      resErr_(validarCategoria_({ tipo: 'Diario', categoria: '' }), 'categoría');
    });
  });

  test_('validarMedio_ detecta entidades duplicadas', function () {
    conFixtures_(function () {
      resErr_(validarMedio_({ tipo_medio: 'Efectivo', entidad: 'efectivo' }), 'ya existe');
      resOk_(validarMedio_({ tipo_medio: 'Efectivo', entidad: 'Efectivo' }, 'med00001'), 'editándose a sí mismo');
      resOk_(validarMedio_({ tipo_medio: 'Credito', entidad: 'Naranja X' }));
      resErr_(validarMedio_({ tipo_medio: '', entidad: 'X' }), 'tipo');
      resErr_(validarMedio_({ tipo_medio: 'Efectivo', entidad: '' }), 'entidad');
    });
  });

  test_('contadores de referencias (para el borrado condicional)', function () {
    conFixtures_(function () {
      eq_(contarPagosDeCompra_('com00001'), 2);
      eq_(contarPagosDeCompra_('com00002'), 2);
      eq_(contarPagosDeCompra_('noexiste'), 0);
      eq_(contarRefsCategoria_('cat00001'), 4, '3 gastos + 1 compra');
      eq_(contarRefsCategoria_('cat00004'), 0, 'inactiva y sin usar → borrable');
      eq_(contarRefsMedio_('med00002'), 5, 'la cuenta que paga los resúmenes: 1 gasto directo + 4 cuotas');
      eq_(contarRefsMedio_('med00003'), 1, 'la tarjeta solo la usa la compra');
    });
  });
}

function testsLecturas_() {
  test_('getCatalogos devuelve solo activos y separa las tarjetas', function () {
    conFixtures_(function () {
      var d = resOk_(getCatalogos());
      eq_(d.categorias.length, 3, 'la inactiva no viaja');
      eq_(d.medios.length, 4, 'el medio inactivo no viaja');
      eq_(d.tarjetas.length, 2, 'solo los medios Credito');
      eq_(d.tarjetas[0].tipo_medio, 'Credito');
    });
  });

  test_('listarGastos ordena por fecha desc y arma las etiquetas', function () {
    conFixtures_(function () {
      var g = resOk_(listarGastos({})).gastos;
      eq_(g.length, 6);
      eq_(g[0].fecha, '2026-07-20', 'el más nuevo primero');
      eq_(g[g.length - 1].fecha, '2026-06-15', 'el más viejo último');
      eq_(g[0].categoria_label, 'Transporte', 'sin subcategoría no lleva " › "');
      var almuerzo = porId_(g, 'gas00001');
      eq_(almuerzo.categoria_label, 'Comida › Almuerzo');
      eq_(almuerzo.medio_label, 'Efectivo');
      eq_(almuerzo.es_cuota, false);
    });
  });

  test_('listarGastos deriva la tarjeta de una cuota (no la duplica en Gastos)', function () {
    conFixtures_(function () {
      var cuota = porId_(resOk_(listarGastos({})).gastos, 'gas00004');
      eq_(cuota.es_cuota, true);
      eq_(cuota.medio_label, 'Galicia Debito', 'el medio es la CUENTA que pagó el resumen');
      eq_(cuota.tarjeta_label, 'Galicia Visa', 'la tarjeta sale de la compra vinculada');
      eq_(cuota.compra_label, 'Heladera');
      eq_(cuota.compra_ncuotas, 6);
      eq_(cuota.nro_cuota, 2);
    });
  });

  test_('listarGastos filtra por rango de fechas', function () {
    conFixtures_(function () {
      eq_(resOk_(listarGastos({ desde: '2026-07-01' })).gastos.length, 5);
      eq_(resOk_(listarGastos({ hasta: '2026-07-01' })).gastos.length, 3);
      eq_(resOk_(listarGastos({ desde: '2026-07-01', hasta: '2026-07-15' })).gastos.length, 4);
      eq_(resOk_(listarGastos({ desde: '2027-01-01' })).gastos.length, 0);
    });
  });

  test_('listarGastos NO mezcla categorías homónimas de distinto Tipo (It 4a)', function () {
    conFixtures_(function () {
      // gas00001 (Diario › Comida) + las 2 cuotas de Heladera, que también son
      // Diario › Comida. gas00002 es Mensual › Comida y queda afuera.
      eq_(resOk_(listarGastos({ categoria: 'Diario|Comida' })).gastos.length, 3);
      eq_(resOk_(listarGastos({ categoria: 'Mensual|Comida' })).gastos.length, 1);
      // Nombre pelado (compatibilidad): trae las dos.
      eq_(resOk_(listarGastos({ categoria: 'Comida' })).gastos.length, 4);
      eq_(resOk_(listarGastos({ categoria: 'Diario|Comida', subcategoria: 'Almuerzo' })).gastos.length, 3);
      eq_(resOk_(listarGastos({ categoria: 'Diario|Comida', subcategoria: 'Delivery' })).gastos.length, 0);
    });
  });

  test_('listarGastos filtra por medio, por crédito y por tarjeta', function () {
    conFixtures_(function () {
      eq_(resOk_(listarGastos({ medio_pago_id: 'med00001' })).gastos.length, 1);
      eq_(resOk_(listarGastos({ cuotas: 'solo' })).gastos.length, 4);
      eq_(resOk_(listarGastos({ cuotas: 'sin' })).gastos.length, 2);
      eq_(resOk_(listarGastos({ tarjeta_id: 'med00003' })).gastos.length, 2, 'las 2 cuotas de la Visa');
      eq_(resOk_(listarGastos({ tarjeta_id: 'med00005' })).gastos.length, 2, 'las 2 cuotas de la Amex');
      eq_(resOk_(listarGastos({ tarjeta_id: 'med00003', cuotas: 'sin' })).gastos.length, 0);
    });
  });

  test_('listarCompras deriva el estado por CONTEO de cuotas, nunca por monto', function () {
    conFixtures_(function () {
      var compras = resOk_(listarCompras({})).compras;
      eq_(compras.length, 2);
      var heladera = porId_(compras, 'com00001');
      eq_(heladera.pagadas, 2);
      eq_(heladera.pendientes, 4);
      eq_(heladera.completa, false);
      eq_(heladera.monto_cuota_teorico, 10000);
      eq_(heladera.tarjeta_label, 'Galicia Visa');

      // cuotas_previas cuenta como pagada aunque no tenga fila en Gastos.
      var note = porId_(compras, 'com00002');
      eq_(note.pagadas, 3, '1 previa + 2 pagos');
      eq_(note.pendientes, 0);
      eq_(note.completa, true);
    });
  });

  test_('listarCompras agrupa lo pagado por moneda (nunca suma ARS + USD)', function () {
    conFixtures_(function () {
      var note = porId_(resOk_(listarCompras({})).compras, 'com00002');
      eq_(note.moneda, 'USD', 'la compra es en USD');
      eq_(note.pagado.length, 1, 'los pagos fueron todos en ARS');
      eq_(note.pagado[0].moneda, 'ARS');
      eq_(note.pagado[0].monto, 181000);
    });
  });

  test_('listarCompras filtra por estado y por tarjeta, y ordena pendientes primero', function () {
    conFixtures_(function () {
      var pend = resOk_(listarCompras({ estado: 'pendientes' })).compras;
      eq_(pend.length, 1);
      eq_(pend[0].id, 'com00001');
      eq_(resOk_(listarCompras({ estado: 'completas' })).compras.length, 1);
      eq_(resOk_(listarCompras({ medio_pago_id: 'med00005' })).compras.length, 1);
      eq_(resOk_(listarCompras({})).compras[0].completa, false, 'las pendientes van primero');
    });
  });

  test_('getMaestros trae también los inactivos, con activo booleano', function () {
    conFixtures_(function () {
      var d = resOk_(getMaestros());
      eq_(d.categorias.length, 4);
      eq_(d.medios.length, 5);
      eq_(porId_(d.categorias, 'cat00004').activo, false);
      eq_(porId_(d.medios, 'med00001').activo, true);
    });
  });
}

function testsConfirmarResumen_() {
  // Base reutilizable: paga con la cuenta de débito, un ítem de la Heladera.
  function payload_(over) {
    return merge_({
      fecha: '2026-08-10',
      medio_pago_id: 'med00002',
      items: [{ compra_credito_id: 'com00001', categoria_id: 'cat00001', monto: 10000, moneda: 'ARS' }]
    }, over);
  }

  test_('rechaza pagar el resumen con otra tarjeta de crédito', function () {
    conFixtures_(function () {
      resErr_(confirmarResumen(payload_({ medio_pago_id: 'med00003' })), 'crédito');
    });
  });

  test_('rechaza fecha inválida, medio inactivo y grilla vacía', function () {
    conFixtures_(function () {
      resErr_(confirmarResumen(payload_({ fecha: '10/08/2026' })), 'fecha');
      resErr_(confirmarResumen(payload_({ medio_pago_id: 'med00004' })), 'inactivo');
      resErr_(confirmarResumen(payload_({ medio_pago_id: '' })), 'medio');
      resErr_(confirmarResumen(payload_({ items: [] })), 'no hay nada');
    });
  });

  test_('rechaza ítems con monto, moneda o categoría inválidos', function () {
    conFixtures_(function () {
      var it = { compra_credito_id: 'com00001', categoria_id: 'cat00001', monto: 100, moneda: 'ARS' };
      resErr_(confirmarResumen(payload_({ items: [merge_(it, { monto: 0 })] })), 'monto');
      resErr_(confirmarResumen(payload_({ items: [merge_(it, { moneda: 'EUR' })] })), 'moneda');
      resErr_(confirmarResumen(payload_({ items: [merge_(it, { categoria_id: 'cat00004' })] })), 'categoría');
      resErr_(confirmarResumen(payload_({ items: [merge_(it, { compra_credito_id: 'noexiste' })] })), 'inexistente');
    });
  });

  test_('no deja vincular más cuotas que las pendientes', function () {
    conFixtures_(function () {
      // La Notebook ya está completa (0 pendientes).
      resErr_(confirmarResumen(payload_({
        items: [{ compra_credito_id: 'com00002', categoria_id: 'cat00003', monto: 1000, moneda: 'ARS' }]
      })), 'no tiene tantas cuotas pendientes');

      // La Heladera tiene 4 pendientes: 5 ítems de la misma compra no entran.
      var cinco = [];
      for (var i = 0; i < 5; i++) {
        cinco.push({ compra_credito_id: 'com00001', categoria_id: 'cat00001', monto: 10000, moneda: 'ARS' });
      }
      resErr_(confirmarResumen(payload_({ items: cinco })), 'pendientes');
    });
  });

  test_('avisa antes de duplicar un pago de la misma compra y misma fecha', function () {
    conFixtures_(function () {
      // gas00004 ya es un pago de com00001 con fecha 2026-07-15.
      var res = confirmarResumen(payload_({ fecha: '2026-07-15' }));
      var d = resOk_(res);
      eq_(d.requiereConfirmacion, true);
      eq_(d.duplicados.length, 1);
      eq_(d.duplicados[0], 'Heladera');
      ok_(d.insertados === undefined, 'no debería haber insertado nada');
    });
  });
}

/* ===================== Sandbox ===================== */

function idSandbox_() {
  return PropertiesService.getScriptProperties().getProperty('TEST_SHEET_ID') || '';
}

function idTrabajo_() {
  return PropertiesService.getScriptProperties().getProperty('SHEET_ID') || '';
}

/**
 * Prepara la spreadsheet sandbox: crea las 4 pestañas operacionales con sus
 * headers (SCHEMA) si faltan. Corré esto UNA vez, después de cargar la Script
 * Property `TEST_SHEET_ID`. No borra datos.
 */
function setupSandbox() {
  var idTest = idSandbox_();
  if (!idTest) {
    throw new Error('Falta la Script Property "TEST_SHEET_ID". Creá una spreadsheet vacía y pegá su id ahí.');
  }
  if (idTest === idTrabajo_()) {
    throw new Error('TEST_SHEET_ID es igual a SHEET_ID. La sandbox tiene que ser OTRA spreadsheet.');
  }

  var ss = SpreadsheetApp.openById(idTest);
  var nombres = ss.getSheets().map(function (h) { return h.getName(); });

  // La sandbox tiene que espejar la copia de trabajo también en la timezone:
  // es la que Sheets usa para interpretar las celdas de fecha.
  var tzProyecto = Session.getScriptTimeZone();
  if (ss.getSpreadsheetTimeZone() !== tzProyecto) ss.setSpreadsheetTimeZone(tzProyecto);

  // Guarda: si tiene pestañas legacy_*, es una copia de datos reales, no una
  // sandbox. Mejor abortar que arriesgarse a truncarla en cada corrida.
  var legacy = nombres.filter(function (n) { return n.indexOf('legacy_') === 0; });
  if (legacy.length) {
    throw new Error('Esa spreadsheet tiene pestañas legacy_* (' + legacy.join(', ') +
      '): parece una copia de datos reales, no una sandbox. Usá una spreadsheet nueva y vacía.');
  }

  var log = [
    'Sandbox: ' + ss.getName() + ' (' + idTest + ')',
    'Timezone: ' + ss.getSpreadsheetTimeZone() + ' (proyecto: ' + tzProyecto + ')'
  ];
  Object.keys(SCHEMA).forEach(function (nombre) {
    if (ss.getSheetByName(nombre)) {
      log.push('Ya existe "' + nombre + '" → se deja como está.');
      return;
    }
    var headers = SCHEMA[nombre];
    var hoja = ss.insertSheet(nombre);
    hoja.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    hoja.setFrozenRows(1);
    log.push('Creada "' + nombre + '" con headers [' + headers.join(', ') + ']');
  });

  var salida = log.join('\n');
  Logger.log(salida);
  return salida;
}

/**
 * Corre `fn` apuntando a la sandbox. Verifica que el override haya tomado
 * efecto y trunca las 4 tablas antes de empezar. Restaura siempre.
 */
function conSandbox_(fn) {
  var idTest = idSandbox_();
  if (idTest === idTrabajo_()) {
    throw new Error('TEST_SHEET_ID es igual a SHEET_ID: los tests NUNCA corren sobre la copia de trabajo.');
  }

  var gs = getSheetId_, memo = TABLA_MEMO_, ss = SS_MEMO_, tz = TZ_MEMO_;
  getSheetId_ = function () { return idTest; };
  SS_MEMO_ = null;
  TZ_MEMO_ = null;
  TABLA_MEMO_ = {};
  try {
    if (getSheetId_() !== idTest) {
      throw new Error('No se pudo activar el override de getSheetId_; se aborta para no tocar datos reales.');
    }
    truncarSandbox_();
    return fn();
  } finally {
    getSheetId_ = gs;
    SS_MEMO_ = ss;
    TZ_MEMO_ = tz;
    TABLA_MEMO_ = memo;
  }
}

/** Deja las 4 pestañas de la sandbox con headers y sin datos. */
function truncarSandbox_() {
  var ss = abrirSS_();
  Object.keys(SCHEMA).forEach(function (nombre) {
    var hoja = ss.getSheetByName(nombre);
    if (!hoja) throw new Error('Falta la pestaña "' + nombre + '" en la sandbox. Corré setupSandbox().');
    var lr = hoja.getLastRow();
    if (lr > 1) hoja.getRange(2, 1, lr - 1, SCHEMA[nombre].length).clearContent();
  });
  SpreadsheetApp.flush();
  invalidarTabla_();
}

/**
 * Siembra los maestros mínimos en la sandbox y devuelve sus ids. Cada test que
 * lo necesite arranca de cero (trunca primero).
 */
function sembrarMaestros_() {
  truncarSandbox_();
  var ids = {
    catComida: nuevoId_(), catTransporte: nuevoId_(), catInactiva: nuevoId_(),
    efectivo: nuevoId_(), debito: nuevoId_(), visa: nuevoId_()
  };
  insertarFilas_('Categorias', [
    { id: ids.catComida, tipo: 'Diario', categoria: 'Comida', subcategoria: 'Almuerzo', activo: true },
    { id: ids.catTransporte, tipo: 'Diario', categoria: 'Transporte', subcategoria: '', activo: true },
    { id: ids.catInactiva, tipo: 'Diario', categoria: 'Obsoleta', subcategoria: '', activo: false }
  ]);
  insertarFilas_('MediosPago', [
    { id: ids.efectivo, tipo_medio: 'Efectivo', entidad: 'Efectivo', activo: true },
    { id: ids.debito, tipo_medio: 'Debito - Transferencia', entidad: 'Galicia Debito', activo: true },
    { id: ids.visa, tipo_medio: 'Credito', entidad: 'Galicia Visa', activo: true }
  ]);
  return ids;
}

/* ===================== Capa 2: integración ===================== */

function testsDb_() {
  test_('leerTabla_ de una pestaña vacía devuelve []', function () {
    truncarSandbox_();
    eq_(leerTabla_('Gastos').length, 0);
  });

  test_('insertarFilas_ escribe en batch e invalida el cache de lectura', function () {
    truncarSandbox_();
    var n = insertarFilas_('Categorias', [
      { id: 'aaa11111', tipo: 'Diario', categoria: 'Uno', subcategoria: '', activo: true },
      { id: 'bbb22222', tipo: 'Mensual', categoria: 'Dos', subcategoria: 'Sub', activo: false }
    ]);
    eq_(n, 2);
    var filas = leerTabla_('Categorias');
    eq_(filas.length, 2, 'la lectura posterior tiene que ver lo recién escrito');
    eq_(String(filas[0].id), 'aaa11111');
    eq_(String(filas[1].subcategoria), 'Sub');
  });

  test_('insertarFilas_ ordena las columnas según los headers, no según el objeto', function () {
    truncarSandbox_();
    // Claves a propósito en orden distinto al de SCHEMA.
    insertarFilas_('MediosPago', [{ entidad: 'Prueba', activo: true, id: 'ccc33333', tipo_medio: 'Efectivo' }]);
    var m = leerTabla_('MediosPago')[0];
    eq_(String(m.id), 'ccc33333');
    eq_(String(m.tipo_medio), 'Efectivo');
    eq_(String(m.entidad), 'Prueba');
    eq_(esActivo_(m.activo), true);
  });

  test_('insertarFilas_ con lista vacía no escribe nada', function () {
    truncarSandbox_();
    eq_(insertarFilas_('Gastos', []), 0);
    eq_(leerTabla_('Gastos').length, 0);
  });

  test_('actualizarFila_ toca solo los headers presentes en los cambios', function () {
    truncarSandbox_();
    insertarFilas_('Categorias', [{ id: 'ddd44444', tipo: 'Diario', categoria: 'Vieja', subcategoria: 'Sub', activo: true }]);
    eq_(actualizarFila_('Categorias', 'ddd44444', { categoria: 'Nueva' }), true);
    var c = leerTabla_('Categorias')[0];
    eq_(String(c.categoria), 'Nueva');
    eq_(String(c.subcategoria), 'Sub', 'no debería haber pisado el resto');
    eq_(actualizarFila_('Categorias', 'noexiste', { categoria: 'X' }), false);
  });

  test_('borrarFila_ borra físicamente y devuelve false si no existe', function () {
    truncarSandbox_();
    insertarFilas_('Categorias', [
      { id: 'eee55555', tipo: 'Diario', categoria: 'A', subcategoria: '', activo: true },
      { id: 'fff66666', tipo: 'Diario', categoria: 'B', subcategoria: '', activo: true }
    ]);
    eq_(borrarFila_('Categorias', 'eee55555'), true);
    var filas = leerTabla_('Categorias');
    eq_(filas.length, 1);
    eq_(String(filas[0].id), 'fff66666');
    eq_(borrarFila_('Categorias', 'eee55555'), false, 'borrar dos veces');
  });
}

function testsEndpoints_() {
  test_('crearGasto → listarGastos lo trae con sus etiquetas', function () {
    var ids = sembrarMaestros_();
    var d = resOk_(crearGasto({
      fecha: '2026-07-20', descripcion: 'Empanadas', categoria_id: ids.catComida,
      medio_pago_id: ids.efectivo, monto: 4500, moneda: 'ARS'
    }));
    ok_(/^[0-9a-f]{8}$/.test(d.id), 'el id no tiene forma de 8 hex: ' + d.id);

    var g = resOk_(listarGastos({})).gastos;
    eq_(g.length, 1);
    eq_(g[0].descripcion, 'Empanadas');
    eq_(g[0].categoria_label, 'Comida › Almuerzo');
    eq_(g[0].medio_label, 'Efectivo');
    eq_(g[0].monto, 4500);
    eq_(g[0].fecha, '2026-07-20');
    eq_(g[0].es_cuota, false);
    ok_(String(leerTabla_('Gastos')[0].creado_en).length > 0, 'debería sellar creado_en');
  });

  // Regresión de It 4b: Sheets guarda las fechas como serial y las interpreta
  // en la timezone DE LA SPREADSHEET. Con una tz hardcodeada en fechaISO_, todo
  // el round-trip se corría un día contra una spreadsheet en otra zona.
  test_('las fechas hacen round-trip exacto por Sheets (sin corrimiento de día)', function () {
    var ids = sembrarMaestros_();
    var fechas = ['2026-01-01', '2026-07-20', '2026-12-31', '2026-02-28', '2026-06-30'];
    fechas.forEach(function (f, i) {
      resOk_(crearGasto({
        fecha: f, descripcion: 'F' + i, categoria_id: ids.catComida,
        medio_pago_id: ids.efectivo, monto: 100 + i, moneda: 'ARS'
      }));
    });
    var g = resOk_(listarGastos({})).gastos;
    eq_(g.length, fechas.length);
    fechas.forEach(function (f, i) {
      var fila = g.filter(function (x) { return x.descripcion === 'F' + i; })[0];
      eq_(fila.fecha, f, 'la fecha volvió distinta de como se escribió');
    });
    // Y el filtro por rango tiene que ver esas mismas fechas.
    eq_(resOk_(listarGastos({ desde: '2026-07-20', hasta: '2026-07-20' })).gastos.length, 1);
    eq_(resOk_(listarGastos({ desde: '2026-12-31' })).gastos.length, 1);
  });

  test_('crearGasto rechaza pagar con tarjeta de crédito y categorías inactivas', function () {
    var ids = sembrarMaestros_();
    var base = { fecha: '2026-07-20', descripcion: 'X', categoria_id: ids.catComida, medio_pago_id: ids.efectivo, monto: 100, moneda: 'ARS' };
    resErr_(crearGasto(merge_(base, { medio_pago_id: ids.visa })), 'crédito');
    resErr_(crearGasto(merge_(base, { categoria_id: ids.catInactiva })), 'inactiva');
    eq_(leerTabla_('Gastos').length, 0, 'nada de eso debería haberse escrito');
  });

  test_('actualizarGasto edita, y rechaza nro_cuota en un gasto que no es cuota', function () {
    var ids = sembrarMaestros_();
    var id = resOk_(crearGasto({
      fecha: '2026-07-20', descripcion: 'Original', categoria_id: ids.catComida,
      medio_pago_id: ids.efectivo, monto: 100, moneda: 'ARS'
    })).id;

    resOk_(actualizarGasto(id, {
      fecha: '2026-07-21', descripcion: 'Editado', categoria_id: ids.catTransporte,
      medio_pago_id: ids.debito, monto: 250, moneda: 'USD'
    }));
    var g = resOk_(listarGastos({})).gastos[0];
    eq_(g.descripcion, 'Editado');
    eq_(g.fecha, '2026-07-21');
    eq_(g.monto, 250);
    eq_(g.moneda, 'USD');

    resErr_(actualizarGasto(id, {
      fecha: '2026-07-21', descripcion: 'Editado', categoria_id: ids.catTransporte,
      medio_pago_id: ids.debito, monto: 250, moneda: 'USD', nro_cuota: 3
    }), 'no es una cuota');
    resErr_(actualizarGasto('noexiste', {
      fecha: '2026-07-21', categoria_id: ids.catComida, medio_pago_id: ids.efectivo, monto: 1, moneda: 'ARS'
    }), 'no se encontró');
  });

  test_('borrarGasto borra físicamente', function () {
    var ids = sembrarMaestros_();
    var id = resOk_(crearGasto({
      fecha: '2026-07-20', descripcion: 'Para borrar', categoria_id: ids.catComida,
      medio_pago_id: ids.efectivo, monto: 100, moneda: 'ARS'
    })).id;
    resOk_(borrarGasto(id));
    eq_(resOk_(listarGastos({})).gastos.length, 0);
    resErr_(borrarGasto(id), 'no se encontró');
  });

  test_('crearCompra deja cuotas_previas en 0 y todas las cuotas pendientes', function () {
    var ids = sembrarMaestros_();
    var id = resOk_(crearCompra({
      fecha_compra: '2026-07-01', descripcion: 'Heladera', medio_pago_id: ids.visa,
      categoria_id: ids.catComida, monto_total: 60000, n_cuotas: 6, moneda: 'ARS', nota: 'n'
    })).id;
    var c = porId_(resOk_(listarCompras({})).compras, id);
    eq_(c.cuotas_previas, 0);
    eq_(c.pagadas, 0);
    eq_(c.pendientes, 6);
    eq_(c.completa, false);
    eq_(c.monto_cuota_teorico, 10000);
    eq_(c.tarjeta_label, 'Galicia Visa');
    eq_(c.categoria_label, 'Comida › Almuerzo');
  });

  test_('confirmarResumen inserta en batch y numera las cuotas server-side', function () {
    var ids = sembrarMaestros_();
    var compraId = resOk_(crearCompra({
      fecha_compra: '2026-07-01', descripcion: 'Heladera', medio_pago_id: ids.visa,
      categoria_id: ids.catComida, monto_total: 60000, n_cuotas: 6, moneda: 'ARS'
    })).id;

    var d = resOk_(confirmarResumen({
      fecha: '2026-08-10',
      medio_pago_id: ids.debito,
      items: [
        // El cliente NO manda nro_cuota: lo calcula el server.
        { compra_credito_id: compraId, categoria_id: ids.catComida, monto: 10500, moneda: 'ARS' },
        { compra_credito_id: compraId, categoria_id: ids.catComida, monto: 10600, moneda: 'ARS' },
        { categoria_id: ids.catTransporte, monto: 3000, moneda: 'ARS', descripcion: 'Suelto de la tarjeta' }
      ]
    }));
    eq_(d.insertados, 3);

    var gastos = resOk_(listarGastos({ cuotas: 'solo' })).gastos;
    eq_(gastos.length, 2);
    var nros = gastos.map(function (g) { return g.nro_cuota; }).sort();
    eq_(nros.join(','), '1,2', 'las cuotas se numeran correlativas desde pagadas+1');
    var primera = gastos.filter(function (g) { return g.nro_cuota === 1; })[0];
    eq_(primera.descripcion, 'Cuota 1/6 - Heladera', 'descripción autogenerada');
    eq_(primera.medio_label, 'Galicia Debito', 'el medio es la cuenta que paga');
    eq_(primera.tarjeta_label, 'Galicia Visa', 'la tarjeta se deriva de la compra');

    var suelto = resOk_(listarGastos({ cuotas: 'sin' })).gastos;
    eq_(suelto.length, 1);
    eq_(suelto[0].descripcion, 'Suelto de la tarjeta');

    var compra = porId_(resOk_(listarCompras({})).compras, compraId);
    eq_(compra.pagadas, 2);
    eq_(compra.pendientes, 4);
    eq_(compra.pagado[0].monto, 21100);
  });

  test_('confirmarResumen avisa del duplicado y recién con forzar inserta', function () {
    var ids = sembrarMaestros_();
    var compraId = resOk_(crearCompra({
      fecha_compra: '2026-07-01', descripcion: 'Heladera', medio_pago_id: ids.visa,
      categoria_id: ids.catComida, monto_total: 60000, n_cuotas: 6, moneda: 'ARS'
    })).id;
    var pago = {
      fecha: '2026-08-10', medio_pago_id: ids.debito,
      items: [{ compra_credito_id: compraId, categoria_id: ids.catComida, monto: 10000, moneda: 'ARS' }]
    };
    eq_(resOk_(confirmarResumen(pago)).insertados, 1);

    var aviso = resOk_(confirmarResumen(pago));
    eq_(aviso.requiereConfirmacion, true);
    eq_(aviso.duplicados[0], 'Heladera');
    eq_(leerTabla_('Gastos').length, 1, 'no debería haber insertado el duplicado');

    eq_(resOk_(confirmarResumen(pago, true)).insertados, 1, 'forzando sí entra');
    eq_(leerTabla_('Gastos').length, 2);
    eq_(porId_(resOk_(listarCompras({})).compras, compraId).pagadas, 2);
  });

  test_('confirmarResumen no deja pasar más cuotas que las pendientes', function () {
    var ids = sembrarMaestros_();
    var compraId = resOk_(crearCompra({
      fecha_compra: '2026-07-01', descripcion: 'TV', medio_pago_id: ids.visa,
      categoria_id: ids.catComida, monto_total: 20000, n_cuotas: 2, moneda: 'ARS'
    })).id;
    var item = { compra_credito_id: compraId, categoria_id: ids.catComida, monto: 10000, moneda: 'ARS' };
    resErr_(confirmarResumen({
      fecha: '2026-08-10', medio_pago_id: ids.debito, items: [item, item, item]
    }), 'pendientes');
    eq_(leerTabla_('Gastos').length, 0, 'la escritura es atómica: no entra nada');
  });

  test_('actualizarCompra no deja dejar menos cuotas que las ya pagadas', function () {
    var ids = sembrarMaestros_();
    var compraId = resOk_(crearCompra({
      fecha_compra: '2026-07-01', descripcion: 'Heladera', medio_pago_id: ids.visa,
      categoria_id: ids.catComida, monto_total: 60000, n_cuotas: 6, moneda: 'ARS'
    })).id;
    resOk_(confirmarResumen({
      fecha: '2026-08-10', medio_pago_id: ids.debito,
      items: [
        { compra_credito_id: compraId, categoria_id: ids.catComida, monto: 1, moneda: 'ARS' },
        { compra_credito_id: compraId, categoria_id: ids.catComida, monto: 1, moneda: 'ARS' },
        { compra_credito_id: compraId, categoria_id: ids.catComida, monto: 1, moneda: 'ARS' }
      ]
    }));
    var base = {
      fecha_compra: '2026-07-01', descripcion: 'Heladera', medio_pago_id: ids.visa,
      categoria_id: ids.catComida, monto_total: 60000, moneda: 'ARS'
    };
    resErr_(actualizarCompra(compraId, merge_(base, { n_cuotas: 2 })), 'ya pagadas');
    resOk_(actualizarCompra(compraId, merge_(base, { n_cuotas: 3 })), 'igual a las pagadas sí se puede');
    eq_(porId_(resOk_(listarCompras({})).compras, compraId).completa, true);
  });

  test_('borrarCompra se niega si tiene cuotas pagadas', function () {
    var ids = sembrarMaestros_();
    var compraId = resOk_(crearCompra({
      fecha_compra: '2026-07-01', descripcion: 'Heladera', medio_pago_id: ids.visa,
      categoria_id: ids.catComida, monto_total: 60000, n_cuotas: 6, moneda: 'ARS'
    })).id;
    resOk_(borrarCompra(compraId), 'sin pagos se puede borrar');

    var otra = resOk_(crearCompra({
      fecha_compra: '2026-07-01', descripcion: 'TV', medio_pago_id: ids.visa,
      categoria_id: ids.catComida, monto_total: 20000, n_cuotas: 2, moneda: 'ARS'
    })).id;
    resOk_(confirmarResumen({
      fecha: '2026-08-10', medio_pago_id: ids.debito,
      items: [{ compra_credito_id: otra, categoria_id: ids.catComida, monto: 10000, moneda: 'ARS' }]
    }));
    resErr_(borrarCompra(otra), 'cuota');
    eq_(leerTabla_('ComprasCredito').length, 1, 'sigue ahí');
  });

  test_('ABM de categorías: alta, duplicado, soft delete y borrado condicional', function () {
    var ids = sembrarMaestros_();
    var nueva = resOk_(crearCategoria({ tipo: 'Mensual', categoria: 'Servicios', subcategoria: 'Luz' })).id;
    resErr_(crearCategoria({ tipo: 'mensual', categoria: 'SERVICIOS', subcategoria: 'luz' }), 'ya existe');

    resOk_(setActivoCategoria(nueva, false));
    eq_(porId_(resOk_(getMaestros()).categorias, nueva).activo, false);
    resOk_(setActivoCategoria(nueva, true));
    eq_(porId_(resOk_(getMaestros()).categorias, nueva).activo, true);

    resOk_(actualizarCategoria(nueva, { tipo: 'Mensual', categoria: 'Servicios', subcategoria: 'Gas' }));
    eq_(porId_(resOk_(getMaestros()).categorias, nueva).subcategoria, 'Gas');

    // Con referencias no se puede borrar; sin referencias sí.
    resOk_(crearGasto({
      fecha: '2026-07-20', descripcion: 'Gas', categoria_id: nueva,
      medio_pago_id: ids.efectivo, monto: 100, moneda: 'ARS'
    }));
    resErr_(borrarCategoria(nueva), 'no se puede eliminar');
    resOk_(borrarCategoria(ids.catInactiva), 'sin referencias sí se borra');
    eq_(leerTabla_('Categorias').length, 3);
  });

  test_('ABM de medios: duplicado por entidad y borrado condicional', function () {
    var ids = sembrarMaestros_();
    resErr_(crearMedio({ tipo_medio: 'Efectivo', entidad: 'efectivo' }), 'ya existe');
    var nuevo = resOk_(crearMedio({ tipo_medio: 'Credito', entidad: 'Naranja X' })).id;
    eq_(porId_(resOk_(getCatalogos()).tarjetas, nuevo).entidad, 'Naranja X', 'aparece como tarjeta');

    resOk_(setActivoMedio(nuevo, false));
    ok_(!porId_(resOk_(getCatalogos()).medios, nuevo), 'inactivo: no viaja en catálogos');

    resOk_(crearGasto({
      fecha: '2026-07-20', descripcion: 'X', categoria_id: ids.catComida,
      medio_pago_id: ids.efectivo, monto: 100, moneda: 'ARS'
    }));
    resErr_(borrarMedio(ids.efectivo), 'no se puede eliminar');
    resOk_(borrarMedio(nuevo), 'sin referencias sí se borra');
  });
}

/* ===================== Utilidades de test ===================== */

/** Copia superficial de `base` con `over` encima (no muta ninguno). */
function merge_(base, over) {
  var o = {}, k;
  for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) o[k] = base[k];
  for (k in over) if (Object.prototype.hasOwnProperty.call(over, k)) o[k] = over[k];
  return o;
}

/** Busca en una lista el elemento con ese id (o undefined). */
function porId_(lista, id) {
  return lista.filter(function (x) { return String(x.id) === String(id); })[0];
}
