// Modelos del catálogo. Reflejan las respuestas del backend (/categorias, /productos, …).

export interface Paginado<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  paginas: number;
}

export interface Categoria {
  id: number;
  nombre: string;
  descripcion?: string | null;
  /** Calibres válidos de este material, separados por coma: "1/30,2/30". */
  calibres?: string | null;
  imagen_url?: string | null;
  orden: number;
  activo: boolean | number;
}

/**
 * Un BULTO físico de la variante: su código de barras propio, lo que pesa de
 * verdad y el lote con el que llegó. Varios lotes distintos pueden ser del
 * mismo hilo; el inventario no se separa por lote, suman al mismo saldo.
 */
export interface VarianteCodigo {
  id: number;
  variante_id: number;
  codigo: string;
  peso_kg?: string | null;
  lote?: string | null;
  conos?: number | null;
  /** Un bulto se consume una sola vez: al venderse o al desarmarse. */
  estado?: EstadoBulto;
  consumido_en?: string | null;
  consumido_tipo?: 'pedido' | 'conversion' | null;
  consumido_id?: number | null;
  /** Folio del pedido que lo consumió, cuando fue una venta. */
  consumido_folio?: string | null;
  remesa_id?: number | null;
  remesa_folio?: string | null;
  etiqueta?: string | null;
  creado_en?: string;
}

export type EstadoBulto = 'disponible' | 'vendido' | 'desarmado';

/** Los bultos de un lote, para resumir la lista cuando son muchos. */
export interface LoteDeBultos {
  lote: string;
  bultos: VarianteCodigo[];
  kg: number;
  /** Cuántos siguen disponibles y cuántos kilos representan. */
  disponibles: number;
  kgDisponibles: number;
}

/**
 * Cómo se presenta y se vende una variante:
 *  paquete → la cantidad son kilos  y `precio` es el precio por kilo
 *  cono    → la cantidad son KILOS y `precio` es el precio por kilo (el mismo del
 *             paquete): es el mismo hilo, solo enconado
 *  simple  → la cantidad va en la unidad del producto
 */
export type TipoPresentacion = 'simple' | 'paquete' | 'cono';

/** De dónde sale el precio del cono: lo reparte el paquete o lo pone el usuario. */
export type ModoPrecio = 'manual' | 'calculado';

export interface Variante {
  id: number;
  producto_id: number;
  producto?: string; // presente en el listado /variantes
  codigos?: VarianteCodigo[]; // sus bultos físicos, con peso y lote
  sku: string;
  codigo_barras?: string | null;
  presentacion?: string | null;
  /** Etiqueta de la remesa; solo si el producto es "por lotes". */
  lote?: string | null;
  precio: string; // DECIMAL llega como string para no perder precisión
  precio_oferta?: string | null;
  costo?: string | null;
  activo: boolean | number;
  tipo_presentacion?: TipoPresentacion;
  /**
   * Peso de UNA unidad de esta presentación (el paquete entero, o un cono).
   * DECIMAL: llega como string al leer, se envía como number al escribir.
   */
  peso_kg?: string | number | null;
  /** Solo conos: paquete del que se desarman. */
  origen_variante_id?: number | null;
  /** Solo conos: cuántos salen de un paquete. Informativo; se vende por kilo. */
  piezas_por_origen?: number | null;
  modo_precio?: ModoPrecio;
  /** Abreviatura de la unidad de peso del producto (g, kg, t). */
  unidad?: string;
  /**
   * Cómo se identifica el hilo del que es esta presentación. Lo necesita el
   * selector de la remesa: con solo el color no se distingue el mismo color en
   * dos calibres, y son dos productos.
   */
  calibre?: string | null;
  material?: string | null;
  linea?: string | null;
  /** Unidad de venta. Hoy siempre kg: todo el hilo se vende por peso. */
  unidad_venta?: string;
  // Datos del paquete de origen, para explicar de dónde salió el precio.
  paquete_sku?: string | null;
  paquete_precio_kg?: string | null;
  paquete_peso_kg?: string | null;
  /** Existencias vendibles en el almacén que surte la tienda en línea. */
  disponible?: string | null;
  multipresentacion?: boolean | number;
  por_lotes?: boolean | number;
  /** Precios propios por tipo de cliente (el público es `precio`). */
  precios?: PrecioTipo[];
}

/** Tipo de cliente = lista de precios. El público cobra `variante.precio`. */
export interface TipoCliente {
  id: number;
  nombre: string;
  es_publico: boolean | number;
  orden: number;
  activo: boolean | number;
}

export interface PrecioTipo {
  tipo_cliente_id: number;
  tipo_cliente: string;
  precio: string;
}

export interface Imagen {
  id: number;
  producto_id: number;
  variante_id?: number | null;
  url: string;
  es_principal: boolean | number;
  orden: number;
}

export interface Producto {
  id: number;
  categoria_id: number;
  categoria?: string;
  /** Calibres del material del producto, tal como los define la categoría. */
  calibres_material?: string | null;
  /** Línea de procedencia: turco, nacional, chino. */
  linea_id?: number | null;
  linea?: string | null;
  unidad_medida_id: number;
  unidad?: string;
  impuesto_id?: number | null;
  impuesto_porcentaje?: string | null;
  nombre: string;
  descripcion?: string | null;
  grosor_calibre?: string | null;
  /**
   * Precio de lista del hilo por unidad de peso. Las presentaciones que se creen
   * después lo heredan; el que se cobra sigue siendo el de la variante.
   */
  precio_kg?: string | number | null;
  /** Se maneja como paquete que se desarma en conos. */
  multipresentacion?: boolean | number;
  /** Sus presentaciones se etiquetan por lote (el stock no se separa). */
  por_lotes?: boolean | number;
  destacado: boolean | number;
  activo: boolean | number;
  creado_en?: string;
  actualizado_en?: string;
  // Derivados para el listado/tienda:
  precio_desde?: string | null;
  imagen?: string | null;
  /** Suma de existencias vendibles en línea de todas sus variantes activas. */
  disponible?: string | null;
}

/** Detalle: producto + colecciones anidadas. */
export interface ProductoDetalle extends Producto {
  variantes: Variante[];
  imagenes: Imagen[];
}

/** Opción genérica para selects (id + etiqueta). */
export interface Opcion {
  id: number;
  nombre: string;
  abreviatura?: string;
  porcentaje?: string;
}
