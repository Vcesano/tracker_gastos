/**
 * Tests de la lógica pura del cliente (It 4c).
 *
 * CÓMO SE CORRE
 *   1. Abrí la app en la PC (Chrome/Edge) y esperá a que cargue.
 *   2. F12 → pestaña Console.
 *   3. ⚠ IMPORTANTE: cambiá el CONTEXTO de la consola. Apps Script sirve la app
 *      adentro de un iframe sandboxeado, y la consola arranca apuntando al
 *      frame de afuera (script.google.com), donde la app no existe. Arriba a la
 *      izquierda de la consola hay un desplegable que dice "top": abrilo y
 *      elegí la entrada del iframe ("userHtmlFrame", o una URL de
 *      googleusercontent.com).
 *   4. Recién ahí pegá TODO este archivo y Enter.
 *
 * Imprime PASS/FAIL por caso y un resumen final. No toca la Sheet, no dispara
 * ningún google.script.run y no modifica el estado de la app: solo ejercita las
 * funciones puras que `app-js.html` expone en `window.__TEST__`.
 *
 * Este archivo vive FUERA de /src a propósito: clasp no lo sube al proyecto de
 * Apps Script (no tiene por qué viajar con la app).
 */
(function () {
  'use strict';

  var T = window.__TEST__;
  if (!T) {
    // Causa nº 1 por lejos: la consola está apuntando al frame de afuera.
    // Apps Script mete la app en un iframe sandboxeado de otro origen, así que
    // desde "top" no hay forma de alcanzarla (ni leyendo frames[]).
    var esTop = (window.top === window.self);
    console.error('✗ No existe window.__TEST__.');
    if (esTop) {
      console.error('   Estás en el frame de AFUERA (' + location.host + '), donde la app no vive.');
      console.error('   → Arriba a la izquierda de la consola hay un desplegable que dice "top".');
      console.error('     Abrilo, elegí "userHtmlFrame" (o la URL de googleusercontent.com) y pegá esto de nuevo.');
    } else {
      console.error('   Estás en el frame correcto, así que probablemente sea el HTML viejo en cache:');
      console.error('   → recargá con Ctrl+Shift+R (necesita el deploy @28 o posterior).');
    }
    return;
  }

  var pass = 0, fail = 0, fallos = [];

  function test(nombre, fn) {
    try {
      fn();
      pass++;
      console.log('%c PASS %c ' + nombre, 'background:#1f6b52;color:#eafff5', '');
    } catch (e) {
      fail++;
      fallos.push(nombre + ': ' + e.message);
      console.log('%c FAIL %c ' + nombre + ' → ' + e.message, 'background:#7a2f2b;color:#ffeceb', '');
    }
  }

  function eq(actual, esperado, msg) {
    if (actual !== esperado) {
      throw new Error((msg ? msg + ' — ' : '') +
        'esperaba ' + JSON.stringify(esperado) + ' y vino ' + JSON.stringify(actual));
    }
  }

  function ok(cond, msg) {
    if (!cond) throw new Error(msg || 'se esperaba una condición verdadera');
  }

  function eqJSON(actual, esperado, msg) {
    eq(JSON.stringify(actual), JSON.stringify(esperado), msg);
  }

  console.log('%c═══ Tests del cliente ═══', 'font-weight:bold');

  /* ---------- Montos (separador es-AR: miles ".", decimal ",") ---------- */

  test('formatMonto pone separador de miles mientras se tipea', function () {
    eq(T.formatMonto('1234567'), '1.234.567');
    eq(T.formatMonto('1234'), '1.234');
    eq(T.formatMonto('999'), '999');
    eq(T.formatMonto(''), '');
  });

  test('formatMonto descarta caracteres que no son dígito ni coma', function () {
    eq(T.formatMonto('1a2b3c'), '123');
    eq(T.formatMonto('$ 1.234'), '1.234');
    eq(T.formatMonto('abc'), '');
  });

  test('formatMonto acepta una sola coma y corta en 2 decimales', function () {
    eq(T.formatMonto('1234,5'), '1.234,5');
    eq(T.formatMonto('1234,56'), '1.234,56');
    eq(T.formatMonto('1234,5678'), '1.234,56', 'se trunca en 2 decimales');
    eq(T.formatMonto('12,34,56'), '12,34', 'las comas extra se ignoran');
  });

  test('formatMonto normaliza ceros a la izquierda y coma inicial', function () {
    eq(T.formatMonto('0012'), '12');
    eq(T.formatMonto('0'), '0');
    eq(T.formatMonto(',5'), '0,5', 'sin parte entera, se asume 0');
  });

  test('parseMonto convierte el texto es-AR a número', function () {
    eq(T.parseMonto('1.234,56'), 1234.56);
    eq(T.parseMonto('1.234'), 1234);
    eq(T.parseMonto('999'), 999);
    eq(T.parseMonto('0,5'), 0.5);
    ok(isNaN(T.parseMonto('')), 'texto vacío debería dar NaN, no 0');
  });

  test('montoAInput muestra un número del server en formato es-AR', function () {
    eq(T.montoAInput(1234.56), '1.234,56');
    eq(T.montoAInput(1000), '1.000');
    eq(T.montoAInput(0.5), '0,5');
    eq(T.montoAInput(10500), '10.500');
  });

  test('montoAInput y parseMonto hacen round-trip (editar un gasto no lo cambia)', function () {
    [1, 999, 1000, 1234.56, 10500, 1234567, 0.5].forEach(function (n) {
      eq(T.parseMonto(T.montoAInput(n)), n, 'round-trip de ' + n);
    });
  });

  /* ---------- Fechas ---------- */

  test('fmtFecha pasa ISO a dd/mm/yyyy', function () {
    eq(T.fmtFecha('2026-07-25'), '25/07/2026');
    eq(T.fmtFecha('2026-01-01'), '01/01/2026');
    eq(T.fmtFecha('2026-12-31'), '31/12/2026');
  });

  test('fmtFecha devuelve tal cual lo que no es ISO', function () {
    eq(T.fmtFecha(''), '');
    eq(T.fmtFecha('cualquier cosa'), 'cualquier cosa');
  });

  test('fmtFechaLarga agrega el día de la semana (encabezado del Historial)', function () {
    eq(T.fmtFechaLarga('2026-07-25'), 'sáb 25/07/2026');
    eq(T.fmtFechaLarga('2026-07-20'), 'lun 20/07/2026');
    eq(T.fmtFechaLarga('2026-01-01'), 'jue 01/01/2026');
  });

  test('fmtFechaLarga no se corre de día por UTC', function () {
    // Se arma con componentes locales a propósito: con new Date('2026-01-01')
    // (que es UTC) al oeste de Greenwich caería el 31/12.
    eq(T.fmtFechaLarga('2026-01-01').slice(-10), '01/01/2026');
    eq(T.fmtFechaLarga('2026-03-01').slice(-10), '01/03/2026');
  });

  test('hoyISO y fechaMenosDias son coherentes entre sí', function () {
    var hoy = T.hoyISO();
    ok(/^\d{4}-\d{2}-\d{2}$/.test(hoy), 'formato inesperado: ' + hoy);
    eq(T.fechaMenosDias(0), hoy, 'el atajo "Hoy" tiene que dar hoy');

    var ayer = T.fechaMenosDias(1);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(ayer), 'formato inesperado: ' + ayer);
    ok(ayer < hoy, 'el atajo "Ayer" tiene que ser anterior a hoy');

    // Exactamente un día de diferencia (comparando como fechas locales).
    var d1 = new Date(hoy.slice(0, 4), +hoy.slice(5, 7) - 1, +hoy.slice(8, 10));
    var d0 = new Date(ayer.slice(0, 4), +ayer.slice(5, 7) - 1, +ayer.slice(8, 10));
    eq(Math.round((d1 - d0) / 86400000), 1, 'Ayer debería ser hoy menos 1 día');
  });

  /* ---------- Moneda ---------- */

  test('fmtMoneda antepone la moneda y usa formato es-AR', function () {
    eq(T.fmtMoneda(1234.5, 'ARS'), 'ARS 1.234,5');
    eq(T.fmtMoneda(1234567, 'ARS'), 'ARS 1.234.567');
    eq(T.fmtMoneda(300, 'USD'), 'USD 300');
    eq(T.fmtMoneda(1000), '1.000', 'sin moneda no antepone nada');
  });

  /* ---------- Helpers de listas ---------- */

  test('distinct conserva el orden de aparición', function () {
    eqJSON(T.distinct(['b', 'a', 'b', 'c', 'a']), ['b', 'a', 'c']);
    eqJSON(T.distinct([]), []);
  });

  test('findById compara ids como texto', function () {
    var lista = [{ id: 'a1' }, { id: 'b2' }];
    eq(T.findById(lista, 'b2').id, 'b2');
    eq(T.findById(lista, 'noexiste'), null);
  });

  test('escapeHtml neutraliza lo que podría romper el HTML', function () {
    eq(T.escapeHtml('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
    eq(T.escapeHtml('a & b'), 'a &amp; b');
    eq(T.escapeHtml('di "hola"'), 'di &quot;hola&quot;');
  });

  /* ---------- Búsqueda por texto (Historial / Compras / Pendientes) ---------- */

  var GASTOS = [
    { descripcion: 'Milanesa napolitana', categoria_label: 'Comida › Almuerzo', medio_label: 'Efectivo', tarjeta_label: '', moneda: 'ARS', monto: 5000, fecha: '2026-07-20' },
    { descripcion: 'Nafta', categoria_label: 'Transporte', medio_label: 'Galicia Debito', tarjeta_label: '', moneda: 'ARS', monto: 30000, fecha: '2026-07-20' },
    { descripcion: 'Cuota 2/6 - Heladera', categoria_label: 'Hogar', medio_label: 'Galicia Debito', tarjeta_label: 'Galicia Visa', moneda: 'ARS', monto: 10800, fecha: '2026-07-19' },
    { descripcion: 'Suscripción', categoria_label: 'Otro › Suscripciones', medio_label: 'Galicia Debito', tarjeta_label: '', moneda: 'USD', monto: 12, fecha: '2026-07-19' }
  ];
  var CAMPOS = ['descripcion', 'categoria_label', 'medio_label', 'tarjeta_label'];

  test('filtrarPorTexto sin búsqueda devuelve la lista intacta', function () {
    ok(T.filtrarPorTexto(GASTOS, '', CAMPOS) === GASTOS, 'debería devolver la misma referencia');
    ok(T.filtrarPorTexto(GASTOS, '   ', CAMPOS) === GASTOS, 'solo espacios = sin búsqueda');
  });

  test('filtrarPorTexto ignora mayúsculas y busca en todos los campos', function () {
    eq(T.filtrarPorTexto(GASTOS, 'MILANESA', CAMPOS).length, 1, 'por descripción');
    eq(T.filtrarPorTexto(GASTOS, 'transporte', CAMPOS).length, 1, 'por categoría');
    eq(T.filtrarPorTexto(GASTOS, 'galicia debito', CAMPOS).length, 3, 'por medio');
    eq(T.filtrarPorTexto(GASTOS, 'visa', CAMPOS).length, 1, 'por tarjeta de la cuota');
  });

  test('filtrarPorTexto matchea substrings y no inventa resultados', function () {
    eq(T.filtrarPorTexto(GASTOS, 'napol', CAMPOS).length, 1);
    eq(T.filtrarPorTexto(GASTOS, 'zzzz', CAMPOS).length, 0);
    eq(T.filtrarPorTexto([], 'x', CAMPOS).length, 0);
  });

  test('filtrarPorTexto no rompe con campos ausentes o nulos', function () {
    var lista = [{ descripcion: 'ok' }, { descripcion: null }, {}];
    eq(T.filtrarPorTexto(lista, 'ok', CAMPOS).length, 1);
  });

  /* ---------- Agrupación por día del Historial ---------- */

  test('agruparPorDia agrupa conservando el orden que manda el server', function () {
    var grupos = T.agruparPorDia(GASTOS);
    eq(grupos.length, 2);
    eq(grupos[0].fecha, '2026-07-20', 'el server manda desc por fecha; se respeta');
    eq(grupos[1].fecha, '2026-07-19');
    eq(grupos[0].items.length, 2);
    eq(grupos[1].items.length, 2);
  });

  test('agruparPorDia totaliza por moneda y NUNCA suma ARS + USD', function () {
    var grupos = T.agruparPorDia(GASTOS);
    eqJSON(grupos[0].totales, { ARS: 35000 });
    var t = grupos[1].totales;
    eq(t.ARS, 10800);
    eq(t.USD, 12);
    eq(Object.keys(t).length, 2, 'las dos monedas van separadas');
  });

  test('agruparPorDia tolera lista vacía y un solo día', function () {
    eq(T.agruparPorDia([]).length, 0);
    var uno = T.agruparPorDia([{ fecha: '2026-07-20', moneda: 'ARS', monto: 100 }]);
    eq(uno.length, 1);
    eq(uno[0].totales.ARS, 100);
  });

  test('agruparPorDia corta la fecha a 10 caracteres (por si viene con hora)', function () {
    var grupos = T.agruparPorDia([
      { fecha: '2026-07-20T00:00:00', moneda: 'ARS', monto: 1 },
      { fecha: '2026-07-20', moneda: 'ARS', monto: 2 }
    ]);
    eq(grupos.length, 1, 'deberían caer en el mismo día');
    eq(grupos[0].totales.ARS, 3);
  });

  /* ---------- Resumen ---------- */

  console.log('');
  var estilo = fail ? 'background:#7a2f2b;color:#ffeceb;font-weight:bold'
                    : 'background:#1f6b52;color:#eafff5;font-weight:bold';
  console.log('%c ' + pass + ' PASS / ' + fail + ' FAIL ', estilo);
  if (fallos.length) {
    console.log('Fallos:');
    fallos.forEach(function (f) { console.log('  · ' + f); });
  }
  return pass + ' PASS / ' + fail + ' FAIL';
})();
