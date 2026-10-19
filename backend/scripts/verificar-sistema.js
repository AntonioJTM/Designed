#!/usr/bin/env node
'use strict';

/**
 * VERIFICADOR ESTRICTO MÓDULO POR MÓDULO + UI/UX · SISTEMA CRM / POS / ERP HITEX
 *
 * Es 100% de SOLO LECTURA: no modifica ningún archivo ni escribe en la base.
 * Revisa con criterio estricto de arquitectura, reglas de negocio y diseño UI/UX:
 *   1. Orden de archivos, arquitectura por capas, limpieza y privacidad
 *   2. Pantallas, menú, permisos y sistema de diseño UI/UX (DESIGN.md: "La bodega bien llevada")
 *   3. Auditoría estricta MÓDULO POR MÓDULO (los 12 módulos del sistema en código)
 *   4. Base de datos "hitex" módulo por módulo: estructura y cuadre exacto de números
 *      (inventario, paquetes, apartado, ventas, pagos, CRM, crédito, saldo a favor,
 *       traspasos, catálogo, nómina, configuración)
 *
 * Uso (desde backend/):
 *   node scripts/verificar-sistema.js
 *   node scripts/verificar-sistema.js --sin-bd
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const RAIZ = path.resolve(__dirname, '..', '..');
const BACKEND = path.join(RAIZ, 'backend');
const FRONTEND = path.join(RAIZ, 'frontend');

const args = process.argv.slice(2);
const sinBd = args.includes('--sin-bd');
const idxBase = args.indexOf('--base');
const baseElegida = idxBase >= 0 && args[idxBase + 1] ? args[idxBase + 1] : 'hitex';

const hallazgos = {
  archivos: [],
  pantallas: [],
  modulos: [],
  base: [],
};

// Conteo de comprobaciones por cada uno de los 12 módulos
const estadoModulos = new Map([
  ['01 · Hoy y Campana de avisos', { ok: 0, fallas: [] }],
  ['02 · Punto de venta (POS) y Tickets', { ok: 0, fallas: [] }],
  ['03 · Caja y Cortes de turno', { ok: 0, fallas: [] }],
  ['04 · Ventas, Devoluciones, Notas en espera y Pendientes', { ok: 0, fallas: [] }],
  ['05 · CRM Clientes, Expediente, Crédito y Saldo a favor', { ok: 0, fallas: [] }],
  ['06 · Inventario, Detalle por hilo, Conos y Kardex', { ok: 0, fallas: [] }],
  ['07 · Surtir inventario (Cargas .xlsx) y Proveedores', { ok: 0, fallas: [] }],
  ['08 · Surtir sucursal (Traspasos con escaneo)', { ok: 0, fallas: [] }],
  ['09 · Catálogo (Hilos, Presentaciones, Materiales, Precios)', { ok: 0, fallas: [] }],
  ['10 · Cómo va el negocio (Tablero) y Reportes', { ok: 0, fallas: [] }],
  ['11 · Nómina semanal, Horarios, Vacaciones y Comisiones', { ok: 0, fallas: [] }],
  ['12 · Administración (Almacenes, Personal, Permisos, Config)', { ok: 0, fallas: [] }],
]);

let comprobaciones = 0;

function revisar(categoria, condicion, mensajeFalla, gravedad = 'AVISO', modulo = null) {
  comprobaciones++;
  if (modulo && estadoModulos.has(modulo)) {
    const m = estadoModulos.get(modulo);
    if (condicion) m.ok++;
    else m.fallas.push(`[${gravedad}] ${mensajeFalla}`);
  }
  if (!condicion) {
    hallazgos[categoria].push({ gravedad, mensaje: mensajeFalla, modulo });
  }
}

function leer(rutaRelativa) {
  const p = path.join(RAIZ, rutaRelativa);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function listarArchivos(dir, filtro = () => true, acum = []) {
  if (!fs.existsSync(dir)) return acum;
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (['node_modules', '.git', 'dist', '.angular'].includes(entrada.name)) continue;
      listarArchivos(completo, filtro, acum);
    } else if (filtro(completo, entrada.name)) {
      acum.push(completo);
    }
  }
  return acum;
}

// ============================================================================
// 1. ORDEN DE ARCHIVOS, ARQUITECTURA POR CAPAS, LIMPIEZA Y PRIVACIDAD
// ============================================================================
function verificarArchivos() {
  const permitidosRaiz = new Set([
    '.claude', '.agents', '.git', '.gitignore', '.impeccable',
    'backend', 'db', 'deploy', 'Documentos', 'frontend', 'muestras', 'node_modules',
    'CAMBIOS.txt', 'CLAUDE.md', 'DESIGN.md', 'PRODUCT.md', 'README.md',
    'package.json', 'package-lock.json',
  ]);
  for (const item of fs.readdirSync(RAIZ)) {
    revisar(
      'archivos',
      permitidosRaiz.has(item),
      `Hay un archivo o carpeta suelto en la raíz que no va ahí: "${item}".`,
      'IMPORTANTE'
    );
  }

  const settingsClaude = leer('.claude/settings.json');
  if (settingsClaude) {
    revisar(
      'archivos',
      !/[CD]:\\|\/Users\/|root@|\b\d{1,3}(?:\.\d{1,3}){3}\b/i.test(settingsClaude),
      '`.claude/settings.json` tiene rutas de esta computadora o direcciones IP (eso debe ir en `.claude/settings.local.json`, que no se sube).',
      'GRAVE'
    );
  }

  try {
    const gitStatus = execSync('git status --porcelain', { cwd: RAIZ, encoding: 'utf8' });
    for (const linea of gitStatus.split(/\r?\n/).filter(Boolean)) {
      const archivo = linea.slice(3).trim();
      const esPrivado =
        (/(^|\/)\.env(\.|$)/i.test(archivo) && !archivo.endsWith('.ejemplo') && !archivo.endsWith('.example')) ||
        /dump_.*\.sql$/i.test(archivo) ||
        /ticketinfo\.pdf$/i.test(archivo) ||
        /settings\.local\.json$/i.test(archivo) ||
        /^backend\/uploads\//i.test(archivo) ||
        (/\.xlsx$/i.test(archivo) && !archivo.startsWith('muestras/'));
      revisar(
        'archivos',
        !esPrivado,
        `El archivo privado o de datos reales "${archivo}" aparece en git sin ignorar.`,
        'GRAVE'
      );
    }
  } catch {
    // Git no disponible
  }

  // Todos los módulos de backend/src/modules/* conectados en routes.js y respetando arquitectura
  const routesJs = leer('backend/src/routes.js');
  const dirModulos = path.join(BACKEND, 'src', 'modules');
  if (fs.existsSync(dirModulos)) {
    for (const mod of fs.readdirSync(dirModulos, { withFileTypes: true })) {
      if (!mod.isDirectory()) continue;
      const rutaRoutes = path.join(dirModulos, mod.name, 'routes.js');
      if (fs.existsSync(rutaRoutes)) {
        revisar(
          'archivos',
          routesJs.includes(`./modules/${mod.name}/routes`),
          `El módulo del servidor "backend/src/modules/${mod.name}" tiene routes.js pero no está montado en "backend/src/routes.js".`,
          'IMPORTANTE'
        );
        // Ningún routes.js debe hacer SQL directo (pool.query / conn.query)
        const txtRoutes = fs.readFileSync(rutaRoutes, 'utf8');
        revisar(
          'archivos',
          !/\b(pool|conn)\.query\s*\(/.test(txtRoutes),
          `"backend/src/modules/${mod.name}/routes.js" ejecuta SQL directo en el archivo de rutas (debe ir en model.js).`,
          'IMPORTANTE'
        );
      }
      // Ningún archivo fuera de usuarios/clientes debe leer ni devolver el valor de contrasena_hash
      for (const f of listarArchivos(path.join(dirModulos, mod.name), (x) => x.endsWith('.js'))) {
        const txt = fs.readFileSync(f, 'utf8');
        if (!['usuarios', 'clientes'].includes(mod.name)) {
          const sinFiltroNull = txt.replace(/contrasena_hash\s+IS\s+(?:NOT\s+)?NULL/gi, '');
          revisar(
            'archivos',
            !sinFiltroNull.includes('contrasena_hash'),
            `"${path.relative(RAIZ, f)}" lee o expone contrasena_hash fuera de los módulos de autenticación.`,
            'GRAVE'
          );
        }
      }
    }
  }

  // Todas las carpetas de pantallas en frontend/src/app/features/admin/* conectadas en admin.routes.ts
  const adminRoutes = leer('frontend/src/app/features/admin/admin.routes.ts');
  const dirAdmin = path.join(FRONTEND, 'src', 'app', 'features', 'admin');
  if (fs.existsSync(dirAdmin)) {
    for (const carpeta of fs.readdirSync(dirAdmin, { withFileTypes: true })) {
      if (!carpeta.isDirectory()) continue;
      revisar(
        'archivos',
        adminRoutes.includes(`./${carpeta.name}/`),
        `La carpeta de pantalla "frontend/src/app/features/admin/${carpeta.name}" no está conectada en "admin.routes.ts".`,
        'IMPORTANTE'
      );
    }
  }
}

// ============================================================================
// 2. PANTALLAS, MENÚ, PERMISOS E INTERFAZ
// ============================================================================
function verificarPantallasYPermisos() {
  const { CATALOGO, CLAVES } = require(path.join(BACKEND, 'src', 'modules', 'permisos', 'catalogo.js'));
  const navTs = leer('frontend/src/app/core/navegacion.ts');
  const adminRoutesTs = leer('frontend/src/app/features/admin/admin.routes.ts');
  const authServiceTs = leer('frontend/src/app/core/services/auth.service.ts');

  const usados = new Set();
  const regexPermiso = /'(ver:[a-z_]+|hacer:[a-z_]+)'/g;

  const archivosCodigo = [
    ...listarArchivos(path.join(BACKEND, 'src'), (f) => f.endsWith('.js') && !f.endsWith('.test.js')),
    ...listarArchivos(path.join(FRONTEND, 'src', 'app'), (f) => (f.endsWith('.ts') || f.endsWith('.html')) && !f.endsWith('.spec.ts')),
  ];

  for (const archivo of archivosCodigo) {
    if (archivo.endsWith(path.join('permisos', 'catalogo.js'))) continue;
    const contenido = fs.readFileSync(archivo, 'utf8');
    let m;
    while ((m = regexPermiso.exec(contenido)) !== null) {
      usados.add(m[1]);
      revisar(
        'pantallas',
        CLAVES.has(m[1]),
        `En "${path.relative(RAIZ, archivo)}" se pide el permiso "${m[1]}", pero no existe en catalogo.js.`,
        'GRAVE'
      );
    }
  }

  for (const item of CATALOGO) {
    revisar(
      'pantallas',
      usados.has(item.clave),
      `El permiso "${item.clave}" (${item.nombre}) está en Permisos pero ninguna pantalla ni ruta del sistema lo usa.`,
      'AVISO'
    );
  }

  const regexOpcionMenu = /\{\s*clave:\s*'([^']+)',\s*nombre:\s*'([^']+)',\s*ruta:\s*'\/admin\/([^']+)',\s*icono:\s*[^,]+,\s*permiso:\s*(?:'([^']+)'|(null))\s*\}/g;
  let op;
  while ((op = regexOpcionMenu.exec(navTs)) !== null) {
    const [, clave, nombre, subruta, permStr] = op;
    const permiso = permStr || null;
    revisar(
      'pantallas',
      adminRoutesTs.includes(`path: '${subruta}'`),
      `El menú ofrece "${nombre}" (/admin/${subruta}), pero esa ruta no existe en admin.routes.ts.`,
      'GRAVE'
    );
    if (permiso && permiso !== 'admin') {
      revisar(
        'pantallas',
        CLAVES.has(permiso),
        `La opción del menú "${nombre}" (${clave}) usa el permiso "${permiso}", que no existe en catalogo.js.`,
        'GRAVE'
      );
    }
  }

  for (const permGlobal of ['ver:reportes', 'ver:negocio', 'ver:nomina', 'ver:almacenes']) {
    revisar(
      'pantallas',
      authServiceTs.includes(permGlobal),
      `La pantalla con permiso "${permGlobal}" suma todas las tiendas pero no está en SOLO_TODAS_LAS_TIENDAS de auth.service.ts.`,
      'GRAVE'
    );
  }

  // Reglas globales de DESIGN.md ("La bodega bien llevada") y styles.scss
  const designMd = leer('DESIGN.md');
  const stylesScss = leer('frontend/src/styles.scss');
  revisar(
    'pantallas',
    designMd.includes('La bodega bien llevada') && stylesScss.includes('tabular-nums') && stylesScss.includes('.modal > form'),
    'DESIGN.md o styles.scss perdió reglas base del sistema de diseño ("La bodega bien llevada", tabular-nums o .modal > form).',
    'GRAVE'
  );

  const archivosAdmin = listarArchivos(
    path.join(FRONTEND, 'src', 'app', 'features', 'admin'),
    (f) => (f.endsWith('.ts') || f.endsWith('.html') || f.endsWith('.scss')) && !f.endsWith('.spec.ts')
  );

  for (const archivo of archivosAdmin) {
    const rel = path.relative(RAIZ, archivo);
    const texto = fs.readFileSync(archivo, 'utf8');

    if (archivo.endsWith('.ts')) {
      revisar(
        'pantallas',
        !/\bwindow\.(confirm|alert|prompt)\s*\(/.test(texto),
        `En "${rel}" se usa el cuadro nativo del navegador (window.confirm/alert/prompt) en lugar de ConfirmacionService.`,
        'IMPORTANTE'
      );

      const hexSueltos = (texto.match(/#[0-9a-fA-F]{6}\b/g) || []).filter(
        (h) => h.toUpperCase() !== '#FFFFFF'
      );
      revisar(
        'pantallas',
        hexSueltos.length === 0,
        `En "${rel}" hay colores fijos en código (${hexSueltos.join(', ')}) en vez de usar los tokens de styles.scss.`,
        'AVISO'
      );
    }

    if (archivo.endsWith('.scss')) {
      // Regla "Un Solo Azul / Tokens": sin hexadecimales de color sueltos en hojas de componentes (salvo blanco/negro de máscaras)
      const hexEnScss = (texto.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter(
        (h) => !['#FFF', '#FFFFFF', '#000', '#000000'].includes(h.toUpperCase())
      );
      revisar(
        'pantallas',
        hexEnScss.length === 0,
        `En "${rel}" hay colores hexadecimales fijos (${hexEnScss.join(', ')}) en lugar de tokens var(--...) de DESIGN.md.`,
        'IMPORTANTE'
      );

      // Regla "La Letra En Rem": tamaños de letra siempre en rem, nunca en px
      const fontPx = texto.match(/font-size\s*:\s*\d+(?:\.\d+)?px\b/g) || [];
      revisar(
        'pantallas',
        fontPx.length === 0,
        `En "${rel}" se define tamaño de letra en px (${fontPx.join(', ')}) en vez de rem (Regla "Letra En Rem" de DESIGN.md).`,
        'IMPORTANTE'
      );

      // Regla "Plano Por Defecto": sin cristal esmerilado (backdrop-filter)
      revisar(
        'pantallas',
        !/backdrop-filter\s*:/.test(texto),
        `En "${rel}" se usa backdrop-filter (cristal), lo que rompe el diseño plano de DESIGN.md.`,
        'IMPORTANTE'
      );
    }

    if (archivo.endsWith('.html')) {
      revisar(
        'pantallas',
        !/\$\s*\{\{|\{\{[^}]*\.toFixed\(\s*2\s*\)/.test(texto),
        `En la plantilla "${rel}" se formatea dinero a mano (\${{ o {{ x.toFixed(2) }}) en vez de usar el pipe "| dinero".`,
        'IMPORTANTE'
      );

      if (/class="[^"]*\bmodal\b[^"]*"[^>]*role="(?:alert)?dialog"/.test(texto)) {
        revisar(
          'pantallas',
          /aria-modal="true"/.test(texto),
          `En "${rel}" hay una ventana modal (role="dialog") sin aria-modal="true" (el cursor del teclado no entrará solo).`,
          'IMPORTANTE'
        );
      }

      // Un campo de archivo que se abre desde una etiqueta debe usar class="oculto", no el atributo hidden
      revisar(
        'pantallas',
        !/<input[^>]*type="file"[^>]*(?<!aria-)\bhidden\b/i.test(texto),
        `En "${rel}" hay un <input type="file" hidden>; usa class="oculto" para que sea accesible con el teclado (DESIGN.md).`,
        'IMPORTANTE'
      );

      // Sin colores hexadecimales metidos en style="..."
      revisar(
        'pantallas',
        !/style="[^"]*#[0-9a-fA-F]{3,8}\b/i.test(texto),
        `En "${rel}" hay un style="..." con color hexadecimal fijo en lugar de clases o tokens del sistema de diseño.`,
        'IMPORTANTE'
      );

      revisar(
        'pantallas',
        !/Pregúntame|\/admin\/asistente|\/admin\/apartados\b/i.test(texto),
        `En "${rel}" quedó texto o un enlace a algo que ya se eliminó ("Pregúntame" o "Apartados").`,
        'IMPORTANTE'
      );

      // Diccionario estricto de palabras viejas en el texto visible real de la plantilla
      const visible = textoVisibleHtml(texto);
      const palabrasViejasHtml = [
        { re: /\bcategor[ií]as?\b/i, msg: 'dice "categoría(s)" en pantalla (en Hitex se llama "material" / "materiales")' },
        { re: /\bremesas?\b/i, msg: 'dice "remesa(s)" en pantalla (en Hitex se llama "carga" o "surtir inventario")' },
        { re: /\b(?:fiar|fiad[oa]s?)\b/i, msg: 'dice "fiar/fiado/fiada" en pantalla (en Hitex se dice "a crédito")' },
        { re: /cinco pesta[ñn]as/i, msg: 'dice "cinco pestañas" en pantalla (Clientes ya tiene más pestañas)' },
        { re: /\bdado de alta\b/i, msg: 'dice "dado de alta" en masculino fijo (usa "Se dio de alta a…" o texto neutro)' },
      ];
      for (const pv of palabrasViejasHtml) {
        revisar(
          'pantallas',
          !pv.re.test(visible),
          `En la plantilla "${rel}" ${pv.msg}.`,
          'AVISO'
        );
      }

      // Puntuación y formato roto en plantillas (kg— sin espacio, espacio antes de punto tras {{ }})
      revisar(
        'pantallas',
        !/\bkg—/.test(texto) && !/\}\}\s+\.(?!\.)/.test(texto),
        `En "${rel}" hay un error de espaciado o puntuación ("kg—" sin espacio o espacio antes de un punto "}} .").`,
        'AVISO'
      );

      // Plurales fijos con interpolación directa sin singular/plural
      revisar(
        'pantallas',
        !/\{\{[^?:}]+\}\}\s+(?:solicitudes|paquetes)\b/i.test(texto.replace(/<!--[\s\S]*?-->/g, '')),
        `En "${rel}" hay un plural fijo ("1 solicitudes" o "1 paquetes") que no cambia a singular cuando el número es 1.`,
        'AVISO'
      );

      // OPERATIVIDAD DE USUARIO EN PLANTILLAS:
      const htmlSinCom = texto
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/@if\s*\(\s*modal\(\)\s*===\s*'imagen'\s*\)\s*\{[\s\S]*?\n\}/g, '');

      // 1. Ningún botón de envío (<button type="submit">) debe quedar sin [disabled] (evita doble clic / doble cobro)
      const botonesSubmit = htmlSinCom.match(/<button\b[^>]*type="submit"[^>]*>/gi) || [];
      for (const btn of botonesSubmit) {
        revisar(
          'pantallas',
          btn.includes('[disabled]'),
          `En "${rel}" hay un botón <button type="submit"> sin [disabled] para bloquear doble clic mientras guarda.`,
          'IMPORTANTE'
        );
      }

      // 2. Ningún <input type="number"> debe permitir capturar negativos sin min= o [min]=
      const inputsNumero = htmlSinCom.match(/<input\b[^>]*type="number"[^>]*>/gi) || [];
      for (const inp of inputsNumero) {
        revisar(
          'pantallas',
          /\bmin=/.test(inp) || /\[min\]=/.test(inp),
          `En "${rel}" hay un campo numérico (<input type="number">) sin límite mínimo (min="0"), lo que permitiría capturar negativos por error de dedo.`,
          'IMPORTANTE'
        );
      }

      // 3. Ningún fondo de ventana modal (.modal-overlay) debe cerrarse al hacer clic afuera por accidente (pérdida de captura)
      const overlays = htmlSinCom.match(/<div\b[^>]*class="[^"]*\bmodal-overlay\b[^"]*"[^>]*>/gi) || [];
      for (const ov of overlays) {
        revisar(
          'pantallas',
          !/\(click\)\s*=/.test(ov),
          `En "${rel}" la ventana modal se cierra al tocar el fondo (.modal-overlay con (click)), lo que hace perder lo capturado por un clic accidental.`,
          'IMPORTANTE'
        );
      }

      // 4. Toda ventana modal (role="dialog") debe tener botón de cierre visible (.modal-cerrar) con aria-label="Cerrar"
      if (/class="[^"]*\bmodal\b[^"]*"[^>]*role="dialog"/.test(htmlSinCom)) {
        revisar(
          'pantallas',
          htmlSinCom.includes('modal-cerrar') && /aria-label="Cerrar"/.test(htmlSinCom),
          `En "${rel}" hay una ventana modal sin botón de cierre accesible (.modal-cerrar con aria-label="Cerrar").`,
          'IMPORTANTE'
        );
      }
    }
  }
}

function sinComentariosJs(txt) {
  return txt
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

function textoVisibleHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(?:svg|style)\b[\s\S]*?<\/(?:svg|style)>/gi, ' ')
    .replace(/<[a-zA-Z!/](?:"[^"]*"|'[^']*'|[^'">])*>/g, ' ')
    .replace(/@(?:if|else\s+if|for|switch|case)\b[^{]*\{/g, ' ')
    .replace(/@else\s*\{?/g, ' ')
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/[{}]/g, ' ');
}

// ============================================================================
// 3. AUDITORÍA ESTRICTA MÓDULO POR MÓDULO EN EL CÓDIGO (LOS 12 MÓDULOS)
//    Incluye coherencia entre pantallas, ecuaciones que deben cuadrar,
//    promesas de mensajes contra controles reales y OPERATIVIDAD DE USUARIO.
// ============================================================================
function verificarModulosEnCodigo() {
  // MÓDULO 01 · Hoy y Campana de avisos
  const M01 = '01 · Hoy y Campana de avisos';
  const notifModel = leer('backend/src/modules/notificaciones/model.js');
  const hoyRoutes = leer('backend/src/modules/hoy/routes.js');
  const hoyTs = sinComentariosJs(leer('frontend/src/app/features/admin/hoy/hoy.ts'));
  revisar('modulos', notifModel.includes('DIAS_SIN_ABONAR') && notifModel.includes('DIAS_SIN_VENIR') && notifModel.includes('DIAS_CLIENTE_NUEVO'), 'Los umbrales de avisos (DIAS_SIN_ABONAR, DIAS_SIN_VENIR, DIAS_CLIENTE_NUEVO) deben tener nombre en notificaciones/model.js.', 'IMPORTANTE', M01);
  revisar('modulos', notifModel.includes('filtroAlmacen') && hoyRoutes.includes('almacenesDe'), 'Hoy y la campana deben filtrar los pendientes por las tiendas del usuario.', 'GRAVE', M01);
  // Coherencia entre texto y condición: cliente nuevo es de los últimos 15 días (nunca "hace 15 días o más")
  revisar('modulos', !/hace\s+\d+\s+d[ií]as\s+o\s+m[aá]s/i.test(hoyTs), 'En Hoy (hoy.ts), el aviso de cliente nuevo sin crédito no debe decir "hace 15 días o más" (es al revés: capturado en los últimos 15 días).', 'IMPORTANTE', M01);
  // Quien trabaja en una sola tienda no debe ver la tarjeta global "Cobranza atrasada" en $0
  revisar('modulos', hoyTs.includes('veTodasLasTiendas') || hoyTs.includes('todas_las_tiendas'), 'En Hoy (hoy.ts), "Cobranza atrasada" es de toda la cartera y debe ocultarse a quien solo trabaja en una tienda.', 'IMPORTANTE', M01);

  // MÓDULO 02 · Punto de venta (POS) y Tickets
  const M02 = '02 · Punto de venta (POS) y Tickets';
  const posTs = leer('frontend/src/app/features/admin/pos/pos.ts');
  const posHtml = leer('frontend/src/app/features/admin/pos/pos.html');
  const ticketTs = leer('frontend/src/app/shared/ticket/ticket.ts');
  const waTicketTs = leer('frontend/src/app/shared/ticket/whatsapp-ticket.ts');
  revisar('modulos', posTs.includes('enfocarLector') && posTs.includes('alTeclear'), 'El Punto de venta debe mantener siempre el foco en el lector de código de barras (enfocarLector / alTeclear).', 'GRAVE', M02);
  revisar('modulos', posTs.includes("'cobrar'") && posTs.includes("'credito'") && posTs.includes("'espera'") && posTs.includes("'pendiente'"), 'El Punto de venta debe tener los 4 modos de operación (cobrar, credito, espera, pendiente).', 'GRAVE', M02);
  for (const fnTicket of ['armarTicket', 'armarTicketDevolucion', 'armarTicketAbono', 'armarTicketAnticipo', 'armarTicketPagoNota', 'armarPrueba']) {
    revisar('modulos', ticketTs.includes(fnTicket), `En shared/ticket/ticket.ts falta la función "${fnTicket}" para imprimir tickets térmicos.`, 'GRAVE', M02);
  }
  revisar('modulos', !/@page\s*\{[^}]*\bsize\s*:/.test(ticketTs), 'El ticket térmico NO debe poner `size:` dentro de `@page` (Chrome lo encoge a la mitad del rollo de 3 m).', 'GRAVE', M02);
  revisar('modulos', waTicketTs.includes("hecho() === 'enviado'") && !/\}\}\s+\./.test(waTicketTs), 'En whatsapp-ticket.ts, después de mandar el ticket deben ocultarse "Le llega a…" y "Cambiar número" (hecho() === \'enviado\').', 'IMPORTANTE', M02);
  // Operatividad en POS: cálculo de cambio en vivo, lo que siempre lleva el cliente y envío con un solo Enter en WhatsApp
  revisar('modulos', posTs.includes('cambio') && posTs.includes('ColorComprado') && waTicketTs.includes('Aprieta Enter para mandarlo'), 'Operatividad POS: debe mostrar el cambio en vivo al cobrar en efectivo, sugerir los hilos frecuentes del cliente y permitir mandar el WhatsApp con un solo Enter.', 'IMPORTANTE', M02);
  revisar('modulos', posHtml.includes('autocomplete="off"'), 'Operatividad POS: el lector de código de barras debe tener autocomplete="off" para que el navegador no estorbe con sugerencias encima.', 'IMPORTANTE', M02);

  // MÓDULO 03 · Caja y Cortes de turno
  const M03 = '03 · Caja y Cortes de turno';
  const cajaModel = leer('backend/src/modules/caja/model.js');
  const cajaRoutes = leer('backend/src/modules/caja/routes.js');
  const cajaTs = leer('frontend/src/app/features/admin/caja/caja.ts');
  revisar('modulos', cajaModel.includes('SIGNO_CAJA') && cajaModel.includes('EFECTIVO_INSUFICIENTE'), 'El módulo de Caja debe calcular con SIGNO_CAJA e impedir retiros mayores al efectivo del cajón (EFECTIVO_INSUFICIENTE).', 'GRAVE', M03);
  revisar('modulos', cajaRoutes.includes('hacer:mover_efectivo'), 'Sacar o meter efectivo en Caja debe exigir el permiso "hacer:mover_efectivo" en el servidor.', 'GRAVE', M03);
  // Identidad matemática de Caja: las tarjetas de arriba deben incluir todos los ingresos que no son venta (abonos, anticipos, pagos de nota, entregas, ingresos) para cuadrar con "Debería haber"
  revisar('modulos', cajaTs.includes('claseIngreso') && cajaTs.includes('anticipo') && cajaTs.includes('nota'), 'En Caja (caja.ts), las cifras de arriba deben sumar todos los ingresos al cajón (abonos, anticipos, pagos de nota, entregas e ingresos a mano) para cuadrar con "Debería haber".', 'GRAVE', M03);

  // MÓDULO 04 · Ventas, Devoluciones, Notas en espera y Pendientes
  const M04 = '04 · Ventas, Devoluciones, Notas en espera y Pendientes';
  const pedModel = leer('backend/src/modules/pedidos/model.js');
  const pedRoutes = leer('backend/src/modules/pedidos/routes.js');
  const devJs = leer('backend/src/modules/pedidos/devoluciones.js');
  const pedDetTs = leer('frontend/src/app/features/admin/pedidos/pedido-detalle.ts');
  const devModalTs = leer('frontend/src/app/features/admin/pedidos/devolucion-modal.ts');
  const devModalHtml = leer('frontend/src/app/features/admin/pedidos/devolucion-modal.html');
  const modModalHtml = leer('frontend/src/app/features/admin/encargos/modificar-modal.html');
  const encargosTs = leer('frontend/src/app/features/admin/encargos/encargos.ts');
  const encargosHtml = leer('frontend/src/app/features/admin/encargos/encargos.html');
  revisar('modulos', pedRoutes.includes('sinCostosEnRespuesta'), 'El router de pedidos debe filtrar costos con sinCostosEnRespuesta.', 'GRAVE', M04);
  revisar('modulos', pedModel.includes('_cotizar') && pedModel.includes('_exigirPaqueteAqui'), 'Ventas debe calcular totales en un solo lugar (_cotizar) y exigir que los paquetes escaneados sean de esa tienda (_exigirPaqueteAqui).', 'GRAVE', M04);
  revisar('modulos', devJs.includes('descontarDeVenta') && devJs.includes('debeDeVenta'), 'Las devoluciones de una nota que todavía se debe deben descontarse primero de esa misma nota (debeDeVenta / descontarDeVenta).', 'GRAVE', M04);
  // Prohibido subir comprobante directo en una venta a crédito que aún se debe (causa doble cobro / deuda fantasma)
  revisar('modulos', pedModel.includes('VENTA_A_CREDITO_USA_ABONOS') && pedDetTs.includes('depositoComoAbono'), 'Una venta a crédito que todavía se debe NO debe permitir "Subir captura" en el pedido (el depósito se registra como abono a su cuenta).', 'GRAVE', M04);
  // Al entregar una nota en espera, debe ofrecerse tanto Imprimir ticket como Mandar por WhatsApp
  revisar('modulos', encargosTs.includes('ticketAviso') && encargosHtml.includes('app-boton-whatsapp'), 'Al entregar una nota en espera (encargos), se debe ofrecer imprimir el ticket y mandarlo por WhatsApp.', 'IMPORTANTE', M04);
  // Operatividad en Devoluciones y Modificar nota: lector enfocado al abrir (no en la X) y vista previa "antes -> después"
  revisar('modulos', devModalTs.includes("viewChild<ElementRef<HTMLInputElement>>('lector')") && devModalHtml.includes('autocomplete="off"') && modModalHtml.includes('autocomplete="off"'), 'Operatividad en Devolución y Modificar nota: el lector debe abrir con el foco en el campo de escaneo (nunca en la X) y con autocomplete="off".', 'IMPORTANTE', M04);

  // MÓDULO 05 · CRM Clientes, Expediente, Crédito y Saldo a favor
  const M05 = '05 · CRM Clientes, Expediente, Crédito y Saldo a favor';
  const cliModel = leer('backend/src/modules/clientes/model.js');
  const cliSaldo = leer('backend/src/modules/clientes/saldo-favor.js');
  const cliRoutes = leer('backend/src/modules/clientes/routes.js');
  const anaModel = leer('backend/src/modules/analisis/model.js');
  const anaService = leer('backend/src/modules/analisis/service.js');
  const tableroTs = sinComentariosJs(leer('frontend/src/app/features/admin/tablero/tablero.ts'));
  const vistaDeudaTs = sinComentariosJs(leer('frontend/src/app/features/admin/clientes/vistas/vista-deuda.ts'));
  const adminRoutesTs = leer('frontend/src/app/features/admin/admin.routes.ts');
  revisar('modulos', cliModel.includes('asignarCodigo') && cliModel.includes('repartirAbonos') && cliModel.includes('liquidarVentasACredito'), 'El CRM de Clientes debe asignar código automático (C-0001), repartir abonos por antigüedad (FIFO) y liquidar ventas a crédito cubiertas.', 'GRAVE', M05);
  revisar('modulos', cliSaldo.includes('recibirAnticipo') && cliSaldo.includes('ajustarSaldo') && cliSaldo.includes('SALDO_FAVOR_INSUFICIENTE'), 'El libro de saldo a favor debe soportar anticipos, ajustes con motivo y nunca permitir saldo negativo.', 'GRAVE', M05);
  revisar('modulos', cliRoutes.includes('hacer:corregir_deuda'), 'Ajustar deuda o saldo a favor en Clientes debe exigir el permiso "hacer:corregir_deuda".', 'GRAVE', M05);
  for (const vista of ['todos', 'frecuencia', 'dejaron', 'deuda', 'que-compra', 'cuando', 'gasto', 'lugares']) {
    revisar('modulos', adminRoutesTs.includes(`'${vista}'`), `Falta la pestaña "${vista}" del CRM de Clientes en admin.routes.ts.`, 'GRAVE', M05);
  }
  // Unificación del plazo de atraso en todo el sistema (15 días desde el último abono en Caja, Campana, Cuánto debe y Cómo va el negocio)
  revisar(
    'modulos',
    cliModel.includes('diasSinAbonarDeTodos') &&
      anaModel.includes('diasSinAbonarDeTodos') &&
      !anaService.includes('dias_aviso ?? 30') &&
      !tableroTs.includes('dias_aviso: 30'),
    'El plazo de cuenta atrasada debe ser uno solo (15 días desde el último abono) en Caja, Campana, Clientes › Cuánto debe y Cómo va el negocio (sin mezclar 15 y 30 días).',
    'GRAVE',
    M05
  );
  revisar('modulos', !/d[oó]nde\s+fiar/i.test(vistaDeudaTs), 'En Clientes › Cuánto debe no debe quedar la palabra vieja "dónde fiar".', 'AVISO', M05);

  // MÓDULO 06 · Inventario, Detalle por hilo, Conos y Kardex
  const M06 = '06 · Inventario, Detalle por hilo, Conos y Kardex';
  const invModel = leer('backend/src/modules/inventario/model.js');
  const invService = leer('backend/src/modules/inventario/service.js');
  const invRoutes = leer('backend/src/modules/inventario/routes.js');
  const hiloJs = leer('backend/src/modules/inventario/hilo.js');
  const minModalHtml = leer('frontend/src/app/features/admin/inventario/minimo-modal.html').replace(/<!--[\s\S]*?-->/g, '');
  const minModalTs = sinComentariosJs(leer('frontend/src/app/features/admin/inventario/minimo-modal.ts'));
  const minsModalTs = sinComentariosJs(leer('frontend/src/app/features/admin/inventario/minimos-modal.ts'));
  const movModalHtml = leer('frontend/src/app/features/admin/inventario/movimiento-modal.html');
  const desarmeModalHtml = leer('frontend/src/app/features/admin/inventario/desarme-modal.html');
  revisar('modulos', invRoutes.includes('sinCostosEnRespuesta'), 'El router de inventario debe filtrar costos con sinCostosEnRespuesta.', 'GRAVE', M06);
  revisar('modulos', invModel.includes('COND_ALERTA') && invModel.includes('SOLO_EN_TIENDA') && invModel.includes('destare_por_cono_kg'), 'Inventario debe exigir stock_minimo > 0 para alertas (COND_ALERTA), permitir bajar conos solo en tiendas (SOLO_EN_TIENDA) y soportar destare por cono.', 'GRAVE', M06);
  revisar('modulos', hiloJs.includes('detalleHilo') && hiloJs.includes('bultosDeLote'), 'El detalle de un hilo en Inventario debe exponer saldos por almacén, lotes y paquetes uno por uno.', 'IMPORTANTE', M06);
  // Coherencia entre COND_ALERTA (<=) y texto de las ventanas de mínimo ("o menos", no "menos de")
  revisar('modulos', !/menos de\b/i.test(minModalHtml) && !/menos de\b/i.test(minModalTs) && !/menos de\b/i.test(minsModalTs), 'El stock mínimo avisa al llegar al número o menos (<=); las ventanas de mínimo deben decir "N paquetes o menos", nunca "menos de N".', 'IMPORTANTE', M06);
  // Kardex: distinguir el faltante (merma) y la cancelación de un traspaso del envío normal
  revisar('modulos', invService.includes('Faltante del traspaso') && invService.includes('se canceló el traspaso'), 'En el Kardex (inventario/service.js → _describir), el faltante de un envío debe rotularse como "Faltante del traspaso…" y la cancelación como "Regresó: se canceló el traspaso…", no como un traspaso normal.', 'IMPORTANTE', M06);
  // Operatividad en Inventario: vista previa antes de confirmar ajuste/merma/mínimo y lector limpio en conos
  revisar('modulos', movModalHtml.includes('saldoResultante') && minModalHtml.includes('previa') && desarmeModalHtml.includes('autocomplete="off"'), 'Operatividad en Inventario: Ajuste/merma y Stock mínimo deben mostrar vista previa del resultado antes de guardar, y Bajar conos debe tener lector con autocomplete="off".', 'IMPORTANTE', M06);

  // MÓDULO 07 · Surtir inventario (Cargas .xlsx) y Proveedores
  const M07 = '07 · Surtir inventario (Cargas .xlsx) y Proveedores';
  const remModel = leer('backend/src/modules/remesas/model.js');
  const remLista = leer('backend/src/modules/remesas/lista.js');
  const remHtml = leer('frontend/src/app/features/admin/remesas/remesas.html').replace(/<!--[\s\S]*?-->/g, '');
  revisar('modulos', remModel.includes('TANDA_BULTOS') && remModel.includes('recalcularCosto'), 'Surtir inventario debe insertar bultos por tandas (TANDA_BULTOS) y recalcular el costo promedio ponderado móvil.', 'GRAVE', M07);
  revisar('modulos', remLista.includes('X-Accel-Buffering') || leer('backend/src/modules/remesas/controller.js').includes('X-Accel-Buffering'), 'La carga de lista completa del proveedor debe reportar avance por partes sin buffering (X-Accel-Buffering: no).', 'IMPORTANTE', M07);
  revisar('modulos', !/>\s*Remesa\s*</i.test(remHtml), 'En Surtir inventario (remesas.html) no debe quedar el rótulo viejo "Remesa" en vez de "Carga".', 'AVISO', M07);

  // MÓDULO 08 · Surtir sucursal (Traspasos con escaneo)
  const M08 = '08 · Surtir sucursal (Traspasos con escaneo)';
  const envioModalHtml = leer('frontend/src/app/features/admin/traspasos/envio-modal.html');
  const traspasosHtml = leer('frontend/src/app/features/admin/traspasos/traspasos.html');
  revisar('modulos', invModel.includes('SIN_ESCANEAR') && invModel.includes('guardarEscaneos') && invModel.includes('_traerAlOrigen'), 'Surtir sucursal debe exigir escanear paquetes al enviar (SIN_ESCANEAR), permitir guardar escaneos a medias y pasar con sus kilos los paquetes encontrados en otro almacén.', 'GRAVE', M08);
  revisar('modulos', !invRoutes.includes('/transferencias'), 'No debe existir la ruta vieja /transferencias que movía kilos sin mover paquetes; todo va por /traspasos.', 'GRAVE', M08);
  // Operatividad en Surtir sucursal: lector de envío con autocomplete="off" y barra de avance por hilo
  revisar('modulos', envioModalHtml.includes('autocomplete="off"') && traspasosHtml.includes('avance-barra'), 'Operatividad en Surtir sucursal: el modal de envío debe tener lector con autocomplete="off" y mostrar barra de avance de paquetes por hilo.', 'IMPORTANTE', M08);

  // MÓDULO 09 · Catálogo (Hilos, Presentaciones, Materiales, Precios)
  const M09 = '09 · Catálogo (Hilos, Presentaciones, Materiales, Precios)';
  const prodModel = leer('backend/src/modules/productos/model.js');
  const prodService = leer('backend/src/modules/productos/service.js');
  const varRoutes = leer('backend/src/modules/variantes/routes.js');
  const varCtrl = leer('backend/src/modules/variantes/controller.js');
  const varService = leer('backend/src/modules/variantes/service.js');
  const presHtml = leer('frontend/src/app/features/admin/productos/producto-presentaciones.html');
  const presTs = leer('frontend/src/app/features/admin/productos/producto-presentaciones.ts');
  const prodFormHtml = leer('frontend/src/app/features/admin/productos/producto-form-modal.html');
  const catTs = sinComentariosJs(leer('frontend/src/app/features/admin/categorias/categorias.ts'));
  revisar('modulos', prodModel.includes('eliminarSiVacio') && prodService.includes('PRODUCTO_CON_MOVIMIENTOS'), 'Un producto solo debe poder eliminarse si no tiene paquetes, cargas, ventas ni movimientos (eliminarSiVacio / PRODUCTO_CON_MOVIMIENTOS).', 'GRAVE', M09);
  revisar('modulos', varRoutes.includes('sinCostosEnRespuesta') && varCtrl.includes('_bultosDeSusTiendas'), 'Presentaciones debe ocultar el costo a quien no lo ve y filtrar los bultos a las tiendas del usuario (_bultosDeSusTiendas).', 'GRAVE', M09);
  // Si el error al borrar presentación promete "desactívala en «Precio y peso»", esa ventana DEBE tener la casilla Activa
  if (varService.includes('Precio y peso')) {
    revisar(
      'modulos',
      presHtml.includes('varianteActiva') && presTs.includes('varianteActiva'),
      'El mensaje al borrar una presentación dice "desactívala en «Precio y peso»", pero la ventana de Precio y peso no tiene la casilla Activa (varianteActiva).',
      'GRAVE',
      M09
    );
  }
  // La tarjeta "Imágenes" solo le servía a la tienda en línea apagada: debe estar comentada o fuera del DOM
  const presHtmlSinComentarios = presHtml.replace(/<!--[\s\S]*?-->/g, '');
  revisar('modulos', !/>\s*Im[aá]genes\s*</.test(presHtmlSinComentarios), 'En Presentaciones sigue visible la tarjeta "Imágenes" que solo servía para la tienda en línea apagada.', 'AVISO', M09);
  revisar('modulos', !/\bcategoría/i.test(catTs), 'En Materiales (categorias.ts), los mensajes al usuario deben decir "material", nunca "categoría".', 'AVISO', M09);
  // Operatividad en Catálogo: captura continua ("Capturar otro color") y captura continua de bultos a mano sin cerrar el modal
  revisar('modulos', prodFormHtml.includes('Capturar otro color') && presHtml.includes('avisoBulto'), 'Operatividad en Catálogo: el alta de producto debe ofrecer "Capturar otro color" sin cerrar y "Agregar bulto a mano" debe permitir escanear varios bultos seguidos.', 'IMPORTANTE', M09);

  // MÓDULO 10 · Cómo va el negocio (Tablero) y Reportes
  const M10 = '10 · Cómo va el negocio (Tablero) y Reportes';
  const anaRoutes = leer('backend/src/modules/analisis/routes.js');
  const repRoutes = leer('backend/src/modules/reportes/routes.js');
  const repModel = leer('backend/src/modules/reportes/model.js');
  const repHtml = leer('frontend/src/app/features/admin/reportes/reportes.html');
  const ventaColor = leer('backend/src/modules/reportes/venta-color.js');
  revisar('modulos', anaRoutes.includes('requireTodasLasTiendas') && repRoutes.includes('requireTodasLasTiendas'), 'El tablero "Cómo va el negocio" y "Reportes" suman todas las tiendas y deben exigir requireTodasLasTiendas.', 'GRAVE', M10);
  revisar('modulos', repModel.includes('devolucion') && ventaColor.includes('armarVentaPorColor'), 'El reporte de "Venta por color" debe restar los kilos devueltos por los clientes.', 'IMPORTANTE', M10);
  // En Reportes › Ventas por día, el desglose debe incluir costo_envio / envio para que sin IVA - descuentos + IVA + envío = total
  revisar('modulos', repModel.includes('costo_envio') && repHtml.includes('envio'), 'En Reportes › Ventas por día, el desglose debe incluir el envío (costo_envio) para que las cifras sumen el total.', 'IMPORTANTE', M10);

  // MÓDULO 11 · Nómina semanal, Horarios, Vacaciones y Comisiones
  const M11 = '11 · Nómina semanal, Horarios, Vacaciones y Comisiones';
  const nomRoutes = leer('backend/src/modules/nomina/routes.js');
  const nomCom = leer('backend/src/modules/nomina/comisiones.js');
  const nomRep = leer('backend/src/modules/nomina/reporte.js');
  const nomJorBack = leer('backend/src/modules/nomina/jornada.js');
  const nomJorFront = leer('frontend/src/app/features/admin/nomina/jornada.ts');
  revisar('modulos', nomRoutes.includes('requireTodasLasTiendas'), 'Nómina suma todas las tiendas y debe exigir requireTodasLasTiendas.', 'GRAVE', M11);
  revisar('modulos', nomCom.includes('ventasSinPagarComision') && nomCom.includes('devuelto'), 'Las comisiones de nómina deben pagarse al liquidarse la venta y descontar lo que el cliente devolvió.', 'GRAVE', M11);
  revisar('modulos', Boolean(nomJorBack && nomJorFront), 'El cálculo de jornada, horas extra al doble y vacaciones por ley debe existir en el servidor (nomina/jornada.js) y en la pantalla (nomina/jornada.ts).', 'IMPORTANTE', M11);
  revisar('modulos', nomRep.includes("tipo === 'devolucion'") || nomRep.includes('devoluciones'), 'El PDF de comisiones (nomina/reporte.js) no debe contar una devolución como venta ni sumar su total al monto vendido.', 'IMPORTANTE', M11);

  // MÓDULO 12 · Administración (Almacenes, Personal, Permisos, Config)
  const M12 = '12 · Administración (Almacenes, Personal, Permisos, Config)';
  const permService = leer('backend/src/modules/permisos/service.js');
  const costosTs = leer('frontend/src/app/core/costos.ts');
  const usuCtrl = leer('backend/src/modules/usuarios/controller.js');
  const usuService = leer('backend/src/modules/usuarios/service.js');
  const usuTs = sinComentariosJs(leer('frontend/src/app/features/admin/usuarios/usuarios.ts'));
  const permTs = sinComentariosJs(leer('frontend/src/app/features/admin/permisos/permisos.ts'));
  const cuentasJs = leer('backend/src/modules/configuracion/cuentas.js');
  const prodGuard = leer('backend/scripts/_produccion.js');
  const dbConfig = leer('backend/src/config/db.js');
  const mBack = permService.match(/SE_LLEVA_COSTO\s*=\s*(true|false)/);
  const mFront = costosTs.match(/SE_LLEVA_COSTO\s*=\s*(true|false)/);
  revisar('modulos', mBack && mFront && mBack[1] === mFront[1], `El interruptor SE_LLEVA_COSTO no coincide entre servidor (${mBack?.[1]}) y pantalla (${mFront?.[1]}).`, 'GRAVE', M12);
  revisar('modulos', usuCtrl.includes('SOLO_ADMINISTRADOR') && usuService.includes('SOLO_SUS_TIENDAS'), 'En Personal, solo un administrador puede dar el puesto de administrador (SOLO_ADMINISTRADOR) y nadie puede asignar tiendas que no ve (SOLO_SUS_TIENDAS).', 'GRAVE', M12);
  revisar('modulos', cuentasJs.includes('clabeValida'), 'Las cuentas bancarias en Configuración deben validar el dígito de control de la CLABE (clabeValida).', 'IMPORTANTE', M12);
  revisar('modulos', prodGuard.includes('hitex') && dbConfig.includes('time_zone'), 'Debe estar activo el candado que protege la base "hitex" y la hora de México centro en la conexión.', 'GRAVE', M12);
  revisar('modulos', !/dado de alta/i.test(usuTs) && !/cinco pesta[ñn]as/i.test(permTs), 'En Personal y Permisos no deben quedar textos viejos ("dado de alta" en masculino fijo o "las cinco pestañas").', 'AVISO', M12);
}

// ============================================================================
// 4. BASE DE DATOS MÓDULO POR MÓDULO: ESTRUCTURA Y CUADRE DE NÚMEROS
// ============================================================================
async function verificarBaseDeDatos() {
  if (sinBd) return { conectada: false, motivo: 'Se pidió --sin-bd' };

  let c;
  try {
    c = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: +(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: baseElegida,
      dateStrings: true,
    });
  } catch (e) {
    hallazgos.base.push({
      gravedad: 'AVISO',
      mensaje: `No se pudo conectar a la base "${baseElegida}" (${e.code || e.message}).`,
    });
    return { conectada: false, motivo: e.message };
  }

  try {
    const M03 = '03 · Caja y Cortes de turno';
    const M04 = '04 · Ventas, Devoluciones, Notas en espera y Pendientes';
    const M05 = '05 · CRM Clientes, Expediente, Crédito y Saldo a favor';
    const M06 = '06 · Inventario, Detalle por hilo, Conos y Kardex';
    const M08 = '08 · Surtir sucursal (Traspasos con escaneo)';
    const M09 = '09 · Catálogo (Hilos, Presentaciones, Materiales, Precios)';
    const M10 = '10 · Cómo va el negocio (Tablero) y Reportes';
    const M11 = '11 · Nómina semanal, Horarios, Vacaciones y Comisiones';
    const M12 = '12 · Administración (Almacenes, Personal, Permisos, Config)';

    // 4.1 Verificar que todas las tablas esenciales existen en "hitex"
    const tablasEsenciales = [
      'almacenes', 'cajas', 'sesiones_caja', 'movimientos_caja',
      'usuarios', 'roles', 'permisos', 'rol_permisos', 'usuario_roles', 'usuario_almacenes',
      'categorias', 'lineas', 'unidades_medida', 'tipos_cliente',
      'productos', 'producto_variantes', 'variante_codigos', 'variante_precios',
      'inventario', 'movimientos_inventario', 'variante_conversiones',
      'proveedores', 'remesas', 'traspasos', 'traspaso_detalle', 'traspaso_bultos',
      'clientes', 'lugares_entrega', 'credito_movimientos', 'saldo_favor_movimientos',
      'pedidos', 'pedido_detalle', 'pedido_detalle_bultos', 'pagos', 'metodos_pago',
      'devoluciones', 'devolucion_detalle',
      'nomina_empleados', 'nomina_periodos', 'nomina_recibos', 'nomina_horarios', 'nomina_vacaciones',
      'configuracion', 'cuentas_bancarias',
    ];
    const [tablasEnBase] = await c.query(
      'SELECT table_name t FROM information_schema.tables WHERE table_schema = ?',
      [baseElegida]
    );
    const setTablas = new Set(tablasEnBase.map((r) => r.t));
    const tablasFaltantes = tablasEsenciales.filter((t) => !setTablas.has(t));
    revisar(
      'base',
      tablasFaltantes.length === 0,
      `A la base "${baseElegida}" le faltan tablas esenciales: ${tablasFaltantes.join(', ')}.`,
      'GRAVE',
      M12
    );

    // 4.2 Módulo 12 · Almacén Matriz, Personal, Permisos y CLABEs
    const [[matriz]] = await c.query('SELECT COUNT(*) n FROM almacenes WHERE activo = 1 AND es_matriz = 1');
    const [[totalAlm]] = await c.query('SELECT COUNT(*) n FROM almacenes WHERE activo = 1');
    if (Number(totalAlm.n) > 0) {
      revisar(
        'base',
        Number(matriz.n) === 1,
        Number(matriz.n) === 0
          ? `En "${baseElegida}" hay almacenes pero ninguno está marcado como Matriz.`
          : `En "${baseElegida}" hay ${matriz.n} almacenes marcados como Matriz (solo debe haber uno).`,
        'IMPORTANTE',
        M12
      );
    }

    const [cargadoresConAcceso] = await c.query(
      `SELECT u.id, u.nombre
         FROM usuarios u
         JOIN roles r ON r.id = u.rol_id
        WHERE r.entra_al_sistema = 0
          AND (u.correo IS NOT NULL OR u.contrasena_hash IS NOT NULL
               OR EXISTS (SELECT 1 FROM usuario_roles ur WHERE ur.usuario_id = u.id))`
    );
    revisar('base', cargadoresConAcceso.length === 0, `Hay empleado(s) con puesto "cargador" pero con correo, contraseña u otros puestos: ${cargadoresConAcceso.map((u) => u.nombre).join(', ')}.`, 'GRAVE', M12);

    const [usuariosSinTienda] = await c.query(
      `SELECT u.id, u.nombre, r.nombre AS puesto
         FROM usuarios u
         JOIN roles r ON r.id = u.rol_id
        WHERE u.activo = 1
          AND r.entra_al_sistema = 1
          AND r.nombre <> 'administrador'
          AND u.todas_las_tiendas = 0
          AND NOT EXISTS (SELECT 1 FROM usuario_almacenes ua WHERE ua.usuario_id = u.id)`
    );
    revisar('base', usuariosSinTienda.length === 0, `Hay personal activo sin ninguna tienda asignada en Personal ("Trabaja en"): ${usuariosSinTienda.map((u) => `${u.nombre} (${u.puesto})`).join(', ')}.`, 'IMPORTANTE', M12);

    const { clabeValida } = require(path.join(BACKEND, 'src', 'modules', 'configuracion', 'cuentas.js'));
    const [cuentas] = await c.query('SELECT banco, clabe FROM cuentas_bancarias WHERE clabe IS NOT NULL AND clabe <> ""');
    const clabesMal = cuentas.filter((cta) => !clabeValida(cta.clabe));
    revisar('base', clabesMal.length === 0, `Hay cuenta(s) bancaria(s) en "${baseElegida}" con CLABE inválida: ${clabesMal.map((c) => `${c.banco} (${c.clabe})`).join(', ')}.`, 'GRAVE', M12);

    // 4.3 Módulo 03 · Caja y sesiones
    const [sesionesIncoherentes] = await c.query(
      `SELECT id, estado, fecha_cierre
         FROM sesiones_caja
        WHERE (estado = 'cerrada' AND fecha_cierre IS NULL)
           OR (estado = 'abierta' AND fecha_cierre IS NOT NULL)`
    );
    revisar('base', sesionesIncoherentes.length === 0, `Hay ${sesionesIncoherentes.length} turno(s) de caja donde el estado (abierta/cerrada) contradice su fecha de cierre.`, 'GRAVE', M03);

    // 4.4 Módulo 06 · Inventario, paquetes y conversiones
    const [invNeg] = await c.query(
      `SELECT p.nombre, p.grosor_calibre, v.tipo_presentacion, a.nombre AS almacen, i.cantidad, i.cantidad_reservada
         FROM inventario i
         JOIN producto_variantes v ON v.id = i.variante_id
         JOIN productos p ON p.id = v.producto_id
         JOIN almacenes a ON a.id = i.almacen_id
        WHERE i.cantidad < 0 OR i.cantidad_reservada < 0`
    );
    revisar('base', invNeg.length === 0, `Hay existencias o apartados en NEGATIVO en "${baseElegida}": ${invNeg.map((r) => `${r.nombre} ${r.grosor_calibre || ''} en ${r.almacen} (saldo ${r.cantidad} kg, apartado ${r.cantidad_reservada} kg)`).join('; ')}.`, 'GRAVE', M06);

    const [descuadresPaquetes] = await c.query(
      `SELECT p.nombre, p.grosor_calibre, a.nombre AS almacen,
              i.cantidad AS kg_inventario,
              COALESCE(SUM(vc.peso_kg), 0) AS kg_paquetes,
              COUNT(vc.id) AS num_paquetes
         FROM inventario i
         JOIN producto_variantes v ON v.id = i.variante_id AND v.tipo_presentacion = 'paquete'
         JOIN productos p ON p.id = v.producto_id
         JOIN almacenes a ON a.id = i.almacen_id
         LEFT JOIN variante_codigos vc
           ON vc.variante_id = v.id
          AND vc.almacen_id = i.almacen_id
          AND vc.estado IN ('disponible', 'apartado')
        WHERE EXISTS (SELECT 1 FROM variante_codigos x WHERE x.variante_id = v.id)
        GROUP BY i.id, p.nombre, p.grosor_calibre, a.nombre, i.cantidad
       HAVING ABS(i.cantidad - COALESCE(SUM(vc.peso_kg), 0)) > 0.5`
    );
    revisar(
      'base',
      descuadresPaquetes.length === 0,
      `En "${baseElegida}" los kilos de inventario no cuadran con los paquetes físicos (> 0.5 kg de diferencia): ${descuadresPaquetes
        .map((r) => `${r.nombre} ${r.grosor_calibre || ''} en ${r.almacen} dice ${Number(r.kg_inventario).toFixed(2)} kg pero sus ${r.num_paquetes} paquetes suman ${Number(r.kg_paquetes).toFixed(2)} kg`)
        .join('; ')}.`,
      'IMPORTANTE',
      M06
    );

    const [bultosHuerfanos] = await c.query(
      `SELECT vc.codigo, vc.estado, vc.consumido_tipo, vc.consumido_id,
              p.estado AS estado_pedido, t.estado AS estado_traspaso
         FROM variante_codigos vc
         LEFT JOIN pedidos p ON vc.consumido_tipo = 'pedido' AND p.id = vc.consumido_id
         LEFT JOIN traspasos t ON vc.consumido_tipo = 'traspaso' AND t.id = vc.consumido_id
        WHERE (vc.estado = 'vendido' AND vc.consumido_tipo = 'pedido' AND (p.id IS NULL OR p.estado IN ('cancelado', 'devuelto')))
           OR (vc.estado = 'apartado' AND vc.consumido_tipo = 'pedido' AND (p.id IS NULL OR p.estado IN ('cancelado', 'devuelto') OR p.inventario_descontado = 1))
           OR (vc.estado = 'apartado' AND vc.consumido_tipo = 'traspaso' AND (t.id IS NULL OR t.estado <> 'solicitado'))`
    );
    revisar('base', bultosHuerfanos.length === 0, `Hay ${bultosHuerfanos.length} paquete(s) con estado sin sentido (vendidos o apartados en una venta o traspaso cancelado o cerrado): ${bultosHuerfanos.slice(0, 5).map((b) => `${b.codigo} (${b.estado})`).join(', ')}.`, 'GRAVE', M06);

    // 4.5 Módulo 04 · Ventas, pagos, notas pendientes y aritmética de pedidos
    const [pedidosAritmetica] = await c.query(
      `SELECT numero_pedido, subtotal, descuento, impuestos, costo_envio, total
         FROM pedidos
        WHERE ABS((subtotal - descuento + impuestos + costo_envio) - total) > 0.02`
    );
    revisar('base', pedidosAritmetica.length === 0, `Hay pedido(s) donde subtotal - descuento + impuestos + envío no da el total: ${pedidosAritmetica.map((p) => p.numero_pedido).join(', ')}.`, 'GRAVE', M04);

    const [notasDescuadradas] = await c.query(
      `SELECT p.id, p.numero_pedido AS folio, p.total, p.estado,
              COALESCE(SUM(CASE WHEN pg.estado = 'completado' THEN pg.monto ELSE 0 END), 0) AS pagado
         FROM pedidos p
         LEFT JOIN pagos pg ON pg.pedido_id = p.id
        WHERE p.nota_pendiente = 1
          AND p.estado = 'pendiente'
          AND NOT EXISTS (
            SELECT 1 FROM credito_movimientos cm WHERE cm.pedido_id = p.id AND cm.tipo = 'cargo'
          )
        GROUP BY p.id, p.numero_pedido, p.total, p.estado
       HAVING pagado >= p.total - 0.009`
    );
    revisar('base', notasDescuadradas.length === 0, `Hay nota(s) pendiente(s) de pago que ya tienen cubierto el total pero siguen marcadas como pendientes: ${notasDescuadradas.map((n) => `${n.folio} ($${n.pagado} de $${n.total})`).join(', ')}.`, 'GRAVE', M04);

    const [pagosDeMas] = await c.query(
      `SELECT p.id, p.numero_pedido AS folio, p.total,
              SUM(pg.monto) AS suma_pagos
         FROM pedidos p
         JOIN pagos pg ON pg.pedido_id = p.id AND pg.estado = 'completado'
        WHERE p.estado NOT IN ('cancelado', 'devuelto')
        GROUP BY p.id, p.numero_pedido, p.total
       HAVING suma_pagos > p.total + 0.02`
    );
    revisar('base', pagosDeMas.length === 0, `Hay venta(s) donde los pagos registrados suman más que el total de la venta: ${pagosDeMas.map((p) => `${p.folio} (pagos $${p.suma_pagos} vs total $${p.total})`).join(', ')}.`, 'GRAVE', M04);

    // 4.6 Módulo 05 · CRM Clientes, Crédito y Saldo a favor
    const [clientesSinCodigo] = await c.query('SELECT id, nombre FROM clientes WHERE codigo IS NULL OR TRIM(codigo) = ""');
    revisar('base', clientesSinCodigo.length === 0, `Hay cliente(s) sin número de cliente automático (C-0001): ${clientesSinCodigo.map((c) => c.nombre).join(', ')}.`, 'IMPORTANTE', M05);

    const [saldosFavorNeg] = await c.query(
      `SELECT c.id, c.codigo, c.nombre,
              SUM(CASE WHEN m.tipo IN ('devolucion', 'anticipo', 'reintegro') THEN m.monto
                       WHEN m.tipo IN ('uso', 'aplicado') THEN -m.monto
                       WHEN m.tipo = 'ajuste' THEN m.monto
                       ELSE 0 END) AS saldo_favor
         FROM clientes c
         JOIN saldo_favor_movimientos m ON m.cliente_id = c.id
        GROUP BY c.id, c.codigo, c.nombre
       HAVING saldo_favor < -0.009`
    );
    revisar('base', saldosFavorNeg.length === 0, `Hay cliente(s) con saldo a favor en NEGATIVO en "${baseElegida}": ${saldosFavorNeg.map((r) => `${r.nombre} (${r.codigo || r.id}): $${Number(r.saldo_favor).toFixed(2)}`).join(', ')}.`, 'GRAVE', M05);

    const [ajustesSinMotivo] = await c.query(
      `SELECT 'credito' AS libro, id FROM credito_movimientos WHERE tipo = 'ajuste' AND (notas IS NULL OR TRIM(notas) = '')
       UNION ALL
       SELECT 'saldo_favor' AS libro, id FROM saldo_favor_movimientos WHERE tipo = 'ajuste' AND (notas IS NULL OR TRIM(notas) = '')`
    );
    revisar('base', ajustesSinMotivo.length === 0, `Hay ${ajustesSinMotivo.length} ajuste(s) de deuda o de saldo a favor sin motivo escrito.`, 'IMPORTANTE', M05);

    // 4.7 Módulo 08 · Traspasos
    const [traspasosInvalidos] = await c.query(
      `SELECT folio, almacen_origen_id, almacen_destino_id, estado, enviado_en
         FROM traspasos
        WHERE almacen_origen_id = almacen_destino_id
           OR (estado IN ('en_transito', 'recibido') AND enviado_en IS NULL)`
    );
    revisar('base', traspasosInvalidos.length === 0, `Hay traspaso(s) con datos sin sentido (mismo origen y destino, o en tránsito/recibido sin fecha de envío): ${traspasosInvalidos.map((t) => t.folio).join(', ')}.`, 'GRAVE', M08);

    // 4.8 Módulo 09 · Catálogo, presentaciones, conos y listas de precio
    const [productosSinPaquete] = await c.query(
      `SELECT p.id, p.nombre, p.grosor_calibre,
              SUM(CASE WHEN v.tipo_presentacion = 'paquete' THEN 1 ELSE 0 END) AS paquetes
         FROM productos p
         LEFT JOIN producto_variantes v ON v.producto_id = p.id
        WHERE p.multipresentacion = 1 AND p.precio_kg > 0
        GROUP BY p.id, p.nombre, p.grosor_calibre
       HAVING paquetes <> 1`
    );
    revisar('base', productosSinPaquete.length === 0, `Hay hilo(s) con precio que no tienen exactamente 1 presentación de paquete: ${productosSinPaquete.map((p) => `${p.nombre} ${p.grosor_calibre || ''} (tiene ${p.paquetes})`).join(', ')}.`, 'IMPORTANTE', M09);

    const [conosHuerfanos] = await c.query(
      `SELECT sku FROM producto_variantes WHERE tipo_presentacion = 'cono' AND origen_variante_id IS NULL`
    );
    revisar('base', conosHuerfanos.length === 0, `Hay presentación(es) de cono que no apuntan a su paquete de origen: ${conosHuerfanos.map((c) => c.sku).join(', ')}.`, 'GRAVE', M09);

    const [[publicos]] = await c.query('SELECT COUNT(*) n FROM tipos_cliente WHERE es_publico = 1 AND activo = 1');
    revisar('base', Number(publicos.n) === 1, `Debe existir exactamente 1 lista de precio activa marcada como "Público" (hay ${publicos.n}).`, 'GRAVE', M09);

    // 4.9 Módulo 10 · Vistas de reportes y análisis
    for (const vista of ['v_alertas_stock', 'v_mas_vendidos', 'v_clientes_saldo', 'v_apartados']) {
      let vistaOk = true;
      try {
        await c.query(`SELECT 1 FROM \`${vista}\` LIMIT 1`);
      } catch {
        vistaOk = false;
      }
      revisar('base', vistaOk, `La vista de reportes "${vista}" no existe o falla al consultarse en "${baseElegida}".`, 'GRAVE', M10);
    }

    // 4.10 Módulo 11 · Nómina
    const [recibosNegativos] = await c.query(
      `SELECT id, total_pagar FROM nomina_recibos WHERE total_pagar < -0.01`
    );
    revisar('base', recibosNegativos.length === 0, `Hay recibo(s) de nómina con total a pagar negativo en "${baseElegida}".`, 'GRAVE', M11);

    return { conectada: true, base: baseElegida };
  } finally {
    await c.end();
  }
}

// ============================================================================
// EJECUCIÓN Y REPORTE
// ============================================================================
(async () => {
  verificarArchivos();
  verificarPantallasYPermisos();
  verificarModulosEnCodigo();
  const infoBd = await verificarBaseDeDatos();

  const secciones = [
    ['1. Orden de archivos, arquitectura y privacidad', hallazgos.archivos],
    ['2. Pantallas, menú, permisos e interfaz', hallazgos.pantallas],
    ['3. Reglas estrictas en código (12 módulos)', hallazgos.modulos],
    [`4. Base de datos (${infoBd.conectada ? infoBd.base : 'omitida: ' + infoBd.motivo})`, hallazgos.base],
  ];

  console.log('===============================================================================');
  console.log(` VERIFICACIÓN ESTRICTA HITEX · ${comprobaciones} comprobaciones realizadas`);
  console.log('===============================================================================\n');

  let totalHallazgos = 0;
  let totalGraves = 0;

  for (const [titulo, lista] of secciones) {
    if (lista.length === 0) {
      console.log(`✓ ${titulo}: TODO EN ORDEN`);
    } else {
      console.log(`✖ ${titulo}: ${lista.length} hallazgo(s)`);
      for (const h of lista) {
        totalHallazgos++;
        if (h.gravedad === 'GRAVE') totalGraves++;
        console.log(`    [${h.gravedad}] ${h.mensaje}`);
      }
    }
  }

  console.log('\n-------------------------------------------------------------------------------');
  console.log(' ESTADO MÓDULO POR MÓDULO (LOS 12 MÓDULOS DE HITEX)');
  console.log('-------------------------------------------------------------------------------');
  for (const [nombreMod, est] of estadoModulos.entries()) {
    if (est.fallas.length === 0) {
      console.log(`  ✓ ${nombreMod} (${est.ok} reglas verificadas)`);
    } else {
      console.log(`  ✖ ${nombreMod} (${est.fallas.length} hallazgo(s))`);
      for (const f of est.fallas) console.log(`      · ${f}`);
    }
  }

  console.log('\n-------------------------------------------------------------------------------');
  if (totalHallazgos === 0) {
    console.log('Resultado: TODO ESTÁ EN SU LUGAR Y TIENE SENTIDO (0 hallazgos).');
    process.exit(0);
  } else {
    console.log(`Resultado: ${totalHallazgos} cosa(s) por revisar (${totalGraves} grave(s)).`);
    process.exit(totalGraves > 0 ? 1 : 0);
  }
})().catch((e) => {
  console.error('Error al correr el verificador:', e);
  process.exit(2);
});
