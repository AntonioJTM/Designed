'use strict';

/**
 * Qué se puede permitir a un puesto. Es la lista que dibuja la pantalla de
 * Permisos y la que valida el servidor.
 *
 * Las claves viven en la tabla `permisos` y lo que tiene cada puesto en
 * `rol_permisos`; aquí solo se les pone nombre y grupo para la pantalla. Una
 * clave nueva se agrega en los DOS lados: aquí y con su INSERT en una migración.
 *
 *   ver:*    una pantalla del menú. Lo que no se ve tampoco se abre escribiendo
 *            la dirección (lo cuida el frontend con su guarda de ruta).
 *   hacer:*  una acción dentro de una pantalla que sí se ve. Estas las valida el
 *            SERVIDOR: esconder un botón no basta. Quien la hace directo,
 *            AUTORIZA a quien solo la puede pedir.
 *   pedir:*  AUTORIZACIONES (2026-10-19): la puede pedir, y la hace hasta que
 *            alguien con su `hacer:*` la acepte (o escriba su clave ahí mismo).
 *            Si el puesto tiene las dos, la hace directo.
 *
 * El ADMINISTRADOR no se configura: lo puede todo siempre, para que nunca se
 * quede nadie sin poder entrar a Permisos. Permisos y la creación de puestos son
 * solo suyos y no aparecen en la lista.
 */
const CATALOGO = [
  { grupo: 'Inicio y Vender', tipo: 'pantalla', clave: 'ver:hoy', nombre: 'Hoy', ayuda: 'Los pendientes del día' },
  { grupo: 'Inicio y Vender', tipo: 'pantalla', clave: 'ver:pos', nombre: 'Punto de venta', ayuda: 'Cobrar, a crédito, notas en espera y pendientes de pago' },
  { grupo: 'Inicio y Vender', tipo: 'pantalla', clave: 'ver:caja', nombre: 'Caja', ayuda: 'Turno, efectivo y corte' },
  { grupo: 'Inicio y Vender', tipo: 'pantalla', clave: 'ver:pedidos', nombre: 'Ventas', ayuda: 'Todo lo vendido y su estado' },
  { grupo: 'Inicio y Vender', tipo: 'pantalla', clave: 'ver:encargos', nombre: 'Notas en espera', ayuda: 'Notas que el cliente modifica antes de llevárselas; se cobran al entregarlas' },
  { grupo: 'Inicio y Vender', tipo: 'pantalla', clave: 'ver:transferencias', nombre: 'Transferencias', ayuda: 'Todo lo que entró por transferencia: a qué cuenta, si ya se vio en el banco y si se facturó' },
  { grupo: 'Inicio y Vender', tipo: 'pantalla', clave: 'ver:notas_pendientes', nombre: 'Notas pendientes de pago', ayuda: 'Lo que se llevaron sin pagar: registrar su pago o pasarlo a crédito' },
  { grupo: 'Clientes', tipo: 'pantalla', clave: 'ver:clientes', nombre: 'Clientes', ayuda: 'La lista de clientes, sus pestañas y el expediente' },
  { grupo: 'Mercancía', tipo: 'pantalla', clave: 'ver:inventario', nombre: 'Inventario', ayuda: 'Existencias por almacén' },
  { grupo: 'Mercancía', tipo: 'pantalla', clave: 'ver:remesa', nombre: 'Surtir inventario', ayuda: 'Cargar la lista del proveedor, con su factura y pedimento' },
  { grupo: 'Mercancía', tipo: 'pantalla', clave: 'ver:surtir', nombre: 'Surtir sucursal', ayuda: 'Pedir, enviar y recibir traspasos' },
  { grupo: 'Mercancía', tipo: 'pantalla', clave: 'ver:kardex', nombre: 'Kardex', ayuda: 'Cada entrada y salida' },
  { grupo: 'Catálogo y números', tipo: 'pantalla', clave: 'ver:catalogo', nombre: 'Productos y Materiales', ayuda: 'Dar de alta hilos y materiales' },
  { grupo: 'Catálogo y números', tipo: 'pantalla', clave: 'ver:negocio', nombre: 'Cómo va el negocio', ayuda: 'Ventas, ganancia y dinero parado' },
  { grupo: 'Catálogo y números', tipo: 'pantalla', clave: 'ver:reportes', nombre: 'Reportes', ayuda: 'Ventas por día, cortes y más' },
  // Rotación de inventario (2026-10-22): solo kilos; junta todas las tiendas.
  { grupo: 'Catálogo y números', tipo: 'pantalla', clave: 'ver:rotacion', nombre: 'Rotación de inventario', ayuda: 'Cuánto hilo se vende, en qué temporada y cuándo pedirlo' },
  { grupo: 'Administración', tipo: 'pantalla', clave: 'ver:almacenes', nombre: 'Almacenes y Listas de precio', ayuda: 'Bodegas, sucursales, cajas y precios por tipo de cliente' },
  { grupo: 'Administración', tipo: 'pantalla', clave: 'ver:personal', nombre: 'Personal', ayuda: 'Quién trabaja y en qué puesto' },
  { grupo: 'Administración', tipo: 'pantalla', clave: 'ver:nomina', nombre: 'Nómina', ayuda: 'Sueldos y comisiones de la semana' },
  { grupo: 'Administración', tipo: 'pantalla', clave: 'ver:config', nombre: 'Configuración', ayuda: 'Datos de la tienda' },
  { grupo: 'Administración', tipo: 'pantalla', clave: 'ver:autorizaciones', nombre: 'Autorizaciones', ayuda: 'Lo que pidió y, si autoriza algo, lo que le toca aceptar' },

  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:fiar', nombre: 'Vender a crédito', ayuda: 'A crédito a un cliente con límite, y pasar a crédito una nota pendiente' },
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:cancelar_venta', nombre: 'Cancelar o devolver una venta', ayuda: 'Regresa la mercancía y saca el efectivo de la caja' },
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:mover_efectivo', nombre: 'Sacar o meter efectivo', ayuda: 'Retiros e ingresos en el turno' },
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:corregir_deuda', nombre: 'Corregir la deuda de un cliente', ayuda: 'Perdonar o agregar un cargo, con motivo' },
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:cambiar_precios', nombre: 'Cambiar precios', ayuda: 'Precio público, peso y precio por lista de una presentación' },
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:ver_costos', nombre: 'Ver costos y márgenes', ayuda: 'Lo que costó cada hilo y lo que deja' },
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:fiar_atrasado', nombre: 'Fiar con cuenta atrasada', ayuda: 'Vender a crédito a quien lleva más de 15 días sin abonar' },
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:dar_credito', nombre: 'Darle o subirle el crédito', ayuda: 'El límite de crédito de un cliente' },
  // Transferencias (2026-10-20).
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:revisar_transferencias', nombre: 'Revisar transferencias', ayuda: 'Marcarlas procesadas (ya se vieron en el banco) o facturadas, y corregir su cuenta y su número de operación' },
  // Gastos de la caja (2026-10-20).
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:registrar_gasto', nombre: 'Registrar gastos de la caja', ayuda: 'Pagar con el cajón limpieza, papelería, viajes…, hasta el límite de su tipo' },
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:gasto_sobre_limite', nombre: 'Gastos arriba de su límite', ayuda: 'Los que pasan su límite o de un tipo sin límite: registrarlos sin pedir (y autorizar los que se piden)' },
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:tipos_gasto', nombre: 'Tipos de gasto y sus límites', ayuda: 'Dar de alta los tipos (viajes, limpieza…) y el tope de cada gasto, y autorizar los que piden' },
  { grupo: 'Catálogo y números', tipo: 'accion', clave: 'hacer:ajustes_rotacion', nombre: 'Tiempos para pedir al proveedor', ayuda: 'Cuánto tarda el proveedor, el colchón y para cuánto alcanza cada pedido (Rotación de inventario → Qué pedir)' },
  { grupo: 'Catálogo y números', tipo: 'accion', clave: 'hacer:cargar_ventas_anteriores', nombre: 'Cargar ventas de años anteriores', ayuda: 'Subir en kilos, por hilo y por mes, lo que se vendió antes del sistema (para la temporada)' },
  { grupo: 'Mercancía', tipo: 'accion', clave: 'hacer:enviar_traspaso', nombre: 'Enviar desde la bodega', ayuda: 'Mandar lo que pidió una sucursal' },
  { grupo: 'Mercancía', tipo: 'accion', clave: 'hacer:recibir_traspaso', nombre: 'Confirmar que llegó un envío', ayuda: 'Firmar de recibido en la sucursal' },
  { grupo: 'Mercancía', tipo: 'accion', clave: 'hacer:ajuste_merma', nombre: 'Ajuste y merma', ayuda: 'Cuadrar con un conteo o dar de baja hilo dañado' },
  { grupo: 'Mercancía', tipo: 'accion', clave: 'hacer:bajar_conos', nombre: 'Bajar conos a mostrador', ayuda: 'Desarmar un paquete en conos' },
  // Fase 2 de autorizaciones (2026-10-19).
  { grupo: 'Mercancía', tipo: 'accion', clave: 'hacer:cargar_inventario', nombre: 'Cargar mercancía al inventario', ayuda: 'La lista del proveedor, un hilo o un paquete a mano' },
  { grupo: 'Mercancía', tipo: 'accion', clave: 'hacer:surtir_sucursal', nombre: 'Pedir mercancía a otra tienda', ayuda: 'Sin esperar autorización (y autorizar los pedidos, también por menos)' },
  { grupo: 'Administración', tipo: 'accion', clave: 'hacer:pagar_nomina', nombre: 'Pagar la nómina', ayuda: 'Marcarla pagada (y autorizar que se pague la que preparó alguien más)' },
  { grupo: 'Administración', tipo: 'accion', clave: 'hacer:autorizar_vacaciones', nombre: 'Autorizar vacaciones', ayuda: 'Aceptar o rechazar las vacaciones que pide el personal (nunca las propias)' },
  // Lo que se PIDE con autorización (2026-10-19). Lo autoriza quien tiene su «hacer».
  { grupo: 'Dinero', tipo: 'pedir', clave: 'pedir:mover_efectivo', nombre: 'Sacar o meter efectivo', ayuda: 'Retiros e ingresos en el turno' },
  { grupo: 'Dinero', tipo: 'pedir', clave: 'pedir:cancelar_venta', nombre: 'Cancelar o devolver una venta', ayuda: 'Cancelar completa o regresar mercancía' },
  { grupo: 'Dinero', tipo: 'pedir', clave: 'pedir:corregir_deuda', nombre: 'Corregir la deuda o el saldo a favor', ayuda: 'Perdonar o agregar un cargo, quitar o agregar saldo a favor' },
  { grupo: 'Dinero', tipo: 'pedir', clave: 'pedir:cambiar_precios', nombre: 'Cambiar precios', ayuda: 'Precio público, oferta, peso y precio por lista' },
  { grupo: 'Dinero', tipo: 'pedir', clave: 'pedir:fiar_atrasado', nombre: 'Fiar con cuenta atrasada', ayuda: 'Se autoriza con clave en el momento: el cliente está enfrente' },
  { grupo: 'Dinero', tipo: 'pedir', clave: 'pedir:dar_credito', nombre: 'Darle o subirle el crédito', ayuda: 'El límite de crédito de un cliente' },
  { grupo: 'Dinero', tipo: 'pedir', clave: 'pedir:tipos_gasto', nombre: 'Tipos de gasto nuevos', ayuda: 'Dar de alta un tipo de gasto; quien autoriza lo acepta poniéndole su límite' },
  { grupo: 'Dinero', tipo: 'pedir', clave: 'pedir:gasto_sobre_limite', nombre: 'Gastos arriba de su límite', ayuda: 'También los de un tipo sin límite; el dinero no sale del cajón hasta que se acepta' },
  { grupo: 'Mercancía', tipo: 'pedir', clave: 'pedir:ajuste_merma', nombre: 'Ajuste y merma', ayuda: 'Cuadrar con un conteo o dar de baja hilo dañado' },
  { grupo: 'Mercancía', tipo: 'pedir', clave: 'pedir:cargar_inventario', nombre: 'Cargar mercancía al inventario', ayuda: 'Entra con sus paquetes cuando se acepta' },
  { grupo: 'Mercancía', tipo: 'pedir', clave: 'pedir:surtir_sucursal', nombre: 'Pedir mercancía a otra tienda', ayuda: 'Quien surte la ve cuando se acepta; puede autorizarse por menos' },
  { grupo: 'Administración', tipo: 'pedir', clave: 'pedir:pagar_nomina', nombre: 'Pedir que se pague la nómina', ayuda: 'Quien la prepara; si cambia después de pedirla, se pide otra vez' },
  { grupo: 'Administración', tipo: 'pedir', clave: 'pedir:vacaciones', nombre: 'Pedir sus vacaciones', ayuda: 'En «Mis vacaciones»; se le avisa por WhatsApp' },
];

const CLAVES = new Set(CATALOGO.map((p) => p.clave));
const NOMBRE = Object.fromEntries(CATALOGO.map((p) => [p.clave, p.nombre]));

/**
 * Las pantallas que SUMAN TODAS LAS TIENDAS (2026-10-15): solo las ve quien tiene
 * «Todas las tiendas» en Personal (o es administrador), aunque su puesto tenga el
 * permiso; sus rutas llevan `requireTodasLasTiendas`. Gemelo de
 * `SOLO_TODAS_LAS_TIENDAS` en frontend/core/services/auth.service.ts: si cambia
 * uno, cambia el otro. Permisos y Personal lo dicen (2026-10-22: Contabilidad tenía
 * Transferencias y su persona, de una sola tienda, no la veía sin saber por qué).
 */
const SOLO_TODAS_LAS_TIENDAS = new Set([
  'ver:reportes', 'ver:negocio', 'ver:nomina', 'ver:almacenes', 'ver:transferencias', 'ver:rotacion',
]);

/**
 * Lo que, sin ser una pantalla entera, TAMBIÉN pide todas las tiendas (revisor de
 * tiendas, 2026-10-22): las seis miradas de Clientes (la lista y Dónde entrego sí
 * las ve cualquiera) y cambiar los tipos de gasto. `ve` / `hace` es como se dice en
 * los avisos ("no ve …", "ni puede …"); `nota`, la etiqueta en Permisos.
 */
const PARTE_DE_TODAS = {
  'ver:clientes': { ve: 'las miradas de Clientes', nota: 'Sus miradas (Frecuencia, Cuánto debe…), solo con todas las tiendas' },
  'hacer:tipos_gasto': { hace: 'cambiar los tipos de gasto', nota: 'Solo con todas las tiendas' },
};

/** Lo que una lista de claves NO deja ver / hacer a quien es de una sola tienda. */
function soloConTodas(claves) {
  const tiene = new Set(claves);
  const pantallas = [...SOLO_TODAS_LAS_TIENDAS].filter((c) => tiene.has(c)).map((c) => NOMBRE[c] ?? c);
  for (const [c, p] of Object.entries(PARTE_DE_TODAS)) if (p.ve && tiene.has(c)) pantallas.push(p.ve);
  const acciones = Object.entries(PARTE_DE_TODAS).filter(([c, p]) => p.hace && tiene.has(c)).map(([, p]) => p.hace);
  return { pantallas, acciones };
}

/** La etiqueta de Permisos para una clave, o null. */
function notaTiendas(clave) {
  return SOLO_TODAS_LAS_TIENDAS.has(clave) ? 'Solo con todas las tiendas' : PARTE_DE_TODAS[clave]?.nota ?? null;
}

module.exports = { CATALOGO, CLAVES, NOMBRE, SOLO_TODAS_LAS_TIENDAS, soloConTodas, notaTiendas };
