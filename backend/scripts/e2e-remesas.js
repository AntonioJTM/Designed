'use strict';

/**
 * Prueba de punta a punta de la recepción de remesas, contra el servidor y la
 * base reales. Usa el archivo de lista de empaque que está en la raíz del repo.
 *
 *   cd backend
 *   PORT=3210 node src/server.js &        # en otra terminal
 *   node scripts/e2e-remesas.js           # BASE=http://localhost:3210/api/v1
 *
 * Crea un producto, una presentación paquete y un almacén temporales (todos con
 * prefijo TMP), carga la remesa completa y al terminar borra lo que creó. Sale
 * con código 1 si alguna comprobación falla.
 */

const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const BASE = process.env.BASE ?? 'http://localhost:3210/api/v1';
const ARCHIVO = path.join(__dirname, '..', '..', 'MARINO OSCURO 2-30.xlsx');

const token = jwt.sign(
  { sub: 1, tipo: 'usuario', rol_id: 1, rol: 'administrador' },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

let fallas = 0;
function ck(nombre, ok, detalle) {
  console.log(`${ok ? '  ok  ' : ' FALLA'} · ${nombre}${detalle !== undefined ? ` → ${detalle}` : ''}`);
  if (!ok) fallas++;
}

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

/** Sube el .xlsx en crudo, como lo hace el navegador. */
async function subir() {
  const r = await fetch(`${BASE}/remesas/previa`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'X-Nombre-Archivo': path.basename(ARCHIVO),
    },
    body: fs.readFileSync(ARCHIVO),
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

(async () => {
  if (!fs.existsSync(ARCHIVO)) {
    console.error(`No se encontró el archivo de prueba:\n  ${ARCHIVO}`);
    process.exit(1);
  }

  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // Se anota qué había antes para poder devolver la base a su estado.
  const antes = {};
  for (const t of ['productos', 'almacenes', 'remesas']) {
    antes[t] = new Set((await db.query(`SELECT id FROM ${t}`))[0].map((r) => r.id));
  }

  try {
    console.log('=== 1. Vista previa del archivo real ===');
    let r = await subir();
    ck('lee el archivo', r.status === 200, `hoja "${r.data?.hoja}"`);
    const s = r.data.resumen;
    ck('80 bultos', s.num_bultos === 80, s.num_bultos);
    ck('1,527.500 kg en total', s.kg_total === 1527.5, `${s.kg_total} kg`);
    ck('pesos de 10.75 a 19.8', s.peso_min === 10.75 && s.peso_max === 19.8, `${s.peso_min} – ${s.peso_max}`);
    ck('2 lotes con su desglose', s.lotes.length === 2,
      s.lotes.map((l) => `${l.lote}: ${l.bultos} bultos ${l.kg} kg`).join(' · '));
    ck('955 conos (79×12 + 7)', s.conos_totales === 79 * 12 + 7, s.conos_totales);
    ck('avisa del bulto incompleto', r.data.avisos.some((a) => /incompleto/.test(a.aviso)),
      r.data.avisos.find((a) => /incompleto/.test(a.aviso))?.aviso);
    ck('se puede cargar', r.data.se_puede_cargar === true);
    const bultos = r.data.bultos;

    console.log('\n=== 2. Confirmar la entrada ===');
    const cat = (await api('GET', '/categorias')).data.items[0].id;
    const kg = (await api('GET', '/opciones/unidades')).data.find((u) => u.abreviatura === 'kg').id;
    const prod = (await api('POST', '/productos', {
      categoria_id: cat, unidad_medida_id: kg, nombre: 'TMP MARINO OSCURO 2/30',
      grosor_calibre: '2/30', multipresentacion: true, por_lotes: true,
    })).data.id;
    const paq = (await api('POST', '/variantes', {
      producto_id: prod, sku: 'TMP-MARINO-PAQ', presentacion: 'Paquete',
      tipo_presentacion: 'paquete', peso_kg: 19.094, precio: 200,
    })).data.id;
    const alm = (await api('POST', '/almacenes', { nombre: 'TMP Bodega Remesa' })).data.id;

    r = await api('POST', '/remesas', {
      variante_id: paq, almacen_id: alm, archivo: path.basename(ARCHIVO), bultos,
    });
    ck('la remesa se crea con folio', r.status === 201 && /^REM-/.test(r.data?.folio ?? ''), r.data?.folio);
    ck('registra los 80 bultos', r.data?.num_bultos === 80);
    ck('da entrada a 1,527.5 kg', Number(r.data?.kg_total) === 1527.5,
      `${r.data?.saldo_anterior} → ${r.data?.saldo_nuevo} kg`);
    const remesa = r.data.id;

    const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM variante_codigos WHERE remesa_id = ?', [remesa]);
    ck('los bultos quedaron ligados a su remesa', n === 80, n);
    const [[b1]] = await db.query(
      'SELECT codigo, peso_kg, lote, conos FROM variante_codigos WHERE codigo = ?', ['00531332']);
    ck('cada bulto guarda su peso real y su lote',
      Number(b1.peso_kg) === 18.65 && b1.lote === '0094886' && b1.conos === 12,
      `${b1.codigo} · ${b1.peso_kg} kg · lote ${b1.lote} · ${b1.conos} conos`);
    const [[b2]] = await db.query(
      'SELECT peso_kg, conos FROM variante_codigos WHERE codigo = ?', ['00548087']);
    ck('el bulto incompleto conserva sus 7 conos',
      Number(b2.peso_kg) === 10.75 && b2.conos === 7, `${b2.peso_kg} kg · ${b2.conos} conos`);

    console.log('\n=== 3. El kardex lo explica ===');
    r = await api('GET', '/inventario/movimientos?limit=5');
    const mov = r.data.items.find((x) => x.referencia_tipo === 'remesa');
    ck('el movimiento aparece', !!mov, `${mov?.concepto} · +${mov?.cantidad} ${mov?.unidad}`);
    ck('el motivo dice bultos y lotes', /80 bultos/.test(mov?.motivo ?? ''), mov?.motivo);

    console.log('\n=== 4. Escanear un bulto encuentra su presentación ===');
    r = await api('GET', '/variantes?q=00548087');
    ck('el código resuelve a la presentación', r.data.items.some((v) => v.id === paq), r.data.items[0]?.sku);

    console.log('\n=== 5. Volver a subir el mismo archivo ===');
    r = await subir();
    ck('la previa marca los 80 como ya registrados', r.data?.duplicados?.length === 80, r.data?.duplicados?.length);
    ck('y no deja cargar', r.data?.se_puede_cargar === false);
    r = await api('POST', '/remesas', { variante_id: paq, almacen_id: alm, bultos });
    ck('confirmar de nuevo da 409', r.status === 409, r.error?.code);

    console.log('\n=== 6. Guardas ===');
    r = await api('POST', '/remesas', {
      variante_id: paq, almacen_id: alm, bultos: [{ codigo: 'TMP-X1', peso_kg: 5 }] });
    ck('un bulto sin lote ni conos se acepta', r.status === 201);
    // Con una variante paquete VÁLIDA, para que la guarda que responda sea la
    // del almacén y no la de tipo de presentación.
    r = await api('POST', '/remesas', {
      variante_id: paq, almacen_id: 999999, bultos: [{ codigo: 'TMP-X2', peso_kg: 5 }] });
    ck('422 si el almacén no existe', r.status === 422 && r.error?.code === 'ALMACEN_INVALIDO',
      `${r.status} ${r.error?.code}`);
    const vsim = (await api('POST', '/variantes', {
      producto_id: prod, sku: 'TMP-MARINO-SIM', presentacion: 'Bolsa',
      tipo_presentacion: 'simple', precio: 50,
    })).data.id;
    r = await api('POST', '/remesas', {
      variante_id: vsim, almacen_id: alm, bultos: [{ codigo: 'TMP-X3', peso_kg: 5 }] });
    ck('422 si la presentación no es paquete', r.status === 422 && r.error?.code === 'NO_ES_PAQUETE',
      `${r.status} ${r.error?.code}`);
    r = await api('POST', '/remesas', {
      variante_id: 999999, almacen_id: alm, bultos: [{ codigo: 'TMP-X4', peso_kg: 5 }] });
    ck('422 si la presentación no existe', r.status === 422 && r.error?.code === 'VARIANTE_INVALIDA',
      `${r.status} ${r.error?.code}`);
    const vacio = await fetch(`${BASE}/remesas/previa`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    });
    ck('422 si no se manda archivo', vacio.status === 422, vacio.status);

    console.log('\n=== 7. El filtro por tipo de presentación ===');
    r = await api('GET', '/variantes?tipo_presentacion=paquete&limit=200');
    ck('solo devuelve paquetes', r.data.items.every((v) => v.tipo_presentacion === 'paquete'),
      `${r.data.items.length} variantes`);
    ck('incluye el paquete nuevo y excluye la simple',
      r.data.items.some((v) => v.id === paq) && !r.data.items.some((v) => v.id === vsim));

    const [[{ huerfanos }]] = await db.query(
      "SELECT COUNT(*) huerfanos FROM variante_codigos WHERE codigo LIKE 'TMP-X%' AND codigo <> 'TMP-X1'");
    ck('las guardas no dejaron bultos huérfanos', huerfanos === 0, huerfanos);
  } finally {
    console.log('\n=== Limpieza ===');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    const nuevos = async (t) =>
      (await db.query(`SELECT id FROM ${t}`))[0].map((r) => r.id).filter((i) => !antes[t].has(i));
    for (const id of await nuevos('productos')) {
      const sub = '(SELECT id FROM producto_variantes WHERE producto_id = ?)';
      for (const tabla of ['variante_codigos', 'movimientos_inventario', 'inventario']) {
        await db.query(`DELETE FROM ${tabla} WHERE variante_id IN ${sub}`, [id]);
      }
      await db.query(`DELETE FROM remesas WHERE variante_id IN ${sub}`, [id]);
      await db.query('DELETE FROM producto_variantes WHERE producto_id = ?', [id]);
      await db.query('DELETE FROM productos WHERE id = ?', [id]);
    }
    for (const id of await nuevos('remesas')) await db.query('DELETE FROM remesas WHERE id = ?', [id]);
    for (const id of await nuevos('almacenes')) await db.query('DELETE FROM almacenes WHERE id = ?', [id]);
    await db.query("DELETE FROM variante_codigos WHERE codigo LIKE 'TMP-X%'");
    await db.query('SET FOREIGN_KEY_CHECKS = 1');

    const [[{ p }]] = await db.query('SELECT COUNT(*) p FROM productos');
    const [[{ rr }]] = await db.query('SELECT COUNT(*) rr FROM remesas');
    ck('la base quedó como antes', p === antes.productos.size && rr === antes.remesas.size,
      `${p} productos · ${rr} remesas`);
    await db.end();
  }

  console.log(`\n${fallas === 0 ? 'OK · todo pasó' : `FALLAS: ${fallas}`}`);
  process.exit(fallas === 0 ? 0 : 1);
})();
