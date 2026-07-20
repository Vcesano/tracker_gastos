/**
 * API cliente ↔ servidor (It 1, slice 1a).
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

    return { ok: true, data: { categorias: categorias, medios: medios } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Da de alta un gasto (grano = un pago real). Inserta 1 fila en `Gastos` con
 * id nuevo. No maneja cuotas: compra_credito_id y nro_cuota quedan vacíos
 * (eso llega en It 2). `payload` = { fecha, descripcion, categoria_id,
 * medio_pago_id, monto, moneda }.
 */
function crearGasto(payload) {
  try {
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

    // Validar que las FKs existan y estén activas (evita gastos huérfanos).
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

    var gasto = {
      id: nuevoId_(),
      fecha: fecha,
      descripcion: String(payload.descripcion || '').trim(),
      categoria_id: categoriaId,
      medio_pago_id: medioId,
      monto: monto,
      moneda: moneda,
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
