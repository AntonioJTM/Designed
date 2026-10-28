'use strict';

// QUÉ CAMBIÓ, según la ruta que se guardó (2026-10-19, el sistema en tiempo
// real). Cuando una petición que escribe sale bien, se avisa a las pantallas
// abiertas QUÉ tipo de cosa cambió —no el dato—, y cada una vuelve a pedir lo
// suyo. Así cada quien sigue viendo solo sus tiendas y nadie recibe costos ni
// datos que no le tocan: el aviso no lleva nada más que el tipo.
//
// Un endpoint nuevo que escribe queda cubierto solo por su prefijo. Si escribe
// algo de otro tipo, se agrega aquí.

const POR_PREFIJO = [
  // El más largo primero: /inventario/traspasos antes que /inventario.
  ['/inventario/traspasos', ['traspasos', 'inventario', 'avisos']],
  ['/inventario', ['inventario', 'avisos']],
  ['/pedidos', ['ventas', 'inventario', 'caja', 'clientes', 'avisos']],
  ['/caja', ['caja', 'avisos']],
  ['/clientes', ['clientes', 'caja', 'avisos']],
  // Marcar Procesada / Facturada o corregir la cuenta y el no. de operación (que
  // vive en la venta, el abono o el anticipo). Solo a quien ve todas (almacenes.js).
  ['/transferencias', ['transferencias', 'ventas', 'clientes']],
  ['/remesas', ['inventario', 'catalogo', 'avisos']],
  // Los tiempos para pedir y las ventas de años anteriores (2026-10-22). Solo a
  // quien ve todas (almacenes.js).
  ['/rotacion', ['rotacion']],
  ['/variantes', ['inventario', 'catalogo']],
  ['/productos', ['catalogo', 'avisos']],
  ['/categorias', ['catalogo']],
  ['/tipos-cliente', ['catalogo']],
  ['/proveedores', ['catalogo']],
  ['/autorizaciones', ['autorizaciones', 'avisos']],
  ['/almacenes', ['almacenes', 'inventario', 'caja']],
  // Permisos de un puesto, o los puestos y tiendas de una persona (2026-10-22): la
  // sesión abierta vuelve a pedir su perfil y su menú cambia sin volver a entrar
  // (antes: "le di Transferencias y no la ve" hasta cerrar sesión). Va a todos: el
  // aviso no lleva datos y cada quien pide solo el suyo.
  ['/permisos', ['sesion']],
  // «Mi clave para autorizar» no cambia el menú de nadie (revisor de tiendas).
  ['/usuarios/perfil', []],
  ['/usuarios', ['sesion']],
  // La nómina: pagarla cierra su solicitud de pago, y pedir vacaciones abre una
  // (2026-10-26, auditoría: Autorizaciones y la campana seguían enseñándola).
  ['/nomina', ['autorizaciones', 'avisos']],
  // La configuración: ninguna pantalla la escucha todavía, así que no se avisa.
];

// Peticiones que se mandan con POST pero NO cambian nada: cotizar, la vista
// previa de una carga, entrar. (Mandar por WhatsApp no avisa porque /whatsapp no
// está en la lista; "enviar" un traspaso SÍ cambia el inventario.)
const NO_CAMBIAN = /\/(cotizacion|previa|login)(\/|$)/;

/** Los tipos que cambiaron con esa petición (`ruta` sin /api/v1 y sin ?…), o []. */
function tiposDeRuta(metodo, ruta, cuerpo = null) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(metodo).toUpperCase())) return [];
  const r = String(ruta ?? '');
  if (NO_CAMBIAN.test(r)) return [];
  // "Mínimo para varios" sin `guardar` solo enseña la vista previa.
  if (r === '/inventario/configuracion/minimos' && cuerpo?.guardar !== true) return [];
  const hit = POR_PREFIJO.find(([p]) => r === p || r.startsWith(`${p}/`));
  return hit ? hit[1] : [];
}

module.exports = { tiposDeRuta };
