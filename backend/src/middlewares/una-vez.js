'use strict';

const { pool } = require('../config/db');
const { AppError } = require('./error');

/**
 * UNA OPERACIÓN DE DINERO SE REGISTRA UNA VEZ (2026-10-20, auditoría: 3
 * anticipos de $1,000 en 98 segundos). La pantalla manda una llave de un solo
 * uso en `X-Clave-Unica` (un UUID que cambia al registrarse), como la venta con
 * su `clave_cobro`:
 *   · la primera vez se anota "en_curso" y la petición sigue;
 *   · si contesta bien, se guarda su respuesta ANTES de mandarla ("hecha"): otra
 *     petición con la misma llave recibe esa misma respuesta (con `X-Repetida`)
 *     sin registrar nada otra vez;
 *   · si falla o solo se pidió autorización (202), la llave se borra y se
 *     puede reintentar;
 *   · si llega otra mientras la primera trabaja: 409 YA_SE_ESTA_REGISTRANDO.
 * Sin la cabecera pasa como siempre (scripts, autorizaciones que se repiten con
 * su propia llave). Va DESPUÉS de `validate` y ANTES de `autorizable`.
 */
const VALIDA = /^[A-Za-z0-9-]{8,64}$/;

function unaVez() {
  return async (req, res, next) => {
    const clave = req.get('X-Clave-Unica');
    if (!clave) return next();
    if (!VALIDA.test(clave)) {
      return next(new AppError(422, 'CLAVE_INVALIDA', 'La llave de la operación no es válida: vuelve a abrir la ventana.'));
    }
    const usuario = req.auth?.sub ?? null;
    const ruta = req.originalUrl.split('?')[0].slice(0, 255);
    try {
      // De vez en cuando se tiran las de hace más de 2 días.
      if (Math.random() < 0.05) {
        await pool.query('DELETE FROM operaciones_unicas WHERE creado_en < NOW() - INTERVAL 2 DAY');
      }
      await pool.query(
        'INSERT INTO operaciones_unicas (clave, usuario_id, metodo, ruta) VALUES (:clave, :usuario, :metodo, :ruta)',
        { clave, usuario, metodo: req.method, ruta }
      );
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') return next(e);
      try {
        const [[ya]] = await pool.query(
          `SELECT usuario_id, metodo, ruta, estado, status, respuesta,
                  (creado_en < NOW() - INTERVAL 2 MINUTE) AS perdida
             FROM operaciones_unicas WHERE clave = :clave`,
          { clave }
        );
        if (!ya) return next();
        if (Number(ya.usuario_id ?? 0) !== Number(usuario ?? 0) || ya.ruta !== ruta || ya.metodo !== req.method) {
          return next(new AppError(422, 'CLAVE_REPETIDA', 'Esa llave ya se usó en otra operación: vuelve a abrir la ventana.'));
        }
        if (ya.estado === 'hecha') {
          // Por `res.json` y no `res.send`: así pasa otra vez por lo que la ruta
          // le quita (el costo, `sinCostosEnRespuesta`), igual que la primera.
          res.set('X-Repetida', '1');
          return res.status(Number(ya.status) || 200).json(JSON.parse(ya.respuesta));
        }
        // Una "en curso" de hace más de 2 minutos se dio por perdida (el servidor
        // se reinició a media operación): no se repite a ciegas, se pide revisar.
        return next(new AppError(409, 'YA_SE_ESTA_REGISTRANDO', Number(ya.perdida)
          ? 'Esta operación se cortó a medias. Revisa si quedó registrada antes de volver a intentarlo (abre la ventana otra vez).'
          : 'Ya se está registrando: espera un momento.'));
      } catch (e2) {
        return next(e2);
      }
    }

    // La respuesta se guarda ANTES de mandarla: así una segunda petición que
    // llegue justo después ya la encuentra "hecha".
    const enviar = res.json.bind(res);
    res.json = (cuerpo) => {
      // Un 202 (se PIDIÓ autorización, no se hizo nada) suelta la llave: si
      // vuelve a apretar, se pregunta otra vez en lugar de repetirle un "listo".
      const ok = res.statusCode < 400 && res.statusCode !== 202 && !res.get('X-Autorizacion-Pedida');
      const guardar = ok
        ? pool.query(
          "UPDATE operaciones_unicas SET estado = 'hecha', status = :status, respuesta = :respuesta WHERE clave = :clave",
          { status: res.statusCode, respuesta: JSON.stringify(cuerpo), clave }
        )
        : pool.query("DELETE FROM operaciones_unicas WHERE clave = :clave AND estado = 'en_curso'", { clave });
      guardar
        .catch((e) => console.error(`[una-vez] no se pudo anotar la llave ${clave}:`, e.message))
        .finally(() => enviar(cuerpo));
      return res;
    };
    // Si el navegador corta la conexión, la llave NO se suelta (2026-10-26, auditoría):
    // la operación sigue en el servidor y termina en `res.json`, que la deja "hecha"
    // (o la borra si falló). Soltarla aquí dejaba que el reintento de la cajera con la
    // misma llave registrara OTRO abono de $1,000. Si el servidor se cae a media
    // operación, la llave queda "en curso" y a los 2 minutos se pide revisar (arriba).
    return next();
  };
}

module.exports = { unaVez };
