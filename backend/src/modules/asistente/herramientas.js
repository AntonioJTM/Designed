'use strict';

const analisisModel = require('../analisis/model');
const clientesModel = require('../clientes/model');
const pedidosModel = require('../pedidos/model');
// Se usan los SERVICES y no los modelos: ya normalizan los rangos de fecha
// —`hastaExcl` es exclusivo y hay que sumarle un día, error fácil de cometer— y
// son los mismos que alimentan las pantallas, así que el asistente y los
// reportes nunca se contradicen.
const reportes = require('../reportes/service');
const inventario = require('../inventario/service');

/**
 * Lo que el asistente PUEDE consultar.
 *
 * LA REGLA DE FONDO: la IA no ve la base de datos y no escribe SQL. Recibe esta
 * lista de herramientas con sus parámetros, elige cuál usar, y el servidor
 * ejecuta la consulta —ya programada y validada— y le devuelve solo el
 * resultado. La IA se limita a redactar la respuesta con esos datos.
 *
 * Por qué así y no dejando que la IA escriba consultas:
 *   · Una consulta generada puede leer lo que no debe (sueldos, contraseñas) o
 *     bloquear tablas en medio de una venta.
 *   · Un modelo puede equivocarse en un JOIN y devolver una cifra que parece
 *     buena. Aquí las cifras salen de las mismas funciones que ya usan las
 *     pantallas, así que el asistente y el tablero nunca se contradicen.
 *   · TODAS son de solo lectura. El asistente no puede cambiar nada: no
 *     registra ventas, no mueve inventario, no perdona deudas.
 *
 * `soloJefes` marca las que exponen costos o márgenes: un cajero que pregunte
 * por el margen recibe una negativa, no el dato.
 */

const HERRAMIENTAS = {
  ventas_del_dia: {
    soloJefes: false,
    descripcion:
      'Cuánto se vendió en un día: total, número de tickets y desglose por método de pago. ' +
      'Sin fecha usa hoy.',
    parametros: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha en formato AAAA-MM-DD. Por omisión, hoy.' },
      },
    },
    ejecutar: async ({ fecha }) => reportes.ventas(fecha, fecha),
  },

  ventas_por_rango: {
    soloJefes: false,
    descripcion: 'Cuánto se vendió entre dos fechas.',
    parametros: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'AAAA-MM-DD' },
        hasta: { type: 'string', description: 'AAAA-MM-DD' },
      },
      required: ['desde', 'hasta'],
    },
    ejecutar: async ({ desde, hasta }) => reportes.ventas(desde, hasta),
  },

  mas_vendidos: {
    soloJefes: false,
    descripcion: 'Qué hilos se venden más, por kilos e importe.',
    parametros: {
      type: 'object',
      properties: {
        limite: { type: 'integer', description: 'Cuántos traer. Por omisión 10.' },
      },
    },
    ejecutar: async ({ limite }) => ({
      mas_vendidos: await reportes.masVendidos(Math.min(Number(limite) || 10, 50)),
    }),
  },

  existencias: {
    soloJefes: false,
    descripcion:
      'Cuánto hay de cada hilo y en qué almacén. Se puede filtrar por color, ' +
      'material o SKU con el texto de búsqueda.',
    parametros: {
      type: 'object',
      properties: {
        buscar: { type: 'string', description: 'Color, material o SKU. Opcional.' },
      },
    },
    ejecutar: async ({ buscar }) => {
      // El service pagina: se pide una sola página y basta. Mandarle cientos de
      // renglones al modelo gastaría saldo sin mejorar la respuesta.
      const p = await inventario.listarStock({
        q: buscar || undefined,
        page: 1,
        limit: 40,
        offset: 0,
      });
      return { existencias: p.items ?? p, total: p.total };
    },
  },

  resumen_almacenes: {
    soloJefes: false,
    descripcion: 'Cuántos kilos hay en total en cada almacén.',
    parametros: { type: 'object', properties: {} },
    ejecutar: async () => inventario.resumenPorAlmacen(),
  },

  por_reabastecer: {
    soloJefes: false,
    descripcion: 'Qué hilos están por debajo de su mínimo y hay que volver a pedir.',
    parametros: { type: 'object', properties: {} },
    ejecutar: async () => ({ por_reabastecer: await reportes.porReabastecer() }),
  },

  quien_me_debe: {
    soloJefes: false,
    descripcion:
      'Quién tiene saldo pendiente, cuánto, y desde cuándo no abona. ' +
      'Incluye el total por cobrar y el reparto por antigüedad.',
    parametros: {
      type: 'object',
      properties: {
        dias_aviso: {
          type: 'integer',
          description: 'Desde cuántos días sin abonar se considera atrasado. Por omisión 30.',
        },
      },
    },
    ejecutar: async ({ dias_aviso }) =>
      analisisModel.cartera({ diasAviso: Number(dias_aviso) || 30 }),
  },

  clientes_que_no_vuelven: {
    soloJefes: false,
    descripcion:
      'Clientes que compraban seguido y dejaron de venir, con cuánto gastaban y ' +
      'cuántas veces su propio ritmo llevan sin aparecer.',
    parametros: {
      type: 'object',
      properties: {
        dias: { type: 'integer', description: 'Días sin venir. Por omisión 60.' },
      },
    },
    ejecutar: async ({ dias }) =>
      analisisModel.clientesEnfriados({ dias: Number(dias) || 60, limite: 20 }),
  },

  buscar_cliente: {
    soloJefes: false,
    descripcion:
      'Encuentra un cliente por nombre, apodo, teléfono o número de cliente. ' +
      'Úsala antes de pedir su expediente, para saber su id.',
    parametros: {
      type: 'object',
      properties: { texto: { type: 'string', description: 'Nombre, apodo o teléfono.' } },
      required: ['texto'],
    },
    ejecutar: async ({ texto }) => ({ clientes: await clientesModel.buscarParaVenta(texto, 10) }),
  },

  expediente_cliente: {
    soloJefes: false,
    descripcion:
      'Todo de un cliente: cuánto ha comprado, qué colores se lleva, su saldo y ' +
      'sus últimas compras. Necesita el id, que sale de buscar_cliente.',
    parametros: {
      type: 'object',
      properties: { cliente_id: { type: 'integer' } },
      required: ['cliente_id'],
    },
    ejecutar: async ({ cliente_id }) => {
      const id = Number(cliente_id);
      const [cliente, estadisticas, colores] = await Promise.all([
        clientesModel.obtener(id),
        clientesModel.estadisticas(id),
        clientesModel.coloresMasComprados(id, 10),
      ]);
      if (!cliente) return { error: 'No existe un cliente con ese id.' };
      return { cliente, estadisticas, colores_mas_comprados: colores };
    },
  },

  apartados: {
    soloJefes: false,
    descripcion:
      'Los apartados vigentes: de quién son, cuánto llevan pagado y cuánto falta.',
    parametros: { type: 'object', properties: {} },
    ejecutar: async () => pedidosModel.listarApartados({ orden: 'por_liquidar' }),
  },

  // --- Estas exponen costos: solo administradores y gerentes ---

  hilo_parado: {
    soloJefes: true,
    descripcion:
      'Hilos con existencias que no se venden, y cuánto dinero está inmovilizado ahí.',
    parametros: {
      type: 'object',
      properties: {
        dias: { type: 'integer', description: 'Días sin venderse. Por omisión 90.' },
      },
    },
    ejecutar: async ({ dias }) =>
      analisisModel.hiloMuerto({ dias: Number(dias) || 90, limite: 20 }),
  },

  margen_por_hilo: {
    soloJefes: true,
    descripcion:
      'Cuánto deja cada hilo: venta, costo, ganancia y margen. Solo cuenta lo que ' +
      'tiene precio de compra capturado.',
    parametros: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'AAAA-MM-DD. Opcional.' },
        hasta: { type: 'string', description: 'AAAA-MM-DD. Opcional.' },
      },
    },
    ejecutar: async ({ desde, hasta }) =>
      analisisModel.margenPorHilo({ desde, hasta, limite: 20 }),
  },

  cortes_de_caja: {
    soloJefes: true,
    descripcion: 'Los cortes de caja: cuánto se esperaba, cuánto se contó y la diferencia.',
    parametros: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'AAAA-MM-DD. Opcional.' },
        hasta: { type: 'string', description: 'AAAA-MM-DD. Opcional.' },
      },
    },
    ejecutar: async ({ desde, hasta }) => ({
      cortes: await reportes.cortesCaja(desde, hasta),
    }),
  },
};

/** Las herramientas que este rol puede usar. */
function permitidas(rol) {
  const esJefe = rol === 'administrador' || rol === 'gerente';
  return Object.fromEntries(
    Object.entries(HERRAMIENTAS).filter(([, h]) => esJefe || !h.soloJefes)
  );
}

/**
 * El catálogo en el formato que espera el proveedor (el mismo que usa OpenAI,
 * que es el que habla Gemini por su endpoint de compatibilidad).
 */
function catalogo(rol) {
  return Object.entries(permitidas(rol)).map(([nombre, h]) => ({
    type: 'function',
    function: {
      name: nombre,
      description: h.descripcion,
      parameters: h.parametros,
    },
  }));
}

/**
 * Ejecuta una herramienta por su nombre.
 *
 * Si el modelo pide una que no existe —o una que su rol no permite— se le
 * contesta con un error EN TEXTO en vez de lanzar: así puede corregir y elegir
 * otra, que es mejor que tumbar la conversación.
 */
async function ejecutar(nombre, argumentos, rol) {
  const disponibles = permitidas(rol);
  const h = disponibles[nombre];
  if (!h) {
    return HERRAMIENTAS[nombre]
      ? { error: 'Esa información es solo para administradores y gerentes.' }
      : { error: `No existe la herramienta "${nombre}".` };
  }
  try {
    return await h.ejecutar(argumentos ?? {});
  } catch (err) {
    // El detalle técnico no le sirve al modelo ni al usuario; lo importante es
    // que sepa que esa vía falló y pueda decirlo o intentar otra.
    return { error: `No se pudo consultar: ${err.message}` };
  }
}

module.exports = { HERRAMIENTAS, catalogo, ejecutar, permitidas };
