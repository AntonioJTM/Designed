'use strict';
/**
 * E2E del traspaso con estados: solicitud → envío → recepción, con faltante,
 * cancelación y los rechazos que importan.
 *
 * SE LIMPIA SOLO. Crea su propio producto y sus propios almacenes con un prefijo
 * reconocible y los borra al final, incluidos los movimientos del kardex, para no
 * dejar basura en la base donde la tienda ya está capturando en serio. Si algo
 * falla, la limpieza corre igual.
 *
 *   node scripts/e2e-traspaso-estados.js
 */
require('dotenv').config();
const { pool } = require('../src/config/db');
const model = require('../src/modules/inventario/model');
const round3 = (n) => Math.round(n * 1000) / 1000;

const MARCA = 'E2E-TRASPASO';
let ok = 0;
let fallos = 0;

function check(desc, cond, extra) {
  if (cond) {
    ok++;
    console.log(`  ✓ ${desc}`);
  } else {
    fallos++;
    console.error(`  ✗ ${desc}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`);
  }
}

async function esperaError(desc, codigo, fn) {
  try {
    await fn();
    fallos++;
    console.error(`  ✗ ${desc} → no lanzó ${codigo}`);
  } catch (e) {
    check(`${desc} (${codigo})`, e.code === codigo, { code: e.code, msg: e.message });
  }
}

const kg = async (varianteId, almacenId) => {
  const [[f]] = await pool.query(
    'SELECT cantidad, cantidad_reservada FROM inventario WHERE variante_id = :v AND almacen_id = :a',
    { v: varianteId, a: almacenId }
  );
  return f
    ? { cantidad: Number(f.cantidad), reservada: Number(f.cantidad_reservada) }
    : { cantidad: 0, reservada: 0 };
};

async function main() {
  const ids = { almacenes: [], producto: null, variantes: [], traspasos: [] };

  try {
    // ---- Datos propios ----
    const [cat] = await pool.query('SELECT id FROM categorias LIMIT 1');
    const [um] = await pool.query("SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1");

    for (const nombre of [`${MARCA} bodega`, `${MARCA} sucursal`]) {
      const [r] = await pool.query(
        'INSERT INTO almacenes (nombre, es_punto_venta, activo) VALUES (:n, 0, 1)',
        { n: nombre }
      );
      ids.almacenes.push(r.insertId);
    }
    const [origen, destino] = ids.almacenes;

    const [p] = await pool.query(
      `INSERT INTO productos (categoria_id, unidad_medida_id, nombre, grosor_calibre,
                              multipresentacion, precio_kg, activo)
       VALUES (:c, :u, :n, '2/30', 1, 100, 1)`,
      { c: cat[0].id, u: um[0].id, n: `${MARCA} HILO` }
    );
    ids.producto = p.insertId;

    // Paquete de 20 kg nominal, y un cono para probar que se rechaza.
    const [vp] = await pool.query(
      `INSERT INTO producto_variantes (producto_id, sku, presentacion, tipo_presentacion,
                                       peso_kg, precio, activo)
       VALUES (:p, :sku, 'Paquete', 'paquete', 20, 100, 1)`,
      { p: ids.producto, sku: `${MARCA}-PAQ` }
    );
    const paquete = vp.insertId;
    const [vc] = await pool.query(
      `INSERT INTO producto_variantes (producto_id, sku, presentacion, tipo_presentacion,
                                       origen_variante_id, piezas_por_origen, peso_kg, precio, activo)
       VALUES (:p, :sku, 'Cono', 'cono', :o, 12, 1.6, 100, 1)`,
      { p: ids.producto, sku: `${MARCA}-CONO`, o: paquete }
    );
    const cono = vc.insertId;
    ids.variantes.push(paquete, cono);

    // Cinco bultos con pesos DISTINTOS, como llegan de verdad.
    const pesos = [19.5, 20.25, 18.75, 21.0, 19.0];
    const sumaTres = 19.5 + 20.25 + 18.75; // los tres más antiguos: 58.5
    for (let i = 0; i < pesos.length; i++) {
      await pool.query(
        `INSERT INTO variante_codigos (variante_id, codigo, peso_kg, almacen_id, estado)
         VALUES (:v, :c, :p, :a, 'disponible')`,
        { v: paquete, c: `${MARCA}-B${i}`, p: pesos[i], a: origen }
      );
    }
    const total = pesos.reduce((s, x) => s + x, 0); // 98.5
    await pool.query(
      'INSERT INTO inventario (variante_id, almacen_id, cantidad) VALUES (:v, :a, :c)',
      { v: paquete, a: origen, c: total }
    );

    console.log(`\nDatos de prueba: ${total} kg en 5 bultos (origen ${origen} → destino ${destino})`);

    // ---- 1 · Solicitar ----
    console.log('\n1 · Solicitar');
    const sol = await model.solicitarTraspaso(
      { almacen_origen_id: origen, almacen_destino_id: destino, items: [{ variante_id: paquete, paquetes: 3 }] },
      null
    );
    ids.traspasos.push(sol.id);
    check('queda en estado solicitado', sol.estado === 'solicitado', sol.estado);
    check('la cantidad sale del peso REAL de los 3 bultos más antiguos',
      sol.lineas[0].cantidad === sumaTres, sol.lineas[0].cantidad);
    let s = await kg(paquete, origen);
    check('la existencia NO se movió todavía', s.cantidad === total, s);
    check('pero quedó APARTADA', s.reservada === sumaTres, s);

    await esperaError('un cono no se traspasa', 'NO_SE_TRASPASAN_CONOS', () =>
      model.solicitarTraspaso(
        { almacen_origen_id: origen, almacen_destino_id: destino, items: [{ variante_id: cono, cantidad: 1 }] },
        null
      )
    );

    // Lo apartado ya no está libre: 98.5 − 58.5 = 40 kg.
    await esperaError('otra solicitud no puede pedir lo apartado', 'STOCK_INSUFICIENTE', () =>
      model.solicitarTraspaso(
        { almacen_origen_id: origen, almacen_destino_id: destino, items: [{ variante_id: paquete, cantidad: 45 }] },
        null
      )
    );

    // ---- 2 · Enviar ----
    console.log('\n2 · Enviar');
    const env = await model.enviarTraspaso(sol.id, null);
    check('pasa a en_transito', env.estado === 'en_transito', env.estado);
    s = await kg(paquete, origen);
    check('la mercancía SALIÓ del origen', s.cantidad === total - sumaTres, s);
    check('y se liberó el apartado', s.reservada === 0, s);
    const d = await kg(paquete, destino);
    check('todavía NO entró al destino: va en camino', d.cantidad === 0, d);
    const [[bultosMovidos]] = await pool.query(
      "SELECT COUNT(*) n FROM variante_codigos WHERE variante_id = :v AND almacen_id = :a AND codigo LIKE :m",
      { v: paquete, a: destino, m: `${MARCA}%` }
    );
    check('los 3 bultos ya apuntan a la sucursal', Number(bultosMovidos.n) === 3, bultosMovidos);

    await esperaError('no se puede enviar dos veces', 'ESTADO_INVALIDO', () =>
      model.enviarTraspaso(sol.id, null)
    );

    // ---- 3 · Recibir con faltante ----
    console.log('\n3 · Recibir, aceptando 2 de 3 paquetes');
    await esperaError('no se puede aceptar más de lo enviado', 'RECIBE_MAS_DE_LO_ENVIADO', () =>
      model.recibirTraspaso(sol.id, null, {
        recibido: [{ detalle_id: env.lineas[0].detalle_id, cantidad: sumaTres + 5 }],
      })
    );

    const rec = await model.recibirTraspaso(sol.id, null, {
      recibido: [{ detalle_id: env.lineas[0].detalle_id, paquetes: 2 }],
      notas: 'Llegaron 2, uno se quedó en la camioneta',
    });
    check('queda recibido', rec.estado === 'recibido', rec.estado);
    check('reporta 1 línea con faltante', rec.faltantes === 1, rec.faltantes);
    const esperadoRecibido = Math.round((sumaTres * 2) / 3 * 1000) / 1000;
    check('entró al destino solo lo aceptado', rec.lineas[0].recibida === esperadoRecibido,
      { recibida: rec.lineas[0].recibida, esperado: esperadoRecibido });
    const d2 = await kg(paquete, destino);
    check('el saldo del destino es lo aceptado', d2.cantidad === esperadoRecibido, d2);

    const [movs] = await pool.query(
      `SELECT tipo, cantidad, motivo FROM movimientos_inventario
        WHERE referencia_tipo = 'traspaso' AND referencia_id = :id ORDER BY id`,
      { id: sol.id }
    );
    check('el kardex tiene 3 patas: salida, entrada y el faltante', movs.length === 3, movs.map((m) => m.tipo));
    check('la del faltante es una merma con el folio',
      movs[2].tipo === 'merma' && movs[2].motivo.includes(sol.folio), movs[2]);
    check('la merma es por la diferencia exacta',
      Number(movs[2].cantidad) === -Math.round((sumaTres - esperadoRecibido) * 1000) / 1000,
      movs[2].cantidad);

    await esperaError('un traspaso recibido ya no se cancela', 'ESTADO_INVALIDO', () =>
      model.cancelarTraspaso(sol.id, null, 'ya no')
    );

    // ---- 4 · Cancelar una solicitud: libera el apartado ----
    console.log('\n4 · Cancelar');
    const antes = (await kg(paquete, origen)).cantidad;
    const sol2 = await model.solicitarTraspaso(
      { almacen_origen_id: origen, almacen_destino_id: destino, items: [{ variante_id: paquete, cantidad: 10 }] },
      null
    );
    ids.traspasos.push(sol2.id);
    check('aparta los 10 kg', (await kg(paquete, origen)).reservada === 10);
    await model.cancelarTraspaso(sol2.id, null, 'ya no hacía falta');
    const tras = await kg(paquete, origen);
    check('al cancelar la solicitud se libera el apartado', tras.reservada === 0, tras);
    check('y la existencia no se tocó', tras.cantidad === antes, tras);

    // ---- 4b · Pedir en KILOS, que es como pide la sucursal ----
    console.log('\n4b · Pedir en kilos (no en paquetes)');
    const antesKg = (await kg(paquete, origen)).cantidad;
    const solKg = await model.solicitarTraspaso(
      { almacen_origen_id: origen, almacen_destino_id: destino, items: [{ variante_id: paquete, cantidad: 30 }] },
      null
    );
    ids.traspasos.push(solKg.id);
    check('la línea guarda los kilos EXACTOS que se pidieron', solKg.lineas[0].cantidad === 30,
      solKg.lineas[0].cantidad);
    check('sin paquetes: no se pidió por bultos', solKg.lineas[0].paquetes === null,
      solKg.lineas[0].paquetes);

    const envKg = await model.enviarTraspaso(solKg.id, null);
    check('salen los 30 kg exactos, sin redondear a bultos enteros',
      envKg.lineas[0].cantidad === 30, envKg.lineas[0].cantidad);
    check('el origen bajó exactamente 30 kg',
      (await kg(paquete, origen)).cantidad === round3(antesKg - 30), await kg(paquete, origen));
    // Los bultos se acomodan solos: los que caben sin pasarse de 30 kg.
    const pesoBultos = envKg.lineas[0].bultos.reduce((s, b) => s + Number(b.peso_kg), 0);
    check('mueve bultos completos sin pasarse de los kilos que salieron',
      pesoBultos <= 30 && envKg.lineas[0].bultos.length > 0,
      { bultos: envKg.lineas[0].bultos.length, peso: pesoBultos });

    // La campana del panel debe verlo pendiente de recepción.
    const notif = require('../src/modules/notificaciones/model');
    const pend = await notif.pendientes();
    check('la campana lo lista como pendiente de recibir',
      pend.traspasos_por_recibir.some((t) => t.folio === solKg.folio),
      pend.traspasos_por_recibir.map((t) => t.folio));
    check('y el total de la campana cuenta al menos ese', pend.total >= 1, pend.total);

    await model.recibirTraspaso(solKg.id, null, {});
    const pend2 = await notif.pendientes();
    check('al recibirlo desaparece de la campana',
      !pend2.traspasos_por_recibir.some((t) => t.folio === solKg.folio),
      pend2.traspasos_por_recibir.map((t) => t.folio));

    // ---- 5 · Cancelar en tránsito: la mercancía regresa ----
    console.log('\n5 · Cancelar en tránsito');
    const antes3 = (await kg(paquete, origen)).cantidad;
    const sol3 = await model.solicitarTraspaso(
      { almacen_origen_id: origen, almacen_destino_id: destino, items: [{ variante_id: paquete, cantidad: 10 }] },
      null
    );
    ids.traspasos.push(sol3.id);
    await model.enviarTraspaso(sol3.id, null);
    check('salió del origen', (await kg(paquete, origen)).cantidad === round3(antes3 - 10));
    await model.cancelarTraspaso(sol3.id, null, 'se regresó el camión');
    const vuelta = await kg(paquete, origen);
    check('cancelar en tránsito REGRESA la mercancía', vuelta.cantidad === antes3, vuelta);
    check('y no deja nada apartado', vuelta.reservada === 0, vuelta);
  } finally {
    // ---- Limpieza ----
    console.log('\nLimpiando…');
    for (const id of ids.traspasos) {
      await pool.query('DELETE FROM movimientos_inventario WHERE referencia_tipo = :t AND referencia_id = :id',
        { t: 'traspaso', id });
      await pool.query('DELETE FROM traspaso_detalle WHERE traspaso_id = :id', { id });
      await pool.query('DELETE FROM traspasos WHERE id = :id', { id });
    }
    if (ids.variantes.length) {
      await pool.query('DELETE FROM movimientos_inventario WHERE variante_id IN (:v)', { v: ids.variantes });
      await pool.query('DELETE FROM variante_codigos WHERE variante_id IN (:v)', { v: ids.variantes });
      await pool.query('DELETE FROM inventario WHERE variante_id IN (:v)', { v: ids.variantes });
      // El cono apunta al paquete: primero el cono.
      await pool.query('DELETE FROM producto_variantes WHERE id IN (:v) ORDER BY id DESC', { v: ids.variantes });
    }
    if (ids.producto) await pool.query('DELETE FROM productos WHERE id = :id', { id: ids.producto });
    if (ids.almacenes.length) {
      await pool.query('DELETE FROM almacenes WHERE id IN (:a)', { a: ids.almacenes });
    }

    // Se comprueba que no quedó nada con la marca.
    const [[resto]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM productos WHERE nombre LIKE :m)
            + (SELECT COUNT(*) FROM producto_variantes WHERE sku LIKE :m)
            + (SELECT COUNT(*) FROM almacenes WHERE nombre LIKE :m)
            + (SELECT COUNT(*) FROM variante_codigos WHERE codigo LIKE :m) AS n`,
      { m: `${MARCA}%` }
    );
    check(`no quedó basura en la base (${MARCA})`, Number(resto.n) === 0, resto);

    console.log(`\n${ok} comprobaciones OK, ${fallos} fallos`);
    await pool.end();
    process.exit(fallos ? 1 : 0);
  }
}

main();
