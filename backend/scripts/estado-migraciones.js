'use strict';

/**
 * Qué migraciones le faltan a una base. NO escribe nada: solo compara.
 *
 *   node scripts/estado-migraciones.js                     # hitex, la base REAL
 *   node scripts/estado-migraciones.js --base desarrollo   # la de pruebas
 *
 * La base es la de `--base` y, sin él, `hitex` (2026-10-16), igual que
 * `verificar-sistema.js`. Antes tomaba la del `.env` e IGNORABA `--base`: un
 * "--base hitex" revisaba en realidad `desarrollo`. El servidor y el usuario
 * siguen saliendo del `.env`.
 *
 * Nació el 2026-09-05, después de descubrir que `2026-07_traspasos_estados.sql`
 * llevaba semanas sin aplicarse pese a que la bitácora la daba por aplicada, y
 * el panel devolvía 500. La verdad está en `information_schema`, no en un
 * archivo de texto: esto la consulta.
 *
 * Cada migración se reconoce por una HUELLA —una tabla o columna que crea o
 * elimina—, no por un registro de las que corrieron: así funciona también en
 * bases donde nunca se llevó ese registro, que es el caso de este proyecto.
 * Al agregar una migración nueva, agrega aquí su huella.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const idxBase = process.argv.indexOf('--base');
const BASE = idxBase >= 0 && process.argv[idxBase + 1] ? process.argv[idxBase + 1] : 'hitex';

// tabla            → la tabla debe EXISTIR
// tabla.columna    → la columna debe EXISTIR
// tabla.!columna   → la columna NO debe existir (migración que elimina)
// vista~texto      → la definición de la vista debe CONTENER ese texto
//                    (migración que solo cambia una vista, sin tocar columnas)
// tabla#col=valor  → debe haber una FILA con ese valor (migración que solo
//                    llena datos, sin tocar la estructura)
// tabla^texto      → algún CHECK de la tabla debe CONTENER ese texto
//                    (migración que solo cambia los valores válidos)
const MIGRACIONES = [
  ['2026-07_variante_codigos', 'variante_codigos'],
  ['2026-07_nomina', 'nomina_periodos'],
  ['2026-07_unidades_peso', 'unidades_medida'],
  ['2026-07_almacen_tienda_linea', 'almacenes.es_tienda_linea'],
  ['2026-07_paquetes_y_conos', 'producto_variantes.tipo_presentacion'],
  ['2026-07_paquetes_y_conos (conversiones)', 'variante_conversiones'],
  ['2026-07_almacen_matriz', 'almacenes.es_matriz'],
  ['2026-07_traspasos', 'traspasos'],
  ['2026-07_producto_peso_kg', 'producto_variantes.peso_kg'],
  ['2026-07_quitar_slug', 'productos.!slug'],
  ['2026-07_quitar_categoria_padre', 'categorias.!padre_id'],
  ['2026-07_linea_material_calibres', 'lineas'],
  ['2026-07_linea_material_calibres (calibres)', 'categorias.calibres'],
  ['2026-07_quitar_peso_producto', 'productos.!peso_kg'],
  ['2026-07_lotes_multipresentacion_precios', 'productos.multipresentacion'],
  ['2026-07_lotes_multipresentacion_precios (precios)', 'variante_precios'],
  ['2026-07_remesas_bultos', 'remesas'],
  ['2026-07_remesas_bultos (peso)', 'variante_codigos.peso_kg'],
  ['2026-07_bultos_trazabilidad', 'pedido_detalle_bultos'],
  ['2026-07_bultos_estado', 'variante_codigos.estado'],
  ['2026-07_producto_precio_kg', 'productos.precio_kg'],
  ['2026-07_quitar_color', 'producto_variantes.!color_id'],
  ['2026-07_bulto_almacen', 'variante_codigos.almacen_id'],
  ['2026-07_desarme_destare', 'variante_conversiones.destare_kg'],
  ['2026-07_cono_por_kilo', 'producto_variantes.modo_precio'],
  ['2026-07_traspasos_estados', 'traspasos.estado'],
  ['2026-07_traspasos_estados (detalle)', 'traspaso_detalle.cantidad_recibida'],
  ['2026-09_checkout_online', 'pedidos.metodo_entrega'],
  ['2026-09_checkout_online (configuracion)', 'configuracion'],
  ['2026-09_comprobante_pago', 'pagos.comprobante_archivo'],
  ['2026-09_clientes_expediente_credito', 'clientes.limite_credito'],
  ['2026-09_clientes_expediente_credito (movimientos)', 'credito_movimientos'],
  ['2026-09_costo_y_margen', 'remesas.costo_kg'],
  ['2026-09_costo_y_margen (congelado)', 'pedido_detalle.costo_unitario'],
  ['2026-09_apartados', 'pedidos.inventario_descontado'],
  ['2026-10_alertas_stock_con_minimo', 'v_alertas_stock~`stock_minimo` > 0'],
  ['2026-10_permisos_por_puesto', 'permisos#clave=ver:hoy'],
  ['2026-10_nomina_dias_vacaciones_horario', 'nomina_vacaciones'],
  ['2026-10_nomina_dias_vacaciones_horario (recibos)', 'nomina_recibos.dias_trabajados'],
  ['2026-10_cuentas_bancarias', 'cuentas_bancarias'],
  ['2026-10_traspaso_bultos', 'traspaso_bultos'],
  ['2026-10_traspaso_lo_que_salio', 'traspasos.envio_notas'],
  ['2026-10_traspaso_lo_que_salio (pedido)', 'traspaso_detalle.cantidad_solicitada'],
  ['2026-10 hora de la tienda (scripts/ajustar-hora.js)', '_zona_horaria'],
  ['2026-10_carga_proveedor_costo', 'remesas.proveedor_id'],
  ['2026-10_carga_proveedor_costo (contabilidad)', 'roles#nombre=contabilidad'],
  ['2026-10_varios_puestos', 'usuario_roles'],
  ['2026-10_piezas_en_venta', 'pedido_detalle.piezas'],
  ['2026-10_pedidos_encargo', 'pedidos.encargo'],
  ['2026-10_pedidos_encargo (permiso)', 'permisos#clave=ver:encargos'],
  ['2026-10_bulto_apartado', "variante_codigos^'apartado'"],
  ['2026-10_comisiones_al_liquidar', 'nomina_comisiones'],
  ['2026-10_notas_pendientes', 'pedidos.nota_pendiente'],
  ['2026-10_notas_pendientes (permiso)', 'permisos#clave=ver:notas_pendientes'],
  ['2026-10_saldo_a_favor', 'saldo_favor_movimientos'],
  ['2026-10_saldo_a_favor (método)', 'metodos_pago.interno'],
  ['2026-10_comision_devoluciones', 'nomina_comisiones.devuelto'],
  ['2026-10_anticipos', 'saldo_favor_movimientos.metodo_pago_id'],
  ['2026-10_datos_fiscales_ticket', 'configuracion#clave=fiscal_rfc'],
  ['2026-10_ticket_papel', 'configuracion#clave=ticket_papel_mm'],
  ['2026-10_clientes_lugar_entrega', 'clientes.lugar_entrega_id'],
  ['2026-10_puesto_cargador', 'roles.entra_al_sistema'],
  ['2026-10_puesto_cargador (cargador)', 'roles#nombre=cargador'],
  ['2026-10_tiendas_por_persona', 'usuarios.todas_las_tiendas'],
  ['2026-10_tiendas_por_persona (tiendas)', 'usuario_almacenes'],
  ['2026-10_efectivo_recibido', 'pagos.recibido'],
  ['2026-10_clave_cobro', 'pedidos.clave_cobro'],
  ['2026-10_autorizaciones', 'autorizaciones'],
  ['2026-10_autorizaciones (clave)', 'usuarios.clave_autorizacion_hash'],
  ['2026-10_autorizaciones (candado de la clave)', 'usuarios.clave_autorizacion_fallos'],
  ['2026-10_autorizaciones_fase2', 'autorizaciones.nota_aprobacion'],
  ['2026-10_autorizaciones_fase2 (permisos)', 'permisos#clave=pedir:surtir_sucursal'],
  ['2026-10_autorizaciones_fase3', 'permisos#clave=pedir:pagar_nomina'],
  ['2026-10_bulto_faltante', "variante_codigos^'faltante'"],
  ['2026-10_destare_tope', 'configuracion#clave=desarme_destare_max_kg'],
  ['2026-10_operaciones_unicas', 'operaciones_unicas'],
  ['2026-10_gastos', "movimientos_caja^'gasto'"],
  ['2026-10_gastos_tipo_pedir', 'permisos#clave=pedir:tipos_gasto'],
  ['2026-10_transferencias', 'transferencias'],
  ['2026-10_transferencias (permisos)', 'permisos#clave=ver:transferencias'],
  ['2026-10_dias_credito', 'pedidos.dias_credito'],
  ['2026-10_rotacion_inventario', 'ventas_anteriores'],
  ['2026-10_rotacion_inventario (permisos)', 'permisos#clave=ver:rotacion'],
  ['2026-10_rotacion_inventario (tiempos)', 'permisos#clave=hacer:ajustes_rotacion'],
  ['2026-10_vendedor_en_venta', 'pedidos.vendedor_id'],
];

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: BASE,
  });
  const [[donde]] = await c.query('SELECT @@hostname h, DATABASE() db');
  console.log(`Base: ${donde.db} en ${donde.h} (${process.env.DB_HOST})\n`);

  const faltan = [];
  for (const [nombre, huella] of MIGRACIONES) {
    if (huella.includes('#')) {
      const [tabla, cond] = huella.split('#');
      const [col, valor] = cond.split('=');
      const [[f]] = await c.query(`SELECT COUNT(*) n FROM \`${tabla}\` WHERE \`${col}\` = ?`, [valor]);
      const ok = Number(f.n) > 0;
      console.log(`  ${ok ? 'ok      ' : 'FALTA   '} ${nombre}${ok ? '' : `  → no hay ${tabla} con ${col} = ${valor}`}`);
      if (!ok) faltan.push(nombre);
      continue;
    }
    if (huella.includes('^')) {
      const [tabla, texto] = huella.split('^');
      const [[k]] = await c.query(
        `SELECT COUNT(*) n FROM information_schema.check_constraints
          WHERE constraint_schema = ? AND table_name = ? AND check_clause LIKE ?`,
        [BASE, tabla, `%${texto}%`]
      );
      const ok = Number(k.n) > 0;
      console.log(`  ${ok ? 'ok      ' : 'FALTA   '} ${nombre}${ok ? '' : `  → ningún CHECK de ${tabla} admite ${texto}`}`);
      if (!ok) faltan.push(nombre);
      continue;
    }
    if (huella.includes('~')) {
      const [vista, texto] = huella.split('~');
      const [[v]] = await c.query(
        'SELECT VIEW_DEFINITION d FROM information_schema.views WHERE table_schema = ? AND table_name = ?',
        [BASE, vista]
      );
      const ok = !!v && v.d.includes(texto);
      console.log(`  ${ok ? 'ok      ' : 'FALTA   '} ${nombre}${ok ? '' : `  → ${vista} no filtra ${texto}`}`);
      if (!ok) faltan.push(nombre);
      continue;
    }
    const [tabla, col] = huella.split('.');
    const [[t]] = await c.query(
      'SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
      [BASE, tabla]
    );
    let ok;
    let detalle;
    if (!t.n) {
      ok = false;
      detalle = `falta la tabla ${tabla}`;
    } else if (!col) {
      ok = true;
    } else {
      const niega = col.startsWith('!');
      const nombreCol = niega ? col.slice(1) : col;
      const [[x]] = await c.query(
        `SELECT COUNT(*) n FROM information_schema.columns
          WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
        [BASE, tabla, nombreCol]
      );
      ok = niega ? !x.n : !!x.n;
      detalle = niega ? `${tabla}.${nombreCol} debería estar eliminada` : `falta ${tabla}.${nombreCol}`;
    }
    console.log(`  ${ok ? 'ok      ' : 'FALTA   '} ${nombre}${ok ? '' : '  → ' + detalle}`);
    if (!ok) faltan.push(nombre);
  }

  console.log(
    faltan.length
      ? `\n${faltan.length} migración(es) sin aplicar.`
      : '\nLa base está al día.'
  );
  await c.end();
  process.exit(faltan.length ? 1 : 0);
})().catch((e) => {
  console.error('ERROR:', e.code || '', e.message);
  process.exit(2);
});
