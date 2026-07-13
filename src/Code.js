/**
 * Punto de entrada de la web app (It 0 — andamiaje mínimo).
 * Sirve la SPA con HtmlService. Deploy privado: Execute as Me / Only myself.
 */
function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Gastos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Permite incluir parciales (styles / app-js) dentro de index.html
 * con <?!= include('styles') ?>.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Ping de humo para verificar que google.script.run funciona end-to-end.
 * Se remueve/expande cuando arranque It 1.
 */
function ping() {
  return { ok: true, data: { pong: true, ts: new Date().toISOString() } };
}
