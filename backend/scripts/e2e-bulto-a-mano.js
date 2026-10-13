'use strict';

/**
 * Prueba del BULTO CAPTURADO A MANO (2026-10-07): "cuando tengo hilo en 2
 * lugares, que me pregunte a cuál de los 2 se va a cargar ese bulto", y "sí se
 * suman los kilos de la entrada de ese paquete".
 *
 *   · entra al almacén que se diga y sus kilos se suman ahí, con su movimiento
 *     en el kardex ("Bulto capturado a mano");
 *   · hilo en dos almacenes, sin decir a cuál: 422 FALTA_ALMACEN; en un solo
 *     lugar: entra ahí; sin existencias: hay que decirlo;
 *   · sin peso no entra (422 FALTA_PESO); un almacén que no existe: 422;
 *   · quitarlo saca sus kilos (si sigue disponible); uno vendido no se quita
 *     (409); "un bulto que metió kilos se los lleva al quitarlo": el de una
 *     CARGA del proveedor también los saca; el capturado a mano antes del
 *     cambio (nunca metió kilos) solo borra su registro;
 *   · si la presentación no tenía peso, toma el del bulto.
 *
 * Crea "TMPBM …" y lo borra al final.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &
 *   E2E_ACEPTO_PRODUCCION=si node scripts/e2e-bulto-a-mano.js   # contra la base de pruebas
 *
 * Sale 1 si algo falla.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./_no-en-produccion');
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');

const B = process.env.BASE ?? 'http://localhost:3210/api/v1';
const SUF = Date.now().toString(36).toUpperCase();

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
  /** "almacén:kilos" de cada renglón de inventario de la presentación. */
  const inventario = async (v) => {
    const [rows] = await db.query('SELECT almacen_id, cantidad FROM inventario WHERE variante_id = ? ORDER BY almacen_id', [v]);
    return rows.map((x) => `${x.almacen_id}:${Number(x.cantidad)}`).join(',');
  };

  try {
    const [alms] = await db.query('SELECT id, nombre FROM almacenes WHERE activo = 1 ORDER BY id LIMIT 3');
    if (alms.length < 3) throw new Error('Hacen falta 3 almacenes activos en la base de pruebas');
    const [a1, a2, a3] = alms;
    const [[cat]] = await db.query('SELECT id FROM categorias ORDER BY id LIMIT 1');
    const [[kg]] = await db.query("SELECT id FROM unidades_medida WHERE abreviatura = 'kg' LIMIT 1");
    const hilo = async (nombre, entradas) => {
      const p = (await api('POST', '/productos', {
        categoria_id: cat.id, unidad_medida_id: kg.id, nombre: `TMPBM ${nombre} ${SUF}`, precio_kg: 100, multipresentacion: true,
      })).data;
      const v = (await api('GET', `/productos/${p.id}`)).data.variantes[0];
      for (const [almacen, cantidad] of entradas) {
        await api('POST', '/inventario/movimientos', { variante_id: v.id, almacen_id: almacen, tipo: 'entrada', cantidad, motivo: 'TMPBM' });
      }
      return v;
    };
    let n = 0;
    const bulto = (v, extra = {}) => api('POST', `/variantes/${v.id}/codigos`, { codigo: `TMPBM-${SUF}-${++n}`, peso_kg: 19, ...extra });

    console.log(`=== 1. Hilo en dos lugares (${a1.nombre} y ${a2.nombre}) ===`);
    const dos = await hilo('ROJO', [[a1.id, 100], [a2.id, 40]]);
    let r = await bulto(dos);
    ck('sin decir a cuál: 422 FALTA_ALMACEN, y dice dónde está', r.status === 422 && r.error?.code === 'FALTA_ALMACEN' &&
      r.error.message.includes(a1.nombre) && r.error.message.includes(a2.nombre), r.error);
    r = await bulto(dos, { almacen_id: a2.id, peso_kg: undefined });
    ck('sin peso: 422 FALTA_PESO', r.status === 422 && r.error?.code === 'FALTA_PESO', r.error?.code);
    r = await bulto(dos, { almacen_id: 999999 });
    ck('un almacén que no existe: 422 ALMACEN_INVALIDO', r.status === 422 && r.error?.code === 'ALMACEN_INVALIDO', r.error?.code);
    ck('…y nada se movió', (await inventario(dos.id)) === `${a1.id}:100,${a2.id}:40`, await inventario(dos.id));
    r = await bulto(dos, { almacen_id: a2.id, peso_kg: 18.6 });
    const enA2 = r.data;
    ck(`a ${a2.nombre}: ahí queda el bulto`, r.status === 201 && Number(enA2?.almacen_id) === a2.id && enA2?.almacen === a2.nombre, r.error ?? enA2);
    ck('y sus 18.6 kg entran ahí (40 → 58.6)', (await inventario(dos.id)) === `${a1.id}:100,${a2.id}:58.6`, await inventario(dos.id));
    r = await api('GET', `/inventario/movimientos?variante_id=${dos.id}&limit=5`);
    const mov = r.data?.items?.find((x) => x.referencia_tipo === 'bulto');
    ck('el kardex dice "Bulto capturado a mano" con su código', mov?.concepto === 'Bulto capturado a mano' &&
      mov?.codigo_bulto === enA2?.codigo && Number(mov?.cantidad) === 18.6, mov && [mov.concepto, mov.codigo_bulto, mov.cantidad]);
    r = await bulto(dos, { almacen_id: a3.id, peso_kg: 10 });
    ck(`también puede entrar a ${a3.nombre}, donde no había`, r.status === 201 && (await inventario(dos.id)).includes(`${a3.id}:10`), await inventario(dos.id));
    r = await api('GET', `/variantes/${dos.id}/codigos`);
    ck('la lista de bultos dice dónde está y que dio entrada', r.data?.some((b) => b.codigo === enA2.codigo && b.almacen === a2.nombre && Number(b.con_entrada) === 1));

    console.log('\n=== 2. Quitarlo saca sus kilos ===');
    r = await api('DELETE', `/variantes/codigos/${enA2.id}`);
    ck('se quita y salen sus 18.6 kg', r.status === 200 && Number(r.data?.salieron_kg) === 18.6 &&
      (await inventario(dos.id)).includes(`${a2.id}:40`), r.error ?? [r.data, await inventario(dos.id)]);
    const [[salida]] = await db.query(
      "SELECT cantidad FROM movimientos_inventario WHERE referencia_tipo = 'bulto' AND referencia_id = ? AND tipo = 'salida'", [enA2.id]
    );
    ck('con su salida en el kardex', Number(salida?.cantidad) === -18.6, salida);
    r = await bulto(dos, { almacen_id: a1.id });
    await db.query("UPDATE variante_codigos SET estado = 'vendido' WHERE id = ?", [r.data.id]);
    r = await api('DELETE', `/variantes/codigos/${r.data.id}`);
    ck('uno ya vendido no se quita: 409', r.status === 409 && r.error?.code === 'BULTO_NO_DISPONIBLE', r.error?.code);
    const [ins] = await db.query("INSERT INTO variante_codigos (variante_id, codigo, peso_kg, almacen_id) VALUES (?, ?, 20, ?)", [dos.id, `TMPBM-${SUF}-VIEJO`, a1.id]);
    let antes = await inventario(dos.id);
    r = await api('DELETE', `/variantes/codigos/${ins.insertId}`);
    ck('el capturado a mano ANTES (nunca metió kilos) solo borra su registro', r.status === 200 && Number(r.data?.salieron_kg) === 0 &&
      (await inventario(dos.id)) === antes, [r.data, await inventario(dos.id)]);

    // Una carga del proveedor con dos paquetes (19.2 + 18): entran sus 37.2 kg a la primera.
    const folio = `TMPBM-REM-${SUF}`;
    const [rem] = await db.query(
      'INSERT INTO remesas (folio, variante_id, almacen_id, num_bultos, kg_total) VALUES (?, ?, ?, 2, 37.2)', [folio, dos.id, a1.id]
    );
    const [b1] = await db.query(
      'INSERT INTO variante_codigos (variante_id, codigo, peso_kg, almacen_id, remesa_id) VALUES (?, ?, 19.2, ?, ?)', [dos.id, `TMPBM-${SUF}-C1`, a1.id, rem.insertId]
    );
    await db.query('INSERT INTO variante_codigos (variante_id, codigo, peso_kg, almacen_id, remesa_id) VALUES (?, ?, 18, ?, ?)', [dos.id, `TMPBM-${SUF}-C2`, a1.id, rem.insertId]);
    await db.query('UPDATE inventario SET cantidad = cantidad + 37.2 WHERE variante_id = ? AND almacen_id = ?', [dos.id, a1.id]);
    antes = await inventario(dos.id);
    r = await api('GET', `/variantes/${dos.id}/codigos`);
    ck('la lista dice que el de la carga metió kilos', Number(r.data?.find((b) => b.id === b1.insertId)?.con_entrada) === 1);
    r = await api('DELETE', `/variantes/codigos/${b1.insertId}`);
    const kilosA1 = (txt) => Number(txt.split(',').find((x) => x.startsWith(`${a1.id}:`)).split(':')[1]);
    ck('quitar un paquete de la CARGA saca sus 19.2 kg', r.status === 200 && Number(r.data?.salieron_kg) === 19.2 &&
      Math.abs(kilosA1(antes) - kilosA1(await inventario(dos.id)) - 19.2) < 0.0005, [r.data, antes, await inventario(dos.id)]);
    const [[movCarga]] = await db.query(
      "SELECT cantidad, motivo FROM movimientos_inventario WHERE referencia_tipo = 'bulto' AND referencia_id = ? AND tipo = 'salida'", [b1.insertId]
    );
    ck('y el kardex dice de qué carga era', Number(movCarga?.cantidad) === -19.2 && movCarga?.motivo?.includes(folio), movCarga);
    r = await bulto(dos, { codigo: `TMPBM-${SUF}-C1-BIEN`, almacen_id: a1.id, peso_kg: 19.2 });
    ck('y volverlo a capturar con el código bien deja el inventario igual que antes', r.status === 201 && (await inventario(dos.id)) === antes,
      [antes, await inventario(dos.id)]);

    console.log('\n=== 3. Hilo en un solo lugar, y sin existencias ===');
    const uno = await hilo('AZUL', [[a2.id, 60]]);
    r = await bulto(uno);
    ck(`sin preguntar, entra a ${a2.nombre} (60 → 79)`, r.status === 201 && Number(r.data?.almacen_id) === a2.id &&
      (await inventario(uno.id)) === `${a2.id}:79`, r.error ?? await inventario(uno.id));
    const cero = await hilo('VERDE', []);
    r = await bulto(cero);
    ck('sin existencias en ningún lado: hay que decir a dónde (422)', r.status === 422 && r.error?.code === 'FALTA_ALMACEN', r.error?.code);
    r = await bulto(cero, { almacen_id: a3.id, peso_kg: 17.25 });
    ck(`entra a ${a3.nombre} con sus 17.25 kg`, r.status === 201 && (await inventario(cero.id)) === `${a3.id}:17.25`, r.error ?? await inventario(cero.id));
    const [[pv]] = await db.query('SELECT peso_kg FROM producto_variantes WHERE id = ?', [cero.id]);
    ck('la presentación, que no tenía peso, toma el del bulto', Number(pv.peso_kg) === 17.25, pv.peso_kg);
  } catch (e) {
    console.error(e);
    f++;
  } finally {
    const [prods] = await db.query('SELECT id FROM productos WHERE nombre LIKE ?', [`TMPBM %${SUF}`]);
    const pr = prods.map((x) => x.id);
    const [vs] = pr.length ? await db.query('SELECT id FROM producto_variantes WHERE producto_id IN (?)', [pr]) : [[]];
    const vids = vs.map((v) => v.id);
    if (vids.length) {
      for (const tb of ['variante_codigos', 'movimientos_inventario', 'inventario', 'variante_precios']) {
        await db.query(`DELETE FROM ${tb} WHERE variante_id IN (?)`, [vids]);
      }
      await db.query('DELETE FROM remesas WHERE folio = ?', [`TMPBM-REM-${SUF}`]);
      await db.query('DELETE FROM producto_variantes WHERE id IN (?)', [vids]);
    }
    if (pr.length) await db.query('DELETE FROM productos WHERE id IN (?)', [pr]);
    const [[{ n: quedan }]] = await db.query("SELECT COUNT(*) AS n FROM productos WHERE nombre LIKE 'TMPBM %'");
    ck('no quedó basura (TMPBM)', Number(quedan) === 0, quedan);
    await db.end();
  }
  console.log(f === 0 ? '\nTODO OK' : `\n${f} FALLA(S)`);
  process.exit(f === 0 ? 0 : 1);
})();
