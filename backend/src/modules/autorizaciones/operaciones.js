'use strict';

const { pool } = require('../../config/db');
const { AppError } = require('../../middlewares/error');
const { hoyLocal } = require('../../utils/fechas');

// LAS OPERACIONES QUE SE AUTORIZAN (2026-10-19). Cada una tiene su permiso de
// HACERLA directo (`permiso`, `hacer:*`, que también la autoriza) y el de
// PEDIRLA (`pedir`, `pedir:*`). Su candado va en la ruta con
// `autorizable('<clave>')`, DESPUÉS de validar los datos (`autorizable.js`).
//
//   aplica(req)          → si esta petición en particular es la operación
//                          (cambiar el estado de una venta solo lo es al cancelarla).
//   describir(req)       → lo que se pide, en palabras, para quien autoriza.
//   conTienda            → es de UNA tienda (la caja, la venta, el almacén): si no
//                          se sabe cuál, o no es de las de quien pide, "no existe".
//   vence: 'dia'         → lo de la caja y el mostrador: si no se aceptó el mismo
//                          día, vence (el turno, el corte y el cliente ya pasaron).
//   soloEnElMomento      → no se deja pedir para después: se autoriza con la clave
//                          de quien autoriza ahí mismo (el cliente está enfrente).
//   contexto(req) /      → lo que se guarda al pedirla y se revisa al aceptarla
//   revisarAntes(c, ctx)   (el saldo que había cuando se contó un ajuste).
//   parcial(req)         → al pedirla se guarda SOLO lo que necesita autorización
//                          y lo demás de la petición se hace ya (la ficha del
//                          cliente se guarda; el aumento de crédito queda pedido).
//   — fase 2 (2026-10-19) —
//   conTienda: 'alguna'  → es de DOS tiendas (un pedido a otra): basta una suya.
//   sinConsulta          → se guarda sin su `?…` (la lista del proveedor contesta
//                          por partes con `?progreso=1`; al aceptarla, completa).
//   completar(req)       → lo que falta para saber de qué tienda es, antes de revisarla.
//   alPedir(req)         → revisa que se PUEDA hacer antes de guardarla o preguntar.
//   detalle(cuerpo, ctx) → los renglones que quien autoriza puede ajustar, o lo
//                          que tiene que ver antes de aceptarla (qué se va a
//                          cargar). `ctx`: { veAlmacen(id), veCostos, puede(clave), ruta }.
//   ajustar(cuerpo, a)   → autorizar MENOS de lo pedido (10 de 20 paquetes):
//                          { cuerpo, nota }; se hace con ese cuerpo.
//   alResolver(fila, r)  → algo más al aceptarla o rechazarla (el WhatsApp de
//                          las vacaciones); devuelve qué se avisó.
//   unaPorRuta           → pedirla otra vez reemplaza la que esperaba (pagar una nómina).
//   cerrarSiCambio       → si `revisarAntes` dice que cambió, se cierra sola (no se queda esperando).
//   siempreSePide        → se pide aunque se pueda autorizar (las vacaciones
//                          propias); `noASiMismo`: nadie se autoriza lo suyo
//                          (salvo el administrador).

const pesos = (n) =>
  `$${Number(n ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const kg = (n) => `${Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`;
const conMotivo = (t) => (t && String(t).trim() ? ` · «${String(t).trim()}»` : '');

async function una(sql, params) {
  const [[r]] = await pool.query(sql, params);
  return r ?? null;
}

const nombreCliente = async (id) =>
  (await una('SELECT COALESCE(nombre_comercial, nombre) AS n FROM clientes WHERE id = :id', { id: Number(id) }))?.n ?? 'el cliente';

const ventaDe = (id) => una(
  `SELECT p.numero_pedido, p.total, COALESCE(c.nombre_comercial, c.nombre, 'Mostrador') AS cliente
     FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.id = :id`,
  { id: Number(id) }
);

const hiloDe = async (varianteId) => {
  const v = await una(
    `SELECT CONCAT(p.nombre, IF(p.grosor_calibre IS NULL OR p.grosor_calibre = '', '', CONCAT(' ', p.grosor_calibre)),
                   IF(v.tipo_presentacion = 'cono', ' · cono', '')) AS hilo,
            v.precio, v.precio_oferta, v.peso_kg, v.activo, v.tipo_presentacion
       FROM producto_variantes v JOIN productos p ON p.id = v.producto_id WHERE v.id = :id`,
    { id: Number(varianteId) }
  );
  return v ?? { hilo: 'el hilo' };
};

const saldoEn = async (varianteId, almacenId) =>
  Number((await una('SELECT cantidad FROM inventario WHERE variante_id = :v AND almacen_id = :a',
    { v: Number(varianteId), a: Number(almacenId) }))?.cantidad ?? 0);

/** El efectivo que cobró una venta (sale de la caja al cancelarla). */
const efectivoDe = async (pedidoId) =>
  Number((await una(
    `SELECT COALESCE(SUM(pg.monto), 0) AS total FROM pagos pg JOIN metodos_pago mp ON mp.id = pg.metodo_pago_id
      WHERE pg.pedido_id = :id AND pg.estado = 'completado' AND LOWER(mp.nombre) LIKE '%efectivo%'`,
    { id: Number(pedidoId) }
  ))?.total ?? 0);

/**
 * Cuánto vale lo que regresa en una devolución: los kilos de cada línea (los de
 * sus paquetes escaneados más lo suelto) al precio con que se vendieron
 * (`(subtotal + impuesto) ÷ cantidad`, el mismo de `pedidos/devoluciones.js`).
 */
async function valorDevolucion(pedidoId, lineas) {
  let total = 0;
  for (const l of lineas ?? []) {
    const d = await una(
      'SELECT cantidad, subtotal, impuesto FROM pedido_detalle WHERE id = :d AND pedido_id = :p',
      { d: Number(l.detalle_id), p: Number(pedidoId) }
    );
    if (!d || !(Number(d.cantidad) > 0)) continue;
    let kgLinea = Number(l.kg_sueltos ?? 0);
    const codigos = (l.codigos ?? []).map((c) => String(c).trim()).filter(Boolean);
    if (codigos.length) {
      const r = await una(
        'SELECT COALESCE(SUM(peso_kg), 0) AS kg FROM pedido_detalle_bultos WHERE detalle_id = :d AND codigo IN (:c)',
        { d: Number(l.detalle_id), c: codigos }
      );
      kgLinea += Number(r?.kg ?? 0);
    }
    total += kgLinea * ((Number(d.subtotal) + Number(d.impuesto)) / Number(d.cantidad));
  }
  return Math.round(total * 100) / 100;
}

const nombreAlmacen = async (id) =>
  (await una('SELECT nombre FROM almacenes WHERE id = :id', { id: Number(id) }))?.nombre ?? 'el almacén';

const hiloDeProducto = async (productoId) =>
  (await una(
    `SELECT CONCAT(nombre, IF(grosor_calibre IS NULL OR grosor_calibre = '', '', CONCAT(' ', grosor_calibre))) AS hilo
       FROM productos WHERE id = :id`,
    { id: Number(productoId) }
  ))?.hilo ?? 'el hilo';

const nPaquetes = (n) => `${Number(n).toLocaleString('es-MX')} ${Number(n) === 1 ? 'paquete' : 'paquetes'}`;

/** "lunes 3 de noviembre" de una fecha 'YYYY-MM-DD' (sin moverla de día). */
function fechaLarga(iso) {
  const [a, m, d] = String(iso).split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
}

/**
 * Cada renglón de un pedido a otra tienda: el hilo y cuánto. Va en PAQUETES
 * solo si es un paquete y trae `paquetes` —la MISMA regla del traspaso
 * (`inventario/model.js`)—; si no, en kilos (`cantidad`). Así lo que se enseña y
 * se ajusta es lo que se aparta.
 */
async function lineasPedido(items) {
  const lineas = [];
  for (const it of items ?? []) {
    const v = await hiloDe(it.variante_id);
    const enPaquetes = v.tipo_presentacion === 'paquete' && it.paquetes != null;
    lineas.push({
      variante_id: Number(it.variante_id),
      hilo: v.hilo,
      unidad: enPaquetes ? 'paquetes' : 'kg',
      campo: enPaquetes ? 'paquetes' : 'cantidad',
      pedido: Number(enPaquetes ? it.paquetes : it.cantidad),
    });
  }
  return lineas;
}
const textoLinea = (l, cuanto = l.pedido) => `${l.hilo} · ${l.unidad === 'paquetes' ? nPaquetes(cuanto) : kg(cuanto)}`;

/**
 * LA NÓMINA DE UNA SEMANA en lo que importa para pagarla: cada recibo (quién,
 * días, total) y una FIRMA que cambia si se recalcula o se le agrega o quita
 * algo a cualquier recibo (así lo que se autoriza es lo que se pidió).
 */
async function resumenNomina(periodoId) {
  const p = await una(
    `SELECT id, estado, DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS fecha_fin
       FROM nomina_periodos WHERE id = :id`,
    { id: Number(periodoId) }
  );
  const [recibos] = await pool.query(
    `SELECT r.id, u.nombre, r.dias_trabajados, r.total_pagar,
            (SELECT COUNT(*) FROM nomina_recibo_conceptos c WHERE c.recibo_id = r.id) AS conceptos,
            (SELECT COALESCE(SUM(c.importe), 0) FROM nomina_recibo_conceptos c WHERE c.recibo_id = r.id) AS suma
       FROM nomina_recibos r JOIN usuarios u ON u.id = r.usuario_id
      WHERE r.periodo_id = :id ORDER BY u.nombre, r.id`,
    { id: Number(periodoId) }
  );
  const total = Math.round(recibos.reduce((s, r) => s + Number(r.total_pagar), 0) * 100) / 100;
  return {
    periodo: p,
    // Sin horario el recibo paga la semana completa: sus días van en null.
    recibos: recibos.map((r) => ({ nombre: r.nombre, dias: r.dias_trabajados == null ? null : Number(r.dias_trabajados), total: Number(r.total_pagar) })),
    total,
    firma: recibos.map((r) => `${r.id}:${r.total_pagar}:${r.dias_trabajados}:${r.conceptos}:${r.suma}`).join('|'),
  };
}
const periodoDeRuta = (ruta) => Number(String(ruta ?? '').match(/\/nomina\/periodos\/(\d+)\//)?.[1] ?? 0);

const limiteDe = async (clienteId) =>
  Number((await una('SELECT limite_credito FROM clientes WHERE id = :id', { id: Number(clienteId) }))?.limite_credito ?? 0);

const OPERACIONES = {
  mover_efectivo: {
    nombre: 'Sacar o meter efectivo',
    permiso: 'hacer:mover_efectivo',
    pedir: 'pedir:mover_efectivo',
    conTienda: true,
    vence: 'dia',
    async describir(req) {
      const s = await una(
        'SELECT c.nombre AS caja FROM sesiones_caja s JOIN cajas c ON c.id = s.caja_id WHERE s.id = :id',
        { id: Number(req.params.id) }
      );
      const b = req.body;
      return `${b.tipo === 'retiro' ? 'Sacar' : 'Meter'} ${pesos(b.monto)} ${b.tipo === 'retiro' ? 'de' : 'a'} ` +
        `${s?.caja ?? 'la caja'}${conMotivo(b.motivo)}`;
    },
  },

  // GASTOS DE LA CAJA (2026-10-20): el límite es POR GASTO. Se autoriza el que
  // pasa el tope de su tipo y TODO el de un tipo sin tope; los demás van
  // directo (`aplica`).
  gasto_sobre_limite: {
    nombre: 'Gasto arriba de su límite',
    permiso: 'hacer:gasto_sobre_limite',
    pedir: 'pedir:gasto_sobre_limite',
    conTienda: true,
    vence: 'dia',
    cerrarSiCambio: true,
    aplica: (req) => require('../caja/gastos').seAutoriza(req.body?.tipo_gasto_id, req.body?.monto),
    async describir(req) {
      const b = req.body ?? {};
      const t = await require('../caja/gastos').obtenerTipo(Number(b.tipo_gasto_id));
      const s = await una(
        'SELECT c.nombre AS caja FROM sesiones_caja s JOIN cajas c ON c.id = s.caja_id WHERE s.id = :id',
        { id: Number(req.params.id) }
      );
      const tope = t?.limite != null ? `su límite es ${pesos(t.limite)}` : 'ese tipo no tiene límite: todo se autoriza';
      return `Gasto de ${t?.nombre ?? 'otro tipo'} por ${pesos(b.monto)} (${tope}) ` +
        `de ${s?.caja ?? 'la caja'}${conMotivo(b.descripcion)}`;
    },
    // Antes de pedirla: que se PUEDA hacer (turno abierto y efectivo en el
    // cajón); pedir un gasto que no alcanza solo dejaría una solicitud imposible.
    async alPedir(req) {
      const { pool: p } = require('../../config/db');
      const { efectivoEnCajon } = require('../caja/model');
      const conn = await p.getConnection();
      try {
        const [[s]] = await conn.query('SELECT estado FROM sesiones_caja WHERE id = :id', { id: Number(req.params.id) });
        if (!s || s.estado !== 'abierta') {
          throw new AppError(409, 'SESION_CERRADA', 'El turno de caja ya está cerrado: abre uno para registrar el gasto.');
        }
        const hay = await efectivoEnCajon(conn, Number(req.params.id));
        if (Number(req.body?.monto) > hay + 0.001) {
          throw new AppError(409, 'EFECTIVO_INSUFICIENTE',
            `En el cajón debería haber ${pesos(hay)}; no alcanza para un gasto de ${pesos(req.body?.monto)}.`);
        }
      } finally {
        conn.release();
      }
    },
    // Al aceptarla se revisa que todavía se pueda: el turno sigue abierto, el
    // tipo activo y quien la pidió todavía registra gastos. Si no, se cierra sola.
    contexto: (req) => ({ sesion_id: Number(req.params.id), solicitante_id: Number(req.auth.sub) }),
    async revisarAntes(cuerpo, ctx) {
      if (!ctx?.sesion_id) return null;
      const s = await una('SELECT estado FROM sesiones_caja WHERE id = :id', { id: ctx.sesion_id });
      if (!s || s.estado !== 'abierta') return 'El turno de caja ya se cerró: que se registre en el turno abierto.';
      const t = await require('../caja/gastos').obtenerTipo(Number(cuerpo?.tipo_gasto_id));
      if (!t || !t.activo) return `El tipo de gasto ${t ? `«${t.nombre}» ` : ''}ya no está activo.`;
      const { puede } = require('../permisos/service');
      if (!(await puede({ sub: ctx.solicitante_id, tipo: 'usuario' }, 'hacer:registrar_gasto'))) {
        return 'Quien lo pidió ya no registra gastos.';
      }
      return null;
    },
  },

  // UN TIPO DE GASTO NUEVO (2026-10-20): "que lo puedan hacer también cajeros y
  // la persona que tiene a cargo autorizar, que diga si se autoriza ese tipo y
  // el límite" (usuario). Quien autoriza lo acepta con el límite que él decida
  // (`detalle` / `ajustar`) o lo rechaza. Los tipos son de todas las tiendas.
  tipo_gasto: {
    nombre: 'Nuevo tipo de gasto',
    permiso: 'hacer:tipos_gasto',
    pedir: 'pedir:tipos_gasto',
    cerrarSiCambio: true,
    async describir(req) {
      const b = req.body ?? {};
      const tope = b.limite != null ? `con límite de ${pesos(b.limite)} por gasto` : 'sin límite (todo gasto de ese tipo se autorizaría)';
      return `Nuevo tipo de gasto «${String(b.nombre ?? '').trim()}» ${tope}`;
    },
    // Que no exista ya, antes de pedirlo.
    alPedir: (req) => require('../caja/gastos').exigirNombreLibre(String(req.body?.nombre ?? '').trim()),
    // Si mientras esperaba alguien dio de alta uno igual, se cierra sola.
    async revisarAntes(cuerpo) {
      try {
        await require('../caja/gastos').exigirNombreLibre(String(cuerpo?.nombre ?? '').trim());
        return null;
      } catch {
        return `Ya hay un tipo de gasto «${String(cuerpo?.nombre ?? '').trim()}».`;
      }
    },
    /** Lo que ve quien autoriza: el nombre y el límite que propusieron, para dejarlo o cambiarlo. */
    async detalle(cuerpo) {
      return { tipo_gasto: { nombre: String(cuerpo?.nombre ?? '').trim(), limite: cuerpo?.limite != null ? Number(cuerpo.limite) : null } };
    },
    /** Se acepta con el límite que decide quien autoriza (vacío = sin límite: todo se autoriza). */
    async ajustar(cuerpo, ajustes) {
      const v = ajustes?.limite;
      const limite = v === null || v === undefined || v === '' ? null : Number(v);
      if (limite !== null && (!Number.isFinite(limite) || limite <= 0 || limite > 99999999)) {
        throw new AppError(422, 'AJUSTE_INVALIDO', 'El límite va en pesos, mayor que 0 (o vacío para que todo se autorice).');
      }
      const redondo = limite === null ? null : Math.round(limite * 100) / 100;
      const antes = cuerpo?.limite != null ? Number(cuerpo.limite) : null;
      const igual = antes === redondo;
      return {
        cuerpo: { ...cuerpo, limite: redondo },
        nota: igual ? null
          : `Lo autorizó ${redondo != null ? `con límite de ${pesos(redondo)} por gasto` : 'sin límite (todo gasto de ese tipo se autoriza)'}` +
            ` (se propuso ${antes != null ? pesos(antes) : 'sin límite'}).`,
      };
    },
  },

  cancelar_venta: {
    nombre: 'Cancelar una venta',
    permiso: 'hacer:cancelar_venta',
    pedir: 'pedir:cancelar_venta',
    conTienda: true,
    vence: 'dia',
    aplica: (req) => ['cancelado', 'devuelto'].includes(req.body?.estado),
    async describir(req) {
      const p = await ventaDe(req.params.id);
      const verbo = req.body?.estado === 'devuelto' ? 'Devolver completa' : 'Cancelar';
      const efectivo = await efectivoDe(req.params.id);
      return `${verbo} ${p?.numero_pedido ?? 'la venta'} (${pesos(p?.total)}) · ${p?.cliente ?? ''}` +
        (efectivo > 0 ? ` · sale ${pesos(efectivo)} de efectivo de la caja` : '');
    },
  },

  devolucion: {
    nombre: 'Devolución de mercancía',
    permiso: 'hacer:cancelar_venta',
    pedir: 'pedir:cancelar_venta',
    conTienda: true,
    vence: 'dia',
    async describir(req) {
      const p = await ventaDe(req.params.id);
      const lineas = req.body?.lineas ?? [];
      const paquetes = lineas.reduce((s, l) => s + (l.codigos?.length ?? 0), 0);
      const sueltos = lineas.reduce((s, l) => s + Number(l.kg_sueltos ?? 0), 0);
      const que = [paquetes ? `${paquetes} ${paquetes === 1 ? 'paquete' : 'paquetes'}` : '', sueltos ? `${kg(sueltos)} sueltos` : '']
        .filter(Boolean).join(' y ');
      // A QUIÉN le queda y POR CUÁNTO: en una venta de mostrador el cliente lo
      // escoge quien pide, y eso es lo que tiene que ver quien autoriza.
      const v = await una('SELECT cliente_id FROM pedidos WHERE id = :id', { id: Number(req.params.id) });
      const elegido = !v?.cliente_id && req.body?.cliente_id;
      const quien = elegido ? await nombreCliente(req.body.cliente_id) : (p?.cliente ?? 'el cliente');
      const valor = await valorDevolucion(req.params.id, lineas);
      // Si ESA venta todavía se debe, lo que regresa se descuenta primero de ella
      // (2026-10-22: el resumen decía "quedan a favor" de una nota a crédito sin pagar).
      const debeEsta = Number((await require('../clientes/saldo-favor').debeDeVenta(pool, Number(req.params.id)))?.debe ?? 0);
      const deEsta = Math.round(Math.min(valor, debeEsta) * 100) / 100;
      const sobra = Math.round((valor - deEsta) * 100) / 100;
      const resto = req.body?.destino === 'deuda' ? `se descuentan de lo que debe ${quien}` : `quedan a favor de ${quien}`;
      const destino = deEsta > 0.004
        ? `${pesos(deEsta)} se descuentan de esta nota${sobra > 0.004 ? ` y ${pesos(sobra)} ${resto}` : ` de ${quien}`}`
        : `${pesos(valor)} ${resto}`;
      return `Devolución de ${p?.numero_pedido ?? 'la venta'}${elegido ? ' (venta de mostrador)' : ''}` +
        `${que ? ` · regresan ${que}` : ''} · ${destino}` +
        (elegido ? ' (lo eligió quien lo pide)' : '');
    },
    // Qué regresa, para revisarlo antes de aceptarla (2026-10-22, usuario: "qué
    // cliente es, cuántos paquetes regresa, color y lote, pesos e importe").
    async detalle(cuerpo, { ruta }) {
      const { detalleDeDevolucion, ventaDeRuta } = require('../pedidos/devolucion-solicitud');
      return { devolucion: await detalleDeDevolucion(ventaDeRuta(ruta), cuerpo) };
    },
  },

  corregir_deuda: {
    nombre: 'Corregir la deuda de un cliente',
    permiso: 'hacer:corregir_deuda',
    pedir: 'pedir:corregir_deuda',
    async describir(req) {
      const m = Number(req.body?.monto ?? 0);
      return `${m < 0 ? 'Quitarle' : 'Agregarle'} ${pesos(Math.abs(m))} a la deuda de ${await nombreCliente(req.params.id)}` +
        conMotivo(req.body?.notas);
    },
  },

  ajustar_saldo_favor: {
    nombre: 'Ajustar el saldo a favor',
    permiso: 'hacer:corregir_deuda',
    pedir: 'pedir:corregir_deuda',
    async describir(req) {
      const m = Number(req.body?.monto ?? 0);
      return `${m < 0 ? 'Quitarle' : 'Agregarle'} ${pesos(Math.abs(m))} de saldo a favor a ` +
        `${await nombreCliente(req.params.id)}${conMotivo(req.body?.notas)}`;
    },
  },

  cambiar_precio: {
    nombre: 'Cambiar precio, peso o si se vende',
    permiso: 'hacer:cambiar_precios',
    pedir: 'pedir:cambiar_precios',
    async describir(req) {
      const v = await hiloDe(req.params.id);
      const b = req.body ?? {};
      const cambios = [];
      if (b.precio !== undefined) cambios.push(`precio ${pesos(v.precio)} → ${pesos(b.precio)}`);
      if (b.precio_oferta !== undefined) {
        cambios.push(b.precio_oferta == null ? 'sin oferta' : `oferta ${pesos(b.precio_oferta)}`);
      }
      if (b.peso_kg !== undefined) cambios.push(`peso ${b.peso_kg == null ? 'sin peso' : kg(b.peso_kg)}`);
      if (b.activo !== undefined) cambios.push(b.activo ? 'que se venda' : 'que ya no se venda');
      return `${v.hilo}: ${cambios.join(', ') || 'sin cambios'}`;
    },
  },

  precio_lista: {
    nombre: 'Cambiar el precio de una lista',
    permiso: 'hacer:cambiar_precios',
    pedir: 'pedir:cambiar_precios',
    async describir(req) {
      const v = await hiloDe(req.params.id);
      const t = await una('SELECT nombre FROM tipos_cliente WHERE id = :id', { id: Number(req.body?.tipo_cliente_id) });
      const p = req.body?.precio;
      return `${v.hilo} para «${t?.nombre ?? 'la lista'}»: ${p == null ? 'que pague el precio público' : pesos(p)}`;
    },
  },

  ajuste_merma: {
    nombre: 'Ajuste o merma de inventario',
    permiso: 'hacer:ajuste_merma',
    pedir: 'pedir:ajuste_merma',
    conTienda: true,
    async describir(req) {
      const b = req.body ?? {};
      const v = await hiloDe(b.variante_id);
      const a = await una('SELECT nombre FROM almacenes WHERE id = :a', { a: Number(b.almacen_id) });
      const donde = `${v.hilo} en ${a?.nombre ?? 'el almacén'}`;
      const ref = b.referencia_tipo ? ` (de ${b.referencia_tipo}${b.referencia_id ? ` #${b.referencia_id}` : ''})` : '';
      if (b.tipo === 'ajuste') {
        return `Ajuste de ${donde}: contaron ${kg(b.cantidad)} (el sistema dice ${kg(await saldoEn(b.variante_id, b.almacen_id))})` +
          `${ref}${conMotivo(b.motivo)}`;
      }
      const que = { merma: 'Merma', entrada: 'Entrada', salida: 'Salida', devolucion: 'Devolución' }[b.tipo] ?? 'Movimiento';
      return `${que} de ${kg(b.cantidad)} de ${donde}${ref}${conMotivo(b.motivo)}`;
    },
    // El AJUSTE sobreescribe el saldo con lo contado: si cuando se acepta el saldo
    // ya no es el de cuando se contó (se vendió, llegó mercancía), no se hace.
    async contexto(req) {
      if (req.body?.tipo !== 'ajuste') return null;
      return { saldo: await saldoEn(req.body.variante_id, req.body.almacen_id) };
    },
    async revisarAntes(cuerpo, ctx) {
      if (cuerpo?.tipo !== 'ajuste' || ctx?.saldo == null) return null;
      const hoy = await saldoEn(cuerpo.variante_id, cuerpo.almacen_id);
      if (Math.abs(hoy - Number(ctx.saldo)) <= 0.0005) return null;
      return `El saldo cambió desde que se contó (era ${kg(ctx.saldo)}, hoy es ${kg(hoy)}): que se vuelva a contar.`;
    },
  },

  fiar_atrasado: {
    nombre: 'Fiar con cuenta atrasada',
    permiso: 'hacer:fiar_atrasado',
    pedir: 'pedir:fiar_atrasado',
    soloEnElMomento: true,
    // En la caja, al pasar una nota pendiente a crédito y al entregar una nota en espera a crédito.
    aplica: (req) => req.body?.fiar_con_atraso === true,
    async describir(req) {
      if (!req.params?.id) {
        return `Fiar ${pesos(req.body?.a_credito)} a ${await nombreCliente(req.body?.cliente_id)}, que trae su cuenta atrasada`;
      }
      const p = await ventaDe(req.params.id);
      const como = /\/a-credito$/.test(req.path) ? 'Pasar a crédito' : `Entregar a crédito ${pesos(req.body?.a_credito)} de`;
      return `${como} ${p?.numero_pedido ?? 'la nota'} · ${p?.cliente ?? ''}, que trae su cuenta atrasada`;
    },
  },

  dar_credito: {
    nombre: 'Subirle el crédito a un cliente',
    permiso: 'hacer:dar_credito',
    pedir: 'pedir:dar_credito',
    // Solo SUBIRLO: bajarlo o dejarlo igual no necesita autorización.
    async aplica(req) {
      return Number(req.body?.limite_credito) > (await limiteDe(req.params.id)) + 0.004;
    },
    async describir(req) {
      return `Crédito de ${await nombreCliente(req.params.id)}: ${pesos(await limiteDe(req.params.id))} → ` +
        `${pesos(req.body?.limite_credito)}`;
    },
    // Si mientras tanto alguien le cambió el crédito, aceptar "$0 → $5,000" podría
    // BAJÁRSELO: se revisa que siga igual que cuando se pidió.
    async contexto(req) {
      return { cliente_id: Number(req.params.id), limite: await limiteDe(req.params.id) };
    },
    async revisarAntes(cuerpo, ctx) {
      if (ctx?.limite == null) return null;
      const hoy = await limiteDe(ctx.cliente_id);
      if (Math.abs(hoy - Number(ctx.limite)) < 0.005) return null;
      return `Su crédito cambió desde que se pidió (era ${pesos(ctx.limite)}, hoy es ${pesos(hoy)}): que se vuelva a pedir.`;
    },
    // Desde la ficha completa (`PUT /clientes/:id`) se pide SOLO el límite (su
    // propia ruta) y lo demás de la ficha se guarda ya, con el límite de antes:
    // si no, al aceptarla días después se regresaría lo que se corrigió mientras.
    async parcial(req) {
      if (/\/limite-credito$/.test(req.path)) return null;
      const actual = await limiteDe(req.params.id);
      const nuevo = Number(req.body.limite_credito);
      return {
        metodo: 'PUT',
        ruta: `/clientes/${Number(req.params.id)}/limite-credito`,
        cuerpo: { limite_credito: nuevo },
        ajustar: () => { req.body.limite_credito = actual; },
      };
    },
  },

  credito_alta: {
    nombre: 'Darle crédito a un cliente nuevo',
    permiso: 'hacer:dar_credito',
    pedir: 'pedir:dar_credito',
    // Un cliente que todavía no existe no se deja "pedido": o se autoriza en el
    // momento, o se da de alta sin crédito y el crédito se pide desde su ficha.
    soloEnElMomento: true,
    aplica: (req) => Number(req.body?.limite_credito) > 0,
    async describir(req) {
      return `Cliente nuevo «${req.body?.nombre ?? ''}» con ${pesos(req.body?.limite_credito)} de crédito`;
    },
  },

  // ------------------------------------------------------------ FASE 2 (2026-10-19)

  // INGRESO DE INVENTARIO: la carga del proveedor (un hilo, o la lista con varios
  // colores) y el paquete capturado a mano. Directo la gerente y el
  // administrador; el almacenista y Contabilidad lo piden (decisión del usuario).
  cargar_inventario: {
    nombre: 'Cargar mercancía al inventario',
    permiso: 'hacer:cargar_inventario',
    pedir: 'pedir:cargar_inventario',
    conTienda: true,
    sinConsulta: true,
    async describir(req) {
      const b = req.body ?? {};
      const donde = await nombreAlmacen(b.almacen_id);
      const papeles = [b.factura ? `factura ${b.factura}` : '', b.pedimento ? `pedimento ${b.pedimento}` : '']
        .filter(Boolean).join(' · ');
      const cola = `${papeles ? ` · ${papeles}` : ''}${b.archivo ? ` · «${b.archivo}»` : ''}`;
      if (Array.isArray(b.hilos)) {
        const bultos = b.hilos.flatMap((h) => h.bultos ?? []);
        const total = bultos.reduce((s, x) => s + Number(x.peso_kg ?? 0), 0);
        return `Cargar a ${donde} la lista del proveedor: ${b.hilos.length} ${b.hilos.length === 1 ? 'hilo' : 'hilos'} · ` +
          `${nPaquetes(bultos.length)} · ${kg(total)}${cola}`;
      }
      const hilo = b.variante_id ? (await hiloDe(b.variante_id)).hilo : await hiloDeProducto(b.producto_id);
      const bultos = b.bultos ?? [];
      const total = bultos.reduce((s, x) => s + Number(x.peso_kg ?? 0), 0);
      return `Cargar a ${donde}: ${hilo} · ${nPaquetes(bultos.length)} · ${kg(total)}${cola}`;
    },
    // Qué se va a cargar, para revisarlo antes de aceptarla (2026-10-21, usuario:
    // "qué color de hilo, peso de paquetes"): cada hilo con sus lotes y paquetes.
    async detalle(cuerpo, { veCostos, veAlmacen, puede }) {
      // Lo que hay hoy en ese almacén, solo a quien ve esa tienda y su Inventario
      // (un puesto armado a mano podría autorizar cargas sin ver existencias).
      const veExistencias = veAlmacen(Number(cuerpo.almacen_id)) && (await puede('ver:inventario'));
      return { carga: await require('../remesas/solicitud').detalleDeCarga(cuerpo, { veCostos, veExistencias }) };
    },
  },

  bulto_a_mano: {
    nombre: 'Agregar un paquete a mano',
    permiso: 'hacer:cargar_inventario',
    pedir: 'pedir:cargar_inventario',
    conTienda: true,
    // Sin almacén entra donde está el hilo (si está en uno solo): se decide al
    // pedirlo, con la misma regla de siempre, para saber de qué tienda es.
    async completar(req) {
      const { almacenDelBulto } = require('../variantes/service');
      const { almacenesDe } = require('../permisos/service');
      req.body.almacen_id = await almacenDelBulto(Number(req.params.id), req.body.almacen_id ?? null, await almacenesDe(req.auth));
    },
    // Lo mismo que revisa al hacerse (`variantes/service.js → agregarCodigo`), y
    // que no lo haya pedido ya alguien más: si no, se quedaría esperando y al
    // aceptarla fallaría.
    async alPedir(req) {
      const v = await una('SELECT tipo_presentacion FROM producto_variantes WHERE id = :id', { id: Number(req.params.id) });
      if (!v) throw new AppError(404, 'NO_ENCONTRADO', 'Variante no encontrada');
      if (v.tipo_presentacion === 'cono') {
        throw new AppError(422, 'NO_ES_PAQUETE', 'Los conos no llevan bultos: el bulto es del paquete.');
      }
      const codigo = String(req.body?.codigo ?? '').trim();
      if (await require('../variantes/model').variantePorCodigo(codigo)) {
        throw new AppError(409, 'CODIGO_REPETIDO', `El código ${codigo} ya está registrado.`);
      }
      const pedido = await una(
        `SELECT id FROM autorizaciones
          WHERE operacion = 'bulto_a_mano' AND estado IN ('pendiente', 'aprobando')
            AND JSON_UNQUOTE(JSON_EXTRACT(cuerpo, '$.codigo')) = :c LIMIT 1`,
        { c: codigo }
      );
      if (pedido) throw new AppError(409, 'CODIGO_YA_PEDIDO', `El paquete ${codigo} ya se pidió y está esperando autorización.`);
    },
    async describir(req) {
      const b = req.body ?? {};
      return `Agregar a mano el paquete ${b.codigo} de ${(await hiloDe(req.params.id)).hilo} · ${kg(b.peso_kg)} ` +
        `· entra a ${await nombreAlmacen(b.almacen_id)}${b.lote ? ` · lote ${b.lote}` : ''}` +
        `${b.conos ? ` · ${b.conos} ${Number(b.conos) === 1 ? 'cono' : 'conos'}` : ''}`;
    },
  },

  // SURTIR SUCURSAL: la sucursal pide mercancía y la solicitud espera; hasta que
  // se acepta no se aparta nada ni la ve quien surte. Quien autoriza puede dar
  // MENOS de lo pedido, renglón por renglón (decisión del usuario: "de esos 20,
  // que solo autorice 10").
  surtir_sucursal: {
    nombre: 'Pedir mercancía a otra tienda',
    permiso: 'hacer:surtir_sucursal',
    pedir: 'pedir:surtir_sucursal',
    conTienda: 'alguna',
    // Lo AUTORIZA quien ve el almacén que SURTE: decide cuánto sale de ahí. (Si lo
    // autorizara alguien que solo es de la sucursal, el porqué de "no alcanza"
    // le diría cuánto hay en la Matriz: se rompería pedir a ciegas.)
    tiendasQueAutorizan: (cuerpo) => [Number(cuerpo?.almacen_origen_id)],
    // Lo que revisa el traspaso al hacerse, antes de guardar la solicitud: cada
    // hilo una vez, y a ciegas (quien no ve el origen) solo se le pide a la Matriz.
    async alPedir(req) {
      const b = req.body ?? {};
      const ids = (b.items ?? []).map((it) => Number(it.variante_id));
      if (new Set(ids).size !== ids.length) {
        throw new AppError(422, 'HILO_REPETIDO', 'Pon cada hilo una sola vez en el pedido.');
      }
      const { almacenesDe } = require('../permisos/service');
      const mias = await almacenesDe(req.auth);
      if (mias !== null && !mias.includes(Number(b.almacen_origen_id))) {
        const origen = await una('SELECT es_matriz FROM almacenes WHERE id = :id', { id: Number(b.almacen_origen_id) });
        if (!Number(origen?.es_matriz)) throw new AppError(404, 'OTRA_TIENDA', 'Ese almacén no existe.');
      }
    },
    async describir(req) {
      const b = req.body ?? {};
      const lineas = await lineasPedido(b.items);
      return `${await nombreAlmacen(b.almacen_destino_id)} le pide a ${await nombreAlmacen(b.almacen_origen_id)}: ` +
        `${lineas.map((l) => textoLinea(l)).join('; ')}${conMotivo(b.notas)}`;
    },
    /** Los renglones para ajustar; con cuántos paquetes hay libres en el origen si quien mira lo ve. */
    async detalle(cuerpo, { veAlmacen }) {
      const origen = Number(cuerpo.almacen_origen_id);
      const lineas = await lineasPedido(cuerpo.items);
      const ve = veAlmacen(origen);
      for (const l of lineas) {
        if (!ve) { l.en_origen = null; continue; }
        // Lo LIBRE: los paquetes disponibles, o los kilos menos lo ya apartado.
        l.en_origen = l.unidad === 'paquetes'
          ? Number((await una(
            `SELECT COUNT(*) AS n FROM variante_codigos
              WHERE variante_id = :v AND almacen_id = :a AND estado = 'disponible'`,
            { v: l.variante_id, a: origen }
          ))?.n ?? 0)
          : Math.max(0, Number((await una(
            'SELECT cantidad - cantidad_reservada AS libre FROM inventario WHERE variante_id = :v AND almacen_id = :a',
            { v: l.variante_id, a: origen }
          ))?.libre ?? 0));
      }
      return { origen: await nombreAlmacen(origen), lineas };
    },
    async ajustar(cuerpo, ajustes) {
      const nuevos = Array.isArray(ajustes?.items) ? ajustes.items : null;
      if (!nuevos) throw new AppError(422, 'AJUSTE_INVALIDO', 'Di cuánto se autoriza de cada hilo.');
      const pedidos = cuerpo.items ?? [];
      if (nuevos.some((x) => !pedidos.some((p) => Number(p.variante_id) === Number(x?.variante_id)))) {
        throw new AppError(422, 'AJUSTE_INVALIDO', 'Ese hilo no está en lo que se pidió.');
      }
      const lineas = await lineasPedido(pedidos);
      const items = [];
      const cambios = [];
      for (const [i, p] of pedidos.entries()) {
        // Paquetes o kilos con la misma regla del traspaso (ver `lineasPedido`).
        const { campo, hilo, unidad } = lineas[i];
        const pedido = Number(p[campo]);
        const a = nuevos.find((x) => Number(x.variante_id) === Number(p.variante_id));
        const vale = a == null || a[campo] == null ? pedido : Number(a[campo]);
        const linea = { hilo, unidad, pedido };
        if (!Number.isFinite(vale) || vale < 0 || (campo === 'paquetes' && !Number.isInteger(vale))) {
          throw new AppError(422, 'AJUSTE_INVALIDO', `De ${linea.hilo} escribe ${campo === 'paquetes' ? 'paquetes enteros' : 'kilos'}, de 0 en adelante.`);
        }
        if (vale > pedido + 0.0005) {
          throw new AppError(422, 'AJUSTE_MAYOR', `De ${linea.hilo} se pidieron ${(linea.unidad === 'paquetes' ? nPaquetes(pedido) : kg(pedido))}: no se autoriza más de eso.`);
        }
        if (vale > 0) items.push({ ...p, [campo]: vale });
        if (vale < pedido - 0.0005) {
          cambios.push(vale > 0 ? `${linea.hilo}: ${campo === 'paquetes' ? `${vale} de ${nPaquetes(pedido)}` : `${kg(vale)} de ${kg(pedido)}`}`
            : `${linea.hilo}: nada (se pidieron ${(linea.unidad === 'paquetes' ? nPaquetes(pedido) : kg(pedido))})`);
        }
      }
      if (!items.length) throw new AppError(422, 'AJUSTE_VACIO', 'Así no se autoriza nada: para eso, recházala.');
      return { cuerpo: { ...cuerpo, items }, nota: cambios.length ? `Autorizó menos de lo pedido: ${cambios.join('; ')}.` : null };
    },
  },

  // NÓMINA (fase 3): la prepara la gerente o Contabilidad y PAGARLA lo autoriza
  // el administrador. Si cambia después de pedirla, no se paga hasta pedirla otra
  // vez (decisión del usuario).
  pagar_nomina: {
    nombre: 'Pagar la nómina',
    permiso: 'hacer:pagar_nomina',
    pedir: 'pedir:pagar_nomina',
    aplica: (req) => req.body?.estado === 'pagado',
    // Pedirla otra vez REEMPLAZA la anterior, y si al aceptarla ya cambió se
    // CIERRA sola (con el porqué): así quien la prepara la puede volver a pedir.
    unaPorRuta: true,
    cerrarSiCambio: true,
    // Se acepta desde Autorizaciones, viendo los recibos: no con la clave en la
    // computadora de quien la prepara (ahí no se ve qué se paga).
    soloADistancia: true,
    // No se guarda lo que contesta (la semana con todos los sueldos).
    sinResultado: true,
    // La autoriza quien ve la nómina y TODAS las tiendas (las comisiones son de todas).
    async autorizaSoloSi(auth) {
      const { puede, almacenesDe } = require('../permisos/service');
      return (await puede(auth, 'ver:nomina')) && (await almacenesDe(auth)) === null;
    },
    // Lo que revisa al pagarla, antes de pedirla: que exista, siga en borrador y esté calculada.
    async alPedir(req) {
      const p = await una(
        `SELECT p.estado, (SELECT COUNT(*) FROM nomina_recibos r WHERE r.periodo_id = p.id) AS recibos
           FROM nomina_periodos p WHERE p.id = :id`,
        { id: Number(req.params.id) }
      );
      if (!p) throw new AppError(404, 'NO_ENCONTRADO', 'Periodo de nómina no encontrado');
      if (p.estado !== 'borrador') throw new AppError(409, 'NOMINA_NO_BORRADOR', `Esa nómina ya está ${p.estado === 'pagado' ? 'pagada' : 'cancelada'}.`);
      if (!Number(p.recibos)) throw new AppError(422, 'SIN_RECIBOS', 'Calcula la nómina antes de pedir que se pague.');
    },
    async describir(req) {
      const r = await resumenNomina(req.params.id);
      if (!r.periodo) return 'Pagar la nómina';
      return `Pagar la nómina de la semana del ${fechaLarga(r.periodo.fecha_inicio)} al ${fechaLarga(r.periodo.fecha_fin)}: ` +
        `${r.recibos.length} ${r.recibos.length === 1 ? 'recibo' : 'recibos'} · ${pesos(r.total)}`;
    },
    async contexto(req) {
      const r = await resumenNomina(req.params.id);
      return { periodo_id: Number(req.params.id), firma: r.firma, total: r.total };
    },
    async revisarAntes(cuerpo, ctx) {
      if (!ctx?.periodo_id) return null;
      const r = await resumenNomina(ctx.periodo_id);
      if (!r.periodo) return 'Esa nómina ya no existe.';
      if (r.periodo.estado !== 'borrador') {
        return `Esa nómina ya está ${r.periodo.estado === 'pagado' ? 'pagada' : 'cancelada'}.`;
      }
      if (r.firma === ctx.firma) return null;
      return `La nómina cambió desde que se pidió (era ${pesos(ctx.total)}, hoy es ${pesos(r.total)}): que se vuelva a pedir.`;
    },
    /** Cada recibo con su total, para que quien autoriza vea qué paga. */
    async detalle(cuerpo, { ruta }) {
      const r = await resumenNomina(periodoDeRuta(ruta));
      return { recibos: r.recibos, total: r.total };
    },
  },

  // VACACIONES: cada quien pide las suyas en "Mis vacaciones"; las autoriza quien
  // tiene «Autorizar vacaciones» (el administrador), nunca las propias. Al
  // aceptarlas o rechazarlas se le avisa por WhatsApp (decisión del usuario).
  vacaciones: {
    nombre: 'Vacaciones',
    permiso: 'hacer:autorizar_vacaciones',
    pedir: 'pedir:vacaciones',
    siempreSePide: true,
    noASiMismo: true,
    async alPedir(req) {
      const b = req.body ?? {};
      if (b.fecha_inicio < hoyLocal()) {
        throw new AppError(422, 'FECHA_PASADA', 'Las vacaciones se piden de hoy en adelante.');
      }
      // Las mismas reglas que al registrarlas: días que le tocan, semana pagada…
      await require('../nomina/service').revisarVacaciones(req.auth.sub, b, { propias: true });
      const [filas] = await pool.query(
        `SELECT cuerpo FROM autorizaciones
          WHERE operacion = 'vacaciones' AND solicitante_id = :yo AND estado IN ('pendiente', 'aprobando')`,
        { yo: req.auth.sub }
      );
      for (const f of filas) {
        const c = JSON.parse(f.cuerpo ?? '{}');
        if (c.fecha_inicio <= b.fecha_fin && b.fecha_inicio <= c.fecha_fin) {
          throw new AppError(409, 'VACACIONES_YA_PEDIDAS',
            `Ya pediste vacaciones del ${fechaLarga(c.fecha_inicio)} al ${fechaLarga(c.fecha_fin)} y siguen esperando respuesta.`);
        }
      }
    },
    async describir(req) {
      const b = req.body ?? {};
      const r = await require('../nomina/service').resumenVacaciones(req.auth.sub, b);
      return `Vacaciones de ${r.nombre}: del ${fechaLarga(b.fecha_inicio)} al ${fechaLarga(b.fecha_fin)} · ` +
        `${r.dias} ${r.dias === 1 ? 'día' : 'días'} de trabajo · le quedan ${r.restan} de su año${conMotivo(b.notas)}`;
    },
    async alResolver(fila, { estado, motivo }) {
      const u = await una('SELECT nombre, telefono FROM usuarios WHERE id = :id', { id: Number(fila.solicitante_id) });
      const c = JSON.parse((await una('SELECT cuerpo FROM autorizaciones WHERE id = :id', { id: Number(fila.id) }))?.cuerpo ?? '{}');
      if (!u?.telefono || !String(u.telefono).trim()) return 'No se le avisó por WhatsApp: no tiene teléfono en Personal.';
      const nombre = String(u.nombre).trim().split(/\s+/)[0];
      const fechas = `del ${fechaLarga(c.fecha_inicio)} al ${fechaLarga(c.fecha_fin)}`;
      let mensaje;
      if (estado === 'aprobada') {
        const r = await require('../nomina/service').resumenVacaciones(fila.solicitante_id, c);
        mensaje = `Hola ${nombre}: tus vacaciones ${fechas} quedaron APROBADAS (${r.dias} ${r.dias === 1 ? 'día' : 'días'} de trabajo). ` +
          `Te quedan ${r.restan} ${r.restan === 1 ? 'día' : 'días'} de vacaciones de este año. — Hitex`;
      } else {
        mensaje = `Hola ${nombre}: tus vacaciones ${fechas} NO se aprobaron.${motivo ? ` Motivo: ${motivo}` : ''} ` +
          'Si tienes dudas, platícalo con el administrador. — Hitex';
      }
      try {
        const r = await require('../whatsapp/conexion').enviarTexto({ telefono: u.telefono, mensaje });
        return `Se le avisó por WhatsApp al ${r.numero}.`;
      } catch (e) {
        return `No se le avisó por WhatsApp: ${e.message}`;
      }
    },
  },
};

for (const [clave, op] of Object.entries(OPERACIONES)) op.clave = clave;

/** Lo que se pide en palabras; si algo falla al armarlo, al menos el nombre de la operación. */
async function describir(op, req) {
  try {
    return String(await op.describir(req)).slice(0, 500);
  } catch {
    return op.nombre;
  }
}

module.exports = { OPERACIONES, describir, resumenNomina, lineasPedido, nombreAlmacen };
