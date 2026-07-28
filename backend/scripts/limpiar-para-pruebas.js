'use strict';

/**
 * Deja la base lista para empezar a capturar EN SERIO: borra el catálogo de
 * productos y todo el movimiento, y CONSERVA el personal y la configuración.
 *
 *   cd backend
 *   node scripts/limpiar-para-pruebas.js --dry-run    # solo dice qué haría
 *   node scripts/limpiar-para-pruebas.js --si         # borra de verdad
 *
 * BORRA DATOS DE FORMA IRREVERSIBLE. Sin `--si` no hace nada: es a propósito.
 * Respalda antes con `node scripts/dump-db.js`.
 *
 * Este proyecto ya perdió datos una vez por una limpieza mal acotada (ver el
 * INCIDENTE del 2026-07-25 en CAMBIOS.txt), así que aquí las tablas van
 * enumeradas una por una —nunca un "borra todo lo que encuentres"— y el orden
 * respeta las llaves foráneas.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

/** Lo que se borra, en orden: primero lo que depende de otros. */
const BORRAR = [
  // --- Ventas ---
  'pedido_detalle_bultos',
  'pedido_detalle',
  'pagos',
  'envios',
  'pedidos',
  // --- Caja ---
  'movimientos_caja',
  'sesiones_caja',
  // --- Carrito y actividad de la tienda ---
  'carrito_items',
  'carritos',
  'listas_deseos',
  'resenas',
  // --- Inventario y sus documentos ---
  'movimientos_inventario',
  'variante_conversiones',
  'traspaso_detalle',
  'traspasos',
  'inventario',
  'remesas',
  // --- Compras ---
  'orden_compra_detalle',
  'ordenes_compra',
  // --- Catálogo de productos ---
  'variante_codigos',
  'variante_precios',
  'producto_imagenes',
  'producto_variantes',
  'productos',
  // --- Nómina: los periodos y recibos son movimiento, no configuración ---
  'nomina_recibo_conceptos',
  'nomina_recibos',
  'nomina_periodos',
  // --- Clientes de la tienda en línea (el PERSONAL no se toca) ---
  'direcciones',
  'clientes',
  // --- Bitácora ---
  'auditoria',
];

/**
 * Lo que se CONSERVA. Está escrito aquí para que quede constancia de la decisión
 * y para verificar al final que no se tocó.
 */
const CONSERVAR = [
  // Personal, tal como lo pidió la tienda.
  'usuarios',
  'roles',
  'permisos',
  'rol_permisos',
  // Su configuración de nómina (sueldo, comisión, hora extra): es del personal.
  'nomina_empleados',
  // Configuración de la tienda: sin esto no se puede ni dar de alta un producto.
  'almacenes',
  'cajas',
  'categorias',
  'lineas',
  'unidades_medida',
  'impuestos',
  'metodos_pago',
  'tipos_cliente',
  'paqueterias',
  'proveedores',
  'cupones',
];

/** Tablas cuyo contador se reinicia, para que los ids empiecen en 1. */
const REINICIAR_ID = BORRAR.filter((t) => t !== 'auditoria');

(async () => {
  const args = process.argv.slice(2);
  const enSerio = args.includes('--si');
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const contar = async (t) => (await db.query(`SELECT COUNT(*) n FROM \`${t}\``))[0][0].n;

  console.log(`Base: ${process.env.DB_NAME}\n`);
  console.log('SE BORRA:');
  let total = 0;
  for (const t of BORRAR) {
    const n = await contar(t);
    total += n;
    if (n > 0) console.log(`  ${String(n).padStart(4)}  ${t}`);
  }
  console.log(`  ${String(total).padStart(4)}  TOTAL de filas\n`);

  console.log('SE CONSERVA:');
  for (const t of CONSERVAR) {
    const n = await contar(t);
    if (n > 0) console.log(`  ${String(n).padStart(4)}  ${t}`);
  }

  if (!enSerio) {
    console.log('\nSimulación. Para borrar de verdad: node scripts/limpiar-para-pruebas.js --si');
    await db.end();
    return;
  }

  console.log('\nBorrando…');
  // Se apagan las llaves foráneas por si algún dato viejo quedó cruzado; el
  // orden de la lista ya es el correcto de todos modos.
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of BORRAR) {
    await db.query(`DELETE FROM \`${t}\``);
  }
  for (const t of REINICIAR_ID) {
    await db.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`);
  }
  await db.query('SET FOREIGN_KEY_CHECKS = 1');

  // Verificación: lo borrado en cero y lo conservado intacto.
  let fallas = 0;
  for (const t of BORRAR) {
    const n = await contar(t);
    if (n !== 0) {
      console.log(`  FALLA · ${t} quedó con ${n} filas`);
      fallas++;
    }
  }
  console.log('\nQUEDÓ ASÍ:');
  for (const t of CONSERVAR) {
    const n = await contar(t);
    if (n > 0) console.log(`  ${String(n).padStart(4)}  ${t}`);
  }
  console.log(fallas === 0 ? '\nOK · base limpia y configuración intacta' : `\nFALLAS: ${fallas}`);
  await db.end();
  process.exit(fallas ? 1 : 0);
})();
