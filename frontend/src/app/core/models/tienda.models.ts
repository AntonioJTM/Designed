// Modelos de la tienda en línea: dirección de entrega y configuración pública.

/** Dirección de entrega del cliente (tabla `direcciones`). */
export interface Direccion {
  id: number;
  cliente_id: number;
  tipo: 'envio' | 'facturacion';
  nombre_receptor?: string | null;
  calle: string;
  numero_ext?: string | null;
  numero_int?: string | null;
  colonia?: string | null;
  ciudad: string;
  estado: string;
  codigo_postal: string;
  pais: string;
  telefono?: string | null;
  referencias?: string | null;
  /** MySQL devuelve los booleanos como 0/1. */
  es_predeterminada: boolean | number;
}

/** Lo que se manda al crear o editar una dirección. */
export type DireccionInput = Omit<Direccion, 'id' | 'cliente_id' | 'es_predeterminada'> & {
  es_predeterminada?: boolean;
};

/**
 * Configuración pública de la tienda. Son los pocos datos que el administrador
 * cambia sin tocar código y que el checkout necesita: la tarifa de envío, a qué
 * cuenta depositar y dónde se recoge.
 */
export interface ConfiguracionTienda {
  envio_costo_fijo?: string | null;
  transferencia_banco?: string | null;
  transferencia_titular?: string | null;
  transferencia_clabe?: string | null;
  tienda_telefono?: string | null;
  tienda_direccion?: string | null;
}

/** Una clave de configuración como la ve el panel, con su descripción. */
export interface OpcionConfiguracion {
  clave: string;
  valor: string | null;
  descripcion?: string | null;
  publica: boolean | number;
  actualizado_en: string;
}

/** Cómo llega la mercancía al cliente. */
export type MetodoEntrega = 'recoger' | 'envio';

/** Una línea del desglose que devuelve la cotización. */
export interface CotizacionLinea {
  variante_id: number;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento: number;
  impuesto: number;
  subtotal: number;
}

/**
 * Lo que costaría el pedido, calculado por el backend antes de confirmarlo.
 * Es el mismo cálculo que hace la venta: lo que aquí se muestra es lo que se
 * cobra.
 */
export interface Cotizacion {
  metodo_entrega: MetodoEntrega;
  direccion_envio_id: number | null;
  almacen_id: number;
  tipo_cliente_id: number | null;
  lineas: CotizacionLinea[];
  subtotal: number;
  descuento: number;
  impuestos: number;
  costo_envio: number;
  total: number;
  cupon: { codigo: string; tipo: string; valor: string } | null;
}
