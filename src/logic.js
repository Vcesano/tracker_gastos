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
