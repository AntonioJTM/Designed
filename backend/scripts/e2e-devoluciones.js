'use strict';

/**
 * Prueba de las DEVOLUCIONES con SALDO A FAVOR (2026-10-13, parte 2): "un
 * cliente te compra hilo y regresa una parte o todo: no le quiero regresar
 * dinero, lo que se le tiene que agregar es como un saldo a favor" y "a veces el
 * cliente pide que su saldo a favor se utilice para otras compras y dejar su
 * crédito como está: dame esas opciones" (usuario).
 *
 * El caso del usuario: se llevó 3 paquetes de 12 conos y regresa 2 paquetes
 * intactos y, del otro, solo 2 conos.
 *   · los paquetes cerrados se escanean: vuelven como paquetes, disponibles;
 *   · los conos se pesan (lo que marque la báscula): entran como CONOS;
 *   · le queda a favor lo que regresó al precio con que se vendió; no sale
 *     dinero de la caja; la venta sigue pagada;
 *   · el saldo se usa al cobrar (todo o una parte), se descuenta de lo que debe
 *     (al devolver o desde su expediente) y regresa si se cancela la venta
 *     donde se usó.
 *
 * Crea "TMPDV …" (hilo, clientes, caja y turno) y lo borra al final.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si node scripts/e2e-devoluciones.js   # contra la base de pruebas
 *
 * Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');
const { borrarTurnosPropios, borrarCajasSinTurnos } = require('./_propios');

const B = process.env.BASE ?? 'http://localhost:3210/api/v1';
const SUF = Date.now().toString(36).toUpperCase();
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

let f = 0;
const ck = (n, ok, d) => {
  console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + JSON.stringify(d) : ''));
  if (!ok) f++;
};

(async () => {
  const db = await m.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const [[admin]] = await db.query(
    `SELECT u.id, u.rol_id FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE r.nombre = 'administrador' AND u.activo = 1 ORDER BY u.id LIMIT 1`
  );
  const t = jwt.sign({ sub: admin.id, tipo: 'usuario', rol_id: admin.rol_id, rol: 'administrador' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const api = async (me, r, b) => {
    const x = await fetch(B + r, {
      method: me,
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: x.status, ...(await x.json().catch(() => ({}))) };
  };
  const inv = async (v, a) => {
    const [[x]] = await db.query('SELECT cantidad FROM inventario WHERE variante_id = ? AND almacen_id = ?', [v, a]);
    return r3(x?.cantidad ?? 0);
  };
  const caja = async (s) => {
    const [rows] = await db.query('SELECT tipo, monto FROM movimientos_caja WHERE sesion_caja_id = ? ORDER BY id', [s]);
    return rows.map((x) => `${x.tipo}:${r2(x.monto)}`);
  };
  const bulto = async (c) => {
    const [[x]] = await db.query('SELECT estado, almacen_id, consumido_id FROM variante_codigos WHERE codigo = ?', [c]);
    return x;
  };
  const estado = async (id) => {
    const [[x]] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [id]);
    return x?.estado;
  };
  const favor = async (cid) => (await api('GET', `/clientes/${cid}`)).data?.saldo_favor;

  try {
    const [[cat]] = await db.query('SELECT id FROM categorias ORDER BY id LIMIT 1');
    const [[kg]] = await db.query("SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1");
    const [[efectivo]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Efectivo%' ORDER BY id LIMIT 1");
    const [[metSaldo]] = await db.query("SELECT id FROM metodos_pago WHERE nombre = 'Saldo a favor' AND interno = 1");
    const [[transferencia]] = await db.query("SELECT id FROM metodos_pago WHERE nombre LIKE 'Transferencia%' ORDER BY id LIMIT 1");

    let r = await api('POST', '/productos', {
      categoria_id: cat.id, unidad_medida_id: kg.id, nombre: 'TMPDV ROJO ' + SUF, precio_kg: 200, multipresentacion: true,
    });
    const productoId = r.data.id;
    const paquete = (await api('GET', `/productos/${productoId}`)).data.variantes[0];
    const almacen = (await api('GET', '/caja/cajas')).data.find((c) => c.activo).almacen_id;
    const cj = (await api('POST', '/caja/cajas', { almacen_id: almacen, nombre: 'TMPDV Caja ' + SUF })).data;
    const sesion = (await api('POST', '/caja/sesiones', { caja_id: cj.id, monto_inicial: 0 })).data;
    await api('PATCH', `/variantes/${paquete.id}`, { peso_kg: 19 });
    // Tres paquetes de 12 conos (entran con sus kilos) y 60 kg más a granel.
    const P = [18.5, 19.0, 18.8].map((peso, i) => ({ codigo: `TMPDV-${SUF}-${i + 1}`, peso_kg: peso }));
    for (const p of P) {
      await api('POST', `/variantes/${paquete.id}/codigos`, { ...p, conos: 12, lote: 'L1', almacen_id: almacen });
    }
    await api('POST', '/inventario/movimientos', { variante_id: paquete.id, almacen_id: almacen, tipo: 'entrada', cantidad: 60, motivo: 'TMPDV' });
    const cli = (await api('POST', '/clientes', { nombre: 'TMPDV Doña Chela ' + SUF, telefono: '4450000011', limite_credito: 10000 })).data;
    const otro = (await api('POST', '/clientes', { nombre: 'TMPDV Don Juan ' + SUF, telefono: '4450000012' })).data;
    ck('hilo a $200/kg con 3 paquetes (56.3 kg) + 60 kg, caja, turno y clientes',
      !!sesion?.id && !!cli?.id && !!otro?.id && !!metSaldo && (await inv(paquete.id, almacen)) === 116.3,
      await inv(paquete.id, almacen));

    const pos = { canal: 'punto_venta', sesion_caja_id: sesion.id };

    console.log('\n=== 1. Doña Chela se lleva los 3 paquetes y paga en efectivo ===');
    r = await api('POST', '/pedidos', {
      ...pos, cliente_id: cli.id,
      items: [{ variante_id: paquete.id, cantidad: 56.3, bultos: P }],
      pagos: [{ metodo_pago_id: efectivo.id, monto: 11260 }],
    });
    const vA = r.data;
    ck('venta de $11,260 pagada', r.status === 201 && Number(vA?.total) === 11260 && vA?.estado === 'pagado', r.error ?? [vA?.total, vA?.estado]);
    const lineaA = vA.detalle[0].id;

    r = await api('GET', `/pedidos/${vA.id}/devolucion`);
    const pl = r.data?.lineas?.[0];
    ck('lo que puede regresar: 56.3 kg a $200, con sus 3 paquetes', r.status === 200 && r.data?.se_puede === true &&
      pl?.disponible === 56.3 && pl?.precio_kg === 200 && pl?.bultos?.filter((b) => b.devolvible).length === 3,
      r.error ?? pl);

    console.log('\n=== 2. Lo que no se deja ===');
    r = await api('POST', `/pedidos/${vA.id}/devoluciones`, { destino: 'favor', lineas: [{ detalle_id: lineaA }] });
    ck('sin decir qué regresa: 422 DEVOLUCION_VACIA', r.status === 422 && r.error?.code === 'DEVOLUCION_VACIA', r.error?.code);
    r = await api('POST', `/pedidos/${vA.id}/devoluciones`, { destino: 'favor', lineas: [{ detalle_id: lineaA, codigos: ['NO-ES-DE-AQUI'] }] });
    ck('un paquete que no salió en la nota: 422 BULTO_NO_ES_DE_LA_NOTA', r.status === 422 && r.error?.code === 'BULTO_NO_ES_DE_LA_NOTA', r.error?.code);
    r = await api('POST', `/pedidos/${vA.id}/devoluciones`, { destino: 'favor', lineas: [{ detalle_id: lineaA, kg_sueltos: 60 }] });
    ck('más de lo que se llevó: 422 DEVOLUCION_EXCEDE', r.status === 422 && r.error?.code === 'DEVOLUCION_EXCEDE', r.error?.code);
    r = await api('POST', `/pedidos/${vA.id}/devoluciones`, { destino: 'favor', lineas: [{ detalle_id: lineaA, codigos: [P[0].codigo, P[0].codigo] }] });
    ck('el mismo paquete dos veces: 422 BULTO_REPETIDO', r.status === 422 && r.error?.code === 'BULTO_REPETIDO', r.error?.code);

    console.log('\n=== 3. Regresa 2 paquetes intactos (18.5 + 19.0) y 2 conos que pesan 3.2 kg ===');
    const antesPaq = await inv(paquete.id, almacen);
    const cajaAntes = await caja(sesion.id);
    r = await api('POST', `/pedidos/${vA.id}/devoluciones`, {
      destino: 'favor', notas: 'TMPDV',
      lineas: [{ detalle_id: lineaA, codigos: [P[0].codigo, P[1].codigo], kg_sueltos: 3.2, conos: 2 }],
    });
    const d1 = r.data;
    ck('le quedan $8,140 a favor: (37.5 + 3.2) kg × $200', r.status === 201 && d1?.total === 8140 && d1?.kg === 40.7 && d1?.saldo_favor === 8140,
      r.error ?? d1);
    ck('los 2 paquetes regresan cerrados y DISPONIBLES en la tienda',
      (await bulto(P[0].codigo))?.estado === 'disponible' && (await bulto(P[1].codigo))?.estado === 'disponible' &&
        Number((await bulto(P[0].codigo))?.almacen_id) === Number(almacen),
      [await bulto(P[0].codigo), await bulto(P[1].codigo)]);
    ck('el tercero sigue vendido', (await bulto(P[2].codigo))?.estado === 'vendido', await bulto(P[2].codigo));
    ck('el paquete recupera sus 37.5 kg', (await inv(paquete.id, almacen)) === r3(antesPaq + 37.5), await inv(paquete.id, almacen));
    const [[cono]] = await db.query(
      "SELECT id, sku, origen_variante_id FROM producto_variantes WHERE producto_id = ? AND tipo_presentacion = 'cono'", [productoId]
    );
    ck('los 3.2 kg entran como CONO (se creó la presentación)', !!cono && Number(cono.origen_variante_id) === Number(paquete.id) &&
      (await inv(cono.id, almacen)) === 3.2, [cono, cono && (await inv(cono.id, almacen))]);
    const [movs] = await db.query(
      "SELECT variante_id, tipo, cantidad, referencia_tipo, motivo FROM movimientos_inventario WHERE referencia_id = ? AND tipo = 'devolucion' ORDER BY id",
      [vA.id]
    );
    ck('dos movimientos de devolución en el kardex, con el folio', movs.length === 2 &&
      movs.every((x) => x.referencia_tipo === 'pedido' && x.motivo.includes(d1.folio)) && r3(movs[1].cantidad) === 3.2, movs);
    r = await api('GET', `/inventario/movimientos?variante_id=${cono.id}`);
    ck('el kardex lo dice "Devolución del cliente"', r.data?.items?.[0]?.concepto === 'Devolución del cliente', r.data?.items?.[0]?.concepto);
    ck('NO sale dinero de la caja', JSON.stringify(await caja(sesion.id)) === JSON.stringify(cajaAntes), await caja(sesion.id));
    ck('la venta sigue pagada', (await estado(vA.id)) === 'pagado', await estado(vA.id));
    // Lo que regresó ya no cuenta como vendido (2026-10-14): 56.3 − 40.7 = 15.6 kg, $3,120.
    r = await api('GET', `/reportes/venta-por-color?desde=2026-01-01&hasta=2099-12-31&q=${encodeURIComponent('TMPDV ROJO ' + SUF)}`);
    const hiloRep = r.data?.hilos?.[0];
    ck('"Venta por color" cuenta 15.6 kg vendidos ($3,120), no 56.3', hiloRep?.kg_vendidos === 15.6 && hiloRep?.importe === 3120 &&
      hiloRep?.vendido_total === 15.6, r.error ?? hiloRep);
    r = await api('GET', '/reportes/mas-vendidos?limite=1000');
    const mv = r.data?.find?.((x) => Number(x.variante_id) === Number(paquete.id));
    ck('"Más vendidos" también: 15.6 kg del paquete', r3(mv?.unidades_vendidas) === 15.6 && r2(mv?.ingresos) === 3120, r.error ?? mv);
    r = await api('GET', `/pedidos/${vA.id}`);
    ck('el detalle de la venta trae la devolución (paquetes y conos)', r.data?.devuelto_total === 8140 &&
      r.data?.devoluciones?.[0]?.lineas?.length === 2 && r.data.devoluciones[0].lineas[0].codigos.length === 2 &&
      r.data.devoluciones[0].lineas[1].piezas === 2, r.data?.devoluciones);
    r = await api('GET', `/pedidos/${vA.id}/devolucion`);
    ck('ya solo puede regresar 15.6 kg (el tercer paquete)', r.data?.lineas?.[0]?.disponible === 15.6 &&
      r.data.lineas[0].bultos.filter((b) => b.devolvible).length === 1, r.data?.lineas?.[0]);

    r = await api('POST', `/pedidos/${vA.id}/devoluciones`, { destino: 'favor', lineas: [{ detalle_id: lineaA, codigos: [P[0].codigo] }] });
    ck('el mismo paquete no regresa dos veces: 409 BULTO_YA_DEVUELTO', r.status === 409 && r.error?.code === 'BULTO_YA_DEVUELTO', r.error?.code);
    r = await api('POST', `/pedidos/${vA.id}/devoluciones`, { destino: 'favor', lineas: [{ detalle_id: lineaA, kg_sueltos: 16 }] });
    ck('ni más de lo que falta (15.6): 422', r.status === 422 && r.error?.code === 'DEVOLUCION_EXCEDE', r.error?.code);
    r = await api('PATCH', `/pedidos/${vA.id}/estado`, { estado: 'cancelado' });
    ck('ya no se cancela completa: 409 VENTA_CON_DEVOLUCIONES', r.status === 409 && r.error?.code === 'VENTA_CON_DEVOLUCIONES', r.error?.code);

    console.log('\n=== 4. Usa su saldo a favor en otra compra ===');
    r = await api('GET', '/opciones/metodos-pago');
    ck('al cobrar no se ofrece "Saldo a favor" como forma de pago', r.status === 200 && !r.data?.some((x) => x.id === metSaldo.id), r.data);
    r = await api('GET', `/clientes/buscar?q=${encodeURIComponent('Chela ' + SUF)}`);
    ck('la caja ve su saldo a favor al elegirla', r2(r.data?.[0]?.saldo_favor) === 8140, r.data?.[0]?.saldo_favor);
    const item10 = [{ variante_id: paquete.id, cantidad: 10 }];
    r = await api('POST', '/pedidos', { ...pos, items: item10, saldo_favor: 100 });
    ck('sin cliente: 422 SALDO_SIN_CLIENTE', r.status === 422 && r.error?.code === 'SALDO_SIN_CLIENTE', r.error?.code);
    r = await api('POST', '/pedidos', { ...pos, cliente_id: cli.id, items: item10, saldo_favor: 2500 });
    ck('más saldo que la venta: 422 SALDO_MAYOR_AL_TOTAL', r.status === 422 && r.error?.code === 'SALDO_MAYOR_AL_TOTAL', r.error?.code);
    r = await api('POST', '/pedidos', { ...pos, cliente_id: cli.id, items: item10, pagos: [{ metodo_pago_id: metSaldo.id, monto: 2000 }] });
    ck('"Saldo a favor" como pago a mano: 422 METODO_PAGO_INVALIDO', r.status === 422 && r.error?.code === 'METODO_PAGO_INVALIDO', r.error?.code);
    r = await api('POST', '/pedidos', { ...pos, cliente_id: cli.id, items: item10, saldo_favor: 2000, pendiente_pago: true });
    ck('en una nota pendiente de pago no: 422 SALDO_FAVOR_SOLO_AL_COBRAR', r.status === 422 && r.error?.code === 'SALDO_FAVOR_SOLO_AL_COBRAR', r.error?.code);

    const cajaB = await caja(sesion.id);
    r = await api('POST', '/pedidos', { ...pos, cliente_id: cli.id, items: item10, saldo_favor: 2000 });
    const vB = r.data;
    ck('compra $2,000 TODO con saldo a favor: pagada', r.status === 201 && vB?.estado === 'pagado' &&
      vB?.pagos?.some((p) => p.metodo === 'Saldo a favor' && Number(p.monto) === 2000), r.error ?? vB?.pagos);
    ck('no entra nada a la caja', JSON.stringify(await caja(sesion.id)) === JSON.stringify(cajaB), await caja(sesion.id));
    ck('le quedan $6,140 a favor', (await favor(cli.id)) === 6140, await favor(cli.id));

    r = await api('POST', '/pedidos', {
      ...pos, cliente_id: cli.id, items: item10, saldo_favor: 1000, pagos: [{ metodo_pago_id: efectivo.id, monto: 1500 }],
    });
    const vC = r.data;
    ck('compra $2,000: $1,000 de saldo y paga $1,500 en efectivo → $500 de cambio', r.status === 201 && vC?.estado === 'pagado' &&
      Number(vC?.cambio) === 500, r.error ?? [vC?.estado, vC?.cambio]);
    ck('al cajón entran solo $1,000', (await caja(sesion.id)).at(-1) === 'venta:1000', await caja(sesion.id));
    ck('le quedan $5,140 a favor', (await favor(cli.id)) === 5140, await favor(cli.id));

    r = await api('POST', '/pedidos', { ...pos, cliente_id: cli.id, items: [{ variante_id: paquete.id, cantidad: 30 }], saldo_favor: 6000 });
    ck('no le alcanza ($6,000 de $5,140): 409 SALDO_FAVOR_INSUFICIENTE', r.status === 409 && r.error?.code === 'SALDO_FAVOR_INSUFICIENTE', r.error?.code);

    console.log('\n=== 5. Se cancela la compra pagada con saldo: el saldo le regresa ===');
    r = await api('PATCH', `/pedidos/${vB.id}/estado`, { estado: 'cancelado' });
    ck('se cancela', r.status === 200, r.error);
    ck('los $2,000 vuelven a su saldo a favor ($7,140)', (await favor(cli.id)) === 7140, await favor(cli.id));
    ck('y no sale efectivo de la caja', !(await caja(sesion.id)).some((x) => x.startsWith('devolucion')), await caja(sesion.id));
    r = await api('PATCH', `/pedidos/${vB.id}/estado`, { estado: 'cancelado' });
    ck('cancelar dos veces no lo regresa dos veces', (await favor(cli.id)) === 7140, await favor(cli.id));
    r = await api('PATCH', `/pedidos/${vB.id}/estado`, { estado: 'pagado' });
    ck('no se reactiva: 409 VENTA_CON_SALDO_FAVOR', r.status === 409 && r.error?.code === 'VENTA_CON_SALDO_FAVOR', r.error?.code);

    console.log('\n=== 6. Lo que regresa se DESCUENTA de lo que debe ===');
    r = await api('POST', '/pedidos', { ...pos, cliente_id: cli.id, pendiente_pago: true, items: item10 });
    const nN = r.data;
    r = await api('POST', '/pedidos', { ...pos, cliente_id: cli.id, a_credito: 1000, items: [{ variante_id: paquete.id, cantidad: 5 }] });
    const vF = r.data;
    ck('una nota pendiente de $2,000 y una venta a crédito de $1,000', Number(nN?.total) === 2000 && vF?.estado === 'pendiente',
      [nN?.total, vF?.estado, r.error]);
    r = await api('GET', `/clientes/${cli.id}`);
    ck('su expediente: $7,140 a favor y debe $3,000 (crédito 1,000 + notas 2,000)',
      r.data?.saldo_favor === 7140 && r.data?.deuda_total?.credito === 1000 && r.data?.deuda_total?.notas === 2000,
      [r.data?.saldo_favor, r.data?.deuda_total]);

    r = await api('POST', `/pedidos/${nN.id}/devoluciones`, {
      destino: 'deuda', lineas: [{ detalle_id: nN.detalle[0].id, kg_sueltos: 4, conos: 3 }],
    });
    ck('regresa 4 kg de la nota pendiente: $800 que se descuentan de ESA nota', r.status === 201 && r.data?.total === 800 &&
      r.data?.aplicado_a_deuda === 800 && r.data?.aplicaciones?.[0]?.pedido_id === nN.id, r.error ?? r.data);
    r = await api('GET', '/pedidos/notas-pendientes');
    ck('a la nota le faltan $1,200 y su saldo a favor sigue igual ($7,140)',
      r.data?.items?.find((x) => x.id === nN.id)?.falta === 1200 && (await favor(cli.id)) === 7140,
      [r.data?.items?.find((x) => x.id === nN.id)?.falta, await favor(cli.id)]);

    console.log('\n=== 7. Desde su expediente: "aplica mi saldo a lo que debo" ===');
    r = await api('POST', `/clientes/${cli.id}/saldo-favor/aplicar`, {});
    ck('se aplican $2,200: la nota ($1,200) y su cuenta de crédito ($1,000)', r.status === 200 && r.data?.aplicado === 2200 &&
      r.data?.saldo_favor === 4940 && r.data?.deuda_total?.total === 0, r.error ?? r.data);
    ck('la nota queda pagada y la venta a crédito también', (await estado(nN.id)) === 'pagado' && (await estado(vF.id)) === 'pagado',
      [await estado(nN.id), await estado(vF.id)]);
    r = await api('POST', `/clientes/${cli.id}/saldo-favor/aplicar`, {});
    ck('ya no debe nada: 409 SIN_DEUDA (el saldo se queda para sus compras)', r.status === 409 && r.error?.code === 'SIN_DEUDA', r.error?.code);
    r = await api('GET', `/clientes/${cli.id}`);
    ck('sus movimientos dicen de dónde salió y en qué se usó', r.data?.saldo_favor_movimientos?.length >= 6 &&
      r.data.saldo_favor_movimientos.some((x) => x.tipo === 'reintegro') && r.data.saldo_favor_movimientos.some((x) => x.devolucion_folio),
      r.data?.saldo_favor_movimientos?.map((x) => x.tipo));

    console.log('\n=== 8. Una venta sin cliente: se elige a quién se le pone el saldo ===');
    r = await api('POST', '/pedidos', { ...pos, items: [{ variante_id: paquete.id, cantidad: 2 }], pagos: [{ metodo_pago_id: efectivo.id, monto: 400 }] });
    const vG = r.data;
    r = await api('POST', `/pedidos/${vG.id}/devoluciones`, { destino: 'favor', lineas: [{ detalle_id: vG.detalle[0].id, kg_sueltos: 1 }] });
    ck('sin cliente: 422 DEVOLUCION_SIN_CLIENTE', r.status === 422 && r.error?.code === 'DEVOLUCION_SIN_CLIENTE', r.error?.code);
    r = await api('POST', `/pedidos/${vG.id}/devoluciones`, {
      destino: 'favor', cliente_id: otro.id, lineas: [{ detalle_id: vG.detalle[0].id, kg_sueltos: 1 }],
    });
    ck('con Don Juan: le quedan $200 a favor', r.status === 201 && r.data?.total === 200 && (await favor(otro.id)) === 200, r.error ?? r.data);

    console.log('\n=== 9. Una nota en espera todavía no se devuelve ===');
    r = await api('POST', '/pedidos', { ...pos, encargo: true, cliente_id: cli.id, items: [{ variante_id: paquete.id, cantidad: 1 }] });
    const eH = r.data;
    r = await api('POST', `/pedidos/${eH.id}/devoluciones`, { destino: 'favor', lineas: [{ detalle_id: eH.detalle[0].id, kg_sueltos: 1 }] });
    ck('409 NO_SE_HA_ENTREGADO', r.status === 409 && r.error?.code === 'NO_SE_HA_ENTREGADO', r.error?.code);

    console.log('\n=== 10. Una venta A CRÉDITO sin pagar: lo que regresa se descuenta de ESA nota (2026-10-14) ===');
    const jc = (await api('POST', '/clientes', { nombre: 'TMPDV Tejidos JC ' + SUF, telefono: '4450000013', limite_credito: 10000 })).data;
    const posJ = { ...pos, cliente_id: jc.id };
    r = await api('POST', '/pedidos', { ...posJ, a_credito: 1000, items: [{ variante_id: paquete.id, cantidad: 5 }] });
    const vieja = r.data;
    r = await api('POST', '/pedidos', { ...posJ, a_credito: 2000, items: item10 });
    const nueva = r.data;
    ck('dos ventas a crédito: una más vieja de $1,000 y esta de $2,000', vieja?.estado === 'pendiente' && nueva?.estado === 'pendiente',
      [vieja?.estado, nueva?.estado, r.error]);
    r = await api('GET', `/pedidos/${nueva.id}/devolucion`);
    ck('la vista previa dice que esta nota debe $2,000 (a crédito)', r.data?.debe_esta === 2000 && r.data?.debe_esta_tipo === 'credito',
      [r.data?.debe_esta, r.data?.debe_esta_tipo]);
    r = await api('POST', `/pedidos/${nueva.id}/devoluciones`, {
      destino: 'favor', lineas: [{ detalle_id: nueva.detalle[0].id, kg_sueltos: 4, conos: 3 }],
    });
    ck('regresa 4 kg ($800): se descuentan de ESTA nota, sin elegirlo', r.status === 201 && r.data?.descontado_de_esta === 800 &&
      r.data?.aplicado_a_deuda === 800, r.error ?? r.data);
    const debeVenta = async (id) => (await api('GET', `/pedidos/${id}`)).data?.credito_por_pagar;
    ck('esta nota debe $1,200 y la más vieja sigue debiendo $1,000 (no se fue a lo más viejo)',
      (await debeVenta(nueva.id)) === 1200 && (await debeVenta(vieja.id)) === 1000, [await debeVenta(nueva.id), await debeVenta(vieja.id)]);
    ck('no le quedó saldo a favor: todo se descontó', (await favor(jc.id)) === 0, await favor(jc.id));
    r = await api('GET', `/clientes/${jc.id}`);
    ck('su cuenta: debe $2,200 ($1,000 + $1,200)', r.data?.deuda_total?.credito === 2200, r.data?.deuda_total);
    r = await api('POST', `/pedidos/${nueva.id}/devoluciones`, {
      destino: 'favor', lineas: [{ detalle_id: nueva.detalle[0].id, kg_sueltos: 6 }],
    });
    ck('regresa lo demás ($1,200): esta nota queda PAGADA', r.status === 201 && r.data?.descontado_de_esta === 1200 &&
      (await estado(nueva.id)) === 'pagado', r.error ?? [r.data?.descontado_de_esta, await estado(nueva.id)]);
    ck('y la más vieja sigue debiendo sus $1,000', (await debeVenta(vieja.id)) === 1000 && (await estado(vieja.id)) === 'pendiente',
      [await debeVenta(vieja.id), await estado(vieja.id)]);

    console.log('\n=== 11. Regresa MÁS de lo que debe la nota: lo que sobra queda a favor ===');
    r = await api('POST', '/pedidos', { ...posJ, pendiente_pago: true, items: [{ variante_id: paquete.id, cantidad: 5 }] });
    const notaJ = r.data;
    await api('POST', `/pedidos/${notaJ.id}/abonos`, { monto: 600, metodo_pago_id: transferencia.id });
    r = await api('GET', `/pedidos/${notaJ.id}/devolucion`);
    ck('una nota pendiente de $1,000 que ya pagó $600: debe $400', r.data?.debe_esta === 400 && r.data?.debe_esta_tipo === 'nota',
      [r.data?.debe_esta, r.data?.debe_esta_tipo]);
    r = await api('POST', `/pedidos/${notaJ.id}/devoluciones`, { destino: 'favor', lineas: [{ detalle_id: notaJ.detalle[0].id, kg_sueltos: 5 }] });
    ck('regresa todo ($1,000): se descuentan los $400 y quedan $600 a favor', r.status === 201 && r.data?.descontado_de_esta === 400 &&
      r.data?.saldo_favor === 600 && (await estado(notaJ.id)) === 'pagado', r.error ?? [r.data, await estado(notaJ.id)]);

    console.log('\n=== 12. ANTICIPO: dinero a cuenta, sin nota, en efectivo y transferencia (2026-10-14) ===');
    const antes12 = await favor(otro.id);
    r = await api('POST', `/clientes/${otro.id}/anticipos`, {});
    ck('sin decir cuánto: 422 ANTICIPO_VACIO', r.status === 422 && r.error?.code === 'ANTICIPO_VACIO', r.error?.code);
    r = await api('POST', `/clientes/${otro.id}/anticipos`, { efectivo: 600 });
    ck('efectivo sin turno de caja: 409 FALTA_SESION_CAJA', r.status === 409 && r.error?.code === 'FALTA_SESION_CAJA', r.error?.code);
    const cajaA = await caja(sesion.id);
    r = await api('POST', `/clientes/${otro.id}/anticipos`, {
      efectivo: 600, transferencia: 400, sesion_caja_id: sesion.id, referencia: 'TMPDV folio 123',
    });
    ck('deja $600 en efectivo y $400 por transferencia: $1,000 más a favor', r.status === 201 && r.data?.total === 1000 &&
      r.data?.saldo_favor === r2(antes12 + 1000), r.error ?? r.data);
    ck('al turno entran solo los $600 del efectivo, como ingreso', JSON.stringify((await caja(sesion.id)).slice(cajaA.length)) === JSON.stringify(['ingreso:600']),
      (await caja(sesion.id)).slice(cajaA.length));
    r = await api('GET', `/clientes/${otro.id}`);
    const ants = (r.data?.saldo_favor_movimientos ?? []).filter((m) => m.tipo === 'anticipo');
    ck('su expediente dice cada parte con su forma de pago', ants.length === 2 && ants.some((m) => m.metodo?.startsWith('Efectivo') && Number(m.monto) === 600) &&
      ants.some((m) => m.metodo?.startsWith('Transferencia') && m.referencia === 'TMPDV folio 123'), ants);
    r = await api('POST', '/pedidos', { ...pos, cliente_id: otro.id, items: [{ variante_id: paquete.id, cantidad: 5 }], saldo_favor: 1000 });
    ck('con su anticipo se lleva $1,000 de hilo: pagado, sin dinero en la caja', r.status === 201 && r.data?.estado === 'pagado' &&
      (await favor(otro.id)) === r2(antes12), r.error ?? [r.data?.estado, await favor(otro.id)]);

    console.log('\n=== 13. Cobrar con efectivo Y transferencia (2026-10-14) ===');
    const cajaM = await caja(sesion.id);
    r = await api('POST', '/pedidos', {
      ...pos, items: item10,
      pagos: [{ metodo_pago_id: transferencia.id, monto: 500 }, { metodo_pago_id: efectivo.id, monto: 2000 }],
    });
    const vM = r.data;
    ck('venta de $2,000: $500 por transferencia y le dan $2,000 en efectivo → $500 de cambio', r.status === 201 && vM?.estado === 'pagado' &&
      Number(vM?.cambio) === 500, r.error ?? [vM?.estado, vM?.cambio]);
    ck('quedan dos pagos: $500 de transferencia y $1,500 de efectivo', vM?.pagos?.length === 2 &&
      vM.pagos.some((p) => p.metodo.startsWith('Transferencia') && Number(p.monto) === 500) &&
      vM.pagos.some((p) => p.metodo.startsWith('Efectivo') && Number(p.monto) === 1500), vM?.pagos);
    ck('al cajón entran solo los $1,500 del efectivo', JSON.stringify((await caja(sesion.id)).slice(cajaM.length)) === JSON.stringify(['venta:1500']),
      (await caja(sesion.id)).slice(cajaM.length));
    r = await api('POST', '/pedidos', { ...pos, items: item10, pagos: [{ metodo_pago_id: transferencia.id, monto: 2500 }] });
    ck('la transferencia no da cambio: $2,500 para $2,000 → 422 PAGO_EXCEDE_TOTAL', r.status === 422 && r.error?.code === 'PAGO_EXCEDE_TOTAL', r.error?.code);
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    console.log('\nLimpiando…');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    const [cls] = await db.query("SELECT id FROM clientes WHERE nombre LIKE 'TMPDV %'");
    const cids = cls.map((x) => x.id);
    const [prods] = await db.query("SELECT id FROM productos WHERE nombre LIKE 'TMPDV %'");
    const pr = prods.map((x) => x.id);
    const [vs] = pr.length ? await db.query('SELECT id FROM producto_variantes WHERE producto_id IN (?)', [pr]) : [[]];
    const vids = vs.map((v) => v.id);
    const [peds] = vids.length
      ? await db.query('SELECT DISTINCT pedido_id FROM pedido_detalle WHERE variante_id IN (?)', [vids])
      : [[]];
    const pids = peds.map((x) => x.pedido_id);
    if (pids.length) {
      await db.query(
        `DELETE b FROM devolucion_bultos b JOIN devolucion_detalle d ON d.id = b.devolucion_detalle_id
           JOIN devoluciones v ON v.id = d.devolucion_id WHERE v.pedido_id IN (?)`, [pids]
      );
      await db.query('DELETE d FROM devolucion_detalle d JOIN devoluciones v ON v.id = d.devolucion_id WHERE v.pedido_id IN (?)', [pids]);
      await db.query('DELETE FROM devoluciones WHERE pedido_id IN (?)', [pids]);
      await db.query('DELETE b FROM pedido_detalle_bultos b JOIN pedido_detalle d ON d.id = b.detalle_id WHERE d.pedido_id IN (?)', [pids]);
      for (const tb of ['pagos', 'pedido_detalle']) await db.query(`DELETE FROM ${tb} WHERE pedido_id IN (?)`, [pids]);
      await db.query('DELETE FROM credito_movimientos WHERE pedido_id IN (?)', [pids]);
      await db.query('DELETE FROM pedidos WHERE id IN (?)', [pids]);
    }
    if (cids.length) {
      await db.query('DELETE FROM saldo_favor_movimientos WHERE cliente_id IN (?)', [cids]);
      await db.query('DELETE FROM credito_movimientos WHERE cliente_id IN (?)', [cids]);
      await db.query('DELETE FROM clientes WHERE id IN (?)', [cids]);
    }
    if (vids.length) {
      for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) {
        await db.query(`DELETE FROM ${tb} WHERE variante_id IN (?)`, [vids]);
      }
      await db.query('DELETE FROM producto_variantes WHERE id IN (?)', [vids]);
    }
    if (pr.length) await db.query('DELETE FROM productos WHERE id IN (?)', [pr]);
    const [cjs] = await db.query("SELECT id FROM cajas WHERE nombre LIKE 'TMPDV Caja%'");
    if (cjs.length) {
      const [ses] = await db.query('SELECT id FROM sesiones_caja WHERE caja_id IN (?)', [cjs.map((x) => x.id)]);
      await borrarTurnosPropios(db, ses.map((x) => x.id));
      await borrarCajasSinTurnos(db, cjs.map((x) => x.id));
    }
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    const [[{ n }]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM productos WHERE nombre LIKE 'TMPDV %') + (SELECT COUNT(*) FROM clientes WHERE nombre LIKE 'TMPDV %')
            + (SELECT COUNT(*) FROM cajas WHERE nombre LIKE 'TMPDV Caja%')
            + (SELECT COUNT(*) FROM devoluciones d LEFT JOIN pedidos p ON p.id = d.pedido_id WHERE p.id IS NULL) AS n`
    );
    ck('no quedó basura (TMPDV)', Number(n) === 0, n);
    await db.end();
  }

  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
