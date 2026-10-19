'use strict';

const { EventEmitter } = require('node:events');
const { tiposDeRuta } = require('./tipos');
const { almacenesDelCambio, juntarAlmacenes, DESCONOCIDO } = require('./almacenes');
const { conAnotaciones } = require('./contexto');

// EL SISTEMA EN TIEMPO REAL (2026-10-19: "quiero que todo el sistema funcione en
// tiempo real con sockets"). Cuando una petición que escribe sale bien, se avisa
// a todas las pantallas abiertas qué TIPO de cosa cambió (inventario, caja,
// ventas…) y cada una vuelve a pedir lo suyo con sus permisos de siempre.
//
// Los números ya cuadraban antes —el servidor revisa existencias, paquetes,
// crédito y caja con candado al guardar—; esto evita que alguien trabaje con
// una pantalla vieja (la caja de Moroleón viendo conos que ya se vendieron).
//
// Vive en la memoria del proceso: hay UN proceso por sistema. Si algún día hay
// varios, los avisos tendrían que pasar por algo compartido (Redis).

const bus = new EventEmitter();
bus.setMaxListeners(0);

/**
 * Avisa que cambiaron esos tipos. `origen` es la pestaña que lo hizo (ella ya se
 * recargó); `almacenes`, las tiendas del cambio (null = de ninguna en
 * particular: le llega a todos; DESCONOCIDO = no se pudo saber: solo a quien ve
 * todas), y `compartidos`, los tipos que le llegan a TODOS aunque la tienda no
 * sea suya (lo que todas ven del cliente y del catálogo).
 */
function avisar(tipos, origen = null, almacenes = null, compartidos = []) {
  if (tipos && tipos.length) bus.emit('cambio', { tipos, origen, almacenes, compartidos });
}

/** Escucha los avisos; devuelve con qué dejar de escuchar. */
function escuchar(fn) {
  bus.on('cambio', fn);
  return () => bus.off('cambio', fn);
}

/** La ruta sin /api/v1 ni parámetros, y decodificada (`/caja/cajas/%35` es la 5). */
function rutaDe(req) {
  const ruta = req.originalUrl.split('?')[0].replace(/^\/api\/v1/, '');
  try {
    return decodeURIComponent(ruta);
  } catch {
    return ruta;
  }
}

/**
 * Middleware: al TERMINAR bien una petición que escribe, avisa lo que cambió
 * según su ruta (`tipos.js`). Va al principio de /api/v1, así cubre cualquier
 * endpoint nuevo sin tocarlo. Un error (4xx/5xx) no avisa: no cambió nada.
 * La tienda sale de la petición (antes y después: lo que se BORRA ya no está al
 * terminar y una caja puede cambiar de tienda) y de lo que anotó por dentro.
 */
function avisarAlTerminar(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const ruta = rutaDe(req);
  let antes = null;
  const seguir = () => {
    let notas;
    res.on('finish', async () => {
      if (res.statusCode >= 400) return;
      const tipos = tiposDeRuta(req.method, ruta, req.body);
      if (!tipos.length) return;
      let despues;
      try {
        despues = await almacenesDelCambio(ruta, req.body);
      } catch {
        despues = DESCONOCIDO;
      }
      const pestana = String(req.get('X-Pestana') ?? '');
      avisar(
        tipos,
        /^[a-z0-9]{8,40}$/.test(pestana) ? pestana : null,
        juntarAlmacenes(antes, despues, notas ? [...notas.almacenes] : []),
        notas ? [...notas.compartidos] : []
      );
    });
    notas = conAnotaciones(next);
  };
  // Solo se consulta antes lo que puede desaparecer o cambiar de tienda, y solo
  // con sesión (una petición sin token no llega a escribir nada).
  const resolverAntes = req.get('Authorization') && (req.method === 'DELETE' || /^\/caja\/cajas\/\d+/.test(ruta));
  if (!resolverAntes) return seguir();
  almacenesDelCambio(ruta, req.body).then(
    (a) => { antes = a; seguir(); },
    () => { antes = DESCONOCIDO; seguir(); }
  );
}

module.exports = { avisar, escuchar, avisarAlTerminar };
