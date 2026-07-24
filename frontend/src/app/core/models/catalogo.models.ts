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
  padre_id: number | null;
  padre?: string | null;
  nombre: string;
  slug: string;
  descripcion?: string | null;
  imagen_url?: string | null;
  orden: number;
  activo: boolean | number;
}

export interface VarianteCodigo {
  id: number;
  variante_id: number;
  codigo: string;
  etiqueta?: string | null;
  creado_en?: string;
}

export interface Variante {
  id: number;
  producto_id: number;
  producto?: string; // presente en el listado /variantes
  codigos?: VarianteCodigo[]; // códigos de barras adicionales (agrupados por color)
  color_id?: number | null;
  color?: string | null;
  codigo_hex?: string | null;
  sku: string;
  codigo_barras?: string | null;
  presentacion?: string | null;
  precio: string; // DECIMAL llega como string para no perder precisión
  precio_oferta?: string | null;
  costo?: string | null;
  activo: boolean | number;
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
  marca_id?: number | null;
  marca?: string | null;
  material_id?: number | null;
  material?: string | null;
  unidad_medida_id: number;
  unidad?: string;
  impuesto_id?: number | null;
  impuesto_porcentaje?: string | null;
  nombre: string;
  slug: string;
  descripcion?: string | null;
  grosor_calibre?: string | null;
  // DECIMAL: llega como string al leer, se envía como number al escribir.
  peso_gramos?: string | number | null;
  longitud_metros?: string | number | null;
  destacado: boolean | number;
  activo: boolean | number;
  creado_en?: string;
  actualizado_en?: string;
  // Derivados para el listado/tienda:
  precio_desde?: string | null;
  imagen?: string | null;
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
  codigo_hex?: string | null;
}
