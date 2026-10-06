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
 *            SERVIDOR: esconder un botón no basta.
 *
 * El ADMINISTRADOR no se configura: lo puede todo siempre, para que nunca se
 * quede nadie sin poder entrar a Permisos. Permisos y la creación de puestos son
 * solo suyos y no aparecen en la lista.
 */
const CATALOGO = [
  { grupo: 'Inicio y Vender', tipo: 'pantalla', clave: 'ver:hoy', nombre: 'Hoy', ayuda: 'Los pendientes del día' },
  { grupo: 'Inicio y Vender', tipo: 'pantalla', clave: 'ver:pos', nombre: 'Punto de venta', ayuda: 'Cobrar, fiar y apartar' },
  { grupo: 'Inicio y Vender', tipo: 'pantalla', clave: 'ver:caja', nombre: 'Caja', ayuda: 'Turno, efectivo y corte' },
  { grupo: 'Inicio y Vender', tipo: 'pantalla', clave: 'ver:pedidos', nombre: 'Pedidos', ayuda: 'Las ventas y su estado' },
  { grupo: 'Inicio y Vender', tipo: 'pantalla', clave: 'ver:apartados', nombre: 'Apartados', ayuda: 'Lo guardado para un cliente' },
  { grupo: 'Clientes', tipo: 'pantalla', clave: 'ver:clientes', nombre: 'Clientes', ayuda: 'Las cinco pestañas y el expediente' },
  { grupo: 'Mercancía', tipo: 'pantalla', clave: 'ver:inventario', nombre: 'Inventario', ayuda: 'Existencias por almacén' },
  { grupo: 'Mercancía', tipo: 'pantalla', clave: 'ver:remesa', nombre: 'Surtir inventario', ayuda: 'Cargar la lista del proveedor, con su factura y pedimento' },
  { grupo: 'Mercancía', tipo: 'pantalla', clave: 'ver:surtir', nombre: 'Surtir sucursal', ayuda: 'Pedir, enviar y recibir traspasos' },
  { grupo: 'Mercancía', tipo: 'pantalla', clave: 'ver:kardex', nombre: 'Kardex', ayuda: 'Cada entrada y salida' },
  { grupo: 'Catálogo y números', tipo: 'pantalla', clave: 'ver:catalogo', nombre: 'Productos y Materiales', ayuda: 'Dar de alta hilos y materiales' },
  { grupo: 'Catálogo y números', tipo: 'pantalla', clave: 'ver:negocio', nombre: 'Cómo va el negocio', ayuda: 'Ventas, ganancia y dinero parado' },
  { grupo: 'Catálogo y números', tipo: 'pantalla', clave: 'ver:reportes', nombre: 'Reportes', ayuda: 'Ventas por día, cortes y más' },
  { grupo: 'Administración', tipo: 'pantalla', clave: 'ver:almacenes', nombre: 'Almacenes y Listas de precio', ayuda: 'Bodegas, sucursales, cajas y precios por tipo de cliente' },
  { grupo: 'Administración', tipo: 'pantalla', clave: 'ver:personal', nombre: 'Personal', ayuda: 'Quién trabaja y en qué puesto' },
  { grupo: 'Administración', tipo: 'pantalla', clave: 'ver:nomina', nombre: 'Nómina', ayuda: 'Sueldos y comisiones de la semana' },
  { grupo: 'Administración', tipo: 'pantalla', clave: 'ver:config', nombre: 'Configuración', ayuda: 'Datos de la tienda' },

  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:fiar', nombre: 'Fiar', ayuda: 'Vender a crédito a un cliente con límite' },
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:cancelar_venta', nombre: 'Cancelar o devolver una venta', ayuda: 'Regresa la mercancía y saca el efectivo de la caja' },
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:mover_efectivo', nombre: 'Sacar o meter efectivo', ayuda: 'Retiros e ingresos en el turno' },
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:corregir_deuda', nombre: 'Corregir la deuda de un cliente', ayuda: 'Perdonar o agregar un cargo, con motivo' },
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:cambiar_precios', nombre: 'Cambiar precios', ayuda: 'Precio público, peso y precio por lista de una presentación' },
  { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:ver_costos', nombre: 'Ver costos y márgenes', ayuda: 'Lo que costó cada hilo y lo que deja (también en Pregúntame)' },
  { grupo: 'Mercancía', tipo: 'accion', clave: 'hacer:enviar_traspaso', nombre: 'Enviar desde la bodega', ayuda: 'Mandar lo que pidió una sucursal' },
  { grupo: 'Mercancía', tipo: 'accion', clave: 'hacer:recibir_traspaso', nombre: 'Confirmar que llegó un envío', ayuda: 'Firmar de recibido en la sucursal' },
  { grupo: 'Mercancía', tipo: 'accion', clave: 'hacer:ajuste_merma', nombre: 'Ajuste y merma', ayuda: 'Cuadrar con un conteo o dar de baja hilo dañado' },
  { grupo: 'Mercancía', tipo: 'accion', clave: 'hacer:bajar_conos', nombre: 'Bajar conos a mostrador', ayuda: 'Desarmar un paquete en conos' },
];

const CLAVES = new Set(CATALOGO.map((p) => p.clave));
const NOMBRE = Object.fromEntries(CATALOGO.map((p) => [p.clave, p.nombre]));

module.exports = { CATALOGO, CLAVES, NOMBRE };
