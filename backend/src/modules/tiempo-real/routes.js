'use strict';

const { Router } = require('express');
const { authRequired, requireTipo } = require('../../middlewares/auth');
const { AppError } = require('../../middlewares/error');
const { escuchar } = require('./bus');
const { DESCONOCIDO } = require('./almacenes');
const { almacenesDe, puestosDe } = require('../permisos/service');

// GET /api/v1/tiempo-real — la conexión en vivo de cada pantalla (2026-10-19).
// Son "eventos del servidor" (SSE): un socket de una sola vía, servidor →
// pantalla, que es lo único que hace falta (las acciones siguen siendo las
// peticiones de siempre). No necesita librerías ni cambiar nginx:
//   · `X-Accel-Buffering: no` para que nginx no junte los avisos (como el avance
//     de la carga de la lista del proveedor);
//   · un LATIDO cada 25 s, porque nginx corta a los 60 s sin movimiento.
// Cada aviso dice solo QUÉ tipo de cosa cambió; ningún dato.

const LATIDO_MS = 25000;
const router = Router();

/** Las conexiones abiertas: al apagar el servidor se cierran (si no, espera 90 s). */
const abiertas = new Set();

/**
 * La pestaña que dice ser la conexión; solo letras y números (2026-10-19,
 * revisión de tiendas: antes se aceptaba cualquier texto y se repartía a todos).
 */
function limpiarPestana(valor) {
  const v = String(valor ?? '');
  return /^[a-z0-9]{8,40}$/.test(v) ? v : null;
}

router.get('/', authRequired, requireTipo('usuario'), async (req, res, next) => {
  // Sin acceso no se abre (la pantalla deja de intentar con un 403).
  try {
    if (!(await sigueVigente(req.auth))) {
      return next(new AppError(403, 'PROHIBIDO', 'No tienes permiso para acceder a este recurso'));
    }
  } catch (e) {
    return next(e);
  }
  // Si la pantalla se fue mientras se revisaba, ya no hay a quién escribirle
  // (y su 'close' ya pasó: el latido se quedaría corriendo para siempre).
  if (req.destroyed || res.destroyed) return;
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  // Si se cae, el navegador vuelve a intentar a los 5 s.
  res.write('retry: 5000\n\n');

  // Lo que guardó ESTA pestaña no se le manda (ya se recargó sola), y el
  // `origen` de nadie se reparte: el aviso solo dice qué tipo de cosa cambió.
  const mia = limpiarPestana(req.get('X-Pestana'));
  const escribir = (texto) => {
    if (!res.writableEnded && !res.destroyed) res.write(texto);
  };
  const soltar = escuchar(async (ev) => {
    if (mia && ev.origen === mia) return;
    // La conexión vive más que una petición: quien ya no puede entrar (dado de
    // baja, "Sin acceso", cargador) o cuya sesión venció la pierde. Al volver a
    // conectar, el servidor le pide el token otra vez.
    let mias;
    try {
      if (!(await sigueVigente(req.auth))) return res.end();
      mias = await almacenesDe(req.auth);
    } catch {
      return;
    }
    // Se revisa en CADA aviso (con la caché de siempre): si a alguien le quitan
    // una tienda, deja de recibir sus avisos al momento.
    const tipos = tiposPara(ev, mias);
    if (tipos.length) escribir(`event: cambio\ndata: ${JSON.stringify({ tipos })}\n\n`);
  });
  const latido = setInterval(() => escribir(': latido\n\n'), LATIDO_MS);
  const conexion = { res, latido };
  abiertas.add(conexion);
  req.on('close', () => {
    clearInterval(latido);
    soltar();
    abiertas.delete(conexion);
  });
});

/**
 * CADA QUIEN, SUS TIENDAS: qué tipos del aviso le tocan a quien ve `mias` (null
 * = todas). Un cambio de una tienda solo le llega a quien la ve; a los demás,
 * solo lo que todas las tiendas ven (la cuenta del cliente y el catálogo). Si no
 * se supo de qué tienda era, solo a quien ve todas.
 */
function tiposPara(ev, mias) {
  if (!ev.almacenes || mias === null) return ev.tipos;
  const suya = ev.almacenes !== DESCONOCIDO && ev.almacenes.some((a) => mias.includes(Number(a)));
  return suya ? ev.tipos : ev.compartidos ?? [];
}

/** ¿Sigue pudiendo entrar? Activo, con un puesto que entra, y su sesión no ha vencido. */
async function sigueVigente(auth) {
  if (auth?.exp && Date.now() / 1000 > auth.exp) return false;
  return (await puestosDe(auth)).length > 0;
}

/** Cierra las conexiones en vivo (al apagar): las pantallas se vuelven a conectar solas. */
function cerrarTodas() {
  for (const { res, latido } of abiertas) {
    clearInterval(latido);
    res.end();
  }
  abiertas.clear();
}

module.exports = router;
module.exports.cerrarTodas = cerrarTodas;
module.exports.limpiarPestana = limpiarPestana;
module.exports.tiposPara = tiposPara;
