'use strict';

/**
 * Prueba del comprobante de pago y del detalle enriquecido del pedido.
 *
 *   cd backend
 *   PORT=3222 node src/server.js &
 *   BASE=http://localhost:3222/api/v1 node scripts/e2e-comprobante-pago.js
 *
 * Lo que importa: que subir la captura deje el pedido pagado en un paso, que
 * solo se acepten imágenes y PDF DE VERDAD (no un .exe renombrado), que
 * reemplazarla no deje basura en disco, y que el detalle del pedido diga qué
 * hilo es —calibre y material— y de qué bultos salió.
 *
 * SE LIMPIA SOLO: prefijo TMPCM, y borra también los archivos que suba.
 */

const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// Se niega a correr contra la base del servidor. Ver el módulo.
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');
const env = require('../src/config/env');

const B = process.env.BASE ?? 'http://localhost:3222/api/v1';
const t = jwt.sign(
  { sub: 1, tipo: 'usuario', rol_id: 1, rol: 'administrador' },
  process.env.JWT_SECRET, { expiresIn: '1h' }
);

const api = async (me, r, b) => {
  const x = await fetch(B + r, {
    method: me,
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  return { status: x.status, ...(await x.json().catch(() => ({}))) };
};

/** Sube un archivo en crudo, como lo hace el navegador. */
const subir = async (ruta, buf, nombre) => {
  const x = await fetch(B + ruta, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + t,
      'Content-Type': 'application/octet-stream',
      'X-Nombre-Archivo': encodeURIComponent(nombre),
    },
    body: buf,
  });
  return { status: x.status, ...(await x.json().catch(() => ({}))) };
};

// Archivos mínimos pero VÁLIDOS: lo que se valida son los primeros bytes.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 3)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)]);
// Un ejecutable de Windows renombrado a .jpg: tiene que rebotar.
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0)]);

let f = 0;
const ck = (n, ok, d) => {
  console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + d : ''));
  if (!ok) f++;
};

(async () => {
  const db = await m.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const dirComprobantes = path.join(env.uploadsDir, 'comprobantes');
  const archivosAntes = new Set(
    fs.existsSync(dirComprobantes) ? fs.readdirSync(dirComprobantes) : []
  );
  const nuevosEnDisco = () =>
    (fs.existsSync(dirComprobantes) ? fs.readdirSync(dirComprobantes) : [])
      .filter((n) => !archivosAntes.has(n));

  const SUF = Date.now().toString(36);

  try {
    // ---------------------------------------------------------------- montaje
    const cat = (await api('GET', '/categorias')).data.items[0].id;
    const material = (await api('GET', '/categorias')).data.items[0].nombre;
    const kgu = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;
    const linea = (await api('GET', '/opciones/lineas')).data[0];

    const prod = (await api('POST', '/productos', {
      categoria_id: cat, unidad_medida_id: kgu, linea_id: linea.id,
      nombre: 'TMPCM Azul ' + SUF, grosor_calibre: '2/30',
      multipresentacion: true, por_lotes: true, precio_kg: 150,
    })).data.id;
    const variante = (await api('POST', '/variantes', {
      producto_id: prod, sku: 'TMPCM-' + SUF, presentacion: 'Paquete',
      tipo_presentacion: 'paquete', peso_kg: 19.094, precio: 150,
    })).data.id;

    const alm = (await api('GET', '/almacenes/tienda-linea')).data.id;
    await api('POST', '/inventario/movimientos', {
      variante_id: variante, almacen_id: alm, tipo: 'entrada',
      cantidad: 300, motivo: 'TMPCM alta de prueba',
    });

    // Dos bultos con su lote, para ver que el detalle los liste.
    const bultos = [
      { codigo: 'TMPCM-B1-' + SUF, peso_kg: 19.34, lote: 'L-778' },
      { codigo: 'TMPCM-B2-' + SUF, peso_kg: 18.02, lote: 'L-902' },
    ];
    for (const b of bultos) {
      await api('POST', `/variantes/${variante}/codigos`, {
        codigo: b.codigo, peso_kg: b.peso_kg, lote: b.lote, almacen_id: alm,
      });
    }

    const transferencia = (await api('GET', '/opciones/metodos-pago')).data
      .find((x) => x.nombre.toLowerCase().includes('transferencia')).id;

    // ------------------------------------------------- 1. El detalle del artículo
    console.log('\n1 · El artículo dice QUÉ hilo es');
    const venta = await api('POST', '/pedidos', {
      canal: 'tienda_linea', metodo_entrega: 'recoger',
      items: [{ variante_id: variante, cantidad: 37.36, bultos }],
    });
    ck('la venta pasa', venta.status === 201, venta.data?.numero_pedido);
    const pedidoId = venta.data.id;

    const det = (await api('GET', '/pedidos/' + pedidoId)).data.detalle[0];
    ck('trae el calibre', det.calibre === '2/30', det.calibre);
    ck('trae el material', det.material === material, det.material);
    ck('trae la línea', det.linea === linea.nombre, det.linea);
    ck('trae la presentación', det.tipo_presentacion === 'paquete', det.tipo_presentacion);
    ck('y sigue trayendo la descripción CONGELADA', !!det.descripcion, det.descripcion);

    console.log('\n2 · Y de qué bultos salió');
    ck('lista los dos bultos', det.bultos?.length === 2, det.bultos?.length);
    ck('con su código', det.bultos.map((b) => b.codigo).sort().join() ===
      bultos.map((b) => b.codigo).sort().join());
    ck('con su lote', det.bultos.map((b) => b.lote).sort().join() === 'L-778,L-902',
      det.bultos.map((b) => b.lote).join());
    ck('y con su peso real', det.bultos.some((b) => Number(b.peso_kg) === 19.34));

    // ------------------------------------------------------ 3. Subir la captura
    console.log('\n3 · La captura del comprobante');
    ck('el pedido nace pendiente', venta.data.estado === 'pendiente', venta.data.estado);

    const rechazado = await subir(`/pedidos/${pedidoId}/comprobante`, EXE, 'virus.jpg');
    ck('un ejecutable renombrado a .jpg se rechaza',
      rechazado.status === 422 && rechazado.error.code === 'ARCHIVO_INVALIDO',
      rechazado.error?.code);
    ck('y no se escribió nada en disco', nuevosEnDisco().length === 0);

    const subida = await subir(`/pedidos/${pedidoId}/comprobante`, PNG, 'captura banco.png');
    ck('la captura se sube', subida.status === 201, subida.status);
    ck('el pedido queda PAGADO en un paso', subida.data.estado === 'pagado', subida.data?.estado);

    const pago = subida.data.pagos.find((p) => p.tiene_comprobante);
    ck('el pago queda completado', pago.estado === 'completado', pago?.estado);
    ck('guarda el nombre que traía', pago.comprobante_nombre === 'captura banco.png',
      pago?.comprobante_nombre);
    ck('reconoce que es un PNG', pago.comprobante_tipo === 'image/png', pago?.comprobante_tipo);
    ck('deja constancia de quién la subió', !!pago.comprobante_subido_por,
      pago?.comprobante_subido_por);
    ck('NO expone el nombre del archivo en disco',
      pago.comprobante_archivo === undefined);

    // ------------------------------------------------------- 4. Ver el archivo
    console.log('\n4 · Verla y reemplazarla');
    const x = await fetch(`${B}/pedidos/${pedidoId}/comprobante`, {
      headers: { Authorization: 'Bearer ' + t },
    });
    const bajado = Buffer.from(await x.arrayBuffer());
    ck('se puede ver el archivo', x.status === 200, x.headers.get('content-type'));
    ck('y es el mismo que se subió', bajado.equals(PNG));

    const sinSesion = await fetch(`${B}/pedidos/${pedidoId}/comprobante`);
    ck('sin sesión NO se puede ver', sinSesion.status === 401, sinSesion.status);

    ck('hay 1 archivo en disco', nuevosEnDisco().length === 1, nuevosEnDisco().length);
    const reemplazo = await subir(`/pedidos/${pedidoId}/comprobante`, PDF, 'recibo.pdf');
    ck('se puede reemplazar por un PDF', reemplazo.status === 201);
    ck('sigue habiendo 1 archivo: el viejo se borró', nuevosEnDisco().length === 1,
      nuevosEnDisco().length);
    const pago2 = reemplazo.data.pagos.find((p) => p.tiene_comprobante);
    ck('y ahora dice que es un PDF', pago2.comprobante_tipo === 'application/pdf',
      pago2?.comprobante_tipo);

    // ------------------------------------------------ 5. Quitarla y los rechazos
    console.log('\n5 · Quitarla, y lo que no se permite');
    const quitado = await api('DELETE', `/pedidos/${pedidoId}/comprobante`);
    ck('se puede quitar', quitado.status === 200);
    ck('el archivo desaparece del disco', nuevosEnDisco().length === 0);
    ck('pero el pedido SIGUE pagado: quitar la captura no descobra',
      quitado.data.estado === 'pagado', quitado.data?.estado);

    const sinNada = await api('GET', `/pedidos/${pedidoId}/comprobante`);
    ck('pedir un comprobante que no está da 404',
      sinNada.status === 404 && sinNada.error.code === 'SIN_COMPROBANTE', sinNada.error?.code);

    // Un pedido cancelado no se marca pagado por subirle una captura.
    const otra = await api('POST', '/pedidos', {
      canal: 'tienda_linea', metodo_entrega: 'recoger', metodo_pago_id: transferencia,
      items: [{ variante_id: variante, cantidad: 5 }],
    });
    await api('PATCH', `/pedidos/${otra.data.id}/estado`, { estado: 'cancelado' });
    const enCancelado = await subir(`/pedidos/${otra.data.id}/comprobante`, JPG, 'x.jpg');
    ck('no se le sube captura a un pedido cancelado',
      enCancelado.status === 409 && enCancelado.error.code === 'PEDIDO_INACTIVO',
      enCancelado.error?.code);
    ck('y tampoco dejó archivo suelto', nuevosEnDisco().length === 0);

    const inexistente = await subir('/pedidos/99999999/comprobante', JPG, 'x.jpg');
    ck('un pedido que no existe da 404', inexistente.status === 404, inexistente.status);
    ck('sin dejar archivo huérfano', nuevosEnDisco().length === 0);

  } catch (e) {
    console.error('\nERROR:', e.message, e.stack);
    f++;
  } finally {
    console.log('\nLimpiando…');
    for (const n of nuevosEnDisco()) fs.rmSync(path.join(dirComprobantes, n), { force: true });

    // Se borra por el PREFIJO y no solo por la foto de ids: si una corrida
    // anterior murió a medias, su basura sigue ahí y la foto de esta corrida ya
    // la da por preexistente. Así la suite se puede volver a correr siempre.
    const [prodsRows] = await db.query("SELECT id FROM productos WHERE nombre LIKE 'TMPCM%'");
    const prods = prodsRows.map((r) => r.id);

    // Los pedidos que tocaron esos productos, sean de esta corrida o de una
    // anterior: mientras existan, sus líneas impiden borrar las variantes.
    let ped = [];
    if (prods.length) {
      const [pr] = await db.query(
        `SELECT DISTINCT p.id FROM pedidos p
           JOIN pedido_detalle d      ON d.pedido_id = p.id
           JOIN producto_variantes v  ON v.id = d.variante_id
          WHERE v.producto_id IN (?)`, [prods]);
      ped = pr.map((r) => r.id);
    }
    if (ped.length) {
      await db.query('DELETE FROM movimientos_inventario WHERE referencia_tipo="pedido" AND referencia_id IN (?)', [ped]);
      await db.query('DELETE FROM pedidos WHERE id IN (?)', [ped]);
    }
    if (prods.length) {
      const [vs] = await db.query('SELECT id FROM producto_variantes WHERE producto_id IN (?)', [prods]);
      const vids = vs.map((v) => v.id);
      if (vids.length) {
        for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) {
          await db.query('DELETE FROM ' + tb + ' WHERE variante_id IN (?)', [vids]);
        }
        await db.query('DELETE FROM producto_variantes WHERE id IN (?)', [vids]);
      }
      await db.query('DELETE FROM productos WHERE id IN (?)', [prods]);
    }
    const [[{ n }]] = await db.query("SELECT COUNT(*) n FROM productos WHERE nombre LIKE 'TMPCM%'");
    ck('no quedó basura en la base (TMPCM)', Number(n) === 0, n);
    ck('ni archivos sueltos en disco', nuevosEnDisco().length === 0);
    await db.end();
  }

  console.log(`\n${f === 0 ? 'TODO OK' : f + ' FALLO(S)'}`);
  process.exit(f === 0 ? 0 : 1);
})();
