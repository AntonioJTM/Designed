'use strict';

/**
 * Prueba del checkout de la tienda en línea: entrega, dirección, cupón, envío
 * y forma de pago.
 *
 *   cd backend
 *   PORT=3221 node src/server.js &
 *   BASE=http://localhost:3221/api/v1 node scripts/e2e-checkout-online.js
 *
 * Lo que importa comprobar aquí es que el CLIENTE no puede mover el dinero: ni
 * fijar el costo de envío ni declararse pagado. Lo demás (dirección ajena,
 * cupón, recoger vs. envío) es que el pedido diga la verdad de lo prometido.
 *
 * SE LIMPIA SOLO: crea su producto, su cliente y sus pedidos con prefijo TMPCK
 * y los borra al terminar, pase lo que pase. Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// Se niega a correr contra la base del servidor. Ver el módulo.
require('./_no-en-produccion');

// La tienda en línea está APAGADA desde 2026-10 (sus rutas de registro y login de
// clientes están comentadas). Esta prueba se vuelve a correr al encenderla:
// E2E_TIENDA_EN_LINEA=si node scripts/e2e-checkout-online.js
if (process.env.E2E_TIENDA_EN_LINEA !== 'si') {
  console.log('La tienda en línea está apagada: esta prueba no aplica. (E2E_TIENDA_EN_LINEA=si para forzarla.)');
  process.exit(0);
}
const { soloPropios } = require('./_propios');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3221/api/v1';
const tStaff = jwt.sign(
  { sub: 1, tipo: 'usuario', rol_id: 1, rol: 'administrador' },
  process.env.JWT_SECRET, { expiresIn: '1h' }
);

const llamar = async (token, me, r, b) => {
  const x = await fetch(B + r, {
    method: me,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  return { status: x.status, ...(await x.json().catch(() => ({}))) };
};
const api = (me, r, b) => llamar(tStaff, me, r, b);

let f = 0;
const ck = (n, ok, d) => {
  console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + d : ''));
  if (!ok) f++;
};
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011;

(async () => {
  const db = await m.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  // Foto de lo que ya existía, para borrar solo lo que cree esta corrida.
  const foto = {};
  for (const x of ['productos', 'pedidos', 'clientes', 'direcciones', 'cupones']) {
    foto[x] = new Set((await db.query('SELECT id FROM ' + x))[0].map((r) => r.id));
  }
  const envioAntes = (await db.query(
    "SELECT valor v FROM configuracion WHERE clave='envio_costo_fijo'"))[0][0].v;

  const SUF = Date.now().toString(36);
  let tCliente = null;

  try {
    // ---------------------------------------------------------------- montaje
    await api('PUT', '/configuracion', { envio_costo_fijo: '85.50' });
    const cfg = await api('GET', '/configuracion');
    ck('la tarifa de envío queda configurada', cfg.data.envio_costo_fijo === '85.50',
      cfg.data.envio_costo_fijo);

    const cat = (await api('GET', '/categorias')).data.items[0].id;
    const kgu = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;
    // Sin impuesto: así el subtotal y el total solo se mueven por lo que prueba
    // esta suite (envío y cupón) y un cambio de IVA no la rompe.
    const prod = (await api('POST', '/productos', {
      categoria_id: cat, unidad_medida_id: kgu, nombre: 'TMPCK Hilo ' + SUF,
      multipresentacion: true, precio_kg: 100,
    })).data.id;
    const variante = (await api('POST', '/variantes', {
      producto_id: prod, sku: 'TMPCK-' + SUF, presentacion: 'Paquete',
      tipo_presentacion: 'paquete', peso_kg: 20, precio: 100,
    })).data.id;

    const almacenLinea = (await api('GET', '/almacenes/tienda-linea')).data.id;
    await api('POST', '/inventario/movimientos', {
      variante_id: variante, almacen_id: almacenLinea, tipo: 'entrada',
      cantidad: 500, motivo: 'TMPCK alta de prueba',
    });

    // Un cliente de verdad, con su token: es el sujeto de la prueba.
    const correo = `tmpck.${SUF}@ejemplo.mx`;
    const reg = await llamar('', 'POST', '/clientes/registro', {
      nombre: 'TMPCK Cliente', correo, contrasena: 'clave-de-prueba-1',
    });
    ck('el cliente se registra', reg.status === 201, reg.status);
    tCliente = (await llamar('', 'POST', '/clientes/login',
      { correo, contrasena: 'clave-de-prueba-1' })).data.token;
    const cli = (me, r, b) => llamar(tCliente, me, r, b);

    // -------------------------------------------------------------- 1. Direcciones
    console.log('\n1 · Direcciones del cliente');
    const vacias = await cli('GET', '/direcciones');
    ck('empieza sin direcciones', Array.isArray(vacias.data) && vacias.data.length === 0);

    const dir = (await cli('POST', '/direcciones', {
      calle: 'Av. Hidalgo', numero_ext: '212', colonia: 'Centro',
      ciudad: 'Moroleón', estado: 'Guanajuato', codigo_postal: '38800',
      telefono: '4451112233',
    })).data;
    ck('la primera dirección se marca predeterminada sola', dir.es_predeterminada === 1,
      dir.es_predeterminada);

    const dir2 = (await cli('POST', '/direcciones', {
      calle: 'Morelos', numero_ext: '48', ciudad: 'Uriangato',
      estado: 'Guanajuato', codigo_postal: '38980', es_predeterminada: true,
    })).data;
    const lista = (await cli('GET', '/direcciones')).data;
    ck('la nueva predeterminada desplaza a la anterior',
      lista.filter((d) => d.es_predeterminada).length === 1 &&
      lista.find((d) => d.es_predeterminada).id === dir2.id);

    // Una dirección de OTRO cliente no se puede leer ni usar.
    const ajena = (await db.query('SELECT id FROM direcciones WHERE cliente_id <> ? LIMIT 1',
      [dir.cliente_id]))[0][0];
    if (ajena) {
      const r = await cli('GET', '/direcciones/' + ajena.id);
      ck('no puede ver la dirección de otro cliente', r.status === 404, r.status);
    }

    // ------------------------------------------------------------- 2. Cotización
    console.log('\n2 · Lo que costaría, antes de confirmar');
    const items = [{ variante_id: variante, cantidad: 3 }]; // 3 × 100 = 300

    const cotRecoger = await cli('POST', '/pedidos/cotizacion', {
      canal: 'tienda_linea', metodo_entrega: 'recoger', items,
    });
    ck('recoger en tienda no cobra envío', cerca(cotRecoger.data.costo_envio, 0),
      cotRecoger.data.costo_envio);
    ck('y el total es el subtotal más impuestos',
      cerca(cotRecoger.data.total, cotRecoger.data.subtotal + cotRecoger.data.impuestos),
      cotRecoger.data.total);

    const cotEnvio = await cli('POST', '/pedidos/cotizacion', {
      canal: 'tienda_linea', metodo_entrega: 'envio', direccion_envio_id: dir.id, items,
    });
    ck('el envío cobra la tarifa configurada', cerca(cotEnvio.data.costo_envio, 85.5),
      cotEnvio.data.costo_envio);
    ck('y suma al total',
      cerca(cotEnvio.data.total, cotRecoger.data.total + 85.5), cotEnvio.data.total);

    const sinDir = await cli('POST', '/pedidos/cotizacion', {
      canal: 'tienda_linea', metodo_entrega: 'envio', items,
    });
    ck('enviar sin dirección se rechaza',
      sinDir.status === 422 && sinDir.error.code === 'FALTA_DIRECCION', sinDir.error?.code);

    if (ajena) {
      const conAjena = await cli('POST', '/pedidos/cotizacion', {
        canal: 'tienda_linea', metodo_entrega: 'envio', direccion_envio_id: ajena.id, items,
      });
      ck('no puede enviar a la dirección de otro',
        conAjena.status === 422 && conAjena.error.code === 'DIRECCION_INVALIDA',
        conAjena.error?.code);
    }

    // La cotización NO crea nada.
    const [[{ n: pedidosTrasCotizar }]] = await db.query(
      'SELECT COUNT(*) n FROM pedidos WHERE cliente_id = ?', [dir.cliente_id]);
    ck('cotizar no crea pedidos', Number(pedidosTrasCotizar) === 0, pedidosTrasCotizar);

    // -------------------------------------------------------- 3. El dinero no se toca
    console.log('\n3 · El cliente no mueve el dinero');
    const efectivoId = (await api('GET', '/opciones/metodos-pago')).data
      .find((x) => x.nombre.toLowerCase().includes('efectivo')).id;
    const transferenciaId = (await api('GET', '/opciones/metodos-pago')).data
      .find((x) => x.nombre.toLowerCase().includes('transferencia')).id;

    const conEnvioGratis = await cli('POST', '/pedidos', {
      canal: 'tienda_linea', metodo_entrega: 'envio', direccion_envio_id: dir.id,
      costo_envio: 0, metodo_pago_id: transferenciaId, items,
    });
    ck('el cliente NO puede ponerse el envío en cero',
      cerca(conEnvioGratis.data.costo_envio, 85.5), conEnvioGratis.data?.costo_envio);

    const autopagado = await cli('POST', '/pedidos', {
      canal: 'tienda_linea', metodo_entrega: 'recoger',
      pagos: [{ metodo_pago_id: efectivoId, monto: 100000 }],
      metodo_pago_id: efectivoId, items,
    });
    ck('el cliente NO puede declararse pagado', autopagado.data.estado === 'pendiente',
      autopagado.data?.estado);
    ck('y no se le cuela un pago completado',
      autopagado.data.pagos.every((p) => p.estado === 'pendiente'),
      autopagado.data.pagos.map((p) => p.estado).join(','));
    ck('el pago pendiente es por el total',
      cerca(autopagado.data.pagos[0].monto, autopagado.data.total),
      autopagado.data.pagos[0]?.monto);

    // El cliente pagó en efectivo en el mostrador y el administrador lo da por
    // pagado: su pago tiene que quedar COBRADO. Antes el pedido decía "pagado"
    // y su pago seguía "pendiente".
    const marcado = await api('PATCH', '/pedidos/' + autopagado.data.id + '/estado', { estado: 'pagado' });
    ck('el administrador lo da por pagado', marcado.status === 200 && marcado.data?.estado === 'pagado',
      marcado.status + ' ' + marcado.data?.estado);
    ck('y su pago queda COMPLETADO, no pendiente',
      (marcado.data?.pagos ?? []).length === 1 && marcado.data.pagos.every((p) => p.estado === 'completado'),
      (marcado.data?.pagos ?? []).map((p) => p.estado).join(','));

    // ------------------------------------------------------------- 4. El pedido
    console.log('\n4 · El pedido dice lo que se prometió');
    ck('guarda que va a domicilio', conEnvioGratis.data.metodo_entrega === 'envio',
      conEnvioGratis.data.metodo_entrega);
    ck('y a qué dirección', conEnvioGratis.data.direccion_envio_id === dir.id);
    const detalle = (await api('GET', '/pedidos/' + conEnvioGratis.data.id)).data;
    ck('el panel ve la dirección completa, no solo el id',
      detalle.direccion_envio && detalle.direccion_envio.ciudad === 'Moroleón',
      detalle.direccion_envio?.ciudad);
    ck('el de recoger no lleva dirección',
      autopagado.data.metodo_entrega === 'recoger' &&
      autopagado.data.direccion_envio_id === null);

    // Una dirección con pedidos encima no se borra: el histórico la necesita.
    const borrar = await cli('DELETE', '/direcciones/' + dir.id);
    ck('no deja borrar una dirección con pedidos',
      borrar.status === 409 && borrar.error.code === 'DIRECCION_EN_USO', borrar.error?.code);
    const borrar2 = await cli('DELETE', '/direcciones/' + dir2.id);
    ck('la que no se usó sí se borra', borrar2.status === 200, borrar2.status);

    // ---------------------------------------------------------------- 5. Cupón
    console.log('\n5 · Cupón');
    const codigo = 'TMPCK' + SUF.toUpperCase();
    await db.query(
      `INSERT INTO cupones (codigo, tipo, valor, compra_minima, activo)
       VALUES (?, 'porcentaje', 10, 100, 1)`, [codigo]);

    const conCupon = await cli('POST', '/pedidos/cotizacion', {
      canal: 'tienda_linea', metodo_entrega: 'recoger', cupon_codigo: codigo, items,
    });
    ck('el cupón descuenta 10% del subtotal',
      cerca(conCupon.data.descuento, conCupon.data.subtotal * 0.1), conCupon.data.descuento);
    ck('y el desglose lo devuelve para pintarlo',
      conCupon.data.cupon && conCupon.data.cupon.codigo === codigo,
      conCupon.data.cupon?.codigo);

    const [[cuponAntes]] = await db.query(
      'SELECT usos_actuales u FROM cupones WHERE codigo = ?', [codigo]);
    ck('cotizar no gasta un uso del cupón', Number(cuponAntes.u) === 0, cuponAntes.u);

    const pedidoCupon = await cli('POST', '/pedidos', {
      canal: 'tienda_linea', metodo_entrega: 'recoger', cupon_codigo: codigo,
      metodo_pago_id: transferenciaId, items,
    });
    ck('la venta cobra lo mismo que la cotización',
      cerca(pedidoCupon.data.total, conCupon.data.total),
      `${pedidoCupon.data.total} vs ${conCupon.data.total}`);
    const [[cuponDespues]] = await db.query(
      'SELECT usos_actuales u FROM cupones WHERE codigo = ?', [codigo]);
    ck('confirmar sí gasta el uso', Number(cuponDespues.u) === 1, cuponDespues.u);

    // ------------------------------------------------------- 6. El staff sí cobra
    console.log('\n6 · El staff sí puede fijar el envío');
    const dirStaff = (await db.query(
      'SELECT id FROM direcciones WHERE cliente_id = ? LIMIT 1', [dir.cliente_id]))[0][0];
    const porTelefono = await api('POST', '/pedidos', {
      canal: 'tienda_linea', cliente_id: dir.cliente_id, metodo_entrega: 'envio',
      direccion_envio_id: dirStaff.id, costo_envio: 300, items,
    });
    ck('un pedido capturado por el personal lleva la tarifa que le pongan',
      cerca(porTelefono.data.costo_envio, 300), porTelefono.data?.costo_envio);

  } catch (e) {
    console.error('\nERROR:', e.message);
    f++;
  } finally {
    console.log('\nLimpiando…');
    // El orden importa: primero lo que cuelga de los pedidos.
// Solo lo NUEVO que sea de la prueba (prefijo TMP): una venta real hecha
    // mientras corría no se toca. Ver _propios.js.
        const nuevos = soloPropios(db, foto);
    const pedidosNuevos = await nuevos('pedidos');
    if (pedidosNuevos.length) {
      await db.query('DELETE FROM movimientos_inventario WHERE referencia_tipo = "pedido" AND referencia_id IN (?)', [pedidosNuevos]);
      await db.query('DELETE FROM pedidos WHERE id IN (?)', [pedidosNuevos]);
    }
    const dirsNuevas = await nuevos('direcciones');
    if (dirsNuevas.length) await db.query('DELETE FROM direcciones WHERE id IN (?)', [dirsNuevas]);
    const clientesNuevos = await nuevos('clientes');
    if (clientesNuevos.length) await db.query('DELETE FROM clientes WHERE id IN (?)', [clientesNuevos]);
    const cuponesNuevos = await nuevos('cupones');
    if (cuponesNuevos.length) await db.query('DELETE FROM cupones WHERE id IN (?)', [cuponesNuevos]);
    const prodsNuevos = await nuevos('productos');
    if (prodsNuevos.length) {
      const [vs] = await db.query('SELECT id FROM producto_variantes WHERE producto_id IN (?)', [prodsNuevos]);
      const vids = vs.map((v) => v.id);
      if (vids.length) {
        await db.query('DELETE FROM movimientos_inventario WHERE variante_id IN (?)', [vids]);
        await db.query('DELETE FROM inventario WHERE variante_id IN (?)', [vids]);
        await db.query('DELETE FROM producto_variantes WHERE id IN (?)', [vids]);
      }
      await db.query('DELETE FROM productos WHERE id IN (?)', [prodsNuevos]);
    }
    // La tarifa vuelve a como estaba: esto es la base donde la tienda captura.
    await db.query("UPDATE configuracion SET valor = ? WHERE clave = 'envio_costo_fijo'", [envioAntes]);

    const [[{ n }]] = await db.query(
      "SELECT COUNT(*) n FROM productos WHERE nombre LIKE 'TMPCK%'");
    ck('no quedó basura en la base (TMPCK)', Number(n) === 0, n);
    await db.end();
  }

  console.log(`\n${f === 0 ? 'TODO OK' : f + ' FALLO(S)'}`);
  process.exit(f === 0 ? 0 : 1);
})();
