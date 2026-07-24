/**
 * Punto de entrada de la web app.
 * Sirve la SPA con HtmlService. Deploy privado: Execute as Me / Only myself.
 */
function doGet() {
  var t = HtmlService.createTemplateFromFile('index');
  t.boot = bootJSON_();
  return t.evaluate()
    .setTitle('Gastos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Catálogos serializados para inyectar en el HTML inicial (It 3b).
 *
 * Antes la app servía el HTML y recién ahí el cliente pedía getCatalogos() por
 * google.script.run: dos viajes al server antes de poder mostrar nada. Ahora
 * viajan pegados al HTML y la app abre ya poblada. Si algo falla, se manda el
 * error y el cliente cae al camino viejo (pedirlos por su cuenta).
 */
function bootJSON_() {
  var boot;
  try {
    var res = getCatalogos();
    boot = (res && res.ok)
      ? { catalogos: res.data }
      : { error: (res && res.error) || 'No se pudieron cargar los catálogos.' };
  } catch (e) {
    boot = { error: e.message };
  }
  // Escapamos "<" para que ningún dato de la Sheet pueda cerrar el <script>.
  return JSON.stringify(boot).replace(/</g, '\\u003c');
}

/**
 * Permite incluir parciales (styles / app-js) dentro de index.html
 * con <?!= include('styles') ?>.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
