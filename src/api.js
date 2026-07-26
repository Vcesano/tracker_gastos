/**
 * API cliente ↔ servidor (It 1, slices 1a + 1b).
 *
 * Contrato: TODA función pública devuelve { ok: true, data } o
 * { ok: false, error: 'mensaje claro' }. El cliente (app-js.html) muestra
 * `error` tal cual. Nunca lanzar hacia el cliente: se atrapa y se envuelve.
 */

var MONEDAS_VALIDAS = ['ARS', 'USD'];

/**
 * Etiqueta para una FK que no resuelve (It 4f). La Sheet se puede editar a
 * mano, y hasta acá una FK rota se mostraba como el id opaco de 8 hex, que
 * parece un dato más. Con esto el problema se ve en la pantalla donde está.
 */
function etiquetaRota_(id, que) {
  if (!String(id || '').trim()) return '(sin ' + que + ')';
  return '(' + que + ' inexistente: ' + id + ')';
}

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

  var vDesc = textoLimitado_(payload.descripcion, 'descripcion', 'Descripción');
  if (!vDesc.ok) return vDesc;

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
      descripcion: vDesc.data,
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
      id: nuevoIdUnico_('Gastos'),
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
    // El filtro de categoría llega como "Tipo|Categoria" (It 4a): antes viajaba
    // solo el nombre y `Diario › Comida` y `Mensual › Comida` se mezclaban.
    // Se acepta también el nombre pelado por compatibilidad (tipoF queda vacío).
    var catRaw = String(filtros.categoria || '').trim();
    var catParts = catRaw.split('|');
    var tipoF = catParts.length > 1 ? catParts[0].trim() : '';
    var catF = catParts.length > 1 ? catParts.slice(1).join('|').trim() : catRaw;
    var subF = String(filtros.subcategoria || '').trim();
    var medF = String(filtros.medio_pago_id || '').trim();
    var cuotasF = String(filtros.cuotas || '').trim();      // ''|'solo'|'sin'
    var tarjF = String(filtros.tarjeta_id || '').trim();    // filtra por tarjeta de la cuota

    // Info de categoría por id (incluye inactivas para que un gasto viejo resuelva).
    var catInfo = {};
    leerTabla_('Categorias').forEach(function (c) {
      var sub = String(c.subcategoria || '').trim();
      var cat = String(c.categoria || '');
      catInfo[String(c.id)] = {
        tipo: String(c.tipo || ''),
        categoria: cat,
        subcategoria: sub,
        label: cat + (sub ? ' › ' + sub : '')
      };
    });
    var medLabel = {};
    leerTabla_('MediosPago').forEach(function (m) { medLabel[String(m.id)] = String(m.entidad || ''); });

    // Info de cada compra a crédito, para derivar la tarjeta real de una cuota
    // (el medio_pago_id de la cuota es la CUENTA que paga el resumen, no la
    // tarjeta) y para el editor de cuota del Historial (It 3e).
    var compraInfo = {};
    leerTabla_('ComprasCredito').forEach(function (c) {
      compraInfo[String(c.id)] = {
        medio: String(c.medio_pago_id || ''),
        descripcion: String(c.descripcion || ''),
        n_cuotas: numeroSeguro_(c.n_cuotas, 0)
      };
    });

    var gastos = leerTabla_('Gastos').map(function (g) {
      var cid = String(g.categoria_id || ''), mid = String(g.medio_pago_id || '');
      // FK rota (fila editada a mano en la Sheet): se muestra el problema en
      // vez del id opaco, así se ve en el Historial y se puede arreglar (4f).
      var info = catInfo[cid] || { tipo: '', categoria: '', subcategoria: '', label: etiquetaRota_(cid, 'categoría') };
      var nro = g.nro_cuota === '' || g.nro_cuota === null ? '' : (numeroSeguro_(g.nro_cuota, 0) || '');
      var compraId = String(g.compra_credito_id || '').trim();
      var esCuota = compraId !== '';
      var cinfo = esCuota ? (compraInfo[compraId] || null) : null;
      var tarjetaId = cinfo ? cinfo.medio : '';
      return {
        id: String(g.id),
        fecha: fechaISO_(g.fecha),
        descripcion: String(g.descripcion || ''),
        categoria_id: cid,
        tipo: info.tipo,
        categoria: info.categoria,
        subcategoria: info.subcategoria,
        categoria_label: info.label,
        medio_pago_id: mid,
        medio_label: medLabel[mid] || etiquetaRota_(mid, 'medio'),
        monto: numeroSeguro_(g.monto, 0),
        moneda: String(g.moneda || ''),
        es_cuota: esCuota,
        nro_cuota: nro,
        compra_credito_id: compraId,
        compra_label: cinfo ? cinfo.descripcion : '',
        compra_ncuotas: cinfo ? cinfo.n_cuotas : 0,
        tarjeta_id: tarjetaId,
        tarjeta_label: tarjetaId ? (medLabel[tarjetaId] || tarjetaId) : ''
      };
    }).filter(function (g) {
      if (desde && g.fecha < desde) return false;   // ISO yyyy-mm-dd ordena cronológicamente
      if (hasta && g.fecha > hasta) return false;
      if (catF && g.categoria !== catF) return false;
      if (tipoF && g.tipo !== tipoF) return false;
      if (subF && g.subcategoria !== subF) return false;
      if (medF && g.medio_pago_id !== medF) return false;
      if (cuotasF === 'solo' && !g.es_cuota) return false;
      if (cuotasF === 'sin' && g.es_cuota) return false;
      if (tarjF && g.tarjeta_id !== tarjF) return false;
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
 * creado_en y el vínculo a la compra (compra_credito_id) intacto.
 *
 * `nro_cuota` (It 3e): editable SOLO si el gasto es realmente una cuota
 * (tiene compra_credito_id). Se valida entero entre 1 y la cantidad de cuotas
 * de la compra. Si el gasto no es cuota, se ignora (no se puede inventar una).
 */
function actualizarGasto(id, payload) {
  try {
    id = String(id || '').trim();
    if (!id) return { ok: false, error: 'Falta el id del gasto a editar.' };

    var v = validarGastoPayload_(payload);
    if (!v.ok) return v;

    var cambios = {
      fecha: v.data.fecha,
      descripcion: v.data.descripcion,
      categoria_id: v.data.categoria_id,
      medio_pago_id: v.data.medio_pago_id,
      monto: v.data.monto,
      moneda: v.data.moneda
    };

    var pedidoNro = payload && payload.nro_cuota !== undefined && payload.nro_cuota !== null && String(payload.nro_cuota).trim() !== '';
    if (pedidoNro) {
      var gasto = leerTabla_('Gastos').filter(function (g) { return String(g.id) === id; })[0];
      if (!gasto) return { ok: false, error: 'No se encontró el gasto (¿ya fue borrado?).' };
      var compraId = String(gasto.compra_credito_id || '').trim();
      if (!compraId) return { ok: false, error: 'Este gasto no es una cuota: no tiene número de cuota.' };
      var nro = Number(payload.nro_cuota);
      if (!Number.isInteger(nro) || nro < 1) return { ok: false, error: 'El número de cuota debe ser un entero mayor o igual a 1.' };
      var compra = leerTabla_('ComprasCredito').filter(function (c) { return String(c.id) === compraId; })[0];
      var maxN = compra ? (Number(compra.n_cuotas) || 0) : 0;
      if (maxN && nro > maxN) return { ok: false, error: 'La compra tiene ' + maxN + ' cuotas: el número no puede ser mayor.' };
      cambios.nro_cuota = nro;
    }

    var ok = actualizarFila_('Gastos', id, cambios);
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
      id: nuevoIdUnico_('ComprasCredito'),
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
      p.porMoneda[mon] = (p.porMoneda[mon] || 0) + numeroSeguro_(g.monto, 0);
    });

    var compras = leerTabla_('ComprasCredito').map(function (c) {
      var id = String(c.id);
      var nCuotas = numeroSeguro_(c.n_cuotas, 0);
      var previas = numeroSeguro_(c.cuotas_previas, 0);
      var pagos = pagosPorCompra[id] || { count: 0, porMoneda: {} };
      var pagadas = previas + pagos.count;
      var pendientes = Math.max(0, nCuotas - pagadas);
      var mid = String(c.medio_pago_id || '');
      var montoTotal = numeroSeguro_(c.monto_total, 0);
      var pagado = Object.keys(pagos.porMoneda).map(function (mon) {
        return { moneda: mon, monto: pagos.porMoneda[mon] };
      });
      return {
        id: id,
        fecha_compra: fechaISO_(c.fecha_compra),
        descripcion: String(c.descripcion || ''),
        medio_pago_id: mid,
        tarjeta_label: medLabel[mid] || etiquetaRota_(mid, 'tarjeta'),
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

/**
 * Confirma un "resumen de tarjeta" (slice 2b): inserta en `Gastos`, en una sola
 * escritura batch atómica, todas las cuotas tildadas + gastos sueltos de la
 * grilla. `payload` = { fecha, medio_pago_id (cuenta que paga el resumen, NO
 * crédito), items:[{ compra_credito_id?, categoria_id, monto, moneda, descripcion }] }.
 *
 * El `nro_cuota` se calcula en el server desde el estado fresco (pagadas+seq),
 * no se confía en el cliente. Se bloquea vincular más cuotas que las pendientes.
 * Si alguna cuota ya tiene un pago con la MISMA fecha y `forzar` es falso, no
 * inserta nada y devuelve { requiereConfirmacion:true, duplicados:[...] } para
 * que el cliente confirme antes de duplicar.
 *
 * It 4f: TODO el leer→validar→escribir corre adentro de un único lock
 * (`conLock_`). Antes el estado de pagos se leía afuera y solo la escritura
 * estaba protegida: dos confirmaciones simultáneas podían validar contra el
 * mismo estado viejo y vincular más cuotas que las pendientes. Es la escritura
 * más cara de deshacer de la app, así que se paga el lock un poco más largo.
 */
function confirmarResumen(payload, forzar) {
  try {
    payload = payload || {};
    var fecha = String(payload.fecha || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return { ok: false, error: 'Fecha de pago inválida (se espera yyyy-mm-dd).' };
    }
    if (!(payload.items || []).length) {
      return { ok: false, error: 'No hay nada para cargar. Tildá al menos una cuota o agregá un gasto.' };
    }
    return conLock_(function () { return confirmarResumenEnLock_(payload, fecha, forzar); });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Cuerpo de `confirmarResumen`, ya adentro del lock y con el cache de lectura
 * tirado (todas las `leerTabla_` de acá ven el estado del momento en que se
 * ganó el lock). No tomar locks nuevos acá adentro: escribir con *SinLock_.
 */
function confirmarResumenEnLock_(payload, fecha, forzar) {
  var medioId = String(payload.medio_pago_id || '').trim();
  if (!medioId) return { ok: false, error: 'Elegí el medio con el que se paga el resumen.' };
  var medio = leerTabla_('MediosPago').filter(function (m) { return String(m.id) === medioId; })[0];
  if (!medio || !esActivo_(medio.activo)) {
    return { ok: false, error: 'El medio de pago no existe o está inactivo.' };
  }
  if (String(medio.tipo_medio).trim() === 'Credito') {
    return { ok: false, error: 'El resumen se paga con una cuenta (Efectivo o Débito), no con otra tarjeta de crédito.' };
  }

  var items = payload.items || [];

  var catActivas = {};
  leerTabla_('Categorias').forEach(function (c) { if (esActivo_(c.activo)) catActivas[String(c.id)] = true; });

  var comprasById = {};
  leerTabla_('ComprasCredito').forEach(function (c) { comprasById[String(c.id)] = c; });

  // Estado fresco de pagos: conteo por compra + set (compra|fecha) para dups.
  var pagosCount = {}, pagosFecha = {};
  leerTabla_('Gastos').forEach(function (g) {
    var cid = String(g.compra_credito_id || '').trim();
    if (!cid) return;
    pagosCount[cid] = (pagosCount[cid] || 0) + 1;
    pagosFecha[cid + '|' + fechaISO_(g.fecha)] = true;
  });

  var normal = [], seqPorCompra = {}, duplicados = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var monto = Number(it.monto);
    if (!isFinite(monto) || monto <= 0) return { ok: false, error: 'Hay un monto inválido (debe ser mayor a 0).' };
    var moneda = String(it.moneda || 'ARS').trim().toUpperCase();
    if (MONEDAS_VALIDAS.indexOf(moneda) < 0) return { ok: false, error: 'Moneda inválida en un ítem (ARS o USD).' };
    var catId = String(it.categoria_id || '').trim();
    if (!catId || !catActivas[catId]) return { ok: false, error: 'Hay un ítem con categoría inválida o inactiva.' };
    var vDesc = textoLimitado_(it.descripcion, 'descripcion', 'Descripción de un ítem');
    if (!vDesc.ok) return vDesc;
    var desc = vDesc.data;
    var compraId = String(it.compra_credito_id || '').trim();
    var nroCuota = '';

    if (compraId) {
      var compra = comprasById[compraId];
      if (!compra) return { ok: false, error: 'Una cuota referencia una compra inexistente.' };
      var nCuotas = numeroSeguro_(compra.n_cuotas, 0);
      var pagadas = numeroSeguro_(compra.cuotas_previas, 0) + (pagosCount[compraId] || 0);
      var seq = (seqPorCompra[compraId] || 0) + 1;
      seqPorCompra[compraId] = seq;
      var pendientes = nCuotas - pagadas;
      if (seq > pendientes) {
        return { ok: false, error: 'La compra "' + (compra.descripcion || compraId) + '" no tiene tantas cuotas pendientes (quedan ' + Math.max(0, pendientes) + ').' };
      }
      nroCuota = pagadas + seq;
      if (pagosFecha[compraId + '|' + fecha]) duplicados.push(compra.descripcion || compraId);

      // Descripción por default de la cuota: "Cuota N/M - <compra>". El pago
      // conserva su categoría real; esto solo lo hace identificable en el
      // Historial. Editable: si el cliente mandó texto, se respeta.
      if (!desc) {
        var base = String(compra.descripcion || '').trim();
        desc = 'Cuota ' + nroCuota + '/' + nCuotas + (base ? ' - ' + base : '');
      }
    }

    normal.push({
      compra_credito_id: compraId, categoria_id: catId, monto: monto,
      moneda: moneda, descripcion: desc, nro_cuota: nroCuota
    });
  }

  if (!forzar && duplicados.length) {
    return { ok: true, data: { requiereConfirmacion: true, duplicados: duplicados } };
  }

  // Ids únicos: `reservados` evita además que dos filas del MISMO batch
  // salgan con el mismo id (todavía no están escritas, así que la Sheet no
  // las conoce).
  var creado = ahoraISO_();
  var reservados = [];
  var filas = normal.map(function (n) {
    var id = nuevoIdUnico_('Gastos', reservados);
    reservados.push(id);
    return {
      id: id,
      fecha: fecha,
      descripcion: n.descripcion,
      categoria_id: n.categoria_id,
      medio_pago_id: medioId,
      monto: n.monto,
      moneda: n.moneda,
      compra_credito_id: n.compra_credito_id,
      nro_cuota: n.nro_cuota,
      creado_en: creado
    };
  });

  insertarFilasSinLock_('Gastos', filas);
  return { ok: true, data: { insertados: filas.length } };
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
    var row = { id: nuevoIdUnico_('Categorias'), tipo: v.data.tipo, categoria: v.data.categoria, subcategoria: v.data.subcategoria, activo: true };
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
    var row = { id: nuevoIdUnico_('MediosPago'), tipo_medio: v.data.tipo_medio, entidad: v.data.entidad, activo: true };
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

/* ===================== Diagnóstico de datos (It 4f) ===================== */

/**
 * Auditoría READ-ONLY de las 4 pestañas operacionales. No escribe nada: solo
 * reporta lo que una edición manual de la Sheet pudo haber roto y que la app
 * no puede arreglar sola (la app es el único escritor "sano", pero la Sheet
 * está a un clic de distancia y Valentin la abre para mirar).
 *
 * Chequea: ids vacíos o duplicados, FKs huérfanas, fechas fuera de formato,
 * montos no numéricos, monedas fuera de ARS/USD, n_cuotas inválidos y compras
 * con más pagos vinculados que cuotas.
 *
 * Devuelve { problemas:[{tabla, id, campo, detalle}], resumen:{...} }. Sin
 * problemas → lista vacía. Se corre desde el editor de Apps Script o desde
 * `correrTests()`; no está cableada a ninguna pantalla.
 */
function diagnosticarDatos() {
  try {
    var problemas = [];
    var add = function (tabla, id, campo, detalle) {
      problemas.push({ tabla: tabla, id: String(id || ''), campo: campo, detalle: detalle });
    };

    var cats = leerTabla_('Categorias');
    var medios = leerTabla_('MediosPago');
    var compras = leerTabla_('ComprasCredito');
    var gastos = leerTabla_('Gastos');

    // ids vacíos / duplicados en las 4 tablas.
    var setIds = {};
    [['Categorias', cats], ['MediosPago', medios], ['ComprasCredito', compras], ['Gastos', gastos]]
      .forEach(function (par) {
        var tabla = par[0], filas = par[1], vistos = {};
        setIds[tabla] = vistos;
        filas.forEach(function (r) {
          var id = String(r.id || '').trim();
          if (!id) { add(tabla, '', 'id', 'Fila sin id.'); return; }
          if (vistos[id]) add(tabla, id, 'id', 'Id duplicado.');
          vistos[id] = true;
        });
      });

    var esFecha = function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(fechaISO_(v)); };
    var esMoneda = function (v) { return MONEDAS_VALIDAS.indexOf(String(v || '').trim().toUpperCase()) >= 0; };
    var esNum = function (v) { var n = numero_(v); return typeof n === 'number' && isFinite(n); };

    medios.forEach(function (m) {
      if (!String(m.entidad || '').trim()) add('MediosPago', m.id, 'entidad', 'Entidad vacía (es la etiqueta visible).');
      if (!String(m.tipo_medio || '').trim()) add('MediosPago', m.id, 'tipo_medio', 'Tipo de medio vacío.');
    });

    cats.forEach(function (c) {
      if (!String(c.tipo || '').trim()) add('Categorias', c.id, 'tipo', 'Tipo vacío.');
      if (!String(c.categoria || '').trim()) add('Categorias', c.id, 'categoria', 'Categoría vacía.');
    });

    compras.forEach(function (c) {
      var id = c.id;
      if (!esFecha(c.fecha_compra)) add('ComprasCredito', id, 'fecha_compra', 'Fecha inválida: "' + c.fecha_compra + '".');
      if (!esNum(c.monto_total) || numeroSeguro_(c.monto_total, 0) <= 0) add('ComprasCredito', id, 'monto_total', 'Monto total no numérico o <= 0: "' + c.monto_total + '".');
      var n = numeroSeguro_(c.n_cuotas, 0);
      if (n < 1 || Math.floor(n) !== n) add('ComprasCredito', id, 'n_cuotas', 'Cantidad de cuotas inválida: "' + c.n_cuotas + '".');
      if (!esMoneda(c.moneda)) add('ComprasCredito', id, 'moneda', 'Moneda fuera de ARS/USD: "' + c.moneda + '".');
      if (!setIds.MediosPago[String(c.medio_pago_id || '').trim()]) add('ComprasCredito', id, 'medio_pago_id', 'Tarjeta inexistente: "' + c.medio_pago_id + '".');
      if (!setIds.Categorias[String(c.categoria_id || '').trim()]) add('ComprasCredito', id, 'categoria_id', 'Categoría inexistente: "' + c.categoria_id + '".');
    });

    var pagosPorCompra = {};
    gastos.forEach(function (g) {
      var id = g.id;
      if (!esFecha(g.fecha)) add('Gastos', id, 'fecha', 'Fecha inválida: "' + g.fecha + '".');
      if (!esNum(g.monto) || numeroSeguro_(g.monto, 0) <= 0) add('Gastos', id, 'monto', 'Monto no numérico o <= 0: "' + g.monto + '".');
      if (!esMoneda(g.moneda)) add('Gastos', id, 'moneda', 'Moneda fuera de ARS/USD: "' + g.moneda + '".');
      if (!setIds.Categorias[String(g.categoria_id || '').trim()]) add('Gastos', id, 'categoria_id', 'Categoría inexistente: "' + g.categoria_id + '".');
      if (!setIds.MediosPago[String(g.medio_pago_id || '').trim()]) add('Gastos', id, 'medio_pago_id', 'Medio de pago inexistente: "' + g.medio_pago_id + '".');
      var cid = String(g.compra_credito_id || '').trim();
      if (cid) {
        if (!setIds.ComprasCredito[cid]) add('Gastos', id, 'compra_credito_id', 'Compra inexistente: "' + cid + '".');
        else pagosPorCompra[cid] = (pagosPorCompra[cid] || 0) + 1;
      }
    });

    // Más pagos vinculados que cuotas: rompe el estado derivado de la compra.
    compras.forEach(function (c) {
      var id = String(c.id || '').trim();
      var pagadas = numeroSeguro_(c.cuotas_previas, 0) + (pagosPorCompra[id] || 0);
      var n = numeroSeguro_(c.n_cuotas, 0);
      if (n && pagadas > n) {
        add('ComprasCredito', id, 'n_cuotas', 'Tiene ' + pagadas + ' cuotas pagadas sobre ' + n + ' totales.');
      }
    });

    var resumen = {
      Categorias: cats.length, MediosPago: medios.length,
      ComprasCredito: compras.length, Gastos: gastos.length,
      problemas: problemas.length
    };
    return { ok: true, data: { problemas: problemas, resumen: resumen } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Corre `diagnosticarDatos()` y lo imprime legible en el Logger. Pensado para
 * ejecutar a mano desde el editor de Apps Script sobre la copia de trabajo
 * (es read-only: no toca un solo dato).
 */
function reporteDiagnostico() {
  var res = diagnosticarDatos();
  if (!res.ok) { Logger.log('✗ ' + res.error); return; }
  var d = res.data;
  Logger.log('Filas → Categorias %s | MediosPago %s | ComprasCredito %s | Gastos %s',
    d.resumen.Categorias, d.resumen.MediosPago, d.resumen.ComprasCredito, d.resumen.Gastos);
  if (!d.problemas.length) { Logger.log('✓ Sin problemas de integridad.'); return; }
  Logger.log('✗ %s problema(s):', d.problemas.length);
  d.problemas.forEach(function (p) {
    Logger.log('  [%s] id=%s %s → %s', p.tabla, p.id, p.campo, p.detalle);
  });
}
