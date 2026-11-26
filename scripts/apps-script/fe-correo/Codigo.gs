/**
 * fe-correo — Compras F1 (docs/inventario/SPEC-compras-stock-costos.md §4.2).
 * Vive DENTRO de la cuenta de Gmail de proveedores (una copia por cuenta: Santa Teresa, y Nosara cuando llegue).
 * Cada 15 min busca correos con adjunto que todavía no tienen etiqueta «fe-*», saca SOLO los XML (sueltos o dentro de
 * un .zip) y los manda a la Edge `fe-ingesta`. Nunca manda el cuerpo, el remitente, el asunto ni el nombre de los
 * adjuntos. Los PDF no se mandan.
 *
 * Etiquetas (por MENSAJE, con el servicio avanzado de Gmail: un hilo puede juntar facturas de días distintos):
 *   fe-procesada  · la Edge respondió 200 (guardado, duplicado o no era comprobante)
 *   fe-sin-xml    · tenía adjunto pero ningún XML (solo PDF o imagen): se avisa el conteo
 *   fe-error      · XML ilegible, rechazado (4xx), zip dentro de zip o XML de más de 1 MB → lo mira el contador
 *   (sin etiqueta)· error de red o 5xx: se reintenta en la próxima corrida (la ingesta es idempotente por clave)
 *
 * CONFIGURACIÓN (una vez, el dueño, guiado paso a paso en docs/pases/PASE-199-fe-ingesta.md):
 *   Configuración del proyecto → Propiedades del script:
 *     FE_INGESTA_URL     https://<ref>.supabase.co/functions/v1/fe-ingesta
 *     FE_INGESTA_SECRET  el mismo valor que el secreto FE_INGESTA_SECRET de la Edge (NUNCA en este archivo)
 *     FE_FUENTE          rótulo de esta cuenta, en minúsculas: p. ej. santa-teresa
 *     FE_DESDE           (opcional) primera fecha a cargar, AAAA/MM/DD. Por defecto 2026/11/30 (decisión del dueño)
 *   Servicios → agregar «Gmail API» (servicio avanzado; ya declarado en appsscript.json).
 *   Ejecutar `instalar` una vez y autorizar: crea las etiquetas y el disparador cada 15 min.
 *
 * CUOTAS (Gmail común, documentación oficial de Apps Script, releída el 25-nov-2026): 90 min/día de disparadores,
 * 6 min por ejecución, 20.000 UrlFetch/día, 20.000 lecturas de Gmail/día. Con un disparador cada 15 min son 96
 * corridas por día: el promedio tiene que quedar por debajo de ~55 s. Por eso el tope por corrida es 45 s y 20
 * mensajes (lo que sobra queda para la siguiente). Una corrida sin correos nuevos dura 1–3 s.
 */

var ETIQUETAS = { ok: 'fe-procesada', sinXml: 'fe-sin-xml', error: 'fe-error' };
var TOPE_MS = 45 * 1000;
var TOPE_MENSAJES = 20;
var TOPE_XML_BYTES = 1024 * 1024;          // igual que la Edge
var TOPE_B64_POR_PEDIDO = 1500 * 1024;     // la Edge acepta hasta 2 MB por pedido
var TOPE_XML_POR_PEDIDO = 20;
var DESDE_POR_DEFECTO = '2026/11/30';

function config_() {
  var p = PropertiesService.getScriptProperties();
  var c = {
    url: p.getProperty('FE_INGESTA_URL'),
    secreto: p.getProperty('FE_INGESTA_SECRET'),
    fuente: p.getProperty('FE_FUENTE'),
    desde: p.getProperty('FE_DESDE') || DESDE_POR_DEFECTO,
  };
  if (!c.url || !/^https:\/\//.test(c.url)) throw new Error('Falta FE_INGESTA_URL (https) en las propiedades del script');
  if (!c.secreto || c.secreto.length < 32) throw new Error('Falta FE_INGESTA_SECRET (32 o más caracteres) en las propiedades del script');
  if (!c.fuente || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(c.fuente)) throw new Error('FE_FUENTE tiene que ser minúsculas, números y guiones');
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(c.desde)) throw new Error('FE_DESDE tiene que ser AAAA/MM/DD');
  return c;
}

/** Una vez: etiquetas + disparador cada 15 min (borra disparadores viejos de `correr` para no duplicarlos). */
function instalar() {
  config_();
  idsEtiquetas_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'correr') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('correr').timeBased().everyMinutes(15).create();
  Logger.log('Listo: disparador cada 15 min. Corré «correr» una vez a mano para probar.');
}

function idsEtiquetas_() {
  var existentes = (Gmail.Users.Labels.list('me').labels || []);
  var ids = {};
  Object.keys(ETIQUETAS).forEach(function (k) {
    var nombre = ETIQUETAS[k];
    var e = existentes.filter(function (l) { return l.name === nombre; })[0];
    if (!e) e = Gmail.Users.Labels.create({ name: nombre, labelListVisibility: 'labelShow', messageListVisibility: 'show' }, 'me');
    ids[k] = e.id;
  });
  return ids;
}

function enviar_(c, cuerpo) {
  try {
    var r = UrlFetchApp.fetch(c.url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-fe-secret': c.secreto },
      payload: JSON.stringify(cuerpo),
      muteHttpExceptions: true,
      followRedirects: false,
    });
    return r.getResponseCode();
  } catch (e) {
    return 0; // red: se reintenta
  }
}

/** XML de un mensaje: sueltos y de adentro de cada .zip (un nivel). */
function xmlsDe_(mensaje) {
  var xmls = [];
  var problema = null;
  mensaje.getAttachments({ includeInlineImages: false }).forEach(function (a) {
    var nombre = (a.getName() || '').toLowerCase();
    var tipo = (a.getContentType() || '').toLowerCase();
    if (/\.xml$/.test(nombre) || tipo.indexOf('xml') !== -1) {
      xmls.push(a.copyBlob());
    } else if (/\.zip$/.test(nombre) || tipo.indexOf('zip') !== -1) {
      try {
        Utilities.unzip(a.copyBlob()).forEach(function (b) {
          var n = (b.getName() || '').toLowerCase();
          if (/\.xml$/.test(n)) xmls.push(b);
          else if (/\.zip$/.test(n)) problema = 'zip dentro de zip';
        });
      } catch (e) {
        problema = 'zip ilegible';
      }
    }
  });
  return { xmls: xmls, problema: problema };
}

/** Qué pasó con un pedido: 'ok' (2xx) · 'error' (4xx de contenido) · 'reintentar' (red o 5xx) · 'no_autorizado' (401). */
function clasificar_(codigo) {
  if (codigo >= 200 && codigo < 300) return 'ok';
  if (codigo === 401) return 'no_autorizado';
  if (codigo >= 400 && codigo < 500) return 'error';
  return 'reintentar';
}

/** De dos resultados, el que manda: no_autorizado > reintentar > error > ok (reintentar es idempotente por clave). */
function peor_(a, b) {
  var orden = { ok: 0, error: 1, reintentar: 2, no_autorizado: 3 };
  return orden[a] >= orden[b] ? a : b;
}

/** Manda los XML en tandas (≤ 20 y ≤ 1,5 MB por pedido). */
function mandarXmls_(c, blobs) {
  var res = 'ok';
  var tanda = [];
  var tamano = 0;
  var vaciar = function () {
    if (!tanda.length) return;
    res = peor_(res, clasificar_(enviar_(c, { fuente: c.fuente, lote: Utilities.getUuid(), xmls: tanda })));
    tanda = []; tamano = 0;
  };
  blobs.forEach(function (b) {
    var bytes = b.getBytes();
    if (bytes.length > TOPE_XML_BYTES) { res = peor_(res, 'error'); return; }
    var b64 = Utilities.base64Encode(bytes);
    if (tanda.length >= TOPE_XML_POR_PEDIDO || tamano + b64.length > TOPE_B64_POR_PEDIDO) vaciar();
    tanda.push({ b64: b64 });
    tamano += b64.length;
  });
  vaciar();
  return res;
}

/** El disparador. */
function correr() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // otra corrida en curso
  var inicio = Date.now();
  try {
    var c = config_();
    if (clasificar_(enviar_(c, { fuente: c.fuente, latido: true })) === 'no_autorizado') {
      Logger.log('fe-ingesta respondió 401: revisar FE_INGESTA_SECRET. No se etiqueta nada.');
      return;
    }
    var ids = idsEtiquetas_();
    var q = 'has:attachment after:' + c.desde + ' -label:' + ETIQUETAS.ok + ' -label:' + ETIQUETAS.sinXml + ' -label:' + ETIQUETAS.error;
    var lista = Gmail.Users.Messages.list('me', { q: q, maxResults: TOPE_MENSAJES }).messages || [];
    for (var i = 0; i < lista.length; i++) {
      if (Date.now() - inicio > TOPE_MS) break; // lo que sobra queda para la próxima
      var id = lista[i].id;
      var x = xmlsDe_(GmailApp.getMessageById(id));
      var res;
      if (!x.xmls.length && !x.problema) {
        res = clasificar_(enviar_(c, { fuente: c.fuente, lote: Utilities.getUuid(), sin_xml: true }));
        if (res === 'ok') etiquetar_(id, ids.sinXml);
      } else {
        res = x.xmls.length ? mandarXmls_(c, x.xmls) : 'ok';
        if (x.problema) res = peor_(res, 'error');
        if (res === 'ok') etiquetar_(id, ids.ok);
        else if (res === 'error') etiquetar_(id, ids.error);
        // reintentar: sin etiqueta, vuelve en la próxima corrida
      }
      if (res === 'no_autorizado') { Logger.log('401: se para la corrida sin etiquetar.'); return; }
    }
  } finally {
    lock.releaseLock();
  }
}

function etiquetar_(idMensaje, idEtiqueta) {
  Gmail.Users.Messages.modify({ addLabelIds: [idEtiqueta] }, 'me', idMensaje);
}
