'use strict';

/**
 * MUESTRA para enseñar el sistema: tres meses de operación INVENTADA sobre
 * hilos y clientes inventados.
 *
 * Se siembra con los MISMOS services que usa la API —no con SQL a mano— para
 * que el kardex, los cortes de caja, el crédito, los apartados y los bultos
 * cuadren exactamente como cuadran en la operación real. La fecha de cada
 * operación la pone el reloj simulado (`_reloj.js`).
 *
 * Todo lo que crea queda anotado en `_demo_registros` y `limpiar.js` lo borra
 * sin tocar lo real. Las ventas de la muestra SOLO usan hilos de la muestra:
 * el inventario y los bultos reales no se mueven.
 *
 * Uso (desde backend/):
 *   node scripts/demo/sembrar.js --base <DB_NAME>
 *        siembra del 2026-07-01 a hoy. Se niega a correr si ya hay muestra.
 *   node scripts/demo/sembrar.js --base <DB_NAME> --dia AAAA-MM-DD [--hasta-hora HH:MM]
 *        agrega UN día de mostrador a una muestra ya sembrada, para que
 *        "ventas de hoy" tenga algo el día que se enseña.
 *
 * `--base` es obligatorio y tiene que coincidir con DB_NAME: es el
 * recordatorio explícito de en qué base se va a escribir.
 */

process.env.TZ = 'UTC';
require('dotenv').config();

function leerArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    a[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return a;
}
const ARGS = leerArgs(process.argv.slice(2));
if (!ARGS.base || ARGS.base !== process.env.DB_NAME) {
  console.error(
    `\n  ✗ Di en qué base se escribe: --base ${process.env.DB_NAME || '<DB_NAME>'}\n` +
      `    (tiene que coincidir con DB_NAME, que hoy es "${process.env.DB_NAME}")\n`
  );
  process.exit(1);
}

const { pool } = require('../../src/config/db');
const reloj = require('./_reloj');
reloj.instalar(pool);

const productosService = require('../../src/modules/productos/service');
const variantesService = require('../../src/modules/variantes/service');
const remesasService = require('../../src/modules/remesas/service');
const inventarioService = require('../../src/modules/inventario/service');
const pedidosService = require('../../src/modules/pedidos/service');
const clientesService = require('../../src/modules/clientes/service');
const clientesModel = require('../../src/modules/clientes/model');
const cajaModel = require('../../src/modules/caja/model');
const tiposModel = require('../../src/modules/tipos-cliente/model');
const imagenesModel = require('../../src/modules/imagenes/model');
const direccionesModel = require('../../src/modules/direcciones/model');
const configuracionModel = require('../../src/modules/configuracion/model');
const nominaService = require('../../src/modules/nomina/service');
const { comprobantePdf } = require('./_pdf');
const { HILOS, DESCRIPCION, CLIENTES, DIRECCIONES, APARTADOS, CUPONES, CONFIGURACION } = require('./catalogo');

const RealDate = reloj.RealDate;
const CONTRASENA_DEMO = 'Demo2026!';
const PREFIJO_BULTO = '0081';

// ---------------------------------------------------------------------------
// Azar REPRODUCIBLE: con la misma semilla y la misma base de partida sale la
// misma muestra, así el ensayo en una copia predice lo que pasará en la real.
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(Number(ARGS.semilla ?? 20261001));
const azar = (a, b) => a + (b - a) * rnd();
const entero = (a, b) => Math.floor(azar(a, b + 1));
const prob = (p) => rnd() < p;
const elegir = (arr) => arr[Math.floor(rnd() * arr.length)];
function ponderado(items, peso) {
  const ws = items.map(peso);
  const tot = ws.reduce((s, w) => s + w, 0);
  if (tot <= 0) return null;
  let r = rnd() * tot;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
function normal(mu, sd) {
  const u = 1 - rnd();
  const v = rnd();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function poisson(l) {
  const L = Math.exp(-l);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rnd();
  } while (p > L);
  return k - 1;
}
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const aBascula = (kg) => Math.max(0.25, Math.round(kg * 200) / 200); // de 5 en 5 g
const a10 = (n) => Math.max(10, Math.round(n / 10) * 10);

// ---------------------------------------------------------------------------
// Fechas. Todo en "hora de pared" del servidor (UTC), que es la que se guarda.
// ---------------------------------------------------------------------------
const DIA_MS = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const sumarDias = (f, n) =>
  new RealDate(RealDate.parse(`${f}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const diaSemana = (f) => new RealDate(`${f}T00:00:00Z`).getUTCDay(); // 0 = domingo
const habil = (f) => diaSemana(f) !== 0;
const siguienteHabil = (f) => (habil(f) ? f : sumarDias(f, 1));
const hm = (min) => `${pad(Math.floor(min / 60))}:${pad(Math.floor(min % 60))}:${pad(Math.floor((min * 60) % 60))}`;
const aMin = (h) => {
  const [hh, mm] = h.split(':').map(Number);
  return hh * 60 + mm;
};

// "Ahora" en México (UTC-6, sin horario de verano desde 2022): lo de hoy se
// siembra solo hasta un rato antes, para que nada quede en el futuro.
const AHORA_MX = new RealDate(RealDate.now() - 6 * 3600 * 1000);
const HOY_MX = AHORA_MX.toISOString().slice(0, 10);
const MIN_AHORA_MX = AHORA_MX.getUTCHours() * 60 + AHORA_MX.getUTCMinutes();

const MODO_DIA = typeof ARGS.dia === 'string';
const INICIO = MODO_DIA ? ARGS.dia : (ARGS.desde ?? '2026-07-01');
const FIN = MODO_DIA ? ARGS.dia : (ARGS.hasta ?? HOY_MX);
const LIMITE_FIN = ARGS['hasta-hora']
  ? aMin(ARGS['hasta-hora'])
  : FIN === HOY_MX
    ? Math.min(19 * 60, MIN_AHORA_MX - 15)
    : 24 * 60;
if (FIN > HOY_MX) {
  console.error(`\n  ✗ ${FIN} es futuro: la muestra no siembra días que no han pasado.\n`);
  process.exit(1);
}
const progreso = (f) =>
  Math.min(1, Math.max(0, (RealDate.parse(f) - RealDate.parse('2026-07-01')) / (92 * DIA_MS)));

// ---------------------------------------------------------------------------
// Bitácora de lo sembrado: es lo que permite borrarlo después.
// ---------------------------------------------------------------------------
const q = async (sql, p) => (await pool.query(sql, p))[0];
const uno = async (sql, p) => (await q(sql, p))[0] ?? null;

async function anotar(tabla, id) {
  if (!id) return;
  await pool.query('INSERT IGNORE INTO _demo_registros (tabla, registro_id) VALUES (:t, :id)', { t: tabla, id });
}
async function guardarEstado(clave, valor) {
  await pool.query(
    `INSERT INTO _demo_estado (clave, valor) VALUES (:c, :v)
     ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
    { c: clave, v: JSON.stringify(valor) }
  );
}
async function leerEstado(clave) {
  const r = await uno('SELECT valor FROM _demo_estado WHERE clave = :c', { c: clave });
  return r ? JSON.parse(r.valor) : null;
}

const stats = {};
const contar = (k, n = 1) => {
  stats[k] = (stats[k] ?? 0) + n;
};
const fallos = {};
let inesperados = 0;
function fallo(nombre, err) {
  const clave = `${nombre}: ${err.code ?? err.name}`;
  fallos[clave] = (fallos[clave] ?? 0) + 1;
  if (!err.status || err.status >= 500) {
    inesperados++;
    console.error(`\n  ✗ ${ctx.fecha} ${hm(ctx.min)} ${nombre}: ${err.stack || err.message}`);
    if (inesperados > 15) throw new Error('Demasiados errores inesperados; se detiene la siembra.');
  }
}

// ---------------------------------------------------------------------------
// Contexto: referencias de la base y estado de la simulación.
// ---------------------------------------------------------------------------
const ctx = {
  fecha: INICIO,
  min: 0,
  cola: null,
  tiendas: {}, // hgo | gto → { almacen, caja, cajero, sesion }
  hilos: [], // { i, def, productoId, paqueteId, conoId }
  clientes: [], // { i, def, id, tipoId }
  tipos: {},
  M: {}, // métodos de pago
  U: {}, // usuarios
};

async function cargarReferencias() {
  const almacenes = await q('SELECT * FROM almacenes ORDER BY id');
  const tienda = almacenes.find((a) => a.es_tienda_linea && a.es_punto_venta);
  const matriz = almacenes.find((a) => a.es_matriz);
  const sucursal = almacenes.find((a) => a.es_punto_venta && a.id !== tienda?.id);
  if (!tienda || !matriz || !sucursal) {
    throw new Error('Se necesitan: un almacén de tienda en línea con mostrador, la matriz y otra sucursal.');
  }
  const cajas = await q('SELECT * FROM cajas WHERE activo = 1 ORDER BY id');
  const cajaHgo = cajas.find((c) => c.almacen_id === tienda.id);
  const cajaGto = cajas.find((c) => c.almacen_id === sucursal.id);
  if (!cajaHgo || !cajaGto) throw new Error('Cada sucursal necesita su caja.');

  const usuarios = await q(
    `SELECT u.id, u.nombre, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.activo = 1 ORDER BY u.id`
  );
  const deRol = (rol) => usuarios.filter((u) => u.rol === rol).map((u) => u.id);
  const admin = deRol('administrador')[0];
  const gerente = deRol('gerente')[0] ?? admin;
  const cajeros = deRol('cajero');
  const almacenista = deRol('almacenista')[0] ?? gerente;
  if (!admin) throw new Error('No hay un administrador activo.');
  ctx.U = { admin, gerente, almacenista };

  ctx.almacenes = { tienda: tienda.id, matriz: matriz.id, sucursal: sucursal.id };
  // Si la sucursal está desactivada, las pantallas de inventario no la
  // muestran: la muestra la activa mientras dure y la limpieza la regresa.
  ctx.sucursalInactiva = !Number(sucursal.activo);
  ctx.tiendas.hgo = { clave: 'hgo', almacen: tienda.id, caja: cajaHgo.id, cajero: cajeros[0] ?? gerente, sesion: null };
  ctx.tiendas.gto = { clave: 'gto', almacen: sucursal.id, caja: cajaGto.id, cajero: cajeros[1] ?? cajeros[0] ?? gerente, sesion: null };

  const metodos = await q('SELECT id, nombre FROM metodos_pago WHERE activo = 1');
  const metodo = (txt) => metodos.find((m) => m.nombre.toLowerCase().includes(txt))?.id;
  ctx.M = { efectivo: metodo('efectivo'), tarjeta: metodo('tarjeta'), transferencia: metodo('transferencia') };
  if (!ctx.M.efectivo || !ctx.M.tarjeta || !ctx.M.transferencia) {
    throw new Error('Faltan métodos de pago: efectivo, tarjeta y transferencia.');
  }

  const categorias = await q('SELECT id, UPPER(nombre) AS nombre FROM categorias');
  const lineas = await q('SELECT id, nombre FROM lineas');
  ctx.categoria = Object.fromEntries(categorias.map((c) => [c.nombre, c.id]));
  ctx.linea = Object.fromEntries(lineas.map((l) => [l.nombre, l.id]));
  for (const h of HILOS) {
    if (!ctx.categoria[h.material]) throw new Error(`No existe el material ${h.material}`);
    if (!ctx.linea[h.linea]) throw new Error(`No existe la línea ${h.linea}`);
  }
  const kg = await uno("SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1");
  if (!kg) throw new Error('No existe la unidad kg.');
  ctx.unidadKg = kg.id;
  ctx.tipos.publico = (await tiposModel.publico())?.id;
}

// ---------------------------------------------------------------------------
// Agenda: eventos con fecha y minuto. Un día se corre en orden de reloj, y un
// evento puede agendar otro más tarde el mismo día (p. ej. cancelar una venta).
// ---------------------------------------------------------------------------
const agenda = new Map();
function programar(fecha, min, nombre, fn, { siempre = false } = {}) {
  if (fecha > FIN || fecha < INICIO) return;
  // Si es para el día que se está corriendo, va directo a su cola: la agenda
  // de ese día ya se vació.
  if (ctx.cola && fecha === ctx.fecha) {
    enCola(min, nombre, fn);
    return;
  }
  if (!agenda.has(fecha)) agenda.set(fecha, []);
  agenda.get(fecha).push({ min, nombre, fn, siempre });
}
function enCola(min, nombre, fn) {
  if (min <= ctx.min) min = ctx.min + 1;
  ctx.cola.push({ min, nombre, fn });
}

async function correrDia(fecha) {
  const cola = agenda.get(fecha) ?? [];
  agenda.delete(fecha);
  ctx.cola = cola;
  ctx.fecha = fecha;
  while (cola.length) {
    cola.sort((a, b) => a.min - b.min);
    const ev = cola.shift();
    if (fecha === FIN && ev.min > LIMITE_FIN && !ev.siempre) continue;
    ctx.min = fecha === FIN && ev.siempre ? Math.min(ev.min, LIMITE_FIN) : ev.min;
    reloj.fijar(`${fecha} ${hm(ctx.min)}`);
    try {
      await ev.fn();
    } catch (err) {
      fallo(ev.nombre, err);
    }
  }
  ctx.cola = null;
}

// ---------------------------------------------------------------------------
// Lecturas de existencias.
// ---------------------------------------------------------------------------
async function existencia(varianteId, almacenId) {
  if (!varianteId) return 0;
  const r = await uno(
    'SELECT cantidad, cantidad_reservada FROM inventario WHERE variante_id = :v AND almacen_id = :a',
    { v: varianteId, a: almacenId }
  );
  return r ? Number(r.cantidad) : 0;
}
async function disponibleEn(varianteId, almacenId) {
  const r = await uno(
    'SELECT cantidad - cantidad_reservada AS d FROM inventario WHERE variante_id = :v AND almacen_id = :a',
    { v: varianteId, a: almacenId }
  );
  return r ? Number(r.d) : 0;
}
/** Bultos disponibles, primero los que están en ese almacén y los más viejos. */
async function bultosDisponibles(varianteId, almacenId, limite, extra = '') {
  return q(
    `SELECT id, codigo, peso_kg, lote, conos FROM variante_codigos
      WHERE variante_id = :v AND estado = 'disponible' ${extra}
      ORDER BY (almacen_id <=> :a) DESC, id
      LIMIT ${Number(limite)}`,
    { v: varianteId, a: almacenId }
  );
}

const demandaVigente = (h) =>
  h.def.demandaHasta && ctx.fecha > h.def.demandaHasta ? 0 : h.def.demanda;

/** Kilos de paquete que cada sucursal procura tener de cada hilo. */
function objetivo(tk, h) {
  const w = h.def.demanda;
  if (tk === 'hgo') return w === 0 ? 40 : a10(40 + w * 30);
  return w < 2 ? 0 : a10(35 + w * 24);
}

// ---------------------------------------------------------------------------
// Catálogo, clientes y configuración.
// ---------------------------------------------------------------------------
const slug = (h) =>
  `${h.nombre}-${h.calibre}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

async function sembrarCatalogo() {
  const medio = await tiposModel.crear({ nombre: 'Medio mayoreo', orden: 1, activo: 1 });
  const mayoreo = await tiposModel.crear({ nombre: 'Mayoreo', orden: 2, activo: 1 });
  await anotar('tipos_cliente', medio.id);
  await anotar('tipos_cliente', mayoreo.id);
  ctx.tipos.medio = medio.id;
  ctx.tipos.mayoreo = mayoreo.id;

  for (const c of CUPONES) {
    const [r] = await pool.query(
      `INSERT INTO cupones (codigo, tipo, valor, compra_minima, usos_maximos, usos_actuales,
                            fecha_inicio, fecha_fin, activo)
       VALUES (:codigo, :tipo, :valor, :compra_minima, :usos_maximos, 0, :fecha_inicio, :fecha_fin, 1)`,
      c
    );
    await anotar('cupones', r.insertId);
  }

  for (const [i, def] of HILOS.entries()) {
    const p = await productosService.crear({
      categoria_id: ctx.categoria[def.material],
      linea_id: ctx.linea[def.linea],
      unidad_medida_id: ctx.unidadKg,
      nombre: def.nombre,
      descripcion: DESCRIPCION[def.material](def),
      grosor_calibre: def.calibre,
      precio_kg: def.precio,
      multipresentacion: true,
      por_lotes: true,
      destacado: !!def.destacado,
    });
    await anotar('productos', p.id);
    const paquete = (p.variantes ?? []).find((v) => v.tipo_presentacion === 'paquete');
    if (!paquete) throw new Error(`"${def.nombre} ${def.calibre}" se creó sin presentación.`);
    const h = { i, def, productoId: p.id, paqueteId: paquete.id, conoId: null };
    ctx.hilos.push(h);
    await fijarPreciosPorTipo(h.paqueteId, def.precio);
    if (!ARGS['sin-imagenes']) {
      await imagenesModel.crear({
        producto_id: p.id,
        variante_id: null,
        url: `/demo/hilos/${slug(def)}.png`,
        es_principal: 1,
        orden: 0,
      });
    }
  }
  contar('hilos', ctx.hilos.length);
}

async function fijarPreciosPorTipo(varianteId, precio) {
  await variantesService.fijarPrecioTipo(varianteId, ctx.tipos.medio, r2(Math.round(precio * 0.95)));
  await variantesService.fijarPrecioTipo(varianteId, ctx.tipos.mayoreo, r2(Math.round(precio * 0.9)));
}

async function crearCliente(c, { rapido = false } = {}) {
  const d = c.def;
  const tipoId = ctx.tipos[d.tipo] ?? ctx.tipos.publico;
  let id;
  if (d.cuenta) {
    const { cliente } = await clientesService.registrar({
      nombre: d.nombre,
      correo: d.cuenta,
      telefono: d.tel,
      contrasena: CONTRASENA_DEMO,
      acepta_marketing: true,
    });
    id = cliente.id;
  } else {
    // El alta rápida del POS pide nombre, apodo y teléfono, y nace sin crédito.
    const creado = await clientesService.crearDesdeStaff({
      nombre: d.nombre,
      nombre_comercial: d.apodo,
      telefono: d.tel,
      cliente_desde: d.desde,
      limite_credito: 0,
    });
    id = creado.id;
  }
  await anotar('clientes', id);
  if (!rapido || d.cuenta) {
    await clientesService.actualizarCliente(id, {
      nombre_comercial: d.apodo,
      telefono: d.tel,
      tipo_cliente_id: tipoId,
      rfc: d.rfc ?? null,
      ciudad: d.ciudad,
      estado: d.estado,
      como_llego: d.como,
      cliente_desde: d.desde,
      limite_credito: d.limite,
    });
  } else {
    await clientesService.actualizarCliente(id, { tipo_cliente_id: tipoId, ciudad: d.ciudad, estado: d.estado, como_llego: d.como });
  }
  if (d.cuenta && DIRECCIONES[d.cuenta]) {
    const dir = await direccionesModel.crear(id, {
      tipo: 'envio',
      nombre_receptor: d.nombre,
      numero_int: null,
      pais: 'México',
      telefono: d.tel,
      referencias: null,
      es_predeterminada: true,
      ...DIRECCIONES[d.cuenta],
    });
    c.direccionId = dir.id;
  }
  c.id = id;
  c.tipoId = tipoId;
  contar('clientes');
}

async function sembrarConfiguracion() {
  if (ctx.sucursalInactiva) {
    await q('UPDATE almacenes SET activo = 1 WHERE id = :id', { id: ctx.almacenes.sucursal });
    await guardarEstado('almacen_reactivado', ctx.almacenes.sucursal);
  }
  const previa = {};
  for (const clave of Object.keys(CONFIGURACION)) {
    const r = await uno('SELECT valor FROM configuracion WHERE clave = :c', { c: clave });
    if (r) previa[clave] = r.valor;
  }
  await guardarEstado('configuracion_previa', previa);
  const existentes = Object.fromEntries(Object.entries(CONFIGURACION).filter(([k]) => k in previa));
  await configuracionModel.guardar(existentes);
}

// ---------------------------------------------------------------------------
// Bodega: remesas, traspasos, desarmes, ajustes.
// ---------------------------------------------------------------------------
let contadorBulto = 0;
function armarBultos(def, n) {
  const lotes = Array.from({ length: prob(0.4) ? 2 : 1 }, () => String(entero(100000, 999999)).padStart(7, '0'));
  return Array.from({ length: n }, () => {
    const bajo = prob(0.03);
    const peso = bajo
      ? azar(10.75, 13.2)
      : Math.min(def.peso + 2.2, Math.max(def.peso - 2.5, normal(def.peso, 0.85)));
    contadorBulto++;
    return {
      codigo: `${PREFIJO_BULTO}${String(contadorBulto).padStart(4, '0')}`,
      peso_kg: Math.round(peso * 100) / 100,
      lote: elegir(lotes),
      // Así viene de fábrica: el bulto chico rinde menos conos.
      conos: peso < 13.5 ? 7 : def.conos,
    };
  });
}

async function remesa(h, k) {
  const w = h.def.demanda;
  const n = k === 0 ? 20 + Math.round(w * 4) : k === 1 ? 10 + Math.round(w * 4) : 8 + Math.round(w * 3);
  const ultimo = h.def.costos[h.def.costos.length - 1];
  const costo = k < h.def.costos.length ? h.def.costos[k] : ultimo == null ? null : ultimo + k - h.def.costos.length + 1;
  const r = await remesasService.confirmar(
    {
      producto_id: h.productoId,
      almacen_id: ctx.almacenes.matriz,
      archivo: `${h.def.nombre} ${h.def.calibre.replace('/', '-')}.xlsx`,
      costo_kg: costo,
      bultos: armarBultos(h.def, n),
    },
    ctx.U.almacenista
  );
  await anotar('remesas', r?.id);
  contar('remesas');
  contar('bultos', n);
}

async function traspaso(tk, items, { notas, enviarEn, recibirEn, recibido, cancelarEn, motivo } = {}) {
  const t = ctx.tiendas[tk];
  if (!items.length) return;
  const tr = await inventarioService.solicitarTraspaso(
    { almacen_origen_id: ctx.almacenes.matriz, almacen_destino_id: t.almacen, notas, items },
    t.cajero
  );
  await anotar('traspasos', tr.id);
  contar('traspasos');
  if (cancelarEn) {
    programar(cancelarEn[0], cancelarEn[1], 'cancelar traspaso', () =>
      inventarioService.cancelarTraspaso(tr.id, ctx.U.almacenista, motivo));
    return;
  }
  if (!enviarEn) return;
  programar(enviarEn[0], enviarEn[1], 'enviar traspaso', async () => {
    await inventarioService.enviarTraspaso(tr.id, ctx.U.almacenista);
    if (!recibirEn) return;
    programar(recibirEn[0], recibirEn[1], 'recibir traspaso', async () => {
      let datos = {};
      if (recibido) {
        const det = await q('SELECT id, cantidad FROM traspaso_detalle WHERE traspaso_id = :id ORDER BY id', { id: tr.id });
        datos = {
          notas: recibido.notas,
          recibido: [{ detalle_id: det[0].id, cantidad: r3(Math.max(0, Number(det[0].cantidad) - recibido.faltaKg)) }],
        };
      }
      await inventarioService.recibirTraspaso(tr.id, t.cajero, datos);
    });
  });
}

/** Lo que una sucursal pide a la matriz para volver a su nivel. */
async function pedidoDeReposicion(tk, { umbral = 0.6, soloTop = 0 } = {}) {
  const items = [];
  let lista = ctx.hilos.filter((h) => objetivo(tk, h) > 0 && demandaVigente(h) > 0);
  if (soloTop) lista = [...lista].sort((a, b) => b.def.demanda - a.def.demanda).slice(0, soloTop);
  for (const h of lista) {
    const meta = objetivo(tk, h);
    const hay = await existencia(h.paqueteId, ctx.tiendas[tk].almacen);
    if (!soloTop && hay >= meta * umbral) continue;
    const enMatriz = await disponibleEn(h.paqueteId, ctx.almacenes.matriz);
    let pedir = Math.ceil((meta - hay) / 10) * 10;
    if (soloTop) pedir = Math.max(pedir, a10(meta * 0.4));
    pedir = Math.min(pedir, Math.floor(enMatriz / 10) * 10);
    if (pedir >= 20) items.push({ variante_id: h.paqueteId, cantidad: pedir });
  }
  return items;
}

async function desarmarUno(t, h) {
  const hay = await existencia(h.paqueteId, t.almacen);
  // El primero que se baja define cuántos conos dice la presentación: se
  // elige un bulto normal, no uno de los chicos que rinden menos.
  const extra = h.conoId ? '' : `AND conos = ${Number(h.def.conos)}`;
  const [b] = (await bultosDisponibles(h.paqueteId, t.almacen, 6, extra)).filter((x) => Number(x.peso_kg) <= hay);
  if (!b) return false;
  await inventarioService.desarmar(
    {
      codigo_bulto: b.codigo,
      almacen_origen_id: t.almacen,
      almacen_destino_id: t.almacen,
      destare_kg: r3(Number(b.conos) * azar(0.028, 0.042)),
      motivo: 'Bajar conos a mostrador',
    },
    t.cajero
  );
  contar('desarmes');
  if (!h.conoId) {
    const cono = await uno(
      "SELECT id FROM producto_variantes WHERE origen_variante_id = :p AND tipo_presentacion = 'cono' LIMIT 1",
      { p: h.paqueteId }
    );
    h.conoId = cono.id;
    await fijarPreciosPorTipo(h.conoId, h.def.precio);
  }
  return true;
}

async function asegurarConos(t, h, kg) {
  for (let k = 0; k < 3; k++) {
    if (h.conoId && (await existencia(h.conoId, t.almacen)) >= kg) return true;
    if (!(await desarmarUno(t, h))) return false;
  }
  return h.conoId ? (await existencia(h.conoId, t.almacen)) >= kg : false;
}

async function configurarMinimos() {
  for (const h of ctx.hilos) {
    for (const tk of ['hgo', 'gto']) {
      const meta = objetivo(tk, h);
      if (!meta) continue;
      const t = ctx.tiendas[tk];
      await inventarioService.configurar({ variante_id: h.paqueteId, almacen_id: t.almacen, stock_minimo: a10(meta * 0.35) });
      if (h.conoId && h.def.demanda >= 3) {
        await inventarioService.configurar({ variante_id: h.conoId, almacen_id: t.almacen, stock_minimo: 8 });
      }
    }
    if (h.def.demanda >= 5) {
      await inventarioService.configurar({ variante_id: h.paqueteId, almacen_id: ctx.almacenes.matriz, stock_minimo: 150 });
    }
  }
}

async function ajusteConteo(h, almacenId, variante, delta, motivo) {
  const hay = await existencia(variante, almacenId);
  if (hay + delta < 0) return;
  await inventarioService.registrarMovimiento(
    { variante_id: variante, almacen_id: almacenId, tipo: 'ajuste', cantidad: r3(hay + delta), motivo },
    ctx.U.almacenista
  );
  contar('ajustes');
}
async function merma(t, h, kg, motivo) {
  if (!h.conoId || (await existencia(h.conoId, t.almacen)) < kg) return;
  await inventarioService.registrarMovimiento(
    { variante_id: h.conoId, almacen_id: t.almacen, tipo: 'merma', cantidad: kg, motivo },
    t.cajero
  );
  contar('mermas');
}

// ---------------------------------------------------------------------------
// Mostrador.
// ---------------------------------------------------------------------------
async function abrirTurno(t) {
  const [r] = await pool.query(
    'INSERT INTO sesiones_caja (caja_id, usuario_id, monto_inicial) VALUES (:c, :u, :m)',
    { c: t.caja, u: t.cajero, m: elegir([500, 500, 500, 1000]) }
  );
  t.sesion = r.insertId;
  await anotar('sesiones_caja', t.sesion);
  contar('turnos');
}

async function cerrarTurno(t) {
  if (!t.sesion) return;
  const s = await cajaModel.obtenerSesion(t.sesion);
  const esperado = Number(s.esperado_actual);
  // Casi siempre cuadra; de vez en cuando falta o sobra algo, como en la vida.
  const dif = prob(0.08) ? -entero(1, 8) * 10 : prob(0.04) ? entero(1, 6) * 5 : 0;
  await cajaModel.cerrarSesion(t.sesion, r2(Math.max(0, esperado + dif)));
  t.sesion = null;
}

async function retiroSiHaceFalta(t) {
  if (!t.sesion) return;
  const s = await cajaModel.obtenerSesion(t.sesion);
  const esperado = Number(s.esperado_actual);
  if (esperado < 7000) return;
  await cajaModel.registrarMovimientoManual(t.sesion, {
    tipo: 'retiro',
    monto: Math.floor((esperado - 2000) / 1000) * 1000,
    motivo: 'Depósito al banco',
  });
  contar('retiros');
}

function elegirHilo(cliente) {
  if (cliente?.def.gustos?.length && prob(0.65)) {
    const h = ctx.hilos[elegir(cliente.def.gustos)];
    if (demandaVigente(h) > 0) return h;
  }
  return ponderado(ctx.hilos, demandaVigente);
}

const KG_CONO = { paso: [0.4, 3.5], publico: [0.8, 6], medio: [4, 14], mayoreo: [8, 20] };
const PROB_CONO = { paso: 0.88, publico: 0.8, medio: 0.45, mayoreo: 0.1 };
const PAQUETES = { paso: [1, 1], publico: [1, 1], medio: [1, 3], mayoreo: [1, 4] };
const LINEAS = { paso: [1, 2], publico: [1, 3], medio: [1, 3], mayoreo: [1, 3] };

async function armarLinea(t, h, perfil, bultosUsados) {
  if (prob(PROB_CONO[perfil])) {
    const kg = aBascula(azar(...KG_CONO[perfil]));
    if (await asegurarConos(t, h, kg)) return { variante_id: h.conoId, cantidad: kg };
  }
  const n = entero(...PAQUETES[perfil]);
  let disponible = await existencia(h.paqueteId, t.almacen);
  const candidatos = (await bultosDisponibles(h.paqueteId, t.almacen, n + 8))
    .filter((b) => !bultosUsados.has(b.codigo))
    // Quien despacha toma los que tiene a mano, no siempre el más viejo.
    .sort(() => rnd() - 0.5);
  const elegidos = [];
  for (const b of candidatos) {
    if (elegidos.length >= n) break;
    if (Number(b.peso_kg) > disponible + 0.0001) continue;
    elegidos.push(b);
    disponible -= Number(b.peso_kg);
  }
  if (!elegidos.length) return null;
  elegidos.forEach((b) => bultosUsados.add(b.codigo));
  return {
    variante_id: h.paqueteId,
    cantidad: r3(elegidos.reduce((s, b) => s + Number(b.peso_kg), 0)),
    bultos: elegidos.map((b) => ({ codigo: b.codigo, peso_kg: Number(b.peso_kg), lote: b.lote })),
  };
}

function repartirPago(monto, perfil) {
  const ref = () => String(entero(100000, 999999));
  if (prob(0.06) && monto > 400) {
    const efectivo = Math.min(monto - 1, Math.round((monto * 0.4) / 100) * 100 || 100);
    return [
      { metodo_pago_id: ctx.M.efectivo, monto: r2(efectivo) },
      { metodo_pago_id: ctx.M.tarjeta, monto: r2(monto - efectivo), referencia_transaccion: `AUT ${ref()}` },
    ];
  }
  const pEfectivo = { paso: 0.75, publico: 0.65, medio: 0.45, mayoreo: 0.3 }[perfil];
  const pTarjeta = { paso: 0.2, publico: 0.22, medio: 0.2, mayoreo: 0.15 }[perfil];
  const r = rnd();
  if (r < pEfectivo) return [{ metodo_pago_id: ctx.M.efectivo, monto: r2(monto) }];
  if (r < pEfectivo + pTarjeta) {
    return [{ metodo_pago_id: ctx.M.tarjeta, monto: r2(monto), referencia_transaccion: `AUT ${ref()}` }];
  }
  return [{ metodo_pago_id: ctx.M.transferencia, monto: r2(monto), referencia_transaccion: `SPEI ${ref()}${ref()}` }];
}

async function venta(tk, cliente = null, { forzarCredito = false } = {}) {
  const t = ctx.tiendas[tk];
  if (!t.sesion) return;
  const perfil = cliente ? cliente.def.tipo : 'paso';
  const n = entero(...LINEAS[perfil]);
  const items = [];
  const usados = new Set();
  const bultosUsados = new Set();
  for (let k = 0; k < n * 3 && items.length < n; k++) {
    const h = elegirHilo(cliente);
    if (!h || usados.has(h.i)) continue;
    usados.add(h.i);
    const linea = await armarLinea(t, h, perfil, bultosUsados);
    if (linea) items.push(linea);
  }
  if (!items.length) {
    contar('ventas_sin_existencia');
    return;
  }

  const datos = { canal: 'punto_venta', sesion_caja_id: t.sesion, items };
  if (cliente) {
    datos.cliente_id = cliente.id;
    datos.tipo_cliente_id = cliente.tipoId;
  }
  const total = Number((await pedidosService.cotizar(datos, {})).total);

  // ¿Se lo lleva fiado? Solo a quien tiene crédito y sin pasarse del límite.
  let aCredito = 0;
  const d = cliente?.def;
  if (d && d.limite > 0 && d.credito) {
    const p = forzarCredito ? 1 : d.credito === 'moroso' ? 0.8 : d.tipo === 'mayoreo' ? 0.55 : 0.4;
    if (prob(p)) {
      const saldo = Number(await clientesModel.saldo(cliente.id));
      const libre = r2(d.limite - saldo);
      if (libre >= total * 0.3) {
        aCredito = prob(0.7) && libre >= total ? total : r2(Math.min(libre, total * azar(0.5, 0.75)));
      }
    }
  }
  const resto = r2(total - aCredito);
  if (aCredito > 0) datos.a_credito = aCredito;
  if (resto > 0) datos.pagos = repartirPago(resto, perfil);

  const pedido = await pedidosService.crear(datos, t.cajero, {});
  await anotar('pedidos', pedido.id);
  contar('ventas_mostrador');
  if (aCredito > 0) {
    contar('ventas_a_credito');
    planearCobro(cliente, aCredito);
  }

  // Unas pocas se cancelan o se devuelven el mismo día, con el turno abierto.
  // Siempre ANTES del corte: con el turno cerrado, el sistema sacaría el
  // efectivo del otro turno abierto de esa caja, que puede ser uno real.
  if (prob(0.02) && ctx.min < 1100) {
    enCola(ctx.min + entero(4, 25), 'cancelar venta', async () => {
      await pedidosService.cambiarEstado(pedido.id, 'cancelado', t.cajero);
      contar('ventas_canceladas');
    });
  } else if (prob(0.01) && ctx.min < 17 * 60) {
    enCola(ctx.min + entero(30, 90), 'devolver venta', async () => {
      await pedidosService.cambiarEstado(pedido.id, 'devuelto', ctx.U.gerente);
      contar('ventas_devueltas');
    });
  }
}

// ---------------------------------------------------------------------------
// Crédito: cómo paga cada quien lo que se le fía.
// ---------------------------------------------------------------------------
function planearCobro(c, monto) {
  const d = c.def;
  if (d.credito === 'puntual') {
    const f = siguienteHabil(sumarDias(ctx.fecha, entero(7, 14)));
    programar(f, entero(600, 1080), 'abono puntual', () => abonar(c, monto));
  } else if (d.credito === 'lento' && !c.proximoAbono) {
    c.proximoAbono = sumarDias(ctx.fecha, entero(14, 21));
  } else if (d.credito === 'moroso' && !c.abonoUnico && sumarDias(ctx.fecha, 10) < sumarDias(d.hasta, -5)) {
    c.abonoUnico = true;
    const f = siguienteHabil(sumarDias(ctx.fecha, 10));
    programar(f, entero(600, 1080), 'abono moroso', () => abonar(c, Math.round((monto * 0.3) / 100) * 100));
  }
}

async function abonar(c, deseado) {
  const saldo = Number(await clientesModel.saldo(c.id));
  if (saldo <= 0.009) return;
  const monto = r2(Math.min(Math.max(deseado, 100), saldo));
  const t = ctx.tiendas[c.def.tienda];
  const yaNoViene = c.def.hasta && ctx.fecha > c.def.hasta;
  const efectivo = !!t.sesion && !yaNoViene && prob(0.55);
  await clientesService.registrarAbono(
    c.id,
    {
      monto,
      metodo_pago_id: efectivo ? ctx.M.efectivo : ctx.M.transferencia,
      sesion_caja_id: efectivo ? t.sesion : undefined,
      referencia: efectivo ? null : `SPEI ${entero(1000000, 9999999)}`,
    },
    efectivo ? t.cajero : ctx.U.gerente
  );
  contar('abonos');
}

async function abonosLentos() {
  for (const c of ctx.clientes) {
    if (c.def.credito !== 'lento' || !c.id || !c.proximoAbono || ctx.fecha < c.proximoAbono) continue;
    const saldo = Number(await clientesModel.saldo(c.id));
    c.proximoAbono = sumarDias(ctx.fecha, entero(12, 20));
    if (saldo < 100) continue;
    programar(ctx.fecha, entero(620, 1060), 'abono lento', () =>
      abonar(c, Math.round((saldo * azar(0.25, 0.5)) / 100) * 100));
  }
}

// ---------------------------------------------------------------------------
// Apartados, con su guion de catalogo.js.
// ---------------------------------------------------------------------------
function planearApartados() {
  for (const [clave, a] of Object.entries(APARTADOS)) {
    const c = ctx.clientes.find((x) => x.def.apartado === clave);
    if (!c) continue;
    const [f, h] = a.fecha.split(' ');
    programar(f, aMin(h), `apartado ${clave}`, () => apartar(c, a));
  }
}

async function apartar(c, a) {
  const t = ctx.tiendas[c.def.tienda];
  if (!t.sesion) return;
  const items = [];
  for (const [hi, kg] of a.lineas) {
    const h = ctx.hilos[hi];
    if (await asegurarConos(t, h, kg)) items.push({ variante_id: h.conoId, cantidad: kg });
  }
  if (!items.length) return;
  const base = { canal: 'punto_venta', sesion_caja_id: t.sesion, cliente_id: c.id, tipo_cliente_id: c.tipoId, items };
  const total = Number((await pedidosService.cotizar(base, {})).total);
  const anticipo = Math.min(total, a10(total * a.anticipo));
  const pedido = await pedidosService.crear(
    { ...base, apartado: true, pagos: [{ metodo_pago_id: ctx.M.efectivo, monto: anticipo }] },
    t.cajero,
    {}
  );
  await anotar('pedidos', pedido.id);
  contar('apartados');
  let abonado = anticipo;

  a.abonos.forEach(([cuando, frac], idx) => {
    const [f, h] = cuando.split(' ');
    const ultimo = idx === a.abonos.length - 1 && ['entregado', 'listo'].includes(a.fin);
    programar(f, aMin(h), 'abono a apartado', async () => {
      const monto = ultimo ? r2(total - abonado) : Math.min(r2(total - abonado), a10(total * frac));
      if (monto <= 0) return;
      const tt = ctx.tiendas[c.def.tienda];
      const efectivo = !!tt.sesion && prob(0.7);
      await pedidosService.abonarApartado(
        pedido.id,
        {
          monto,
          metodo_pago_id: efectivo ? ctx.M.efectivo : ctx.M.transferencia,
          sesion_caja_id: efectivo ? tt.sesion : undefined,
          referencia: efectivo ? undefined : `SPEI ${entero(1000000, 9999999)}`,
        },
        tt.cajero
      );
      abonado = r2(abonado + monto);
      contar('abonos_apartado');
    });
  });

  if (a.fin === 'entregado' || a.fin === 'cancelado') {
    const [f, h] = a.finFecha.split(' ');
    programar(f, aMin(h), `apartado ${a.fin}`, async () => {
      const tt = ctx.tiendas[c.def.tienda];
      if (a.fin === 'cancelado') {
        await pedidosService.cambiarEstado(pedido.id, 'cancelado', ctx.U.gerente);
        contar('apartados_cancelados');
        return;
      }
      for (const [hi, kg] of a.lineas) await asegurarConos(tt, ctx.hilos[hi], kg);
      await pedidosService.entregarApartado(pedido.id, tt.cajero);
      contar('apartados_entregados');
    });
  }
}

// ---------------------------------------------------------------------------
// Tienda en línea.
// ---------------------------------------------------------------------------
async function pedidoEnLinea(c) {
  const almacen = ctx.almacenes.tienda;
  const items = [];
  const usados = new Set();
  const n = entero(1, 3);
  for (let k = 0; k < n * 3 && items.length < n; k++) {
    const h = elegirHilo(c);
    if (!h || usados.has(h.i)) continue;
    usados.add(h.i);
    if (h.conoId && prob(0.85)) {
      const kg = Math.round(azar(1, 5) * 2) / 2;
      if ((await existencia(h.conoId, almacen)) >= kg) items.push({ variante_id: h.conoId, cantidad: kg });
    } else {
      const v = await uno('SELECT peso_kg FROM producto_variantes WHERE id = :id', { id: h.paqueteId });
      const kg = r3(Number(v.peso_kg));
      if ((await existencia(h.paqueteId, almacen)) >= kg) items.push({ variante_id: h.paqueteId, cantidad: kg });
    }
  }
  if (!items.length) return;

  const envio = !!c.direccionId && prob(0.6);
  const transferencia = envio || prob(0.8);
  const datos = {
    canal: 'tienda_linea',
    cliente_id: c.id,
    metodo_entrega: envio ? 'envio' : 'recoger',
    metodo_pago_id: transferencia ? ctx.M.transferencia : ctx.M.efectivo,
    items,
  };
  if (envio) datos.direccion_envio_id = c.direccionId;
  const sub = Number((await pedidosService.cotizar(datos, { esCliente: true })).subtotal);
  if (!c.compro && sub >= 500) datos.cupon_codigo = 'BIENVENIDA10';
  else if (ctx.fecha >= '2026-08-01' && sub >= 3000 && prob(0.5)) datos.cupon_codigo = 'HILO200';

  const p = await pedidosService.crear(datos, null, { esCliente: true });
  await anotar('pedidos', p.id);
  c.compro = true;
  contar('pedidos_en_linea');

  const g = ctx.U.gerente;
  const dia = (n) => siguienteHabil(sumarDias(ctx.fecha, n));
  if (!transferencia) {
    // Efectivo al recoger: si en unos días no pasó, se cancela.
    programar(dia(5), entero(600, 1000), 'cancelar pedido en línea', () =>
      pedidosService.cambiarEstado(p.id, 'cancelado', g));
    return;
  }
  if (prob(0.06)) {
    programar(dia(3), entero(600, 1000), 'cancelar pedido en línea', () =>
      pedidosService.cambiarEstado(p.id, 'cancelado', g));
    return;
  }
  const fPago = dia(ctx.min > 17 * 60 ? 1 : entero(0, 1));
  const mPago = fPago === ctx.fecha ? Math.max(ctx.min + 40, 600) : entero(600, 840);
  programar(fPago, Math.min(mPago, 1100), 'comprobante', async () => {
    const pdf = comprobantePdf({
      fecha: `${ctx.fecha} ${hm(ctx.min - entero(20, 90)).slice(0, 5)}`,
      monto: p.total,
      ordenante: c.def.nombre,
      concepto: `Pedido ${p.numero_pedido}`,
      rastreo: `DEMO${entero(10000000, 99999999)}${entero(1000, 9999)}`,
      banco: CONFIGURACION.transferencia_banco,
      clabe: CONFIGURACION.transferencia_clabe,
      titular: CONFIGURACION.transferencia_titular,
    });
    await pedidosService.guardarComprobante(p.id, pdf, `comprobante-${p.numero_pedido}.pdf`, g);
    contar('comprobantes');
    enCola(ctx.min + entero(60, 180), 'preparar pedido', () => pedidosService.cambiarEstado(p.id, 'en_preparacion', g));
    if (envio) {
      programar(dia(1), entero(720, 960), 'enviar pedido', () => pedidosService.cambiarEstado(p.id, 'enviado', g));
      programar(dia(entero(3, 4)), entero(660, 1080), 'entregar pedido', () =>
        pedidosService.cambiarEstado(p.id, 'entregado', g));
    } else {
      programar(dia(entero(1, 3)), entero(600, 1080), 'entregar pedido', () =>
        pedidosService.cambiarEstado(p.id, 'entregado', g));
    }
  });
}

// ---------------------------------------------------------------------------
// Nómina de los sábados.
// ---------------------------------------------------------------------------
async function nominaDeLaSemana(sabado, { pagar = true } = {}) {
  const domingo = sumarDias(sabado, -diaSemana(sabado));
  const existente = await uno(
    "SELECT id, estado FROM nomina_periodos WHERE fecha_inicio = :f",
    { f: domingo }
  );
  if (existente) {
    // Un periodo que ya existía es del negocio real: se recalcula (si se
    // puede) para que refleje la semana, y la limpieza lo vuelve a calcular.
    if (existente.estado === 'borrador') {
      await nominaService.calcular(existente.id);
      const lista = (await leerEstado('nomina_recalcular')) ?? [];
      if (!lista.includes(existente.id)) await guardarEstado('nomina_recalcular', [...lista, existente.id]);
    }
    return;
  }
  const p = await nominaService.crearPeriodo(sabado, null, ctx.U.admin);
  await anotar('nomina_periodos', p.id);
  const calculado = await nominaService.calcular(p.id);
  for (const r of calculado.recibos ?? []) {
    const esCajero = [ctx.tiendas.hgo.cajero, ctx.tiendas.gto.cajero].includes(r.usuario_id);
    if (esCajero && prob(0.35)) {
      await nominaService.agregarConcepto(r.id, {
        clave: 'horas_extra',
        cantidad: entero(2, 5),
        descripcion: elegir(['Inventario del sábado', 'Cierre tarde', 'Descarga de remesa']),
      }).catch((e) => fallo('horas extra', e));
    } else if (r.usuario_id === ctx.U.almacenista && prob(0.3)) {
      await nominaService.agregarConcepto(r.id, { clave: 'horas_extra', cantidad: entero(2, 4), descripcion: 'Descarga de remesa' })
        .catch((e) => fallo('horas extra', e));
    }
    if (esCajero && prob(0.06)) {
      await nominaService.agregarConcepto(r.id, {
        clave: 'falta',
        importe: r2(Number(r.sueldo_base) / 6),
        descripcion: 'Falta sin aviso',
      }).catch((e) => fallo('falta', e));
    }
  }
  contar('nominas');
  if (pagar) {
    await nominaService.cambiarEstado(p.id, 'pagado');
    contar('nominas_pagadas');
  }
}

// ---------------------------------------------------------------------------
// El día de mostrador.
// ---------------------------------------------------------------------------
const LLEGADAS_PASO = { hgo: 0.9, gto: 0.65 };
const FACTOR_VISITA = 0.5;

function planearDia(fecha) {
  const dow = diaSemana(fecha);
  const esUltimo = fecha === FIN;
  // El último día es el que se enseña ("ventas de hoy"): se le da más
  // movimiento y todo cae antes de la hora límite, para que no salga vacío.
  const factor = (dow === 6 ? 1.35 : dow === 1 ? 0.85 : 1) * (0.85 + 0.3 * progreso(fecha)) * (esUltimo ? 2.2 : 1);
  const hastaMin = esUltimo ? Math.max(570, Math.min(1120, LIMITE_FIN - 5)) : 1120;
  const horaVenta = () => entero(560, hastaMin);

  // Tienda en línea: se pide cualquier día, a cualquier hora.
  const enLinea = ctx.clientes.filter((c) => c.id && c.def.cuenta && (!c.def.alta || c.def.alta < fecha));
  const pedidosWeb = Math.max(fecha >= sumarDias(FIN, -1) ? 1 : 0, poisson(0.33 * factor));
  for (let k = pedidosWeb; k > 0 && enLinea.length; k--) {
    const c = elegir(enLinea);
    programar(fecha, entero(480, esUltimo ? Math.max(490, LIMITE_FIN - 5) : 1380), 'pedido en línea', () => pedidoEnLinea(c));
  }

  if (!habil(fecha)) return;

  for (const tk of ['hgo', 'gto']) {
    const t = ctx.tiendas[tk];
    programar(fecha, 530, 'abrir turno', () => abrirTurno(t));
    programar(fecha, 535, 'bajar conos', async () => {
      for (const h of ctx.hilos) {
        if (!h.conoId || demandaVigente(h) < 1 || !objetivo(tk, h)) continue;
        if ((await disponibleEn(h.conoId, t.almacen)) < (tk === 'hgo' ? 10 : 8)) await desarmarUno(t, h);
      }
    });
    for (let k = poisson(LLEGADAS_PASO[tk] * factor); k > 0; k--) {
      programar(fecha, horaVenta(), 'venta de paso', () => venta(tk));
    }
    programar(fecha, 840, 'retiro', () => retiroSiHaceFalta(t));
    // El último día la caja de la Tienda principal hace su corte; la de
    // Moroleón queda ABIERTA para poder vender en vivo durante la muestra.
    if (!(esUltimo && tk === 'gto' && FIN === HOY_MX)) {
      programar(fecha, 1140, 'cerrar turno', () => cerrarTurno(t), { siempre: true });
    }
  }

  for (const c of ctx.clientes) {
    const d = c.def;
    if (d.alta && fecha < d.alta) continue;
    if (d.hasta && fecha > d.hasta) continue;
    if (d.alta === fecha) {
      // Cliente nuevo: se le da de alta en la caja, en su primera compra.
      programar(fecha, horaVenta(), 'alta en caja', async () => {
        await crearCliente(c, { rapido: !d.cuenta });
        await venta(d.tienda, c);
      });
      continue;
    }
    if (!c.id) continue;
    if (d.credito === 'moroso' && fecha === d.hasta) {
      // Su última visita: se lleva fiado y ya no regresa. Así su deuda tiene
      // la antigüedad que le toca en la cobranza.
      programar(fecha, horaVenta(), 'última compra fiada', () => venta(d.tienda, c, { forzarCredito: true }));
      continue;
    }
    if (prob((d.freq * FACTOR_VISITA * factor) / 6)) {
      programar(fecha, horaVenta(), 'venta a cliente', () => venta(d.tienda, c));
    }
  }
  programar(fecha, 600, 'abonos lentos', abonosLentos);

  if (dow === 1) {
    // Lunes: cada sucursal pide lo que le falta y la matriz lo surte.
    programar(fecha, 545, 'reposición hgo', async () => {
      await traspaso('hgo', await pedidoDeReposicion('hgo'), {
        notas: 'Reposición semanal',
        enviarEn: [fecha, 690],
        recibirEn: [fecha, 945],
      });
    });
    programar(fecha, 550, 'reposición gto', async () => {
      const conFaltante = fecha === '2026-08-17';
      await traspaso('gto', await pedidoDeReposicion('gto'), {
        notas: 'Reposición semanal',
        enviarEn: [fecha, 700],
        recibirEn: [siguienteHabil(sumarDias(fecha, 1)), 520],
        recibido: conFaltante ? { faltaKg: 19.4, notas: 'Llegó un paquete menos de lo que dice la guía' } : null,
      });
    });
  }

  if (dow === 6) programar(fecha, 1170, 'nómina', () => nominaDeLaSemana(fecha));
}

// Lo que solo pasa una vez: conteos, mermas y los traspasos que dejan
// pendientes en la campana al final.
function planearEventosFijos() {
  const H = (nombre, calibre) => ctx.hilos.find((h) => h.def.nombre === nombre && h.def.calibre === calibre);
  const M = ctx.almacenes.matriz;
  programar('2026-07-29', 800, 'merma', () => merma(ctx.tiendas.hgo, H('CAFE CHOCOLATE', '1/30'), 0.8, 'Conos manchados por humedad'));
  programar('2026-08-01', 1090, 'conteo', async () => {
    await ajusteConteo(H('GRIS OXFORD', '1/30'), M, H('GRIS OXFORD', '1/30').paqueteId, -1.85, 'Conteo físico de fin de mes');
    await ajusteConteo(H('CAFE CHOCOLATE', '1/30'), M, H('CAFE CHOCOLATE', '1/30').paqueteId, 0.62, 'Conteo físico de fin de mes');
  });
  programar('2026-09-01', 1090, 'conteo', async () => {
    const rojo = H('ROJO', '1/30');
    await ajusteConteo(rojo, M, rojo.paqueteId, -2.4, 'Conteo físico de fin de mes');
    const vino = H('VINO', '2/30');
    if (vino.conoId) await ajusteConteo(vino, ctx.tiendas.hgo.almacen, vino.conoId, -0.35, 'Conteo de mostrador');
  });
  programar('2026-09-18', 750, 'merma', () => merma(ctx.tiendas.gto, H('ROSA MEXICANO', '2/30'), 1.15, 'Cono dañado al bajarlo a mostrador'));

  // Una solicitud que se canceló porque ya había.
  programar('2026-09-09', 615, 'traspaso cancelado', async () => {
    await traspaso('gto', (await pedidoDeReposicion('gto', { soloTop: 2 })), {
      notas: 'Urgente para Tejidos JC',
      cancelarEn: ['2026-09-09', 760],
      motivo: 'Se pidió por error: sí había existencia en la sucursal',
    });
  });
  // Al final: uno en camino y uno pendiente de envío, para la campana.
  programar('2026-09-30', 560, 'traspaso en tránsito', async () => {
    await traspaso('gto', await pedidoDeReposicion('gto', { soloTop: 3 }), {
      notas: 'Pedido especial de mitad de semana',
      enviarEn: ['2026-09-30', 910],
    });
  });
  programar(FIN, Math.min(605, LIMITE_FIN - 5), 'traspaso solicitado', async () => {
    await traspaso('hgo', await pedidoDeReposicion('hgo', { soloTop: 3 }), { notas: 'Para el pedido de Doña Lupe' });
  }, { siempre: true });
}

function planearRemesas() {
  for (const h of ctx.hilos) {
    const w = h.def.demanda;
    if (w >= 3) programar(siguienteHabil(`2026-08-${pad(entero(10, 21))}`), entero(560, 720), 'remesa', () => remesa(h, 1));
    if (w >= 5) programar(siguienteHabil(`2026-09-${pad(entero(8, 19))}`), entero(560, 720), 'remesa', () => remesa(h, 2));
  }
}

// ---------------------------------------------------------------------------
// Día 1: catálogo, clientes, primeras remesas y surtido inicial.
// ---------------------------------------------------------------------------
function planearArranque() {
  const f = INICIO;
  programar(f, 470, 'catálogo', sembrarCatalogo);
  programar(f, 480, 'configuración', sembrarConfiguracion);
  programar(f, 490, 'clientes', async () => {
    for (const c of ctx.clientes) if (!c.def.alta) await crearCliente(c);
  });
  programar(f, 540, 'remesas iniciales', async () => {
    for (const h of ctx.hilos) await remesa(h, 0);
  });
  programar(f, 780, 'surtido inicial', async () => {
    for (const tk of ['hgo', 'gto']) {
      const items = [];
      for (const h of ctx.hilos) {
        const meta = objetivo(tk, h);
        if (meta) items.push({ variante_id: h.paqueteId, cantidad: meta });
      }
      await traspaso(tk, items, {
        notas: 'Surtido de apertura',
        enviarEn: [f, 840],
        recibirEn: tk === 'hgo' ? [f, 990] : [sumarDias(f, 1), 515],
      });
    }
  });
  programar(f, 1050, 'primeros conos hgo', async () => {
    for (const h of ctx.hilos) if (h.def.demanda >= 0.5) await desarmarUno(ctx.tiendas.hgo, h);
  });
  programar(sumarDias(f, 1), 525, 'primeros conos gto', async () => {
    for (const h of ctx.hilos) if (h.def.demanda >= 2) await desarmarUno(ctx.tiendas.gto, h);
    await configurarMinimos();
  });
}

// ---------------------------------------------------------------------------
// Principal.
// ---------------------------------------------------------------------------
async function prepararBitacora() {
  await q(`CREATE TABLE IF NOT EXISTS _demo_registros (
             tabla VARCHAR(64) NOT NULL, registro_id BIGINT UNSIGNED NOT NULL,
             PRIMARY KEY (tabla, registro_id)) ENGINE=InnoDB`);
  await q(`CREATE TABLE IF NOT EXISTS _demo_estado (
             clave VARCHAR(100) NOT NULL PRIMARY KEY, valor LONGTEXT NULL) ENGINE=InnoDB`);
  const [{ n }] = await q('SELECT COUNT(*) AS n FROM _demo_registros');
  return Number(n);
}

async function verificarQueSePuede() {
  for (const h of HILOS) {
    const ya = await uno('SELECT id FROM productos WHERE nombre = :n AND grosor_calibre = :c', { n: h.nombre, c: h.calibre });
    if (ya) throw new Error(`Ya existe el hilo "${h.nombre} ${h.calibre}" (id ${ya.id}); la muestra no lo pisa.`);
  }
  const [{ n }] = await q(`SELECT COUNT(*) AS n FROM variante_codigos WHERE codigo LIKE '${PREFIJO_BULTO}%'`);
  if (Number(n)) throw new Error(`Ya hay códigos de bulto que empiezan con ${PREFIJO_BULTO}.`);
  const abierta = await uno("SELECT id FROM sesiones_caja WHERE caja_id = :c AND estado = 'abierta'", { c: ctx.tiendas.gto.caja });
  if (abierta) throw new Error(`La caja de la sucursal tiene un turno abierto (sesión ${abierta.id}); ciérralo antes de sembrar.`);
}

async function sembrarHistoria() {
  ctx.clientes = CLIENTES.map((def, i) => ({ i, def }));
  planearArranque();
  planearApartados();
  // Las remesas y los eventos fijos necesitan los hilos ya creados.
  programar(INICIO, 1200, 'planear remesas y eventos', async () => {
    planearRemesas();
    planearEventosFijos();
  });
  for (let f = INICIO; f <= FIN; f = sumarDias(f, 1)) {
    if (f > INICIO) planearDia(f);
    await correrDia(f);
    if (f.endsWith('01') || f.endsWith('15')) {
      process.stdout.write(`  · ${f}  ventas ${stats.ventas_mostrador ?? 0} · en línea ${stats.pedidos_en_linea ?? 0}\n`);
    }
  }
  // La semana en curso queda en borrador, como estaría hoy.
  if (diaSemana(FIN) !== 6) {
    reloj.fijar(`${FIN} ${hm(Math.max(540, LIMITE_FIN - 2))}`);
    await nominaDeLaSemana(FIN, { pagar: false }).catch((e) => fallo('nómina en curso', e));
  }
  await guardarEstado('hilos', ctx.hilos.map((h) => ({ i: h.i, productoId: h.productoId, paqueteId: h.paqueteId, conoId: h.conoId })));
  await guardarEstado('clientes', ctx.clientes.filter((c) => c.id).map((c) => ({ i: c.i, id: c.id, tipoId: c.tipoId, direccionId: c.direccionId ?? null })));
  await guardarEstado('tipos', ctx.tipos);
  await guardarEstado('sembrado', { desde: INICIO, hasta: FIN, en: new RealDate().toISOString() });
}

/** Un día más sobre una muestra ya sembrada. */
async function sembrarUnDia() {
  const hilos = await leerEstado('hilos');
  const clientes = await leerEstado('clientes');
  ctx.tipos = { ...ctx.tipos, ...(await leerEstado('tipos')) };
  ctx.hilos = hilos.map((x) => ({ ...x, def: HILOS[x.i] }));
  for (const h of ctx.hilos) {
    if (!h.conoId) {
      const cono = await uno("SELECT id FROM producto_variantes WHERE origen_variante_id = :p AND tipo_presentacion = 'cono' LIMIT 1", { p: h.paqueteId });
      h.conoId = cono?.id ?? null;
    }
  }
  const porIndice = new Map(clientes.map((c) => [c.i, c]));
  ctx.clientes = CLIENTES.map((def, i) => ({ i, def: { ...def, alta: def.alta && def.alta > FIN ? def.alta : undefined }, ...(porIndice.get(i) ?? {}) }))
    .filter((c) => c.id);
  // El turno que se dejó abierto se cierra en su día, a la hora de siempre.
  const abiertas = await q(
    `SELECT s.id, DATE_FORMAT(s.fecha_apertura, '%Y-%m-%d') AS dia FROM sesiones_caja s
       JOIN _demo_registros r ON r.tabla = 'sesiones_caja' AND r.registro_id = s.id
      WHERE s.estado = 'abierta'`
  );
  for (const s of abiertas) {
    reloj.fijar(`${s.dia} 19:00:00`);
    await cerrarTurno({ sesion: s.id });
  }
  // Los lentos abonan con cierta probabilidad.
  for (const c of ctx.clientes) if (c.def.credito === 'lento') c.proximoAbono = prob(0.35) ? FIN : null;
  planearDia(FIN);
  await correrDia(FIN);
}

async function main() {
  console.log(`\n  Muestra → base "${process.env.DB_NAME}" en ${process.env.DB_HOST}`);
  await cargarReferencias();
  const previos = await prepararBitacora();
  if (MODO_DIA) {
    if (!previos) throw new Error('No hay muestra sembrada: primero corre la siembra completa.');
    console.log(`  Agregando el día ${FIN} (hasta las ${hm(LIMITE_FIN).slice(0, 5)})\n`);
    await sembrarUnDia();
  } else {
    if (previos) throw new Error('Ya hay una muestra sembrada. Bórrala con limpiar.js antes de sembrar otra.');
    await verificarQueSePuede();
    console.log(`  Sembrando del ${INICIO} al ${FIN} (el último día hasta las ${hm(LIMITE_FIN).slice(0, 5)})\n`);
    await sembrarHistoria();
  }
  reloj.soltar();

  console.log('\n  Resumen');
  for (const [k, v] of Object.entries(stats).sort()) console.log(`    ${k.padEnd(24)} ${v}`);
  const nf = Object.entries(fallos);
  if (nf.length) {
    console.log('\n  Operaciones que el sistema rechazó (se omitieron):');
    for (const [k, v] of nf.sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)} × ${k}`);
  }
  console.log(inesperados ? `\n  ⚠ ${inesperados} error(es) inesperado(s), ver arriba.\n` : '\n  ✓ Listo.\n');
}

main()
  .catch((err) => {
    console.error(`\n  ✗ ${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
