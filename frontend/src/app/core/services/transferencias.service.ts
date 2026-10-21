import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import {
  CambiosTransferencia,
  CuentaDeposito,
  FiltrosTransferencias,
  ListaTransferencias,
  Transferencia,
} from '../models/transferencias.models';

function data<T>(r: ApiResponse<T>): T {
  if (r.error) throw r.error;
  return r.data as T;
}

/**
 * TRANSFERENCIAS (2026-10-20): la lista y su revisión, y las cuentas a las que
 * se elige que llegó una transferencia AL COBRAR (caja, abono, anticipo, pago
 * de nota, entrega).
 */
@Injectable({ providedIn: 'root' })
export class TransferenciasService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/transferencias`;

  /** Las cuentas activas; null mientras no se han pedido. Se piden una vez por sesión. */
  readonly cuentas = signal<CuentaDeposito[] | null>(null);
  private pidiendo = false;

  /** Pide las cuentas si todavía no se tienen (las ventanas de cobro la llaman al abrir). */
  cargarCuentas(forzar = false): void {
    if (this.pidiendo || (this.cuentas() && !forzar)) return;
    this.pidiendo = true;
    this.http.get<ApiResponse<CuentaDeposito[]>>(`${this.base}/cuentas`).pipe(map(data)).subscribe({
      next: (c) => { this.cuentas.set(c); this.pidiendo = false; },
      error: () => { this.cuentas.set([]); this.pidiendo = false; },
    });
  }

  /**
   * ¿Falta decir a qué cuenta llegó? Solo si es por transferencia y hay cuentas
   * dadas de alta (sin ninguna no hay qué elegir).
   */
  faltaCuenta(esTransferencia: boolean, cuentaId: number | null | undefined): boolean {
    return esTransferencia && (this.cuentas()?.length ?? 0) > 0 && !this.elegida(cuentaId);
  }

  /** La cuenta elegida; con UNA sola cuenta activa, esa (no hay qué preguntar). */
  elegida(cuentaId: number | null | undefined): number | null {
    if (cuentaId) return cuentaId;
    const cs = this.cuentas();
    return cs?.length === 1 ? cs[0].id : null;
  }

  /** "Banamex …4521" (o solo el banco si no tiene números). */
  nombreCuenta(c: { banco: string | null; ultimos?: string | null; cuenta_ultimos?: string | null } | null | undefined): string {
    if (!c?.banco) return 'Sin cuenta';
    const u = c.ultimos ?? c.cuenta_ultimos;
    return u ? `${c.banco} …${u}` : c.banco;
  }

  listar(f: FiltrosTransferencias): Observable<ListaTransferencias> {
    let params = new HttpParams().set('limit', 100);
    if (f.desde) params = params.set('desde', f.desde);
    if (f.hasta) params = params.set('hasta', f.hasta);
    if (f.q) params = params.set('q', f.q);
    if (f.cuenta) params = params.set('cuenta', String(f.cuenta));
    if (f.estado) params = params.set('estado', f.estado);
    if (f.facturada !== undefined) params = params.set('facturada', f.facturada ? '1' : '0');
    if (f.de) params = params.set('de', f.de);
    if (f.offset) params = params.set('page', Math.floor(f.offset / 100) + 1);
    return this.http.get<ApiResponse<ListaTransferencias>>(this.base, { params }).pipe(map(data));
  }

  actualizar(clave: string, cambios: CambiosTransferencia): Observable<Transferencia> {
    return this.http.put<ApiResponse<Transferencia>>(`${this.base}/${clave}`, cambios).pipe(map(data));
  }

  /** Marca varias de una vez: Procesadas y/o Facturadas. */
  marcar(claves: string[], cambios: { estado?: 'procesada' | 'por_revisar'; facturada?: boolean }): Observable<{ marcadas: number }> {
    return this.http.post<ApiResponse<{ marcadas: number }>>(`${this.base}/marcar`, { claves, ...cambios }).pipe(map(data));
  }
}
