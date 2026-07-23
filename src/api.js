/**
 * API cliente ↔ servidor (It 1, slices 1a + 1b).
 *
 * Contrato: TODA función pública devuelve { ok: true, data } o
 * { ok: false, error: 'mensaje claro' }. El cliente (app-js.html) muestra
 * `error` tal cual. Nunca lanzar hacia el cliente: se atrapa y se envuelve.
 */

var MONEDAS_VALIDAS = ['ARS', 'USD'];

/**
 * Catálogos para los selects del form de gasto: categorías y medios de pago
 * ACTIVOS. Las categorías traen tipo/categoria/subcategoria para armar la
 * cascada en el cliente; el value final del select es el categoria_id (id).
 */
function getCatalogos() {
  try {
    var categorias = leerTabla_('Categorias')
      .filter(function (c) { return esActivo_(c.activo); })
      .map(function (c) {
        return {
          id: String(c.id),
          tipo: String(c.tipo || ''),
          categoria: String(c.categoria || ''),
          subcategoria: String(c.subcategoria || '')
        };
      });

    var medios = leerTabla_('MediosPago')
      .filter(function (m) { return esActivo_(m.activo); })
      .map(function (m) {
        return { id: String(m.id), entidad: String(m.entidad || ''), tipo_medio: String(m.tipo_medio || '') };
      });

    // Tarjetas = medios activos de crédito. Se derivan de `medios` para que el
    // form de compra (It 2) y las vistas de crédito compartan una sola llamada
    // y se refresquen en caliente igual que el resto de los catálogos.
    var tarjetas = medios.filter(function (m) { return m.tipo_medio === 'Credito'; });

    return { ok: true, data: { categorias: categorias, medios: medios, tarjetas: tarjetas } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Valida y normaliza el payload común a alta/edición de un gasto. Devuelve
 * { ok:true, data:{ campos normalizados } } o { ok:false, error }. No escribe.
 */
function validarGastoPayload_(payload) {
  payload = payload || {};

  var fecha = String(payload.fecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { ok: false, error: 'Fecha inválida (se espera yyyy-mm-dd).' };
  }

  var monto = Number(payload.monto);
  if (!isFinite(monto) || monto <= 0) {
    return { ok: false, error: 'El monto debe ser un número mayor a 0.' };
  }

  var moneda = String(payload.moneda || 'ARS').trim().toUpperCase();
  if (MONEDAS_VALIDAS.indexOf(moneda) < 0) {
    return { ok: false, error: 'Moneda inválida (ARS o USD).' };
  }

  var categoriaId = String(payload.categoria_id || '').trim();
  if (!categoriaId) return { ok: false, error: 'Elegí una categoría.' };

  var medioId = String(payload.medio_pago_id || '').trim();
  if (!medioId) return { ok: false, error: 'Elegí un medio de pago.' };

  var catOk = leerTabla_('Categorias').some(function (c) {
    return String(c.id) === categoriaId && esActivo_(c.activo);
  });
  if (!catOk) return { ok: false, error: 'La categoría elegida no existe o está inactiva.' };

  var medio = leerTabla_('MediosPago').filter(function (m) { return String(m.id) === medioId; })[0];
  if (!medio || !esActivo_(medio.activo)) {
    return { ok: false, error: 'El medio de pago elegido no existe o está inactivo.' };
  }
  // Un gasto directo nunca se paga con una tarjeta de crédito: eso se registra
  // como pago de cuota (It 2), y ahí el medio real es la cuenta que paga el resumen.
  if (String(medio.tipo_medio).trim() === 'Credito') {
    return { ok: false, error: 'No se puede pagar un gasto directo con una tarjeta de crédito.' };
  }

  return {
    ok: true,
    data: {
      fecha: fecha,
      descripcion: String(payload.descripcion || '').trim(),
      categoria_id: categoriaId,
      medio_pago_id: medioId,
      monto: monto,
      moneda: moneda
    }
  };
}

/**
 * Da de alta un gasto (grano = un pago real). Inserta 1 fila en `Gastos` con
 * id nuevo. No maneja cuotas: compra_credito_id y nro_cuota quedan vacíos
 * (eso llega en It 2). `payload` = { fecha, descripcion, categoria_id,
 * medio_pago_id, monto, moneda }.
 */
function crearGasto(payload) {
  try {
    var v = validarGastoPayload_(payload);
    if (!v.ok) return v;

    var gasto = {
      id: nuevoId_(),
      fecha: v.data.fecha,
      descripcion: v.data.descripcion,
      categoria_id: v.data.categoria_id,
      medio_pago_id: v.data.medio_pago_id,
      monto: v.data.monto,
      moneda: v.data.moneda,
      compra_credito_id: '',
      nro_cuota: '',
      creado_en: ahoraISO_()
    };

    insertarFilas_('Gastos', [gasto]);
    return { ok: true, data: { id: gasto.id } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Lista gastos con etiquetas (categoría y medio dereferenciados) y filtros
 * opcionales. `filtros` = { desde:'YYYY-MM-DD', hasta:'YYYY-MM-DD', categoria,
 * subcategoria, medio_pago_id } (todos opcionales; categoria/subcategoria son
 * NOMBRES). Devuelve { gastos:[...] } ordenados por fecha desc.
 *
 * La fecha se normaliza a ISO yyyy-mm-dd (fechaISO_): Sheets suele guardar la
 * fecha como valor Date, y al leerla vuelve como objeto — hay que uniformarla
 * para ordenar, filtrar por rango y mostrarla bien en el cliente.
 */
function listarGastos(filtros) {
  try {
    filtros = filtros || {};
    var desde = String(filtros.desde || '').trim();
    var hasta = String(filtros.hasta || '').trim();
    var catF = String(filtros.categoria || '').trim();
    var subF = String(filtros.subcategoria || '').trim();
    var medF = String(filtros.medio_pago_id || '').trim();

    // Info de categoría por id (incluye inactivas para que un gasto viejo resuelva).
    var catInfo = {};
    leerTabla_('Categorias').forEach(function (c) {
      var sub = String(c.subcategoria || '').trim();
      var cat = String(c.categoria || '');
      catInfo[String(c.id)] = { categoria: cat, subcategoria: sub, label: cat + (sub ? ' › ' + sub : '') };
    });
    var medLabel = {};
    leerTabla_('MediosPago').forEach(function (m) { medLabel[String(m.id)] = String(m.entidad || ''); });

    var gastos = leerTabla_('Gastos').map(function (g) {
      var cid = String(g.categoria_id || ''), mid = String(g.medio_pago_id || '');
      var info = catInfo[cid] || { categoria: '', subcategoria: '', label: cid };
      var nro = g.nro_cuota === '' || g.nro_cuota === null ? '' : (Number(g.nro_cuota) || '');
      return {
        id: String(g.id),
        fecha: fechaISO_(g.fecha),
        descripcion: String(g.descripcion || ''),
        categoria_id: cid,
        categoria: info.categoria,
        subcategoria: info.subcategoria,
        categoria_label: info.label,
        medio_pago_id: mid,
        medio_label: medLabel[mid] || mid,
        monto: Number(g.monto) || 0,
        moneda: String(g.moneda || ''),
        es_cuota: String(g.compra_credito_id || '').trim() !== '',
        nro_cuota: nro
      };
    }).filter(function (g) {
      if (desde && g.fecha < desde) return false;   // ISO yyyy-mm-dd ordena cronológicamente
      if (hasta && g.fecha > hasta) return false;
      if (catF && g.categoria !== catF) return false;
      if (subF && g.subcategoria !== subF) return false;
      if (medF && g.medio_pago_id !== medF) return false;
      return true;
    });

    gastos.sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0; });

    return { ok: true, data: { gastos: gastos } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Edita un gasto existente. Solo toca los 6 campos editables; conserva id,
 * creado_en y el vínculo de cuota (compra_credito_id, nro_cuota) intactos.
 */
function actualizarGasto(id, payload) {
  try {
    id = String(id || '').trim();
    if (!id) return { ok: false, error: 'Falta el id del gasto a editar.' };

    var v = validarGastoPayload_(payload);
    if (!v.ok) return v;

    var ok = actualizarFila_('Gastos', id, {
      fecha: v.data.fecha,
      descripcion: v.data.descripcion,
      categoria_id: v.data.categoria_id,
      medio_pago_id: v.data.medio_pago_id,
      monto: v.data.monto,
      moneda: v.data.moneda
    });
    if (!ok) return { ok: false, error: 'No se encontró el gasto (¿ya fue borrado?).' };
    return { ok: true, data: { id: id } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Borra físicamente un gasto por id. */
function borrarGasto(id) {
  try {
    id = String(id || '').trim();
    if (!id) return { ok: false, error: 'Falta el id del gasto a borrar.' };
    var ok = borrarFila_('Gastos', id);
    if (!ok) return { ok: false, error: 'No se encontró el gasto (¿ya fue borrado?).' };
    return { ok: true, data: { id: id } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ===================== Compras a crédito (slice 2a) ===================== */

/**
 * Da de alta una compra en cuotas (`ComprasCredito`). `cuotas_previas = 0`
 * siempre (hacia adelante no hay historia previa a este sistema). El estado
 * (pagadas/pendientes) NO se persiste: se deriva de los pagos vinculados.
 * `payload` = { fecha_compra, descripcion, medio_pago_id, categoria_id,
 * monto_total, n_cuotas, moneda, nota }.
 */
function crearCompra(payload) {
  try {
    var v = validarCompraPayload_(payload);
    if (!v.ok) return v;

    var compra = {
      id: nuevoId_(),
      fecha_compra: v.data.fecha_compra,
      descripcion: v.data.descripcion,
      medio_pago_id: v.data.medio_pago_id,
      categoria_id: v.data.categoria_id,
      monto_total: v.data.monto_total,
      n_cuotas: v.data.n_cuotas,
      moneda: v.data.moneda,
      cuotas_previas: 0,
      nota: v.data.nota
    };

    insertarFilas_('ComprasCredito', [compra]);
    return { ok: true, data: { id: compra.id } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Lista compras a crédito con etiquetas y estado derivado. `filtros` =
 * { medio_pago_id, estado:'pendientes'|'completas'|'todas' } (opcionales).
 *
 * Estado (CLAUDE.md): pagadas = cuotas_previas + COUNT(pagos vinculados);
 * pendientes = n_cuotas − pagadas; completa cuando pendientes <= 0. El avance
 * se mide SIEMPRE por conteo de cuotas, nunca por ratio de montos. El pagado se
 * agrupa por moneda (los pagos pueden estar en distinta moneda que la compra):
 * nunca se suman monedas distintas.
 */
function listarCompras(filtros) {
  try {
    filtros = filtros || {};
    var medF = String(filtros.medio_pago_id || '').trim();
    var estadoF = String(filtros.estado || 'todas').trim();

    var medLabel = {};
    leerTabla_('MediosPago').forEach(function (m) { medLabel[String(m.id)] = String(m.entidad || ''); });

    var catInfo = {};
    leerTabla_('Categorias').forEach(function (c) {
      var sub = String(c.subcategoria || '').trim();
      var cat = String(c.categoria || '');
      catInfo[String(c.id)] = cat + (sub ? ' › ' + sub : '');
    });

    // Pagos vinculados agrupados por compra: conteo + suma por moneda.
    var pagosPorCompra = {};
    leerTabla_('Gastos').forEach(function (g) {
      var cid = String(g.compra_credito_id || '').trim();
      if (!cid) return;
      var p = pagosPorCompra[cid] || (pagosPorCompra[cid] = { count: 0, porMoneda: {} });
      p.count++;
      var mon = String(g.moneda || 'ARS');
      p.porMoneda[mon] = (p.porMoneda[mon] || 0) + (Number(g.monto) || 0);
    });

    var compras = leerTabla_('ComprasCredito').map(function (c) {
      var id = String(c.id);
      var nCuotas = Number(c.n_cuotas) || 0;
      var previas = Number(c.cuotas_previas) || 0;
      var pagos = pagosPorCompra[id] || { count: 0, porMoneda: {} };
      var pagadas = previas + pagos.count;
      var pendientes = Math.max(0, nCuotas - pagadas);
      var mid = String(c.medio_pago_id || '');
      var montoTotal = Number(c.monto_total) || 0;
      var pagado = Object.keys(pagos.porMoneda).map(function (mon) {
        return { moneda: mon, monto: pagos.porMoneda[mon] };
      });
      return {
        id: id,
        fecha_compra: fechaISO_(c.fecha_compra),
        descripcion: String(c.descripcion || ''),
        medio_pago_id: mid,
        tarjeta_label: medLabel[mid] || mid,
        categoria_id: String(c.categoria_id || ''),
        categoria_label: catInfo[String(c.categoria_id || '')] || '',
        monto_total: montoTotal,
        n_cuotas: nCuotas,
        moneda: String(c.moneda || ''),
        cuotas_previas: previas,
        nota: String(c.nota || ''),
        pagadas: pagadas,
        pendientes: pendientes,
        completa: pendientes <= 0,
        monto_cuota_teorico: nCuotas > 0 ? montoTotal / nCuotas : 0,
        pagado: pagado
      };
    }).filter(function (c) {
      if (medF && c.medio_pago_id !== medF) return false;
      if (estadoF === 'pendientes' && c.completa) return false;
      if (estadoF === 'completas' && !c.completa) return false;
      return true;
    });

    // Pendientes primero, y dentro de cada grupo por fecha de compra desc.
    compras.sort(function (a, b) {
      if (a.completa !== b.completa) return a.completa ? 1 : -1;
      return a.fecha_compra < b.fecha_compra ? 1 : a.fecha_compra > b.fecha_compra ? -1 : 0;
    });

    return { ok: true, data: { compras: compras } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Edita una compra. Bloquea bajar `n_cuotas` por debajo de las ya pagadas
 * (dejaría pendientes negativos y pagos sin cuota válida). Conserva id y
 * cuotas_previas.
 */
function actualizarCompra(id, payload) {
  try {
    id = String(id || '').trim();
    if (!id) return { ok: false, error: 'Falta el id de la compra.' };

    var v = validarCompraPayload_(payload);
    if (!v.ok) return v;

    var compra = leerTabla_('ComprasCredito').filter(function (c) { return String(c.id) === id; })[0];
    if (!compra) return { ok: false, error: 'No se encontró la compra (¿ya fue borrada?).' };

    var pagadas = (Number(compra.cuotas_previas) || 0) + contarPagosDeCompra_(id);
    if (v.data.n_cuotas < pagadas) {
      return { ok: false, error: 'No podés dejar menos cuotas (' + v.data.n_cuotas + ') que las ya pagadas (' + pagadas + ').' };
    }

    var ok = actualizarFila_('ComprasCredito', id, {
      fecha_compra: v.data.fecha_compra,
      descripcion: v.data.descripcion,
      medio_pago_id: v.data.medio_pago_id,
      categoria_id: v.data.categoria_id,
      monto_total: v.data.monto_total,
      n_cuotas: v.data.n_cuotas,
      moneda: v.data.moneda,
      nota: v.data.nota
    });
    if (!ok) return { ok: false, error: 'No se encontró la compra (¿ya fue borrada?).' };
    return { ok: true, data: { id: id } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Borra FÍSICAMENTE una compra, solo si no tiene pagos (cuotas) vinculados en
 * `Gastos`. Si los tiene, se niega para no dejar pagos huérfanos: primero hay
 * que borrar esas cuotas desde el Historial.
 */
function borrarCompra(id) {
  try {
    id = String(id || '').trim();
    if (!id) return { ok: false, error: 'Falta el id de la compra.' };
    var pagos = contarPagosDeCompra_(id);
    if (pagos > 0) {
      return { ok: false, error: 'No se puede eliminar: tiene ' + pagos + ' cuota(s) pagada(s). Borrá esos pagos en el Historial primero.' };
    }
    var ok = borrarFila_('ComprasCredito', id);
    if (!ok) return { ok: false, error: 'No se encontró la compra.' };
    return { ok: true, data: { id: id } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ===================== ABM de maestros (slice 1c) ===================== */

/**
 * Todas las categorías y medios (incluidas las inactivas) para el ABM. La
 * baja es lógica (activo=FALSE): nunca se borra físicamente un maestro.
 */
function getMaestros() {
  try {
    var categorias = leerTabla_('Categorias').map(function (c) {
      return {
        id: String(c.id), tipo: String(c.tipo || ''), categoria: String(c.categoria || ''),
        subcategoria: String(c.subcategoria || ''), activo: esActivo_(c.activo)
      };
    });
    var medios = leerTabla_('MediosPago').map(function (m) {
      return {
        id: String(m.id), tipo_medio: String(m.tipo_medio || ''),
        entidad: String(m.entidad || ''), activo: esActivo_(m.activo)
      };
    });
    return { ok: true, data: { categorias: categorias, medios: medios } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function crearCategoria(payload) {
  try {
    var v = validarCategoria_(payload, null);
    if (!v.ok) return v;
    var row = { id: nuevoId_(), tipo: v.data.tipo, categoria: v.data.categoria, subcategoria: v.data.subcategoria, activo: true };
    insertarFilas_('Categorias', [row]);
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function actualizarCategoria(id, payload) {
  try {
    id = String(id || '').trim();
    if (!id) return { ok: false, error: 'Falta el id de la categoría.' };
    var v = validarCategoria_(payload, id);
    if (!v.ok) return v;
    var ok = actualizarFila_('Categorias', id, { tipo: v.data.tipo, categoria: v.data.categoria, subcategoria: v.data.subcategoria });
    if (!ok) return { ok: false, error: 'No se encontró la categoría.' };
    return { ok: true, data: { id: id } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Borra FÍSICAMENTE una categoría, pero solo si ningún gasto o compra la
 * referencia. Si hay referencias, se niega y sugiere desactivar (mantiene la
 * integridad: no dejar FKs huérfanas). Pensado para limpiar altas de prueba.
 */
function borrarCategoria(id) {
  try {
    id = String(id || '').trim();
    if (!id) return { ok: false, error: 'Falta el id de la categoría.' };
    var refs = contarRefsCategoria_(id);
    if (refs > 0) {
      return { ok: false, error: 'No se puede eliminar: ' + refs + ' registro(s) la usan. Desactivala en su lugar.' };
    }
    var ok = borrarFila_('Categorias', id);
    if (!ok) return { ok: false, error: 'No se encontró la categoría.' };
    return { ok: true, data: { id: id } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Baja/alta lógica de una categoría (activo TRUE/FALSE). Nunca borra. */
function setActivoCategoria(id, activo) {
  try {
    id = String(id || '').trim();
    if (!id) return { ok: false, error: 'Falta el id de la categoría.' };
    var ok = actualizarFila_('Categorias', id, { activo: !!activo });
    if (!ok) return { ok: false, error: 'No se encontró la categoría.' };
    return { ok: true, data: { id: id, activo: !!activo } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function crearMedio(payload) {
  try {
    var v = validarMedio_(payload, null);
    if (!v.ok) return v;
    var row = { id: nuevoId_(), tipo_medio: v.data.tipo_medio, entidad: v.data.entidad, activo: true };
    insertarFilas_('MediosPago', [row]);
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function actualizarMedio(id, payload) {
  try {
    id = String(id || '').trim();
    if (!id) return { ok: false, error: 'Falta el id del medio.' };
    var v = validarMedio_(payload, id);
    if (!v.ok) return v;
    var ok = actualizarFila_('MediosPago', id, { tipo_medio: v.data.tipo_medio, entidad: v.data.entidad });
    if (!ok) return { ok: false, error: 'No se encontró el medio de pago.' };
    return { ok: true, data: { id: id } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Borra FÍSICAMENTE un medio de pago, solo si ningún gasto o compra lo usa.
 * Si hay referencias, se niega y sugiere desactivar.
 */
function borrarMedio(id) {
  try {
    id = String(id || '').trim();
    if (!id) return { ok: false, error: 'Falta el id del medio.' };
    var refs = contarRefsMedio_(id);
    if (refs > 0) {
      return { ok: false, error: 'No se puede eliminar: ' + refs + ' registro(s) lo usan. Desactivalo en su lugar.' };
    }
    var ok = borrarFila_('MediosPago', id);
    if (!ok) return { ok: false, error: 'No se encontró el medio de pago.' };
    return { ok: true, data: { id: id } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Baja/alta lógica de un medio de pago (activo TRUE/FALSE). Nunca borra. */
function setActivoMedio(id, activo) {
  try {
    id = String(id || '').trim();
    if (!id) return { ok: false, error: 'Falta el id del medio.' };
    var ok = actualizarFila_('MediosPago', id, { activo: !!activo });
    if (!ok) return { ok: false, error: 'No se encontró el medio de pago.' };
    return { ok: true, data: { id: id, activo: !!activo } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
