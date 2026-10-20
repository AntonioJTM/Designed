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
  tienda_telefono?: string | null;
  tienda_direccion?: string | null;
  /** Encabezado del ticket (2026-10-14), como vienen en la Constancia de Situación Fiscal. */
  fiscal_razon_social?: string | null;
  fiscal_rfc?: string | null;
  fiscal_regimen?: string | null;
  fiscal_domicilio?: string | null;
  /** Lo que va al pie del ticket. */
  ticket_leyenda?: string | null;
  /** El ancho del rollo de la impresora de tickets: '58' u '80'. */
  ticket_papel_mm?: string | null;
  /** Lo más que puede pesar el tubo de UN cono, en kg (2026-10-20). Vacío: sin tope propio. */
  desarme_destare_max_kg?: string | null;
  /** Las cuentas ACTIVAS a las que se puede depositar (2026-10-06: pueden ser varias). */
  cuentas_bancarias?: CuentaBancariaPublica[];
}

/** Lo que el cliente ve de una cuenta para depositar. */
export interface CuentaBancariaPublica {
  id: number;
  banco: string;
  titular: string | null;
  numero_cuenta: string | null;
  clabe: string | null;
}

/** Una cuenta de banco como la maneja el panel de Configuración. */
export interface CuentaBancaria extends CuentaBancariaPublica {
  activa: number | boolean;
  creado_en: string;
  actualizado_en: string;
}

export interface CuentaBancariaInput {
  banco: string;
  titular: string | null;
  numero_cuenta: string | null;
  clabe: string | null;
  activa: boolean;
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
