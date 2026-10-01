'use strict';

const env = require('../../config/env');
const { AppError } = require('../../middlewares/error');
const { hoyLocal } = require('../../utils/fechas');
const herramientas = require('./herramientas');
const proveedorReal = require('./proveedor');

/**
 * El asistente del negocio: se le pregunta en palabras normales y contesta con
 * los datos de la tienda.
 *
 * CÓMO FUNCIONA, en tres pasos:
 *   1. Se le manda la pregunta junto con el catálogo de herramientas.
 *   2. Si necesita datos, pide una herramienta; el servidor la ejecuta —una
 *      consulta ya programada, de solo lectura— y le devuelve el resultado.
 *   3. Repite hasta que pueda contestar, con un TOPE de vueltas.
 *
 * LA IA NUNCA TOCA LA BASE. No escribe SQL y no puede cambiar nada: no registra
 * ventas, no mueve inventario, no perdona deudas. Solo lee, y solo lo que las
 * herramientas le dejan leer.
 */

/**
 * Las instrucciones del asistente.
 *
 * La fecha va aquí porque el modelo no la sabe: sin ella, "¿cuánto vendí hoy?"
 * lo llevaría a inventar una fecha o a preguntar cuál es.
 */
function instrucciones(rol) {
  return `Eres el asistente de una tienda de hilos en México. Contestas preguntas
sobre el negocio usando ÚNICAMENTE los datos que te devuelven las herramientas.

Hoy es ${hoyLocal()}.

Cómo tienes que trabajar:
- Si te preguntan algo que necesita datos, LLAMA a la herramienta que
  corresponda. No adivines cifras ni las saques de tu memoria.
- Si una herramienta no devuelve nada, dilo tal cual ("no hay ventas
  registradas hoy"). NO inventes números ni rellenes con ejemplos.
- Contesta en español de México, breve y directo, como le hablarías a la dueña
  de la tienda. Sin rodeos y sin repetir la pregunta.
- Las cantidades de hilo van en KILOS y el dinero en pesos. Redondea a dos
  decimales el dinero y a uno los kilos.
- Cuando la respuesta sea una lista, ponla en pocos renglones con lo esencial.
  No vuelques todos los campos que te devolvió la herramienta.
- Si te piden algo que no puedes consultar con tus herramientas, dilo y sugiere
  en qué pantalla del sistema está. Las pantallas son EXACTAMENTE estas, y no
  hay otras: Cómo va el negocio, Punto de venta, Pedidos, Apartados, Clientes,
  Productos, Materiales, Listas de precio, Inventario, Kardex, Recibir remesa,
  Surtir sucursal, Almacenes, Reportes, Nómina, Personal y Configuración.
  Si lo que piden no está en ninguna, di que el sistema todavía no lo tiene.
- NUNCA inventes clientes, colores, folios NI PANTALLAS. Si no aparecen en los
  datos o en la lista de arriba, no existen. Mandar a alguien a una pantalla
  inventada lo hace buscar algo que no está.

Vocabulario de esta tienda, para que entiendas las preguntas:
- Un "hilo" o un "color" es un producto. El mismo color en dos calibres (1/30,
  2/30) son DOS productos distintos.
- Un "paquete" es la presentación grande y un "cono" el hilo ya enconado. Las
  dos se venden por kilo.
- "Fiar" es vender a crédito. "Apartar" es guardar mercancía con un anticipo.
- Un "bulto" es un paquete físico con su código de barras y su peso real.

Tu rol de usuario es: ${rol}.${
    rol === 'administrador' || rol === 'gerente'
      ? ''
      : `
Los costos y los márgenes NO están disponibles para tu rol. Si te preguntan por
eso, dilo con naturalidad y sin dar cifras.`
  }`;
}

/**
 * Contesta una pregunta.
 *
 * `historial` son los turnos anteriores de la conversación, para poder
 * preguntar "¿y del mes pasado?" sin repetir el contexto. Se recorta a los
 * últimos turnos: mandar toda la conversación en cada pregunta encarece cada
 * respuesta sin mejorarla.
 *
 * `proveedor` se inyecta para poder probar el bucle con un doble.
 */
async function preguntar({ pregunta, historial = [], rol = 'cajero' }, proveedor = proveedorReal) {
  const texto = String(pregunta ?? '').trim();
  if (!texto) {
    throw new AppError(422, 'PREGUNTA_VACIA', 'Escribe una pregunta.');
  }
  if (texto.length > 2000) {
    throw new AppError(422, 'PREGUNTA_MUY_LARGA',
      'La pregunta es demasiado larga. Resúmela en unas líneas.');
  }

  const catalogo = herramientas.catalogo(rol);

  // Solo los últimos 6 turnos: alcanza para el hilo de la conversación y evita
  // que cada pregunta arrastre —y pague— toda la charla anterior.
  const previos = historial
    .slice(-6)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

  const mensajes = [
    { role: 'system', content: instrucciones(rol) },
    ...previos,
    { role: 'user', content: texto },
  ];

  // Lo que se consultó, para poder mostrarlo: que se vea DE DÓNDE salió la
  // respuesta es lo que hace que se pueda confiar en ella.
  const consultado = [];
  let usoTotal = { prompt_tokens: 0, completion_tokens: 0 };

  for (let vuelta = 0; vuelta < env.ia.maxVueltas; vuelta++) {
    const { mensaje, uso } = await proveedor.preguntar(mensajes, catalogo);
    if (uso) {
      usoTotal.prompt_tokens += uso.prompt_tokens ?? 0;
      usoTotal.completion_tokens += uso.completion_tokens ?? 0;
    }

    const llamadas = mensaje.tool_calls ?? [];
    if (llamadas.length === 0) {
      // Ya contestó.
      return {
        respuesta: String(mensaje.content ?? '').trim() || 'No supe cómo contestar eso.',
        consultado,
        uso: usoTotal,
        vueltas: vuelta + 1,
      };
    }

    // El mensaje del modelo con sus peticiones tiene que ir al historial ANTES
    // de los resultados, o el proveedor rechaza la conversación por incoherente.
    mensajes.push(mensaje);

    for (const llamada of llamadas) {
      const nombre = llamada.function?.name;
      let args = {};
      try {
        args = llamada.function?.arguments ? JSON.parse(llamada.function.arguments) : {};
      } catch {
        // El modelo mandó JSON roto: se le dice, en vez de tumbar la petición.
        args = {};
      }

      const resultado = await herramientas.ejecutar(nombre, args, rol);
      consultado.push({ herramienta: nombre, argumentos: args });

      mensajes.push({
        role: 'tool',
        tool_call_id: llamada.id,
        // Se recorta: un inventario entero no cabe y encarece la respuesta sin
        // mejorarla. Las herramientas ya limitan sus resultados, esto es el
        // seguro de último recurso.
        content: JSON.stringify(resultado).slice(0, 24000),
      });
    }
  }

  // Se agotaron las vueltas. Puede pasar con una pregunta muy enredada; es
  // mejor decirlo que devolver una respuesta a medias como si fuera completa.
  return {
    respuesta:
      'Me enredé buscando eso. Prueba a preguntarlo más concreto, por ejemplo ' +
      '"¿cuánto vendí ayer?" o "¿quién me debe más?".',
    consultado,
    uso: usoTotal,
    vueltas: env.ia.maxVueltas,
    incompleto: true,
  };
}

/**
 * Qué puede contestar el asistente, para poder mostrarlo en la pantalla.
 * Con un cuadro de texto vacío nadie sabe qué preguntar.
 */
function capacidades(rol) {
  return {
    configurado: proveedorReal.configurado(),
    modelo: env.ia.modelo,
    herramientas: Object.entries(herramientas.permitidas(rol)).map(([nombre, h]) => ({
      nombre,
      descripcion: h.descripcion,
    })),
    // Preguntas de ejemplo, en las palabras de la tienda.
    ejemplos: [
      '¿Cuánto vendí hoy?',
      '¿Quién me debe más?',
      '¿Cuántos kilos de marino oscuro tengo?',
      '¿Qué colores se venden más?',
      '¿Qué hilo se está agotando?',
      '¿Qué clientes dejaron de venir?',
      '¿Qué apartados están por liquidar?',
      ...(rol === 'administrador' || rol === 'gerente'
        ? ['¿Qué hilo llevo meses sin vender?', '¿Qué colores me dejan más margen?']
        : []),
    ],
  };
}

module.exports = { preguntar, capacidades };
