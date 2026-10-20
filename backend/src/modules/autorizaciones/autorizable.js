'use strict';

const { AppError } = require('../../middlewares/error');
const { puede, almacenesDe, esAdmin } = require('../permisos/service');
const { almacenesDelCambio } = require('../tiempo-real/almacenes');
const { OPERACIONES, describir } = require('./operaciones');

// EL CANDADO DE UNA OPERACIÓN QUE SE AUTORIZA (2026-10-19). Va en su ruta
// DESPUÉS de validar los datos (`validate(...)`):
//
//   router.post('/sesiones/:id/movimientos', validate(movimientoSchema), autorizable('mover_efectivo'), …)
//
// 1. Quien la hace directo (`hacer:*`) pasa, como siempre (salvo las que
//    `siempreSePide`: las vacaciones propias se piden aunque se autoricen).
// 2. Quien no puede ni pedirla (`pedir:*`): 403, sin enseñar nada.
// 3. Tiene que ser de SUS tiendas (la caja, la venta, el almacén): si no, "no
//    existe" (404, como cualquier cosa de otra tienda); si no se pudo saber, 503
//    y no se guarda nada. Lo que no es de una tienda (un cliente, un precio) se
//    queda con las tiendas de quien pide, para que lo autorice alguien de ellas.
//    Lo que es de DOS (un pedido a otra tienda, `conTienda: 'alguna'`) basta con
//    que una sea suya.
// 4. `X-Autorizacion`: es el sistema haciéndola al aceptarla (`service.aprobar`);
//    la llave se gasta al usarla.
// 5. `X-Autoriza`: quien autoriza escribió su CLAVE DE AUTORIZACIÓN ahí mismo; se
//    anota ANTES de hacerse y se cierra al terminar (si falló, se borra).
// 6. Con `X-Pedir-Autorizacion` se guarda la solicitud (202). Si la operación es
//    `parcial`, se guarda solo lo que necesita autorización y lo demás se hace ya
//    (cabecera `X-Autorizacion-Pedida`). Sin ella: 428 NECESITA_AUTORIZACION con
//    lo que se pide y quién puede autorizarlo; la pantalla pregunta qué hacer.
//    Antes de las dos, `alPedir` revisa que se PUEDA hacer (unas vacaciones sin
//    días): mejor decirlo ya que al aceptarla.

/** La ruta como llegó (sin /api/v1), con su `?…`: la que se repite al aceptarla. */
const rutaDe = (req) => req.originalUrl.replace(/^\/api\/v1/, '');
const sinConsulta = (ruta) => ruta.split('?')[0];

/** De qué tiendas es lo que se pide, revisando que sean de quien pide (ver arriba, paso 3). */
async function tiendasDe(op, req, ruta) {
  let lista;
  try {
    lista = await almacenesDelCambio(sinConsulta(ruta), req.body);
  } catch {
    throw new AppError(503, 'NO_SE_PUDO_REVISAR', 'No se pudo revisar de qué tienda es. Intenta otra vez.');
  }
  const mias = await almacenesDe(req.auth);
  if (op.conTienda && !(lista && lista.length)) throw new AppError(404, 'NO_ENCONTRADO', 'Eso no existe.');
  if (lista && mias !== null) {
    const ajenas = lista.filter((a) => !mias.includes(Number(a)));
    if (op.conTienda === 'alguna' ? ajenas.length === lista.length : ajenas.length) {
      throw new AppError(404, 'OTRA_TIENDA', 'Eso no existe.');
    }
  }
  return lista ?? mias;
}

function autorizable(clave) {
  const op = OPERACIONES[clave];
  if (!op) throw new Error(`Operación sin autorizar desconocida: ${clave}`);

  return async (req, res, next) => {
    try {
      if (op.aplica && !(await op.aplica(req))) return next();
      if (!req.auth || req.auth.tipo !== 'usuario') {
        return next(new AppError(403, 'PROHIBIDO', 'Recurso exclusivo de personal (staff)'));
      }
      const directo = await puede(req.auth, op.permiso);
      if (directo && (!op.siempreSePide || (await esAdmin(req.auth)))) return next();
      if (!directo && !(await puede(req.auth, op.pedir))) {
        return next(new AppError(403, 'SIN_PERMISO',
          `Tu puesto no tiene permiso para «${op.nombre}». Pídeselo al administrador.`));
      }

      // Perezoso: el servicio carga la base y los permisos.
      const service = require('./service');
      const model = require('./model');
      const repeticion = req.get('X-Autorizacion');
      // Lo que falta para saber de qué tienda es (el almacén de un paquete a mano).
      if (op.completar && !repeticion) await op.completar(req);
      const ruta = rutaDe(req);
      const tiendas = await tiendasDe(op, req, ruta);

      if (repeticion) {
        const id = await model.consumirLlave(repeticion, { metodo: req.method, ruta, solicitanteId: req.auth.sub });
        req.autorizado = { permiso: op.permiso, id };
        return next();
      }

      // Que se PUEDA hacer, antes de pedirla, preguntar o autorizarla ahí mismo.
      if (op.alPedir) await op.alPedir(req);
      // Quién autoriza: quien comparte alguna de sus tiendas o, si la operación lo
      // dice, alguna de las que decide (un pedido a otra tienda: la que surte).
      const tiendasAutoriza = op.tiendasQueAutorizan ? op.tiendasQueAutorizan(req.body) : tiendas;

      const conClave = req.get('X-Autoriza');
      if (conClave && op.soloADistancia) {
        throw new AppError(403, 'SE_AUTORIZA_EN_AUTORIZACIONES',
          `«${op.nombre}» se pide y se acepta en Autorizaciones, viendo lo que se autoriza.`);
      }
      if (conClave) {
        const quien = await service.revisarClave(conClave, op, { solicitanteId: req.auth.sub, tiendas: tiendasAutoriza });
        const id = await model.crearEnElMomento({
          operacion: clave, metodo: req.method, ruta, cuerpo: JSON.stringify(req.body ?? {}),
          resumen: await describir(op, req), almacenes: tiendas, solicitanteId: req.auth.sub, autorizadorId: quien.id,
        });
        req.autorizado = { permiso: op.permiso, id, por: quien.id };
        // Al contestar COMPLETO: se hizo si contestó bien (si no, se borra: no pasó
        // nada). Si el navegador cortó antes de que terminara la respuesta (o a
        // media lista del proveedor, que contesta por partes), no se sabe: se
        // queda "aprobando" y a los 5 minutos se ve como interrumpida, para
        // revisar si se hizo. Lo que contesta por partes dice que falló con
        // `res.locals.fallo`.
        let cerrada = false;
        const cerrar = () => {
          if (cerrada || !res.writableFinished) return;
          cerrada = true;
          const hecha = res.statusCode < 400 && !res.locals.fallo;
          model.cerrarEnElMomento(id, hecha)
            .then(() => (hecha ? service.alResolver(id, 'aprobada') : null))
            .catch((e) => console.error(`[autorizaciones] no se pudo cerrar la autorización ${id}:`, e.message));
        };
        res.on('finish', cerrar);
        res.on('close', cerrar);
        return next();
      }

      const resumen = await describir(op, req);
      if (req.get('X-Pedir-Autorizacion') && !op.soloEnElMomento) {
        const parcial = op.parcial ? await op.parcial(req) : null;
        const guardar = parcial ?? { metodo: req.method, ruta: op.sinConsulta ? sinConsulta(ruta) : ruta, cuerpo: req.body };
        if (op.unaPorRuta) await model.reemplazarPendientes(clave, guardar.ruta);
        const solicitud = await model.crear({
          operacion: clave, metodo: guardar.metodo, ruta: guardar.ruta, cuerpo: JSON.stringify(guardar.cuerpo ?? {}),
          resumen, almacenes: tiendas, contexto: op.contexto ? await op.contexto(req) : null, solicitanteId: req.auth.sub,
        });
        if (parcial) {
          // Lo demás se guarda ya; lo que necesita autorización queda pedido.
          parcial.ajustar();
          res.locals.tiposAvisoExtra = ['autorizaciones', 'avisos'];
          res.set({ 'X-Autorizacion-Pedida': String(solicitud.id), 'Access-Control-Expose-Headers': 'X-Autorizacion-Pedida' });
          return next();
        }
        // El aviso en vivo dice "hay una solicitud", no lo de la ruta (no cambió nada).
        res.locals.tiposAviso = ['autorizaciones', 'avisos'];
        return res.status(202).json({ data: { autorizacion: solicitud }, error: null });
      }

      return next(new AppError(428, 'NECESITA_AUTORIZACION', `«${op.nombre}» necesita autorización.`, {
        operacion: clave,
        nombre: op.nombre,
        resumen,
        solo_en_el_momento: Boolean(op.soloEnElMomento),
        autorizadores: await service.autorizadores(op, tiendasAutoriza, { excluir: op.noASiMismo ? req.auth.sub : null }),
      }));
    } catch (err) {
      return next(err);
    }
  };
}

/** ¿Ya pasó por su candado esta petición (la hace directo o se la autorizaron)? Para los permisos que se revisan dentro del controlador. */
async function puedeEn(req, clave) {
  return req.autorizado?.permiso === clave || puede(req.auth, clave);
}

module.exports = { autorizable, puedeEn };
