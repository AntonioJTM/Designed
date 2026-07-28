'use strict';

// Genera un dump SQL (estructura + datos + vistas) de la BD del .env.
// Uso:  node scripts/dump-db.js [ruta_salida.sql] [--estructura]
//   sin flags      → ../db/dump_<base>_<fecha>.sql  (estructura + datos)
//   --estructura   → ../db/schema_mysql.sql          (solo DDL, agrupado por módulo)
//
// El esquema de referencia del repo se regenera con:
//   node scripts/dump-db.js --estructura

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');

// Orden en que se emite el DDL cuando se genera solo la estructura. Agrupa las
// tablas por dominio para que el archivo se lea como documentación del modelo.
// Las tablas nuevas que no estén aquí caen al final, bajo "SIN CLASIFICAR".
const MODULOS = [
  {
    titulo: 'MÓDULO 1 · SEGURIDAD Y ADMINISTRACIÓN',
    tablas: ['roles', 'permisos', 'rol_permisos', 'usuarios', 'auditoria'],
  },
  {
    titulo: 'MÓDULO 2 · CATÁLOGO DE PRODUCTOS (HILOS)',
    tablas: [
      'categorias', 'lineas', 'unidades_medida', 'impuestos', 'productos',
      'producto_variantes', 'producto_imagenes', 'variante_codigos', 'variante_precios',
    ],
  },
  {
    titulo: 'MÓDULO 3 · COMPRAS, PROVEEDORES Y RECEPCIÓN',
    tablas: ['proveedores', 'ordenes_compra', 'orden_compra_detalle', 'remesas'],
  },
  {
    titulo: 'MÓDULO 4 · INVENTARIO MULTI-ALMACÉN',
    tablas: [
      'almacenes', 'inventario', 'movimientos_inventario',
      'traspasos', 'traspaso_detalle', 'variante_conversiones',
    ],
  },
  {
    titulo: 'MÓDULO 5 · CLIENTES Y TIENDA EN LÍNEA',
    tablas: [
      'tipos_cliente', 'clientes', 'direcciones', 'carritos',
      'carrito_items', 'listas_deseos', 'resenas', 'cupones',
    ],
  },
  {
    titulo: 'MÓDULO 6 · CAJA Y PUNTO DE VENTA',
    tablas: ['cajas', 'sesiones_caja', 'movimientos_caja'],
  },
  {
    titulo: 'MÓDULO 7 · VENTAS (PEDIDOS, PAGOS, ENVÍOS)',
    tablas: [
      'metodos_pago', 'paqueterias', 'pedidos', 'pedido_detalle',
      'pedido_detalle_bultos', 'pagos', 'envios',
    ],
  },
  {
    titulo: 'MÓDULO 8 · NÓMINA',
    tablas: ['nomina_empleados', 'nomina_periodos', 'nomina_recibos', 'nomina_recibo_conceptos'],
  },
];

/** Agrupa las tablas encontradas en la BD según MODULOS, sin perder ninguna. */
function agruparPorModulo(tablas) {
  const restantes = new Set(tablas);
  const grupos = [];
  for (const m of MODULOS) {
    const presentes = m.tablas.filter((t) => restantes.has(t));
    presentes.forEach((t) => restantes.delete(t));
    if (presentes.length) grupos.push({ titulo: m.titulo, tablas: presentes });
  }
  if (restantes.size) {
    grupos.push({ titulo: 'SIN CLASIFICAR (añádelas a MODULOS en scripts/dump-db.js)', tablas: [...restantes] });
  }
  return grupos;
}

const cfg = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

function fechaArchivo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function main() {
  const args = process.argv.slice(2);
  const soloEstructura = args.includes('--estructura');
  const rutaDada = args.find((a) => !a.startsWith('--'));
  const salida =
    rutaDada ||
    (soloEstructura
      ? path.resolve(__dirname, '..', '..', 'db', 'schema_mysql.sql')
      : path.resolve(__dirname, '..', '..', 'db', `dump_${cfg.database}_${fechaArchivo()}.sql`));

  const conn = await mysql.createConnection({ ...cfg, dateStrings: true });

  const esc = (v) => {
    if (v === null || v === undefined) return 'NULL';
    if (Buffer.isBuffer(v)) return '0x' + v.toString('hex');
    if (v instanceof Date) return conn.escape(v);
    if (typeof v === 'object') return conn.escape(JSON.stringify(v)); // columnas JSON
    return conn.escape(v);
  };

  const [meta] = await conn.query(
    `SELECT table_name AS name, table_type AS type
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
      ORDER BY (table_type = 'VIEW'), table_name`
  );
  const tablas = meta.filter((t) => t.type === 'BASE TABLE').map((t) => t.name);
  const vistas = meta.filter((t) => t.type === 'VIEW').map((t) => t.name);

  const out = [];
  if (soloEstructura) {
    out.push('-- =====================================================================');
    out.push('--  SISTEMA DE GESTIÓN PARA TIENDA DE HILOS  ·  Esquema MySQL / MariaDB');
    out.push('--  Tienda en línea · Administrador · Inventario · Punto de venta · Nómina');
    out.push('-- ---------------------------------------------------------------------');
    out.push(`--  ARCHIVO GENERADO desde la base '${cfg.database}'. No lo edites a mano:`);
    out.push('--  cambia la base y vuelve a correr  node scripts/dump-db.js --estructura');
    out.push('-- =====================================================================');
  } else {
    out.push(`-- Dump de la base de datos '${cfg.database}' (${cfg.host})`);
  }
  out.push(`-- Generado: ${new Date().toISOString()}`);
  out.push(`-- Tablas: ${tablas.length} · Vistas: ${vistas.length}`);
  out.push('SET NAMES utf8mb4;');
  out.push('SET FOREIGN_KEY_CHECKS = 0;');
  out.push('');

  // Con --estructura el DDL se agrupa por dominio; con datos se respeta el
  // orden alfabético (la restauración no depende de él: las FK van desactivadas).
  const grupos = soloEstructura
    ? agruparPorModulo(tablas)
    : [{ titulo: null, tablas }];

  let totalFilas = 0;
  for (const g of grupos) {
    if (g.titulo) {
      out.push('-- ---------------------------------------------------------------------');
      out.push(`--  ${g.titulo}`);
      out.push('-- ---------------------------------------------------------------------');
      out.push('');
    }
    for (const t of g.tablas) {
      const [[create]] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
      out.push(`-- ---------- Tabla: ${t} ----------`);
      out.push(`DROP TABLE IF EXISTS \`${t}\`;`);
      // AUTO_INCREMENT=N es estado de la base, no del modelo: estorba en el esquema.
      const ddl = soloEstructura
        ? create['Create Table'].replace(/ AUTO_INCREMENT=\d+/, '')
        : create['Create Table'];
      out.push(ddl + ';');
      out.push('');

      if (soloEstructura) continue;

      const [rows] = await conn.query(`SELECT * FROM \`${t}\``);
      if (rows.length) {
        const cols = Object.keys(rows[0]).map((c) => `\`${c}\``).join(', ');
        const CHUNK = 500;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const grupo = rows.slice(i, i + CHUNK);
          const values = grupo
            .map((r) => '(' + Object.values(r).map(esc).join(', ') + ')')
            .join(',\n  ');
          out.push(`INSERT INTO \`${t}\` (${cols}) VALUES\n  ${values};`);
        }
        totalFilas += rows.length;
      }
      out.push('');
    }
  }

  const ddlVistas = new Map();
  for (const v of vistas) {
    const [[create]] = await conn.query(`SHOW CREATE VIEW \`${v}\``);
    ddlVistas.set(
      v,
      create['Create View']
        .replace(/DEFINER=`[^`]*`@`[^`]*` /i, '')
        .replace(/^CREATE /i, 'CREATE OR REPLACE ')
    );
  }

  // Una vista puede apoyarse en otra (v_alertas_stock lee de v_stock_disponible),
  // así que hay que emitirlas por dependencia: en orden alfabético la restauración
  // falla con "Table doesn't exist".
  const ordenadas = [];
  const enCurso = new Set();
  const ordenar = (v) => {
    if (ordenadas.includes(v) || enCurso.has(v)) return; // ya resuelta o ciclo
    enCurso.add(v);
    for (const otra of vistas) {
      if (otra !== v && ddlVistas.get(v).includes(`\`${otra}\``)) ordenar(otra);
    }
    enCurso.delete(v);
    ordenadas.push(v);
  };
  vistas.forEach(ordenar);

  // Los DROP van al revés: primero las dependientes, luego sus dependencias.
  for (const v of [...ordenadas].reverse()) out.push(`DROP VIEW IF EXISTS \`${v}\`;`);
  if (ordenadas.length) out.push('');

  if (ordenadas.length && soloEstructura) {
    out.push('-- ---------------------------------------------------------------------');
    out.push('--  VISTAS DE REPORTES');
    out.push('-- ---------------------------------------------------------------------');
    out.push('');
  }
  for (const v of ordenadas) {
    out.push(`-- ---------- Vista: ${v} ----------`);
    out.push(ddlVistas.get(v) + ';');
    out.push('');
  }

  out.push('SET FOREIGN_KEY_CHECKS = 1;');
  out.push('');

  fs.writeFileSync(salida, out.join('\n'), 'utf8');
  await conn.end();
  const resumen = soloEstructura ? 'solo estructura' : `${totalFilas} filas`;
  console.log(`OK · ${tablas.length} tablas, ${vistas.length} vistas, ${resumen}`);
  console.log(`Archivo: ${salida} (${(fs.statSync(salida).size / 1024).toFixed(1)} KB)`);
}

main().catch((e) => {
  console.error('Error al generar el dump:', e.message);
  process.exit(1);
});
