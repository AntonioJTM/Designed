'use strict';

const env = require('../../config/env');
const { AppError } = require('../../middlewares/error');

/**
 * La llamada al proveedor de IA, aislada en un solo archivo.
 *
 * Hoy es GOOGLE GEMINI, por su endpoint COMPATIBLE CON OPENAI
 * (`/v1beta/openai/chat/completions`), que habla el mismo protocolo que usaba
 * DeepSeek: `messages` + `tools` + `tool_calls`. Se cambió el 2026-09-10 porque
 * Gemini tiene capa gratuita y la cuenta de DeepSeek se quedó sin saldo.
 *
 * Está aparte por dos razones:
 *   · cambiar de proveedor es cambiar `IA_BASE_URL` y `IA_MODELO`, sin tocar la
 *     lógica del asistente —y así fue: el bucle de herramientas no se modificó
 *     ni una línea al pasar de DeepSeek a Gemini—;
 *   · las pruebas pueden sustituir esta función por un doble y verificar el
 *     bucle de herramientas sin gastar cuota ni depender de la red.
 *
 * NUNCA se le manda la llave al cliente ni se registra en los logs: vive solo
 * en el `.env` del servidor.
 */

/** ¿Está configurado el asistente? */
function configurado() {
  return Boolean(env.ia.apiKey);
}

/**
 * Saca el error de la respuesta, venga como venga.
 *
 * OJO: Gemini devuelve el error DENTRO DE UN ARREGLO (`[{ error: {...} }]`),
 * no como objeto suelto como DeepSeek. Leerlo con `cuerpo.error.message` daba
 * `undefined` y todos los fallos se veían igual: "HTTP 429" sin decir que era
 * la cuota. Se normalizan las dos formas.
 */
function leerError(cuerpo, status) {
  const raiz = Array.isArray(cuerpo) ? (cuerpo[0] ?? {}) : (cuerpo ?? {});
  const e = raiz.error ?? {};
  return {
    mensaje: e.message ?? `HTTP ${status}`,
    // `status` de Google (RESOURCE_EXHAUSTED, UNAVAILABLE…). DeepSeek no lo manda.
    clave: e.status ?? '',
  };
}

/**
 * Traduce el error del proveedor a uno con nombre y con un mensaje que diga
 * QUÉ HACER. Un "error 429" en pantalla no le sirve a nadie en el mostrador.
 */
function traducirError({ mensaje, clave }, status) {
  // La cuota agotada es el caso más probable en la capa gratuita de Gemini.
  // NO es lo mismo que "no hay saldo": la cuota se repone sola, así que el
  // mensaje tiene que decir "espera", no "paga".
  if (status === 429 || clave === 'RESOURCE_EXHAUSTED') {
    return new AppError(429, 'IA_SIN_CUOTA',
      'Se agotó por ahora la cuota gratuita de la IA. Vuelve a intentarlo en unos ' +
      'minutos; si pasa seguido, hay que subir el límite en la consola de Google.');
  }
  // Proveedores de paga (DeepSeek y similares): saldo en ceros.
  if (/insufficient balance|billing|quota exceeded/i.test(mensaje)) {
    return new AppError(402, 'IA_SIN_SALDO',
      'La cuenta de la IA no tiene saldo. Recárgala para poder usar el asistente.');
  }
  if (status === 503 || clave === 'UNAVAILABLE') {
    return new AppError(503, 'IA_OCUPADA',
      'La IA está saturada en este momento. Vuelve a preguntar en un ratito.');
  }
  if (status === 401 || status === 403 || /api key|api_key/i.test(mensaje)) {
    return new AppError(502, 'IA_LLAVE_INVALIDA',
      'La llave de la IA no es válida o fue revocada.');
  }
  // Un modelo retirado da 404 y es un error de CONFIGURACIÓN, no del usuario:
  // ya pasó con `gemini-2.5-flash-lite`, que dejó de estar disponible.
  if (status === 404) {
    return new AppError(502, 'IA_MODELO_NO_EXISTE',
      `El modelo configurado (${env.ia.modelo}) no existe o ya no está disponible. ` +
      'Hay que cambiar IA_MODELO.');
  }
  return new AppError(502, 'IA_ERROR', `La IA devolvió un error: ${mensaje}`);
}

/** Una sola llamada HTTP, con su propio reloj. */
async function _intentar(mensajes, tools) {
  // Un `AbortController` para que una respuesta que nunca llega no deje la
  // petición del usuario colgada para siempre.
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), env.ia.timeoutMs);

  let r;
  try {
    r = await fetch(`${env.ia.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.ia.apiKey}`,
      },
      body: JSON.stringify({
        model: env.ia.modelo,
        messages: mensajes,
        tools: tools && tools.length ? tools : undefined,
        // Se deja que el modelo decida si necesita datos o si ya puede
        // contestar: forzar una herramienta haría que consultara la base para
        // responder un "gracias".
        tool_choice: tools && tools.length ? 'auto' : undefined,
        temperature: 0.2, // son cifras: se quiere consistencia, no creatividad
      }),
      signal: corte.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AppError(504, 'IA_SIN_RESPUESTA',
        'La IA tardó demasiado en contestar. Vuelve a intentarlo.');
    }
    throw new AppError(502, 'IA_INALCANZABLE',
      `No se pudo hablar con la IA: ${err.message}`);
  } finally {
    clearTimeout(reloj);
  }

  const cuerpo = await r.json().catch(() => ({}));
  return { r, cuerpo };
}

/**
 * Una vuelta de conversación con el modelo.
 *
 * `mensajes` es el historial completo (incluidos los resultados de las
 * herramientas ya ejecutadas) y `tools` el catálogo de lo que puede pedir.
 * Devuelve el mensaje del modelo tal cual: puede traer texto, o una petición de
 * herramienta, o las dos cosas.
 */
async function preguntar(mensajes, tools) {
  if (!configurado()) {
    throw new AppError(503, 'ASISTENTE_SIN_CONFIGURAR',
      'El asistente no está configurado: falta la llave de la IA (IA_API_KEY).');
  }

  let r, cuerpo;
  // Gemini contesta 503 "high demand" de vez en cuando, y pasó en la PRIMERA
  // prueba que se le hizo. Es pasajero, así que se reintenta una vez: dejar que
  // ese 503 llegue al mostrador sería fallar por algo que se arregla solo.
  // Solo se reintenta lo pasajero; una llave mala o la cuota agotada no.
  for (let intento = 0; intento < 2; intento++) {
    ({ r, cuerpo } = await _intentar(mensajes, tools));
    if (r.ok) break;
    const { clave } = leerError(cuerpo, r.status);
    const pasajero = r.status === 503 || clave === 'UNAVAILABLE';
    if (!pasajero || intento === 1) break;
    await new Promise((listo) => setTimeout(listo, env.ia.esperaReintentoMs));
  }

  if (!r.ok) {
    throw traducirError(leerError(cuerpo, r.status), r.status);
  }

  const eleccion = cuerpo?.choices?.[0];
  if (!eleccion?.message) {
    throw new AppError(502, 'IA_RESPUESTA_RARA',
      'La IA contestó en un formato que no se entiende.');
  }

  return {
    mensaje: eleccion.message,
    // Para poder decirle al usuario cuánto está costando.
    uso: cuerpo?.usage ?? null,
  };
}

module.exports = { preguntar, configurado, leerError, traducirError };
