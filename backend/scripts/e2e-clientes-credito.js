'use strict';

/**
 * Prueba del expediente del cliente y de su crédito.
 *
 *   cd backend
 *   PORT=3223 node src/server.js &
 *   BASE=http://localhost:3223/api/v1 node scripts/e2e-clientes-credito.js
 *
 * Lo que importa comprobar:
 *   · el expediente rescata lo que el cliente ha comprado, y NO cuenta lo que
 *     canceló o devolvió;
 *   · qué colores compra más, agrupados por producto y no por nombre (el mismo
 *     color en dos calibres son dos productos);
 *   · el límite de crédito se respeta, incluso con dos ventas seguidas;
 *   · lo fiado NO entra al cajón, o el corte no cuadraría;
 *   · cancelar la venta quita la deuda, y cancelar dos veces no la quita dos
 *     veces;
 *   · un abono en efectivo entra al turno de caja.
 *
 * SE LIMPIA SOLO: prefijo TMPCC. Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// Se niega a correr contra la base del servidor. Ver el módulo.
require('./_no-en-produccion');
const { borrarTurnosPropios, borrarCajasSinTurnos } = require('./_propios');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3223/api/v1';
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
  const SUF = Date.now().toString(36);

  try {
    // ---------------------------------------------------------------- montaje
    const cat = (await api('GET', '/categorias')).data.items[0].id;
    const kgu = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;
    const efectivo = (await api('GET', '/opciones/metodos-pago')).data
      .find((x) => x.nombre.toLowerCase().includes('efectivo')).id;
    const transferencia = (await api('GET', '/opciones/metodos-pago')).data
      .find((x) => x.nombre.toLowerCase().includes('transferencia')).id;

    // DOS productos: mismo color, distinto calibre. Es el caso que obliga a
    // agrupar por producto_id y no por nombre.
    const hilos = [];
    for (const calibre of ['1/30', '2/30']) {
      const prod = (await api('POST', '/productos', {
        categoria_id: cat, unidad_medida_id: kgu, nombre: 'TMPCC Azul ' + SUF,
        grosor_calibre: calibre, multipresentacion: true, precio_kg: 100,
      })).data.id;
      const variante = (await api('POST', '/variantes', {
        producto_id: prod, sku: `TMPCC-${calibre.replace('/', '')}-${SUF}`,
        presentacion: 'Paquete', tipo_presentacion: 'paquete', peso_kg: 20, precio: 100,
      })).data.id;
      hilos.push({ prod, variante, calibre });
    }

    // Caja PROPIA de la prueba, nunca el turno de una caja real: en producción
    // la primera caja activa tiene un turno de verdad abierto y las ventas de
    // prueba quedarían en su corte. Va en el almacén donde vende el mostrador.
    const almacen = (await api('GET', '/caja/cajas')).data.find((c) => c.activo).almacen_id;
    const caja = (await api('POST', '/caja/cajas', {
      almacen_id: almacen, nombre: 'TMPCC Caja ' + SUF,
    })).data;
    for (const h of hilos) {
      await api('POST', '/inventario/movimientos', {
        variante_id: h.variante, almacen_id: almacen, tipo: 'entrada',
        cantidad: 500, motivo: 'TMPCC alta de prueba',
      });
    }

    // Turno de caja, para poder cobrar en el mostrador.
    let sesion = (await api('GET', `/caja/sesiones/abierta?caja_id=${caja.id}`)).data;
    const abriYo = !sesion;
    if (!sesion) {
      sesion = (await api('POST', '/caja/sesiones', { caja_id: caja.id, monto_inicial: 0 })).data;
    }

    // ------------------------------------------------------ 1. El expediente
    console.log('\n1 · El expediente');
    const cli = (await api('POST', '/clientes', {
      codigo: 'TMPCC-' + SUF, nombre: 'TMPCC Cliente Viejo',
      nombre_comercial: 'Doña TMPCC', telefono: '4459998888',
      ciudad: 'Moroleón', cliente_desde: '2019-03-15', limite_credito: 1000,
    })).data;
    ck('se da de alta sin cuenta ni contraseña', cli.tiene_cuenta === 0, `tiene_cuenta=${cli.tiene_cuenta}`);
    ck('respeta la antigüedad real, no la de captura', cli.cliente_desde === '2019-03-15',
      cli.cliente_desde);

    const dupCodigo = await api('POST', '/clientes', {
      codigo: 'TMPCC-' + SUF, nombre: 'Otro',
    });
    ck('no deja repetir el código',
      dupCodigo.status === 409 && dupCodigo.error.code === 'CLIENTE_DUPLICADO',
      dupCodigo.error?.code);

    const porApodo = await api('GET', '/clientes/buscar?q=' + encodeURIComponent('doña tmpcc'));
    ck('se encuentra por el apodo, no solo por el nombre',
      porApodo.data.some((c) => c.id === cli.id), porApodo.data?.length + ' resultado(s)');
    const porTel = await api('GET', '/clientes/buscar?q=4459998888');
    ck('y por teléfono', porTel.data.some((c) => c.id === cli.id));
    ck('una sola letra no busca nada',
      (await api('GET', '/clientes/buscar?q=d')).data.length === 0);

    // -------------------------------------------- 2. Lo que compra, y qué color
    console.log('\n2 · Lo que ha comprado');
    const vender = (v, cantidad, extra = {}) => api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: cli.id,
      items: [{ variante_id: v, cantidad }],
      pagos: extra.a_credito ? undefined : [{ metodo_pago_id: efectivo, monto: 100000 }],
      ...extra,
    });

    await vender(hilos[0].variante, 10);   // 1/30 · 10 kg
    await vender(hilos[0].variante, 5);    // 1/30 ·  5 kg  → 15 en total
    await vender(hilos[1].variante, 3);    // 2/30 ·  3 kg

    let exp = (await api('GET', '/clientes/' + cli.id)).data;
    ck('cuenta sus 3 pedidos', Number(exp.estadisticas.num_pedidos) === 3,
      exp.estadisticas.num_pedidos);
    ck('suma los kilos', cerca(exp.estadisticas.kilos, 18), exp.estadisticas.kilos);
    ck('y saca el ticket promedio con 2 decimales',
      /^\d+\.\d{2}$/.test(String(exp.estadisticas.ticket_promedio)),
      exp.estadisticas.ticket_promedio);

    ck('el mismo color en dos calibres son DOS renglones',
      exp.colores_mas_comprados.length === 2, exp.colores_mas_comprados.length);
    const top = exp.colores_mas_comprados[0];
    ck('el que más compra va primero', cerca(top.kilos, 15), `${top.color} ${top.calibre}: ${top.kilos} kg`);
    ck('y dice de qué calibre es', top.calibre === '1/30', top.calibre);
    ck('con las veces que lo ha comprado', Number(top.veces) === 2, top.veces);

    // Cancelar una venta la saca de las cuentas.
    const aCancelar = (await vender(hilos[1].variante, 7)).data;
    exp = (await api('GET', '/clientes/' + cli.id)).data;
    const kilosCon = Number(exp.estadisticas.kilos);
    await api('PATCH', `/pedidos/${aCancelar.id}/estado`, { estado: 'cancelado' });
    exp = (await api('GET', '/clientes/' + cli.id)).data;
    ck('lo cancelado NO cuenta como comprado', cerca(exp.estadisticas.kilos, kilosCon - 7),
      `${kilosCon} → ${exp.estadisticas.kilos}`);
    ck('pero queda contado aparte', Number(exp.estadisticas.num_devueltos) === 1,
      exp.estadisticas.num_devueltos);

    // ---------------------------------------------------- 3. Venta a crédito
    console.log('\n3 · Vender a crédito');
    const cajonAntes = (await api('GET', '/caja/sesiones/' + sesion.id)).data.esperado_actual;

    const fiado = await vender(hilos[0].variante, 6, { a_credito: 600 }); // 6 × 100 = 600
    ck('la venta a crédito pasa', fiado.status === 201, fiado.data?.numero_pedido);
    ck('y queda PENDIENTE, no pagada', fiado.data.estado === 'pendiente', fiado.data?.estado);

    // El estado de cuenta viaja en el expediente: saldo, disponible y movimientos.
    const cuenta = (await api('GET', `/clientes/${cli.id}`)).data;
    ck('le carga los 600 a su cuenta', cerca(cuenta.saldo, 600), cuenta.saldo);
    ck('y le bajan los 600 de disponible', cerca(cuenta.credito_disponible, 400),
      cuenta.credito_disponible);

    const cajonDespues = (await api('GET', '/caja/sesiones/' + sesion.id)).data.esperado_actual;
    ck('lo FIADO no entra al cajón', cerca(cajonAntes, cajonDespues),
      `${cajonAntes} → ${cajonDespues}`);

    // Ya solo le quedan 400 de crédito.
    const pasado = await vender(hilos[0].variante, 6, { a_credito: 600 });
    ck('no se le fía más de su límite',
      pasado.status === 409 && pasado.error.code === 'CREDITO_INSUFICIENTE',
      pasado.error?.code);
    ck('y el mensaje dice cuánto le queda',
      /400\.00/.test(pasado.error.message), pasado.error?.message?.slice(0, 90));

    // Venta MIXTA: paga una parte y debe el resto.
    const mixta = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id, cliente_id: cli.id,
      items: [{ variante_id: hilos[0].variante, cantidad: 5 }], // 500
      pagos: [{ metodo_pago_id: efectivo, monto: 200 }],
      a_credito: 400,
    });
    ck('acepta venta mixta (paga algo, debe el resto)', mixta.status === 201, mixta.status);
    const trasMixta = (await api('GET', `/clientes/${cli.id}`)).data;
    ck('y solo carga la parte fiada', cerca(trasMixta.saldo, 1000), trasMixta.saldo);

    const sinCliente = await api('POST', '/pedidos', {
      canal: 'punto_venta', sesion_caja_id: sesion.id,
      items: [{ variante_id: hilos[0].variante, cantidad: 1 }], a_credito: 100,
    });
    ck('no se le fía a un desconocido',
      sinCliente.status === 422 && sinCliente.error.code === 'FALTA_CLIENTE',
      sinCliente.error?.code);

    // ------------------------------------------------------- 4. Cancelar y abonar
    console.log('\n4 · Cancelar la deuda, y abonar');
    await api('PATCH', `/pedidos/${fiado.data.id}/estado`, { estado: 'cancelado' });
    let saldo = (await api('GET', `/clientes/${cli.id}`)).data;
    ck('cancelar la venta le quita la deuda', cerca(saldo.saldo, 400), saldo.saldo);
    ck('sin borrar el rastro: queda el cargo y su reverso',
      saldo.credito_movimientos.some((x) => x.tipo === 'ajuste' && /Cancelación/.test(x.notas || '')));

    await api('PATCH', `/pedidos/${fiado.data.id}/estado`, { estado: 'cancelado' });
    saldo = (await api('GET', `/clientes/${cli.id}`)).data;
    ck('cancelar dos veces NO perdona la deuda dos veces', cerca(saldo.saldo, 400), saldo.saldo);

    // Abono en efectivo: tiene que entrar al turno.
    const cajonPreAbono = (await api('GET', '/caja/sesiones/' + sesion.id)).data.esperado_actual;
    const abono = await api('POST', `/clientes/${cli.id}/abonos`, {
      monto: 150, metodo_pago_id: efectivo, sesion_caja_id: sesion.id,
    });
    ck('el abono pasa', abono.status === 201, abono.data?.saldo_nuevo);
    ck('baja el saldo', cerca(abono.data.saldo_nuevo, 250), abono.data?.saldo_nuevo);
    const cajonPostAbono = (await api('GET', '/caja/sesiones/' + sesion.id)).data.esperado_actual;
    ck('y el efectivo SÍ entra al cajón',
      cerca(cajonPostAbono - cajonPreAbono, 150), `${cajonPreAbono} → ${cajonPostAbono}`);
    const movs = (await api('GET', '/caja/sesiones/' + sesion.id)).data.movimientos;
    ck('como ingreso y no como venta (no infla los reportes)',
      movs.some((x) => x.tipo === 'ingreso' && cerca(x.monto, 150)));

    const sinTurno = await api('POST', `/clientes/${cli.id}/abonos`, {
      monto: 10, metodo_pago_id: efectivo,
    });
    ck('un abono en efectivo sin turno se rechaza',
      sinTurno.status === 409 && sinTurno.error.code === 'FALTA_SESION_CAJA',
      sinTurno.error?.code);

    const porTransferencia = await api('POST', `/clientes/${cli.id}/abonos`, {
      monto: 50, metodo_pago_id: transferencia, referencia: 'SPEI-TMPCC',
    });
    ck('por transferencia no necesita turno', porTransferencia.status === 201,
      porTransferencia.data?.saldo_nuevo);

    const deMas = await api('POST', `/clientes/${cli.id}/abonos`, { monto: 99999, metodo_pago_id: transferencia });
    ck('no se cobra más de lo que debe',
      deMas.status === 422 && deMas.error.code === 'ABONO_EXCEDE_DEUDA', deMas.error?.code);

    // --------------------------------------------------------- 5. Quién debe
    console.log('\n5 · Quién me debe');
    // Es el listado de Clientes filtrado a los que deben ("quién me debe más").
    const soloDeudores = (await api('GET', '/clientes?con_saldo=true&orden=saldo&limit=100')).data;
    ck('el listado se puede filtrar a los que deben',
      soloDeudores.items.every((x) => Number(x.saldo) > 0), soloDeudores.items.length + ' cliente(s)');
    const mio = soloDeudores.items.find((x) => x.id === cli.id);
    ck('aparece en la lista de deudores', !!mio, mio && `debe ${mio.saldo}`);
    ck('con su teléfono, para poder llamarle', mio?.telefono === '4459998888');

    // El ajuste exige motivo y no deja saldo negativo.
    const sinMotivo = await api('POST', `/clientes/${cli.id}/ajustes`, { monto: -10 });
    ck('un ajuste sin motivo se rechaza', sinMotivo.status === 422, sinMotivo.error?.code);
    const negativo = await api('POST', `/clientes/${cli.id}/ajustes`, {
      monto: -99999, notas: 'prueba',
    });
    ck('y no deja el saldo en negativo',
      negativo.status === 422 && negativo.error.code === 'SALDO_NEGATIVO', negativo.error?.code);

    // ------------------------------------- 6. Pagar lo fiado da la venta por pagada
    // "Pedí a crédito, lo aboné y la venta aún seguía pendiente" (usuario,
    // 2026-10-06). Los abonos se aplican a lo más antiguo primero.
    console.log('\n6 · Lo que se termina de pagar queda PAGADO');
    const estadoDe = async (id) => (await api('GET', `/pedidos/${id}`)).data.estado;
    let debe = Number((await api('GET', `/clientes/${cli.id}`)).data.saldo);
    ck('la venta mixta sigue pendiente mientras se deba algo', (await estadoDe(mixta.data.id)) === 'pendiente',
      `debe ${debe}`);
    let ab = await api('POST', `/clientes/${cli.id}/abonos`, { monto: debe, metodo_pago_id: transferencia, referencia: 'SPEI-TMPCC-2' });
    ck('al abonar lo que falta, la venta mixta pasa a PAGADO', (await estadoDe(mixta.data.id)) === 'pagado',
      `${await estadoDe(mixta.data.id)} · liquidadas ${JSON.stringify(ab.data?.liquidadas)}`);
    ck('y el abono dice qué ventas quedaron pagadas', ab.data?.liquidadas?.includes(mixta.data.numero_pedido),
      JSON.stringify(ab.data?.liquidadas));
    ck('la cancelada sigue cancelada', (await estadoDe(fiado.data.id)) === 'cancelado');

    // Dos ventas fiadas: un abono que solo alcanza para la primera.
    const vieja = await vender(hilos[0].variante, 1, { a_credito: 100 });
    const nueva = await vender(hilos[0].variante, 2, { a_credito: 200 });
    ck('se fían dos ventas (100 y 200)', vieja.status === 201 && nueva.status === 201, `${vieja.status} ${nueva.status}`);
    ab = await api('POST', `/clientes/${cli.id}/abonos`, { monto: 100, metodo_pago_id: transferencia, referencia: 'SPEI-TMPCC-3' });
    ck('un abono de 100 paga la MÁS ANTIGUA', (await estadoDe(vieja.data.id)) === 'pagado' && (await estadoDe(nueva.data.id)) === 'pendiente',
      `vieja ${await estadoDe(vieja.data.id)} · nueva ${await estadoDe(nueva.data.id)}`);
    ab = await api('POST', `/clientes/${cli.id}/abonos`, { monto: 150, metodo_pago_id: transferencia, referencia: 'SPEI-TMPCC-4' });
    ck('un abono parcial no la da por pagada', (await estadoDe(nueva.data.id)) === 'pendiente', await estadoDe(nueva.data.id));
    // El último tramo se condona con un ajuste: también cuenta como pagado.
    const condona = await api('POST', `/clientes/${cli.id}/ajustes`, { monto: -50, notas: 'TMPCC se le perdona el resto' });
    ck('condonar el resto con un ajuste la da por pagada', condona.status === 200 && (await estadoDe(nueva.data.id)) === 'pagado',
      `${condona.status} ${await estadoDe(nueva.data.id)}`);
    debe = Number((await api('GET', `/clientes/${cli.id}`)).data.saldo);
    ck('y el cliente ya no debe nada', cerca(debe, 0), debe);

    // ------------------- 7. Cancelar, el cambio a mano y lo que "falta" en la lista
    console.log('\n7 · Cancelar una fiada, cambiarla a mano y lo que falta');
    const faltaDe = async (id) =>
      Number(((await api('GET', `/pedidos?cliente_id=${cli.id}&limit=100`)).data.items.find((x) => x.id === id) ?? {}).falta);
    const a1 = await vender(hilos[0].variante, 1, { a_credito: 100 });
    const a2 = await vender(hilos[0].variante, 2, { a_credito: 200 });
    await api('POST', `/clientes/${cli.id}/abonos`, { monto: 200, metodo_pago_id: transferencia, referencia: 'SPEI-TMPCC-5' });
    ck('con 200 abonados: la de 100 pagada y a la de 200 le faltan 100',
      (await estadoDe(a1.data.id)) === 'pagado' && (await estadoDe(a2.data.id)) === 'pendiente' && cerca(await faltaDe(a2.data.id), 100),
      `${await estadoDe(a1.data.id)} · ${await estadoDe(a2.data.id)} falta ${await faltaDe(a2.data.id)}`);
    ck('la lista ya no dice que falta en la pagada', cerca(await faltaDe(a1.data.id), 0), await faltaDe(a1.data.id));
    let r = await api('PATCH', `/pedidos/${a2.data.id}/estado`, { estado: 'pagado' });
    ck('a mano no se marca pagada una fiada que se debe', r.status === 409 && r.error?.code === 'VENTA_FIADA_SIN_PAGAR',
      `${r.status} ${r.error?.message}`);
    r = await api('PATCH', `/pedidos/${a1.data.id}/estado`, { estado: 'pendiente' });
    ck('ni se regresa a pendiente una ya pagada con abonos', r.status === 409 && r.error?.code === 'VENTA_FIADA_PAGADA',
      `${r.status} ${r.error?.code}`);
    r = await api('PATCH', `/pedidos/${a1.data.id}/estado`, { estado: 'cancelado' });
    ck('cancelar la más antigua libera su abono y paga la siguiente', r.status === 200 && (await estadoDe(a2.data.id)) === 'pagado',
      `${r.status} ${await estadoDe(a2.data.id)}`);
    ck('y no queda debiendo nada', cerca(Number((await api('GET', `/clientes/${cli.id}`)).data.saldo), 0));

    // Cancelar una fiada que ya se había abonado deja saldo A FAVOR, y eso paga
    // lo próximo que se le fíe.
    const b = await vender(hilos[0].variante, 3, { a_credito: 300 });
    await api('POST', `/clientes/${cli.id}/abonos`, { monto: 100, metodo_pago_id: transferencia, referencia: 'SPEI-TMPCC-6' });
    await api('PATCH', `/pedidos/${b.data.id}/estado`, { estado: 'cancelado' });
    const aFavor = Number((await api('GET', `/clientes/${cli.id}`)).data.saldo);
    ck('cancelar una fiada ya abonada deja lo abonado a su favor', cerca(aFavor, -100), aFavor);
    const cnueva = await vender(hilos[0].variante, 0.5, { a_credito: 50 });
    ck('lo próximo que se le fía lo paga su saldo a favor: nace PAGADA', cnueva.status === 201 && cnueva.data?.estado === 'pagado',
      `${cnueva.status} ${cnueva.data?.estado}`);
    ck('y le queda a favor lo que sobró', cerca(Number((await api('GET', `/clientes/${cli.id}`)).data.saldo), -50));

    if (abriYo) await api('POST', `/caja/sesiones/${sesion.id}/cerrar`, { monto_final: 0 });

  } catch (e) {
    console.error('\nERROR:', e.message, e.stack);
    f++;
  } finally {
    console.log('\nLimpiando…');
    const [cls] = await db.query("SELECT id FROM clientes WHERE nombre LIKE 'TMPCC%'");
    const ids = cls.map((r) => r.id);
    if (ids.length) {
      const [peds] = await db.query('SELECT id FROM pedidos WHERE cliente_id IN (?)', [ids]);
      const pids = peds.map((r) => r.id);
      if (pids.length) {
        await db.query('DELETE FROM movimientos_inventario WHERE referencia_tipo="pedido" AND referencia_id IN (?)', [pids]);
        await db.query('DELETE FROM pedidos WHERE id IN (?)', [pids]);
      }
      await db.query('DELETE FROM clientes WHERE id IN (?)', [ids]); // arrastra credito_movimientos
    }
    const [prods] = await db.query("SELECT id FROM productos WHERE nombre LIKE 'TMPCC%'");
    const pr = prods.map((r) => r.id);
    if (pr.length) {
      const [vs] = await db.query('SELECT id FROM producto_variantes WHERE producto_id IN (?)', [pr]);
      const vids = vs.map((v) => v.id);
      if (vids.length) {
        for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) {
          await db.query('DELETE FROM ' + tb + ' WHERE variante_id IN (?)', [vids]);
        }
        await db.query('DELETE FROM producto_variantes WHERE id IN (?)', [vids]);
      }
      await db.query('DELETE FROM productos WHERE id IN (?)', [pr]);
    }
    // La caja de la prueba con su turno y sus movimientos. Se borra por TURNO y
    // no por referencia_id: ese campo guarda a veces un pedido y a veces un
    // abono de crédito, y por número podría alcanzar un movimiento real.
    const [cjs] = await db.query("SELECT id FROM cajas WHERE nombre LIKE 'TMPCC Caja%'");
    if (cjs.length) {
      const [ses] = await db.query('SELECT id FROM sesiones_caja WHERE caja_id IN (?)', [cjs.map((r) => r.id)]);
      // Solo los turnos que nadie más usó: si alguien cobró en la caja de la
      // prueba (pasó el 2026-10-03), ese turno y su caja se quedan. Ver _propios.js.
      await borrarTurnosPropios(db, ses.map((r) => r.id));
      await borrarCajasSinTurnos(db, cjs.map((r) => r.id));
    }
    const [[{ n }]] = await db.query(
      "SELECT (SELECT COUNT(*) FROM clientes WHERE nombre LIKE 'TMPCC%') + " +
      "(SELECT COUNT(*) FROM productos WHERE nombre LIKE 'TMPCC%') AS n");
    ck('no quedó basura en la base (TMPCC)', Number(n) === 0, n);
    await db.end();
  }

  console.log(`\n${f === 0 ? 'TODO OK' : f + ' FALLO(S)'}`);
  process.exit(f === 0 ? 0 : 1);
})();
