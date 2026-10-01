'use strict';

/**
 * Prueba del asistente SIN gastar saldo de la IA.
 *
 *   node --env-file=.env.local.respaldo scripts/e2e-asistente.js
 *
 * El proveedor se sustituye por un DOBLE que simula lo que haría el modelo:
 * pedir una herramienta, recibir el resultado y contestar. Así se prueba lo que
 * de verdad puede fallar —el bucle, el filtro por rol, los topes— sin depender
 * de que haya crédito ni red.
 *
 * Lo que importa comprobar:
 *   · el bucle ejecuta la herramienta que pide el modelo y le devuelve el dato;
 *   · un cajero NO puede consultar costos ni márgenes, aunque el modelo lo pida;
 *   · el rol sale del token y no se puede falsear desde la petición;
 *   · TODAS las herramientas corren de verdad contra la base sin tronar;
 *   · el tope de vueltas corta un bucle que no termina;
 *   · sin llave configurada, el asistente lo dice en vez de fallar raro;
 *   · los errores del proveedor se traducen a algo que se pueda leer, y el
 *     503 pasajero de Gemini se reintenta en vez de llegar al mostrador.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');

const service = require('../src/modules/asistente/service');
const herramientas = require('../src/modules/asistente/herramientas');
const proveedor = require('../src/modules/asistente/proveedor');
const env = require('../src/config/env');

let f = 0;
const ck = (n, ok, d) => {
  console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + d : ''));
  if (!ok) f++;
};

/** Un doble que pide una herramienta y luego contesta con lo que recibió. */
function dobleQuePide(nombre, args = {}) {
  let vuelta = 0;
  const visto = [];
  return {
    visto,
    async preguntar(mensajes) {
      vuelta++;
      if (vuelta === 1) {
        return {
          mensaje: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: nombre, arguments: JSON.stringify(args) } },
            ],
          },
          uso: { prompt_tokens: 100, completion_tokens: 20 },
        };
      }
      // La segunda vuelta ya trae el resultado de la herramienta.
      const ultimo = mensajes[mensajes.length - 1];
      visto.push(ultimo.content);
      return {
        mensaje: { role: 'assistant', content: 'Listo: ' + String(ultimo.content).slice(0, 60) },
        uso: { prompt_tokens: 200, completion_tokens: 30 },
      };
    },
  };
}

/** Un doble que NUNCA deja de pedir herramientas: prueba el tope de vueltas. */
const dobleInsistente = {
  async preguntar() {
    return {
      mensaje: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'x', type: 'function', function: { name: 'resumen_almacenes', arguments: '{}' } },
        ],
      },
      uso: { prompt_tokens: 10, completion_tokens: 5 },
    };
  },
};

/** Un doble que contesta de una, sin pedir nada. */
const dobleDirecto = {
  async preguntar() {
    return {
      mensaje: { role: 'assistant', content: 'De nada.' },
      uso: { prompt_tokens: 50, completion_tokens: 5 },
    };
  },
};

(async () => {
  try {
    // ------------------------------------------------- 1. El bucle funciona
    console.log('\n1 · El bucle: pide, ejecuta, contesta');
    const d1 = dobleQuePide('resumen_almacenes');
    const r1 = await service.preguntar(
      { pregunta: '¿Cuántos kilos tengo en cada almacén?', rol: 'administrador' },
      d1
    );
    ck('contesta', !!r1.respuesta, r1.respuesta.slice(0, 55));
    ck('ejecutó la herramienta que pidió',
      r1.consultado.some((c) => c.herramienta === 'resumen_almacenes'),
      JSON.stringify(r1.consultado));
    ck('y le pasó el resultado de verdad',
      d1.visto.length === 1 && d1.visto[0].length > 2, `${d1.visto[0]?.length} caracteres`);
    ck('cuenta el consumo para poder decir cuánto cuesta',
      r1.uso.prompt_tokens === 300 && r1.uso.completion_tokens === 50,
      JSON.stringify(r1.uso));
    ck('en dos vueltas', r1.vueltas === 2, r1.vueltas);

    // Sin necesidad de datos, no gasta una vuelta en consultar.
    const r2 = await service.preguntar({ pregunta: 'Gracias', rol: 'cajero' }, dobleDirecto);
    ck('una pregunta que no necesita datos no consulta nada',
      r2.consultado.length === 0 && r2.vueltas === 1, r2.respuesta);

    // ------------------------------------------------------ 2. El filtro por rol
    console.log('\n2 · Un cajero no ve costos');
    const dJefe = dobleQuePide('margen_por_hilo');
    const rJefe = await service.preguntar(
      { pregunta: '¿Qué me deja más?', rol: 'administrador' },
      dJefe
    );
    ck('el administrador SÍ obtiene el margen',
      !/solo para administradores/i.test(dJefe.visto[0] ?? ''),
      (dJefe.visto[0] ?? '').slice(0, 60));

    const dCajero = dobleQuePide('margen_por_hilo');
    await service.preguntar({ pregunta: '¿Qué me deja más?', rol: 'cajero' }, dCajero);
    ck('al cajero se le niega, con un motivo',
      /solo para administradores/i.test(dCajero.visto[0] ?? ''),
      (dCajero.visto[0] ?? '').slice(0, 70));

    ck('y el catálogo del cajero ni siquiera la ofrece',
      !herramientas.catalogo('cajero').some((h) => h.function.name === 'margen_por_hilo'));
    ck('el del administrador sí',
      herramientas.catalogo('administrador').some((h) => h.function.name === 'margen_por_hilo'));

    // Una herramienta inventada no truena: se le dice y puede corregir.
    const dInventada = dobleQuePide('borrar_todo');
    await service.preguntar({ pregunta: 'Borra todo', rol: 'administrador' }, dInventada);
    ck('una herramienta que no existe se rechaza sin tumbar la conversación',
      /No existe la herramienta/i.test(dInventada.visto[0] ?? ''),
      (dInventada.visto[0] ?? '').slice(0, 60));

    // ------------------------------------- 3. Todas las herramientas corren
    console.log('\n3 · Las 14 herramientas corren contra la base');
    const nombres = Object.keys(herramientas.HERRAMIENTAS);
    ck('hay 14 herramientas', nombres.length === 14, nombres.length);

    for (const nombre of nombres) {
      // Los argumentos mínimos de las que los exigen.
      const args =
        nombre === 'ventas_por_rango'
          ? { desde: '2026-01-01', hasta: '2026-12-31' }
          : nombre === 'buscar_cliente'
            ? { texto: 'zzz' }
            : nombre === 'expediente_cliente'
              ? { cliente_id: 999999 }
              : {};
      const r = await herramientas.ejecutar(nombre, args, 'administrador');
      const rompio = r && r.error && /No se pudo consultar/.test(r.error);
      ck(`  ${nombre}`, !rompio, rompio ? r.error : 'ok');
    }

    // ------------------------------------------------------ 4. Los topes
    console.log('\n4 · Los topes');
    const rTope = await service.preguntar(
      { pregunta: 'algo enredado', rol: 'administrador' },
      dobleInsistente
    );
    ck('un modelo que no para de pedir se corta en el tope',
      rTope.incompleto === true, `${rTope.vueltas} vueltas`);
    ck('y avisa en vez de dar una respuesta a medias',
      /más concreto/i.test(rTope.respuesta), rTope.respuesta.slice(0, 50));

    let errVacia = null;
    try {
      await service.preguntar({ pregunta: '   ', rol: 'cajero' }, dobleDirecto);
    } catch (e) { errVacia = e; }
    ck('una pregunta vacía se rechaza', errVacia?.code === 'PREGUNTA_VACIA', errVacia?.code);

    let errLarga = null;
    try {
      await service.preguntar({ pregunta: 'x'.repeat(2100), rol: 'cajero' }, dobleDirecto);
    } catch (e) { errLarga = e; }
    ck('una pregunta larguísima también', errLarga?.code === 'PREGUNTA_MUY_LARGA', errLarga?.code);

    // ---------------------------------------------- 5. Sin llave configurada
    console.log('\n5 · Sin llave, lo dice');
    const llaveOriginal = env.ia.apiKey;
    env.ia.apiKey = '';
    ck('se reporta como no configurado', proveedor.configurado() === false);
    let errSinLlave = null;
    try {
      await proveedor.preguntar([{ role: 'user', content: 'hola' }], []);
    } catch (e) { errSinLlave = e; }
    ck('y al preguntar avisa qué falta',
      errSinLlave?.code === 'ASISTENTE_SIN_CONFIGURAR', errSinLlave?.message?.slice(0, 60));
    env.ia.apiKey = llaveOriginal;

    // ------------------------------------------------------ 6. Capacidades
    console.log('\n6 · Qué puede contestar');
    const cap = service.capacidades('cajero');
    ck('lista las herramientas del cajero', cap.herramientas.length === 11, cap.herramientas.length);
    ck('con ejemplos de preguntas', cap.ejemplos.length >= 7, cap.ejemplos.length);
    const capJefe = service.capacidades('administrador');
    ck('y al jefe le ofrece más', capJefe.herramientas.length === 14, capJefe.herramientas.length);
    ck('incluidos los ejemplos de margen',
      capJefe.ejemplos.some((e) => /margen/i.test(e)));


    // ------------------------------------- 7. Los errores del proveedor
    // Aquí SÍ se usa el proveedor de verdad, contra un servidor de mentiras:
    // es el único código que sabe de Gemini y es donde hay que probar que un
    // fallo se convierte en algo que se pueda leer en el mostrador.
    console.log('\n7 · Los errores del proveedor, traducidos');
    const http = require('node:http');

    let guion = [];      // qué contestar, en orden
    let recibidas = 0;   // cuántas peticiones llegaron
    const falso = http.createServer((req, res) => {
      recibidas++;
      const paso = guion.shift() ?? { status: 200, cuerpo: {} };
      res.writeHead(paso.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(paso.cuerpo));
    });
    await new Promise((listo) => falso.listen(4322, listo));

    const baseOriginal = env.ia.baseUrl;
    const llaveAntes = env.ia.apiKey;
    env.ia.baseUrl = 'http://127.0.0.1:4322';
    env.ia.apiKey = 'llave-de-prueba';
    env.ia.esperaReintentoMs = 0; // que la prueba no tarde en el reintento

    /** Corre el proveedor con un guion y devuelve el error (o null). */
    const conGuion = async (pasos) => {
      guion = pasos.slice();
      recibidas = 0;
      try {
        const r = await proveedor.preguntar([{ role: 'user', content: 'hola' }], []);
        return { ok: r };
      } catch (e) { return { code: e.code, message: e.message, status: e.status }; }
    };

    // La cuota de la capa gratuita. OJO: Gemini manda el error DENTRO DE UN
    // ARREGLO. Si se leyera como objeto, este caso caería en "IA_ERROR" con un
    // mensaje inútil.
    const cuota = await conGuion([{ status: 429, cuerpo: [{ error: {
      code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for quota metric' } }] }]);
    ck('la cuota agotada de Gemini (error en ARREGLO) se reconoce',
      cuota.code === 'IA_SIN_CUOTA', cuota.code);
    ck('y el mensaje dice que se repone, no que hay que pagar',
      /unos minutos/i.test(cuota.message ?? ''), (cuota.message ?? '').slice(0, 60));
    ck('no se reintenta: la cuota no se arregla insistiendo', recibidas === 1, recibidas);

    // El mismo error, en la forma de DeepSeek (objeto suelto): sigue sirviendo.
    const saldo = await conGuion([{ status: 402, cuerpo: {
      error: { message: 'Insufficient Balance' } } }]);
    ck('el saldo agotado de un proveedor de paga se sigue reconociendo',
      saldo.code === 'IA_SIN_SALDO', saldo.code);

    // El 503 "high demand" es pasajero y pasó en la primera prueba real.
    const ocupada = await conGuion([
      { status: 503, cuerpo: [{ error: { status: 'UNAVAILABLE', message: 'high demand' } }] },
      { status: 503, cuerpo: [{ error: { status: 'UNAVAILABLE', message: 'high demand' } }] },
    ]);
    ck('un 503 se reintenta UNA vez', recibidas === 2, `${recibidas} peticiones`);
    ck('y si insiste en fallar, se avisa que está saturada',
      ocupada.code === 'IA_OCUPADA', ocupada.code);

    // Lo que de verdad importa del reintento: que la pregunta SALGA ADELANTE.
    const rescatada = await conGuion([
      { status: 503, cuerpo: [{ error: { status: 'UNAVAILABLE', message: 'high demand' } }] },
      { status: 200, cuerpo: {
        choices: [{ message: { role: 'assistant', content: 'Vendiste $500.' } }],
        usage: { prompt_tokens: 10, completion_tokens: 3 } } },
    ]);
    ck('un 503 pasajero NO llega al mostrador: el reintento la salva',
      rescatada.ok?.mensaje?.content === 'Vendiste $500.', rescatada.ok?.mensaje?.content ?? rescatada.code);

    // Un modelo retirado da 404, y es un error de configuración: hay que decir
    // QUÉ cambiar. Ya pasó con gemini-2.5-flash-lite.
    const noExiste = await conGuion([{ status: 404, cuerpo: [{ error: {
      status: 'NOT_FOUND', message: 'This model models/x is no longer available' } }] }]);
    ck('un modelo retirado se distingue y dice qué cambiar',
      noExiste.code === 'IA_MODELO_NO_EXISTE' && /IA_MODELO/.test(noExiste.message),
      noExiste.code);

    const llaveMala = await conGuion([{ status: 400, cuerpo: [{ error: {
      status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } }] }]);
    ck('una llave inválida se reconoce aunque venga como 400',
      llaveMala.code === 'IA_LLAVE_INVALIDA', llaveMala.code);

    const rara = await conGuion([{ status: 200, cuerpo: { algo: 'que no esperábamos' } }]);
    ck('una respuesta sin la forma esperada no truena feo',
      rara.code === 'IA_RESPUESTA_RARA', rara.code);

    env.ia.baseUrl = baseOriginal;
    env.ia.apiKey = llaveAntes;
    await new Promise((listo) => falso.close(listo));

  } catch (e) {
    console.error('\nERROR:', e.message, e.stack);
    f++;
  }

  console.log(`\n${f === 0 ? 'TODO OK' : f + ' FALLO(S)'}`);
  process.exit(f === 0 ? 0 : 1);
})();
