/**
 * Validaciones de negocio de los maestros (It 1, slice 1c).
 * Devuelven { ok:true, data:{campos normalizados} } o { ok:false, error }.
 * No escriben: solo validan/normalizan. Los usa api.js.
 */

/**
 * Valida un alta/edición de Categoría. `idExcluir` es el id de la fila que se
 * está editando (para no chocar consigo misma en el chequeo de duplicado).
 * Duplicado = misma combinación Tipo + Categoría + Subcategoría (case-insensitive)
 * en cualquier fila (activa o no), para no generar catálogo ambiguo.
 */
function validarCategoria_(payload, idExcluir) {
  payload = payload || {};
  var tipo = String(payload.tipo || '').trim();
  var categoria = String(payload.categoria || '').trim();
  var subcategoria = String(payload.subcategoria || '').trim();

  if (!tipo) return { ok: false, error: 'El tipo es obligatorio.' };
  if (!categoria) return { ok: false, error: 'La categoría es obligatoria.' };

  var low = function (s) { return String(s).trim().toLowerCase(); };
  var dup = leerTabla_('Categorias').some(function (c) {
    return String(c.id) !== String(idExcluir || '') &&
      low(c.tipo) === low(tipo) &&
      low(c.categoria) === low(categoria) &&
      low(c.subcategoria || '') === low(subcategoria);
  });
  if (dup) return { ok: false, error: 'Ya existe esa combinación Tipo / Categoría / Subcategoría.' };

  return { ok: true, data: { tipo: tipo, categoria: categoria, subcategoria: subcategoria } };
}

/**
 * Valida un alta/edición de Medio de pago. Duplicado = misma entidad
 * (etiqueta) en otra fila, para no tener dos medios visualmente iguales.
 */
function validarMedio_(payload, idExcluir) {
  payload = payload || {};
  var tipoMedio = String(payload.tipo_medio || '').trim();
  var entidad = String(payload.entidad || '').trim();

  if (!tipoMedio) return { ok: false, error: 'El tipo de medio es obligatorio.' };
  if (!entidad) return { ok: false, error: 'La entidad es obligatoria.' };

  var low = function (s) { return String(s).trim().toLowerCase(); };
  var dup = leerTabla_('MediosPago').some(function (m) {
    return String(m.id) !== String(idExcluir || '') && low(m.entidad) === low(entidad);
  });
  if (dup) return { ok: false, error: 'Ya existe un medio de pago con esa entidad.' };

  return { ok: true, data: { tipo_medio: tipoMedio, entidad: entidad } };
}

/**
 * Valida un alta/edición de Compra en cuotas (`ComprasCredito`). Devuelve
 * { ok:true, data:{campos normalizados} } o { ok:false, error }. No escribe.
 * Reglas: la tarjeta debe ser un medio ACTIVO con tipo_medio = 'Credito'; la
 * categoría (heredada default por las cuotas) debe existir y estar activa;
 * monto_total > 0; n_cuotas entero >= 1; moneda ARS|USD. `cuotas_previas` no se
 * expone en la app (siempre 0 hacia adelante; era un shim de migración).
 */
function validarCompraPayload_(payload) {
  payload = payload || {};

  var fecha = String(payload.fecha_compra || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { ok: false, error: 'Fecha de compra inválida (se espera yyyy-mm-dd).' };
  }

  var montoTotal = Number(payload.monto_total);
  if (!isFinite(montoTotal) || montoTotal <= 0) {
    return { ok: false, error: 'El monto total debe ser un número mayor a 0.' };
  }

  var nCuotas = Number(payload.n_cuotas);
  if (!isFinite(nCuotas) || nCuotas < 1 || Math.floor(nCuotas) !== nCuotas) {
    return { ok: false, error: 'La cantidad de cuotas debe ser un entero mayor o igual a 1.' };
  }

  var moneda = String(payload.moneda || 'ARS').trim().toUpperCase();
  if (MONEDAS_VALIDAS.indexOf(moneda) < 0) {
    return { ok: false, error: 'Moneda inválida (ARS o USD).' };
  }

  var categoriaId = String(payload.categoria_id || '').trim();
  if (!categoriaId) return { ok: false, error: 'Elegí una categoría.' };
  var catOk = leerTabla_('Categorias').some(function (c) {
    return String(c.id) === categoriaId && esActivo_(c.activo);
  });
  if (!catOk) return { ok: false, error: 'La categoría elegida no existe o está inactiva.' };

  var medioId = String(payload.medio_pago_id || '').trim();
  if (!medioId) return { ok: false, error: 'Elegí una tarjeta.' };
  var medio = leerTabla_('MediosPago').filter(function (m) { return String(m.id) === medioId; })[0];
  if (!medio || !esActivo_(medio.activo)) {
    return { ok: false, error: 'La tarjeta elegida no existe o está inactiva.' };
  }
  if (String(medio.tipo_medio).trim() !== 'Credito') {
    return { ok: false, error: 'El medio elegido no es una tarjeta de crédito.' };
  }

  return {
    ok: true,
    data: {
      fecha_compra: fecha,
      descripcion: String(payload.descripcion || '').trim(),
      medio_pago_id: medioId,
      categoria_id: categoriaId,
      monto_total: montoTotal,
      n_cuotas: nCuotas,
      moneda: moneda,
      nota: String(payload.nota || '').trim()
    }
  };
}

/** Cuenta los pagos (filas de `Gastos`) vinculados a una compra por su id. */
function contarPagosDeCompra_(compraId) {
  compraId = String(compraId || '');
  var n = 0;
  leerTabla_('Gastos').forEach(function (g) { if (String(g.compra_credito_id) === compraId) n++; });
  return n;
}

/**
 * Cuenta cuántos registros (gastos + compras a crédito) referencian una
 * categoría. Se usa para decidir si se puede borrar físicamente: si hay
 * referencias, el borrado rompería la integridad → solo se permite desactivar.
 */
function contarRefsCategoria_(id) {
  id = String(id || '');
  var n = 0;
  leerTabla_('Gastos').forEach(function (g) { if (String(g.categoria_id) === id) n++; });
  leerTabla_('ComprasCredito').forEach(function (c) { if (String(c.categoria_id) === id) n++; });
  return n;
}

/** Idem para medios de pago (referenciados en Gastos y ComprasCredito). */
function contarRefsMedio_(id) {
  id = String(id || '');
  var n = 0;
  leerTabla_('Gastos').forEach(function (g) { if (String(g.medio_pago_id) === id) n++; });
  leerTabla_('ComprasCredito').forEach(function (c) { if (String(c.medio_pago_id) === id) n++; });
  return n;
}
