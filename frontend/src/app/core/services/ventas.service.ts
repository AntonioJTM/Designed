import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import { Paginado } from '../models/catalogo.models';
import { MetodoEntrega } from '../models/tienda.models';
import { TicketPagoNota } from '../models/tickets.models';
import {
  Apartados,
  Caja,
  CanalVenta,
  DevolucionLinea,
  EstadoPedido,
  MetodoPago,
  Pedido,
  ResultadoAbono,
  SesionCaja,
  Encargos,
  NotasPendientes,
  ModificarPedidoInput,
  PreviaDevolucion,
  DevolverInput,
  ResultadoDevolucion,
} from '../models/ventas.models';

function data<T>(r: ApiResponse<T>): T {
  if (r.error || r.data === null) throw r.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía' };
  return r.data;
}

/** Como `data`, pero `null` es un valor válido (no un error). */
function dataNullable<T>(r: ApiResponse<T>): T | null {
  if (r.error) throw r.error;
  return r.data;
}

export interface ItemPedido {
  variante_id: number;
  cantidad: number;
  descuento?: number;
  /**
   * Bultos escaneados que formaron la cantidad. Se guardan con el pedido para
   * poder saber después de qué lote era el hilo que se entregó.
   */
  bultos?: { codigo: string; peso_kg: number; lote?: string | null }[];
}
export interface PagoPedido {
  metodo_pago_id: number;
  monto: number;
  referencia_transaccion?: string;
}
export interface CrearPedidoInput {
  canal: CanalVenta;
  /** Llave de un solo uso de la caja: la misma venta no se registra dos veces. */
  clave_cobro?: string;
  /** Cómo llega la mercancía. El mostrador siempre es 'recoger'. */
  metodo_entrega?: MetodoEntrega;
  /** Obligatoria cuando la entrega es 'envio'. */
  direccion_envio_id?: number;
  /**
   * Cómo dice el CLIENTE de la tienda en línea que va a pagar. No cobra nada:
   * deja el pedido 'pendiente' con un pago 'pendiente' que el administrador
   * confirma. El staff cobra con `pagos`.
   */
  metodo_pago_id?: number;
  /**
   * APARTADO: el cliente deja un anticipo (en `pagos`) y la mercancía se
   * RESERVA sin descontarse hasta que la entregue. Exige `cliente_id`: hay que
   * saber a quién se le guarda.
   */
  apartado?: boolean;
  /**
   * PEDIDO de cliente (encargo): se entrega después —pasa por él o lo lleva el
   * chofer (`metodo_entrega: 'envio'` con `entrega_direccion`)—. La mercancía
   * se aparta; lo que falte se cobra o se fía al entregar. Exige `cliente_id`.
   */
  encargo?: boolean;
  /**
   * NOTA PENDIENTE DE PAGO (2026-10-13): se lleva la mercancía, sale su ticket
   * y el pago se registra después. Exige `cliente_id`; no lleva `pagos` ni
   * `a_credito`.
   */
  pendiente_pago?: boolean;
  /**
   * Cuánto paga con su SALDO A FAVOR (lo que le quedó de una devolución).
   * Exige `cliente_id`; solo al cobrar o vender a crédito.
   */
  saldo_favor?: number;
  entrega_direccion?: string;
  /** 'YYYY-MM-DD'. Lo del chofer va en `costo_envio`. */
  entrega_para?: string;
  /**
   * Cuánto de esta venta se va A CRÉDITO (se lo lleva y paga después). Admite
   * venta MIXTA: paga algo hoy y el resto queda a deber. Exige `cliente_id`:
   * no se le fía a un desconocido.
   */
  a_credito?: number;
  /** Fiarle aunque traiga la cuenta atrasada: la caja lo preguntó antes (2026-10-16). */
  fiar_con_atraso?: boolean;
  sesion_caja_id?: number;
  /** Lista de precios a aplicar. Sin esto se cobra el precio público. */
  tipo_cliente_id?: number;
  almacen_id?: number;
  cliente_id?: number;
  cupon_codigo?: string;
  costo_envio?: number;
  notas?: string;
  items: ItemPedido[];
  pagos?: PagoPedido[];
}

/** Servicio HTTP de ventas (pedidos) y caja. */
@Injectable({ providedIn: 'root' })
export class VentasService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  // ---- Caja ----
  cajas(): Observable<Caja[]> {
    return this.http.get<ApiResponse<Caja[]>>(`${this.base}/caja/cajas`).pipe(map(data));
  }
  /** Alta de caja. Solo administradores. */
  crearCaja(body: { almacen_id: number; nombre: string; activo?: boolean }): Observable<Caja> {
    return this.http.post<ApiResponse<Caja>>(`${this.base}/caja/cajas`, body).pipe(map(data));
  }
  /** Edición de caja (renombrar, cambiar almacén, activar/desactivar). Solo administradores. */
  actualizarCaja(
    id: number,
    body: { almacen_id?: number; nombre?: string; activo?: boolean }
  ): Observable<Caja> {
    return this.http.put<ApiResponse<Caja>>(`${this.base}/caja/cajas/${id}`, body).pipe(map(data));
  }
  /** Solo se permite si la caja nunca abrió turno. Solo administradores. */
  eliminarCaja(id: number): Observable<unknown> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/caja/cajas/${id}`).pipe(map(data));
  }
  sesionAbierta(caja_id: number): Observable<SesionCaja | null> {
    const params = new HttpParams().set('caja_id', caja_id);
    return this.http
      .get<ApiResponse<SesionCaja | null>>(`${this.base}/caja/sesiones/abierta`, { params })
      .pipe(map(dataNullable));
  }
  abrirSesion(caja_id: number, monto_inicial: number): Observable<SesionCaja> {
    return this.http
      .post<ApiResponse<SesionCaja>>(`${this.base}/caja/sesiones`, { caja_id, monto_inicial })
      .pipe(map(data));
  }
  obtenerSesion(id: number): Observable<SesionCaja> {
    return this.http.get<ApiResponse<SesionCaja>>(`${this.base}/caja/sesiones/${id}`).pipe(map(data));
  }
  /** Retiro o ingreso de efectivo a mano. El retiro exige motivo. */
  movimientoCaja(
    id: number,
    body: { tipo: 'retiro' | 'ingreso'; monto: number; motivo?: string }
  ): Observable<SesionCaja> {
    return this.http
      .post<ApiResponse<SesionCaja>>(`${this.base}/caja/sesiones/${id}/movimientos`, body)
      .pipe(map(data));
  }
  cerrarSesion(id: number, monto_final: number): Observable<SesionCaja> {
    return this.http
      .post<ApiResponse<SesionCaja>>(`${this.base}/caja/sesiones/${id}/cerrar`, { monto_final })
      .pipe(map(data));
  }

  // ---- Pedidos ----
  metodosPago(): Observable<MetodoPago[]> {
    return this.http.get<ApiResponse<MetodoPago[]>>(`${this.base}/opciones/metodos-pago`).pipe(map(data));
  }
  crearPedido(body: CrearPedidoInput): Observable<Pedido> {
    return this.http.post<ApiResponse<Pedido>>(`${this.base}/pedidos`, body).pipe(map(data));
  }
  listarPedidos(
    f: {
      canal?: CanalVenta;
      estado?: EstadoPedido;
      /** Folio o cliente (nombre, como le dicen o su número). */
      q?: string;
      /** emitidas / canceladas / con_devolucion (2026-10-16). */
      situacion?: 'emitidas' | 'canceladas' | 'con_devolucion';
      caja_id?: number;
      /** 'YYYY-MM-DD', los dos inclusivos. */
      desde?: string;
      hasta?: string;
      page?: number;
    } = {}
  ): Observable<Paginado<Pedido>> {
    let params = new HttpParams();
    if (f.canal) params = params.set('canal', f.canal);
    if (f.estado) params = params.set('estado', f.estado);
    if (f.q) params = params.set('q', f.q);
    if (f.situacion) params = params.set('situacion', f.situacion);
    if (f.caja_id) params = params.set('caja_id', f.caja_id);
    if (f.desde) params = params.set('desde', f.desde);
    if (f.hasta) params = params.set('hasta', f.hasta);
    params = params.set('page', f.page ?? 1).set('limit', 50);
    return this.http.get<ApiResponse<Paginado<Pedido>>>(`${this.base}/pedidos`, { params }).pipe(map(data));
  }
  obtenerPedido(id: number): Observable<Pedido> {
    return this.http.get<ApiResponse<Pedido>>(`${this.base}/pedidos/${id}`).pipe(map(data));
  }
  misPedidos(): Observable<Paginado<Pedido>> {
    const params = new HttpParams().set('limit', 50);
    return this.http.get<ApiResponse<Paginado<Pedido>>>(`${this.base}/pedidos/mis`, { params }).pipe(map(data));
  }
  // ---- Comprobante de pago ----
  /**
   * Sube la captura que el cliente mandó al depositar. El pedido queda pagado
   * en el mismo paso.
   *
   * El archivo va en CRUDO en el cuerpo, como la lista de empaque de las
   * remesas: el nombre viaja en una cabecera porque el cuerpo es el binario y
   * no hay dónde más ponerlo. El backend valida el tipo por los primeros bytes.
   */
  subirComprobante(pedidoId: number, archivo: File): Observable<Pedido> {
    return this.http
      .post<ApiResponse<Pedido>>(`${this.base}/pedidos/${pedidoId}/comprobante`, archivo, {
        headers: {
          'Content-Type': 'application/octet-stream',
          // encodeURIComponent: una cabecera HTTP no admite acentos ni espacios
          // en crudo, y las capturas suelen llamarse "Comprobante Ago 2026.png".
          'X-Nombre-Archivo': encodeURIComponent(archivo.name),
        },
      })
      .pipe(map(data));
  }

  /**
   * Baja el archivo para mostrarlo. Va por HttpClient y no por `<img src>`
   * porque el endpoint EXIGE sesión —un comprobante bancario no puede quedar
   * accesible con solo adivinar la URL— y una etiqueta `img` no manda el token.
   * Quien lo use debe liberar el object URL al terminar.
   */
  comprobante(pedidoId: number): Observable<Blob> {
    return this.http.get(`${this.base}/pedidos/${pedidoId}/comprobante`, {
      responseType: 'blob',
    });
  }

  /** Quita la captura. NO descobra el pedido: para eso está el cambio de estado. */
  eliminarComprobante(pedidoId: number): Observable<Pedido> {
    return this.http
      .delete<ApiResponse<Pedido>>(`${this.base}/pedidos/${pedidoId}/comprobante`)
      .pipe(map(data));
  }

  // ---- Apartados ----
  /**
   * Los apartados vigentes, con lo que llevan pagado.
   * `orden`: 'por_liquidar' (los que ya casi terminan, para llamarles),
   * 'antiguos' o 'monto'.
   */
  apartados(
    f: { cliente_id?: number; orden?: 'por_liquidar' | 'antiguos' | 'monto' } = {}
  ): Observable<Apartados> {
    let p = new HttpParams();
    if (f.cliente_id) p = p.set('cliente_id', String(f.cliente_id));
    if (f.orden) p = p.set('orden', f.orden);
    return this.http
      .get<ApiResponse<Apartados>>(`${this.base}/pedidos/apartados`, { params: p })
      .pipe(map(data));
  }

  /**
   * MODIFICA un pedido en espera: lo que lleva (la lista completa: lo que no
   * venga se quita) y la entrega. Devuelve el pedido con su total nuevo.
   */
  modificarPedido(pedidoId: number, body: ModificarPedidoInput): Observable<Pedido> {
    return this.http
      .put<ApiResponse<Pedido>>(`${this.base}/pedidos/${pedidoId}/encargo`, body)
      .pipe(map(data));
  }

  /** Los datos del ticket de un abono a una nota (uno de sus pagos; 2026-10-15). */
  ticketPago(pedidoId: number, pagoId: number): Observable<TicketPagoNota> {
    return this.http
      .get<ApiResponse<TicketPagoNota>>(`${this.base}/pedidos/${pedidoId}/pagos/${pagoId}/ticket`)
      .pipe(map(data));
  }

  /** Las NOTAS PENDIENTES DE PAGO por cobrar (se llevaron la mercancía sin pagar). */
  notasPendientes(f: { q?: string } = {}): Observable<NotasPendientes> {
    let p = new HttpParams();
    if (f.q) p = p.set('q', f.q);
    return this.http
      .get<ApiResponse<NotasPendientes>>(`${this.base}/pedidos/notas-pendientes`, { params: p })
      .pipe(map(data));
  }

  /**
   * Registra un pago (o abono) de una nota pendiente de pago. En efectivo hace
   * falta `sesion_caja_id`: entra al turno, al corte del día en que paga. Con
   * el último abono la nota queda pagada sola.
   */
  pagarNota(
    pedidoId: number,
    body: { monto: number; metodo_pago_id: number; sesion_caja_id?: number; referencia?: string }
  ): Observable<ResultadoAbono> {
    return this.http
      .post<ApiResponse<ResultadoAbono>>(`${this.base}/pedidos/${pedidoId}/abonos`, body)
      .pipe(map(data));
  }

  /** Pasa a la cuenta de crédito del cliente lo que falta de una nota pendiente. */
  pasarACredito(pedidoId: number, body: { fiar_con_atraso?: boolean } = {}): Observable<Pedido & { a_credito: number }> {
    return this.http
      .post<ApiResponse<Pedido & { a_credito: number }>>(`${this.base}/pedidos/${pedidoId}/a-credito`, body)
      .pipe(map(data));
  }

  /** Lo que se puede devolver de una nota (solo lee). */
  previaDevolucion(pedidoId: number, clienteId?: number): Observable<PreviaDevolucion> {
    // `cliente_id`: el que se elige cuando la venta no tenía (dice cuánto debe ese).
    const params = clienteId ? new HttpParams().set('cliente_id', clienteId) : undefined;
    return this.http
      .get<ApiResponse<PreviaDevolucion>>(`${this.base}/pedidos/${pedidoId}/devolucion`, { params })
      .pipe(map(data));
  }

  /**
   * El cliente REGRESA mercancía de la nota: los paquetes cerrados (escaneados)
   * y lo suelto (pesado). Entra al inventario y le queda a favor; no sale dinero.
   */
  devolver(pedidoId: number, body: DevolverInput): Observable<ResultadoDevolucion> {
    return this.http
      .post<ApiResponse<ResultadoDevolucion>>(`${this.base}/pedidos/${pedidoId}/devoluciones`, body)
      .pipe(map(data));
  }

  /** Las NOTAS EN ESPERA (encargos) sin entregar. */
  encargos(f: { estado?: string; q?: string } = {}): Observable<Encargos> {
    let p = new HttpParams();
    if (f.estado) p = p.set('estado', f.estado);
    if (f.q) p = p.set('q', f.q);
    return this.http.get<ApiResponse<Encargos>>(`${this.base}/pedidos/encargos`, { params: p }).pipe(map(data));
  }

  /**
   * Entrega una NOTA EN ESPERA cobrando lo que falta (`pagos`: lo recibido; solo
   * el efectivo da cambio y entra al turno `sesion_caja_id`), poniéndolo a
   * crédito (`a_credito`) o dejándolo como NOTA PENDIENTE DE PAGO
   * (`pendiente_pago`). Aquí sale del inventario. Devuelve el pedido con `cambio`.
   */
  entregarPedido(
    pedidoId: number,
    body: { pagos?: PagoPedido[]; sesion_caja_id?: number; a_credito?: number; pendiente_pago?: boolean; fiar_con_atraso?: boolean }
  ): Observable<Pedido> {
    return this.http.post<ApiResponse<Pedido>>(`${this.base}/pedidos/${pedidoId}/entregar`, body).pipe(map(data));
  }

  /**
   * Cambia el estado. Al cancelar o devolver se puede indicar en qué presentación
   * regresa cada línea (paquete entregado → conos devueltos); sin eso vuelve tal
   * como se vendió.
   */
  cambiarEstado(
    id: number,
    estado: EstadoPedido,
    devoluciones?: DevolucionLinea[]
  ): Observable<Pedido> {
    return this.http
      .patch<ApiResponse<Pedido>>(`${this.base}/pedidos/${id}/estado`, {
        estado,
        devoluciones: devoluciones?.length ? devoluciones : undefined,
      })
      .pipe(map(data));
  }
}
