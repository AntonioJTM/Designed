'use strict';

/**
 * Prueba del traspaso por PAQUETES con pesos reales.
 *
 * El problema que resuelve: quien surte pide "5 paquetes de blanco", no kilos,
 * porque los paquetes son cerrados y cada uno pesa distinto. Antes se descontaba
 * paquetes × peso NOMINAL y eso nunca cuadraba. Ahora se aparta y se descuenta
 * paquetes × el peso PROMEDIO REAL de los paquetes que hay en el origen: quien
 * surte agarra los que tenga a la mano, no los más antiguos (usuario,
 * 2026-10-06). Al ENVIAR se escanea cada paquete que sale y sale SU peso real;
 * sin escanear no se envía.
 *
 *   cd backend
 *   PORT=3234 node src/server.js &
 *   node scripts/e2e-traspaso-paquetes.js
 *
 * Crea todo con prefijo PP y lo borra al terminar. Sale 1 si algo falla.
 */

const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// Se niega a correr contra la base del servidor. Ver el módulo.
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const ARCHIVO = path.join(__dirname, '..', '..', 'muestras', 'BLANCO 2-30.xlsx');
const B = process.env.BASE ?? 'http://localhost:3234/api/v1';
const t = jwt.sign({ sub: 1, tipo: 'usuario', rol_id: 1, rol: 'administrador' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const SUF = '-P' + Date.now().toString(36);

const api = async (me, r, b) => {
  const x = await fetch(B + r, { method: me, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: x.status, ...(await x.json().catch(() => ({}))) };
};
let f = 0;
const ck = (n, ok, d) => { console.log((ok ? '  ok  ' : ' FALLA') + ' · ' + n + (d !== undefined ? ' → ' + d : '')); if (!ok) f++; };
const r3 = (n) => Math.round(n * 1000) / 1000;

(async () => {
  const db = await m.createConnection({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const antes = new Set((await db.query('SELECT id FROM productos'))[0].map((r) => r.id));
  const st = async (v, a) => Number(((await db.query('SELECT cantidad c FROM inventario WHERE variante_id=? AND almacen_id=?', [v, a]))[0][0] || { c: 0 }).c);
  const cuenta = async (v, a) => (await db.query('SELECT COUNT(*) n FROM variante_codigos WHERE variante_id=? AND almacen_id=?', [v, a]))[0][0].n;

  try {
    const cat = (await api('GET', '/categorias')).data.items[0].id;
    const kgu = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;
    const bod = (await api('POST', '/almacenes', { nombre: 'PP Bodega' })).data.id;
    const tda = (await api('POST', '/almacenes', { nombre: 'PP Tienda', es_punto_venta: true })).data.id;
    const p = (await api('POST', '/productos', { categoria_id: cat, unidad_medida_id: kgu, nombre: 'PP BLANCO', precio_kg: 180, multipresentacion: true, por_lotes: true })).data.id;
    const previa = await (await fetch(B + '/remesas/previa', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/octet-stream' }, body: fs.readFileSync(ARCHIVO) })).json();
    const bultos = previa.data.bultos.map((b) => ({ ...b, codigo: b.codigo + SUF }));
    await api('POST', '/remesas', { producto_id: p, almacen_id: bod, bultos });
    const pv = (await api('GET', '/productos/' + p)).data.variantes[0];

    console.log('=== 1. "Quiero 100 kg": ¿cuántos paquetes son? ===');
    let r = await api('GET', `/inventario/equivalencia-paquetes?variante_id=${pv.id}&almacen_id=${bod}&kg=100`);
    ck('cuenta los paquetes del origen', r.data.disponible.paquetes === 80, `${r.data.disponible.paquetes} paquetes · ${r.data.disponible.kg_en_bultos} kg`);
    ck('usa el peso REAL, no el nominal', !r.data.referencia_nominal, `promedio ${r.data.peso_referencia} kg`);
    ck('da las dos opciones (por debajo y por arriba)', r.data.sugerencia.opciones.length === 2,
      r.data.sugerencia.opciones.map((o) => `${o.paquetes}→${o.kg_aprox}kg (${o.diferencia > 0 ? '+' : ''}${o.diferencia})`).join(' · '));

    // Con el promedio redondeado, pedir TODOS los paquetes podía dar unos gramos
    // más de los que hay y no dejaba: se multiplica por kilos ÷ paquetes.
    const hay = r.data.disponible;
    const todos = await api('POST', '/inventario/traspasos', { almacen_origen_id: bod, almacen_destino_id: tda, items: [{ variante_id: pv.id, paquetes: hay.paquetes }] });
    ck('se pueden pedir TODOS los paquetes: son exactamente los kilos que hay', todos.status === 201 && Number(todos.data.lineas[0].cantidad) === hay.kg_en_bultos,
      `${todos.status} · ${todos.data?.lineas?.[0]?.cantidad ?? todos.error?.message} = ${hay.kg_en_bultos} kg`);
    if (todos.status === 201) await api('POST', `/inventario/traspasos/${todos.data.id}/cancelar`, {});

    console.log('\n=== 2. Pido 5 paquetes (≈ 5 × el promedio) y al surtir escaneo 5 ===');
    // Los que agarró quien surte: NO los más antiguos.
    const cinco = bultos.slice(10, 15);
    const pesoCinco = r3(cinco.reduce((s, b) => s + b.peso_kg, 0));
    const promedio = r.data.peso_referencia;
    const real = r3((5 * hay.kg_en_bultos) / hay.paquetes);
    const kgAntes = await st(pv.id, bod);
    // El traspaso son TRES pasos desde el 2026-07-28: solicitar aparta, enviar
    // descuenta y mueve los bultos. Los bultos se eligen AL ENVIAR, no al
    // solicitar, porque el mostrador pudo vender alguno entremedio.
    r = await api('POST', '/inventario/traspasos', { almacen_origen_id: bod, almacen_destino_id: tda, items: [{ variante_id: pv.id, paquetes: 5 }] });
    ck('la solicitud pasa', r.status === 201, r.data.folio);
    ck('aparta 5 × el promedio real', Number(r.data.lineas[0].cantidad) === real, `${r.data.lineas[0].cantidad} ≈ 5 × ${promedio}`);
    ck('solicitar no mueve mercancía todavía', (await st(pv.id, bod)) === kgAntes, `${await st(pv.id, bod)} kg`);
    const folio = r.data.id;

    // "Aquí cada cosa que sale se escanea, no se puede enviar si no se escanea."
    r = await api('POST', `/inventario/traspasos/${folio}/enviar`);
    ck('sin escanear no se envía: SIN_ESCANEAR', r.status === 422 && r.error?.code === 'SIN_ESCANEAR', `${r.status} ${r.error?.code}`);
    ck('y no movió nada', (await st(pv.id, bod)) === kgAntes, `${await st(pv.id, bod)} kg`);

    r = await api('POST', `/inventario/traspasos/${folio}/enviar`, { codigos: cinco.map((b) => b.codigo) });
    const l = r.data.lineas[0];
    ck('el envío escaneado pasa', r.status === 200, r.data.estado);
    ck('descuenta el peso REAL de los 5 escaneados (no lo apartado)', Number(l.cantidad) === pesoCinco, `${l.cantidad} kg · se apartaron ${real}`);
    ck('mueve esos 5', l.bultos?.length === 5, (l.bultos ?? []).map((b) => b.peso_kg).join(' + '));

    // Y el destino solo recibe cuando alguien acusa: hasta entonces va en camino.
    ck('en tránsito NO está aún en la tienda', (await st(pv.id, tda)) === 0, `${await st(pv.id, tda)} kg`);
    r = await api('POST', `/inventario/traspasos/${folio}/recibir`);
    ck('al recibir entra a la tienda', r.status === 200, r.data.estado);
    ck('la bodega baja exactamente eso', Math.abs(kgAntes - (await st(pv.id, bod)) - pesoCinco) < 0.001, `${kgAntes} → ${await st(pv.id, bod)}`);
    ck('la tienda recibe exactamente eso', Math.abs((await st(pv.id, tda)) - pesoCinco) < 0.001, (await st(pv.id, tda)) + ' kg');

    console.log('\n=== 3. Los bultos viajaron con la mercancía ===');
    ck('5 bultos en la tienda', (await cuenta(pv.id, tda)) === 5);
    ck('75 siguen en la bodega', (await cuenta(pv.id, bod)) === 75);
    const [cuales] = await db.query('SELECT codigo FROM variante_codigos WHERE almacen_id=? ORDER BY id', [tda]);
    ck('son los escaneados, no los más antiguos', cuales.map((c) => c.codigo).join() === cinco.map((b) => b.codigo).join());

    // Lo que no puede pasar es que se pierda o se invente mercancía entre los dos almacenes.
    console.log('\n=== 4. No se pierde ni se inventa nada entre los dos almacenes ===');
    ck('bodega + tienda = lo que había', Math.abs((await st(pv.id, bod)) + (await st(pv.id, tda)) - kgAntes) < 0.001,
      `${await st(pv.id, bod)} + ${await st(pv.id, tda)} = ${kgAntes}`);

    console.log('\n=== 5. Desde la tienda ya se puede bajar a mostrador ===');
    r = await api('GET', '/inventario/desarmes/previa/' + cinco[0].codigo);
    ck('el bulto se ubica donde llegó', r.status === 200,
      r.data.existencias.map((e) => `${e.almacen} (${e.cantidad} kg)`).join(' · '));

    console.log('\n=== 6. Pedir más de lo que hay ===');
    r = await api('POST', '/inventario/traspasos', { almacen_origen_id: bod, almacen_destino_id: tda, items: [{ variante_id: pv.id, paquetes: 500 }] });
    ck('409 STOCK_INSUFICIENTE al solicitar', r.status === 409, `${r.status} ${r.error?.code}`);
    ck('y no movió nada', (await cuenta(pv.id, tda)) === 5);

    // Si se piden más paquetes que bultos ubicados (mercancía que entró por
    // ajuste), se aparta al promedio; al surtir salen los que se escanean.
    console.log('\n=== 7. Más paquetes que bultos ubicados ===');
    const pesoPaq = Number(pv.peso_kg);
    const saldoBod = await st(pv.id, bod);
    const ajustado = r3(saldoBod + 3 * pesoPaq);
    r = await api('POST', '/inventario/movimientos', { variante_id: pv.id, almacen_id: bod, tipo: 'ajuste', cantidad: ajustado, motivo: 'PP conteo sin bultos' });
    ck('entran kilos sin bulto (ajuste)', r.status === 201, `${saldoBod} → ${await st(pv.id, bod)} kg`);
    r = await api('GET', `/inventario/equivalencia-paquetes?variante_id=${pv.id}&almacen_id=${bod}&kg=1`);
    const quedan = r.data.disponible;
    ck('el promedio sale de los 75 que quedan', !r.data.referencia_nominal && quedan.paquetes === 75, `${r.data.peso_referencia} kg`);
    const esperado = r3((77 * quedan.kg_en_bultos) / quedan.paquetes);
    r = await api('POST', '/inventario/traspasos', { almacen_origen_id: bod, almacen_destino_id: tda, items: [{ variante_id: pv.id, paquetes: 77 }] });
    ck('la solicitud de 77 paquetes pasa', r.status === 201, `${r.status} ${r.error?.message ?? r.data?.folio}`);
    ck('aparta 77 × el promedio (lo mismo que dice la pantalla)', Number(r.data?.lineas?.[0]?.cantidad) === esperado,
      `${r.data?.lineas?.[0]?.cantidad} = ${esperado} kg`);
    const folio77 = r.data?.id;
    const [losDe75] = await db.query("SELECT codigo FROM variante_codigos WHERE variante_id=? AND almacen_id=? AND estado='disponible'", [pv.id, bod]);
    r = await api('POST', `/inventario/traspasos/${folio77}/enviar`, { codigos: losDe75.map((b) => b.codigo) });
    ck('el envío de los 75 escaneados pasa', r.status === 200, `${r.status} ${r.error?.message ?? r.data?.estado}`);
    ck('sale el peso real de los 75 (no los 77 aproximados)', Number(r.data?.lineas?.[0]?.cantidad) === quedan.kg_en_bultos && r.data?.lineas?.[0]?.paquetes === 75,
      `${r.data?.lineas?.[0]?.paquetes} paq · ${r.data?.lineas?.[0]?.cantidad} kg`);
    ck('viajan los 75', (await cuenta(pv.id, bod)) === 0 && (await cuenta(pv.id, tda)) === 80,
      `bodega ${await cuenta(pv.id, bod)} · tienda ${await cuenta(pv.id, tda)}`);
    await api('POST', `/inventario/traspasos/${folio77}/cancelar`, {});
    ck('cancelarlo en tránsito regresa los kilos al origen', Math.abs((await st(pv.id, bod)) - ajustado) < 0.001,
      `${await st(pv.id, bod)} kg`);
    // Solo los 75 que viajaron en ESE envío: los 5 del primer traspaso ya se
    // recibieron y son de la tienda. Antes regresaban los 80.
    ck('y regresan SOLO los bultos de ese envío', (await cuenta(pv.id, bod)) === 75 && (await cuenta(pv.id, tda)) === 5,
      `bodega ${await cuenta(pv.id, bod)} · tienda ${await cuenta(pv.id, tda)}`);

    // Al surtir SE ESCANEAN los paquetes que salen (usuario, 2026-10-06): sale su
    // peso real y viajan esos, no los más antiguos.
    console.log('\n=== 8. Surtir escaneando los paquetes que salen ===');
    const apartadoDe = async (a) => Number(((await db.query('SELECT cantidad_reservada r FROM inventario WHERE variante_id=? AND almacen_id=?', [pv.id, a]))[0][0] || { r: 0 }).r);
    const reservaAntes = await apartadoDe(bod);
    r = await api('POST', '/inventario/traspasos', { almacen_origen_id: bod, almacen_destino_id: tda, items: [{ variante_id: pv.id, paquetes: 3 }] });
    ck('se piden 3 paquetes', r.status === 201, r.data?.folio);
    const folioEsc = r.data.id;
    // Los que agarró quien surte: los MÁS NUEVOS, para que se note que no son los más antiguos.
    const [agarrados] = await db.query("SELECT codigo, peso_kg FROM variante_codigos WHERE variante_id=? AND almacen_id=? AND estado='disponible' ORDER BY id DESC LIMIT 3", [pv.id, bod]);
    const codigos = agarrados.map((b) => b.codigo);
    const pesoReal = r3(agarrados.reduce((s, b) => s + Number(b.peso_kg), 0));
    const saldoAntesEnvio = await st(pv.id, bod);
    const enviarCon = (c) => api('POST', `/inventario/traspasos/${folioEsc}/enviar`, { codigos: c });

    r = await enviarCon([codigos[0], codigos[0]]);
    ck('un paquete escaneado dos veces: BULTO_REPETIDO', r.error?.code === 'BULTO_REPETIDO', `${r.status} ${r.error?.code}`);
    r = await enviarCon(['NOEXISTE' + SUF]);
    ck('un código que no existe: CODIGO_DESCONOCIDO', r.error?.code === 'CODIGO_DESCONOCIDO', `${r.status} ${r.error?.code}`);
    if (pv.codigo_barras) {
      r = await enviarCon([pv.codigo_barras]);
      ck('el código de la presentación no es un paquete: CODIGO_NO_ES_PAQUETE', r.error?.code === 'CODIGO_NO_ES_PAQUETE', `${r.status} ${r.error?.code}`);
    }
    // Un paquete de OTRO hilo (cualquiera disponible de la base: solo se lee, el envio se rechaza).
    const [[otro]] = await db.query("SELECT codigo FROM variante_codigos WHERE variante_id<>? AND estado='disponible' AND peso_kg IS NOT NULL LIMIT 1", [pv.id]);
    if (otro) {
      r = await enviarCon([otro.codigo]);
      ck('un paquete de otro hilo: BULTO_NO_ES_DEL_TRASPASO', r.error?.code === 'BULTO_NO_ES_DEL_TRASPASO', `${r.status} ${r.error?.code}`);
    }
    await db.query("UPDATE variante_codigos SET estado='vendido' WHERE codigo=?", [codigos[2]]);
    r = await enviarCon(codigos);
    ck('un paquete ya vendido: BULTO_NO_DISPONIBLE', r.status === 409 && r.error?.code === 'BULTO_NO_DISPONIBLE', `${r.status} ${r.error?.message}`);
    await db.query("UPDATE variante_codigos SET estado='disponible' WHERE codigo=?", [codigos[2]]);
    ck('los rechazos no movieron nada', (await st(pv.id, bod)) === saldoAntesEnvio, `${await st(pv.id, bod)} kg`);

    r = await enviarCon(codigos);
    const le = r.data?.lineas?.[0];
    ck('el envío escaneado pasa', r.status === 200, `${r.status} ${r.error?.message ?? r.data?.estado}`);
    ck('sale el peso REAL de los escaneados', Number(le?.cantidad) === pesoReal, `${le?.cantidad} = ${pesoReal} kg`);
    ck('la línea queda con los 3 paquetes escaneados', le?.paquetes === 3, `${le?.paquetes} paquetes`);
    ck('la bodega baja exactamente eso', Math.abs(saldoAntesEnvio - (await st(pv.id, bod)) - pesoReal) < 0.001, `${saldoAntesEnvio} → ${await st(pv.id, bod)}`);
    ck('se libera lo apartado', (await apartadoDe(bod)) === reservaAntes, `${await apartadoDe(bod)} kg apartados`);
    const [donde] = await db.query('SELECT DISTINCT almacen_id a FROM variante_codigos WHERE codigo IN (?)', [codigos]);
    ck('viajan ESOS paquetes (no los más antiguos)', donde.length === 1 && donde[0].a === tda, donde.map((x) => x.a).join());
    const tdaAntes = await st(pv.id, tda);
    r = await api('POST', `/inventario/traspasos/${folioEsc}/recibir`);
    ck('al recibir, la tienda recibe su peso real', Math.abs((await st(pv.id, tda)) - tdaAntes - pesoReal) < 0.001, `${tdaAntes} → ${await st(pv.id, tda)}`);

    // SE MANDA LO QUE HAY (usuario, 2026-10-06): "si pido 20 de negro 1/30 y solo
    // tengo 15, que se envíen esos y nada más", y que la nota diga por qué.
    console.log('\n=== 9. Se manda lo que hay: menos paquetes, y un hilo que no sale ===');
    const p2 = (await api('POST', '/productos', { categoria_id: cat, unidad_medida_id: kgu, nombre: 'PP NEGRO', precio_kg: 180, multipresentacion: true, por_lotes: true })).data.id;
    await api('POST', '/remesas', { producto_id: p2, almacen_id: bod, bultos: previa.data.bultos.slice(0, 3).map((b) => ({ ...b, codigo: b.codigo + SUF + 'N' })) });
    const pv2 = (await api('GET', '/productos/' + p2)).data.variantes[0];
    const apartadoDe2 = async () => Number(((await db.query('SELECT cantidad_reservada r FROM inventario WHERE variante_id=? AND almacen_id=?', [pv2.id, bod]))[0][0] || { r: 0 }).r);
    const negroAntes = await st(pv2.id, bod);
    const reservaBlanco = await apartadoDe(bod);
    r = await api('POST', '/inventario/traspasos', { almacen_origen_id: bod, almacen_destino_id: tda, items: [{ variante_id: pv.id, paquetes: 3 }, { variante_id: pv2.id, paquetes: 1 }] });
    ck('se piden 3 de PP BLANCO y 1 de PP NEGRO', r.status === 201, `${r.status} ${r.error?.message ?? r.data?.folio}`);
    const folioDos = r.data?.id;
    ck('PP NEGRO queda apartado', (await apartadoDe2()) > 0, `${await apartadoDe2()} kg`);
    // Solo se encuentran 2 de PP BLANCO, y de PP NEGRO nada.
    const [dosBlanco] = await db.query("SELECT codigo, peso_kg FROM variante_codigos WHERE variante_id=? AND almacen_id=? AND estado='disponible' LIMIT 2", [pv.id, bod]);
    const pesoDos = r3(dosBlanco.reduce((s, b) => s + Number(b.peso_kg), 0));
    const bodAntesDos = await st(pv.id, bod);
    r = await api('POST', `/inventario/traspasos/${folioDos}/enviar`, { codigos: dosBlanco.map((b) => b.codigo), notas: 'Va en la camioneta 2' });
    ck('se envía lo que hay', r.status === 200, `${r.status} ${r.error?.message ?? r.data?.estado}`);
    const lb = r.data?.lineas?.find((x) => x.variante_id === pv.id);
    const ln = r.data?.lineas?.find((x) => x.variante_id === pv2.id);
    ck('de PP BLANCO salen los 2 que había, con su peso real', lb?.paquetes === 2 && lb?.paquetes_pedidos === 3 && Number(lb?.cantidad) === pesoDos,
      `${lb?.paquetes} de ${lb?.paquetes_pedidos} · ${lb?.cantidad} kg`);
    ck('PP NEGRO no sale', ln?.paquetes === 0 && Number(ln?.cantidad) === 0 && ln?.no_salio === true, JSON.stringify({ p: ln?.paquetes, c: ln?.cantidad }));
    ck('la bodega baja solo lo de PP BLANCO', Math.abs(bodAntesDos - (await st(pv.id, bod)) - pesoDos) < 0.001 && (await st(pv2.id, bod)) === negroAntes,
      `blanco ${bodAntesDos} → ${await st(pv.id, bod)} · negro ${await st(pv2.id, bod)}`);
    ck('se suelta lo apartado de los dos', (await apartadoDe(bod)) === reservaBlanco && (await apartadoDe2()) === 0,
      `blanco ${await apartadoDe(bod)} · negro ${await apartadoDe2()}`);
    const nota = r.data?.envio_notas ?? '';
    ck('la nota dice qué no salió completo y por qué', nota.includes('PP BLANCO: salieron 2 de 3') && nota.includes('PP NEGRO: no salió') && nota.includes('Era lo único que había'), nota);
    ck('y lleva lo que escribió quien surte', nota.endsWith('Va en la camioneta 2'), nota);
    const lista = (await api('GET', '/inventario/traspasos?limit=20')).data.items.find((x) => x.id === folioDos);
    const lbLista = lista?.lineas?.find((x) => x.variante_id === pv.id);
    ck('el historial guarda lo pedido y lo que salió', Number(lbLista?.paquetes_solicitados) === 3 && Number(lbLista?.paquetes) === 2 && lista?.envio_notas === nota,
      `${lbLista?.paquetes} de ${lbLista?.paquetes_solicitados}`);
    const tdaAntesDos = await st(pv.id, tda);
    r = await api('POST', `/inventario/traspasos/${folioDos}/recibir`);
    ck('al recibir no hay faltantes: lo que no salió no falta', r.status === 200 && r.data?.faltantes === 0, `${r.status} faltantes ${r.data?.faltantes}`);
    ck('la tienda recibe solo lo de PP BLANCO', Math.abs((await st(pv.id, tda)) - tdaAntesDos - pesoDos) < 0.001 && (await st(pv2.id, tda)) === 0,
      `blanco ${tdaAntesDos} → ${await st(pv.id, tda)} · negro ${await st(pv2.id, tda)}`);
    const [[movNegro]] = await db.query("SELECT COUNT(*) n FROM movimientos_inventario WHERE variante_id=? AND referencia_tipo='traspaso'", [pv2.id]);
    ck('PP NEGRO no tiene movimientos de traspaso en el kardex', Number(movNegro.n) === 0, movNegro.n);

    // Cancelar en camino con un hilo que no salió: regresa solo lo que salió.
    r = await api('POST', '/inventario/traspasos', { almacen_origen_id: bod, almacen_destino_id: tda, items: [{ variante_id: pv.id, paquetes: 1 }, { variante_id: pv2.id, paquetes: 1 }] });
    const folioTres = r.data?.id;
    const [[otroBlanco]] = await db.query("SELECT codigo, peso_kg FROM variante_codigos WHERE variante_id=? AND almacen_id=? AND estado='disponible' LIMIT 1", [pv.id, bod]);
    const bodAntesTres = await st(pv.id, bod);
    await api('POST', `/inventario/traspasos/${folioTres}/enviar`, { codigos: [otroBlanco.codigo] });
    r = await api('POST', `/inventario/traspasos/${folioTres}/cancelar`, {});
    ck('cancelar en camino regresa lo que salió y nada inventado', r.status === 200 && (await st(pv.id, bod)) === bodAntesTres && (await st(pv2.id, bod)) === negroAntes,
      `${r.status} blanco ${await st(pv.id, bod)} · negro ${await st(pv2.id, bod)}`);
  } finally {
    console.log('\n=== Limpieza ===');
    await db.query('SET FOREIGN_KEY_CHECKS=0');
    for (const id of (await db.query('SELECT id FROM productos'))[0].map((r) => r.id).filter((i) => !antes.has(i))) {
      const sub = '(SELECT id FROM producto_variantes WHERE producto_id=?)';
      // Con las llaves apagadas no hay cascada: los bultos de cada envío se borran a mano.
      await db.query('DELETE FROM traspaso_bultos WHERE detalle_id IN (SELECT id FROM traspaso_detalle WHERE variante_id IN ' + sub + ')', [id]);
      await db.query('DELETE FROM traspaso_detalle WHERE variante_id IN ' + sub, [id]);
      for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) await db.query('DELETE FROM ' + tb + ' WHERE variante_id IN ' + sub, [id]);
      await db.query('DELETE FROM remesas WHERE variante_id IN ' + sub, [id]);
      await db.query('UPDATE producto_variantes SET origen_variante_id=NULL WHERE producto_id=?', [id]);
      await db.query('DELETE FROM producto_variantes WHERE producto_id=?', [id]);
      await db.query('DELETE FROM productos WHERE id=?', [id]);
    }
    await db.query("DELETE FROM traspasos WHERE almacen_origen_id IN (SELECT id FROM almacenes WHERE nombre LIKE 'PP %')");
    await db.query("DELETE FROM almacenes WHERE nombre LIKE 'PP %'");
    await db.query('SET FOREIGN_KEY_CHECKS=1');
    ck('los datos de la tienda intactos', (await db.query('SELECT COUNT(*) n FROM productos'))[0][0].n === antes.size, antes.size + ' productos');
    await db.end();
  }
  console.log('\n' + (f === 0 ? 'OK · todo pasó' : 'FALLAS: ' + f));
  process.exit(f ? 1 : 0);
})();
