import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import {
  Categoria,
  Imagen,
  Opcion,
  Paginado,
  Producto,
  ProductoDetalle,
  TipoCliente,
  Variante,
  VarianteCodigo,
} from '../models/catalogo.models';

/** Extrae `data` o lanza el error del API. */
function data<T>(r: ApiResponse<T>): T {
  if (r.error || r.data === null) {
    throw r.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía' };
  }
  return r.data;
}

export interface FiltroProductos {
  q?: string;
  categoria_id?: number;
  activo?: boolean;
  page?: number;
  limit?: number;
}

/**
 * Servicio HTTP del catálogo. Cubre categorías, productos, variantes, imágenes
 * y los catálogos auxiliares (/opciones). Devuelve directamente el `data`.
 */
@Injectable({ providedIn: 'root' })
export class CatalogoService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  // ---- Categorías ----
  listarCategorias(page = 1, limit = 100): Observable<Paginado<Categoria>> {
    const params = new HttpParams().set('page', page).set('limit', limit);
    return this.http
      .get<ApiResponse<Paginado<Categoria>>>(`${this.base}/categorias`, { params })
      .pipe(map(data));
  }
  crearCategoria(body: Partial<Categoria>): Observable<Categoria> {
    return this.http.post<ApiResponse<Categoria>>(`${this.base}/categorias`, body).pipe(map(data));
  }
  actualizarCategoria(id: number, body: Partial<Categoria>): Observable<Categoria> {
    return this.http
      .put<ApiResponse<Categoria>>(`${this.base}/categorias/${id}`, body)
      .pipe(map(data));
  }
  eliminarCategoria(id: number): Observable<unknown> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/categorias/${id}`).pipe(map(data));
  }

  // ---- Productos ----
  listarProductos(f: FiltroProductos = {}): Observable<Paginado<Producto>> {
    let params = new HttpParams();
    if (f.q) params = params.set('q', f.q);
    if (f.categoria_id) params = params.set('categoria_id', f.categoria_id);
    if (f.activo !== undefined) params = params.set('activo', f.activo);
    params = params.set('page', f.page ?? 1).set('limit', f.limit ?? 20);
    return this.http
      .get<ApiResponse<Paginado<Producto>>>(`${this.base}/productos`, { params })
      .pipe(map(data));
  }
  obtenerProducto(id: number): Observable<ProductoDetalle> {
    return this.http
      .get<ApiResponse<ProductoDetalle>>(`${this.base}/productos/${id}`)
      .pipe(map(data));
  }
  crearProducto(body: Partial<Producto>): Observable<Producto> {
    return this.http.post<ApiResponse<Producto>>(`${this.base}/productos`, body).pipe(map(data));
  }
  actualizarProducto(id: number, body: Partial<Producto>): Observable<Producto> {
    return this.http
      .put<ApiResponse<Producto>>(`${this.base}/productos/${id}`, body)
      .pipe(map(data));
  }
  eliminarProducto(id: number): Observable<unknown> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/productos/${id}`).pipe(map(data));
  }

  // ---- Variantes ----
  crearVariante(body: Partial<Variante>): Observable<Variante> {
    return this.http.post<ApiResponse<Variante>>(`${this.base}/variantes`, body).pipe(map(data));
  }
  actualizarVariante(id: number, body: Partial<Variante>): Observable<Variante> {
    return this.http
      .put<ApiResponse<Variante>>(`${this.base}/variantes/${id}`, body)
      .pipe(map(data));
  }
  eliminarVariante(id: number): Observable<unknown> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/variantes/${id}`).pipe(map(data));
  }

  // ---- Códigos de barras adicionales por variante ----
  listarCodigos(varianteId: number): Observable<VarianteCodigo[]> {
    return this.http
      .get<ApiResponse<VarianteCodigo[]>>(`${this.base}/variantes/${varianteId}/codigos`)
      .pipe(map(data));
  }
  /** Da de alta un bulto: su código y, si se conocen, su peso real y su lote. */
  agregarCodigo(
    varianteId: number,
    body: { codigo: string; peso_kg?: number; lote?: string; conos?: number; etiqueta?: string }
  ): Observable<VarianteCodigo> {
    return this.http
      .post<ApiResponse<VarianteCodigo>>(`${this.base}/variantes/${varianteId}/codigos`, body)
      .pipe(map(data));
  }
  eliminarCodigo(codigoId: number): Observable<unknown> {
    return this.http
      .delete<ApiResponse<unknown>>(`${this.base}/variantes/codigos/${codigoId}`)
      .pipe(map(data));
  }

  // ---- Imágenes ----
  crearImagen(body: Partial<Imagen>): Observable<Imagen> {
    return this.http.post<ApiResponse<Imagen>>(`${this.base}/imagenes`, body).pipe(map(data));
  }
  eliminarImagen(id: number): Observable<unknown> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/imagenes/${id}`).pipe(map(data));
  }

  // ---- Tipos de cliente (listas de precio) ----
  tiposCliente(): Observable<TipoCliente[]> {
    return this.http
      .get<ApiResponse<TipoCliente[]>>(`${environment.apiUrl}/tipos-cliente`)
      .pipe(map(data));
  }
  crearTipoCliente(body: { nombre: string; orden?: number }): Observable<TipoCliente> {
    return this.http
      .post<ApiResponse<TipoCliente>>(`${environment.apiUrl}/tipos-cliente`, body)
      .pipe(map(data));
  }
  /** Precio de una presentación para un tipo de cliente. `null` lo borra. */
  fijarPrecioTipo(
    varianteId: number,
    tipo_cliente_id: number,
    precio: number | null
  ): Observable<Variante> {
    return this.http
      .put<ApiResponse<Variante>>(`${this.base}/variantes/${varianteId}/precios`, {
        tipo_cliente_id,
        precio,
      })
      .pipe(map(data));
  }

  // ---- Opciones (lookups) ----
  /**
   * Cache de los lookups. Líneas, unidades e impuestos no se editan desde el
   * panel y son los mismos toda la sesión: se piden UNA vez y las siguientes
   * veces el modal del producto abre ya armado, sin el parpadeo de los selects.
   */
  private readonly cacheOpciones = new Map<string, Observable<Opcion[]>>();

  opciones(tipo: 'lineas' | 'unidades' | 'impuestos'): Observable<Opcion[]> {
    let obs = this.cacheOpciones.get(tipo);
    if (!obs) {
      obs = this.http
        .get<ApiResponse<Opcion[]>>(`${this.base}/opciones/${tipo}`)
        .pipe(map(data), shareReplay({ bufferSize: 1, refCount: false }));
      this.cacheOpciones.set(tipo, obs);
    }
    return obs;
  }
}
