import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import { Paginado } from '../models/catalogo.models';
import {
  ConfigEmpleadoInput,
  DesgloseVentas,
  EmpleadoNomina,
  EstadoPeriodoNomina,
  NuevasHorasExtra,
  NuevoConcepto,
  PeriodoNomina,
  PeriodoResumen,
  SemanaActual,
  VacacionesEmpleado,
} from '../models/nomina.models';

/** Extrae `data` o lanza el error del API. */
function data<T>(r: ApiResponse<T>): T {
  if (r.error || r.data === null) {
    throw r.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía' };
  }
  return r.data;
}

/**
 * Nómina semanal del personal. Todos los endpoints requieren rol
 * administrador porque exponen sueldos.
 */
@Injectable({ providedIn: 'root' })
export class NominaService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/nomina`;

  // ---- Configuración del personal ----

  empleados(soloNomina = false): Observable<EmpleadoNomina[]> {
    let params = new HttpParams();
    if (soloNomina) params = params.set('solo_nomina', true);
    return this.http
      .get<ApiResponse<EmpleadoNomina[]>>(`${this.base}/empleados`, { params })
      .pipe(map(data));
  }

  guardarEmpleado(usuarioId: number, body: ConfigEmpleadoInput): Observable<EmpleadoNomina> {
    return this.http
      .put<ApiResponse<EmpleadoNomina>>(`${this.base}/empleados/${usuarioId}`, body)
      .pipe(map(data));
  }

  // ---- Vacaciones ----

  /** Su saldo (por ley, según su antigüedad) y las vacaciones que ha tomado. */
  vacaciones(usuarioId: number): Observable<VacacionesEmpleado> {
    return this.http
      .get<ApiResponse<VacacionesEmpleado>>(`${this.base}/empleados/${usuarioId}/vacaciones`)
      .pipe(map(data));
  }

  registrarVacaciones(
    usuarioId: number,
    body: { fecha_inicio: string; fecha_fin: string; notas?: string }
  ): Observable<VacacionesEmpleado> {
    return this.http
      .post<ApiResponse<VacacionesEmpleado>>(`${this.base}/empleados/${usuarioId}/vacaciones`, body)
      .pipe(map(data));
  }

  quitarVacaciones(id: number): Observable<VacacionesEmpleado> {
    return this.http
      .delete<ApiResponse<VacacionesEmpleado>>(`${this.base}/vacaciones/${id}`)
      .pipe(map(data));
  }

  // ---- Periodos ----

  /** Semana que contiene `fecha` (por defecto hoy). `periodo` es null si aún no se creó. */
  semanaActual(fecha?: string): Observable<SemanaActual> {
    let params = new HttpParams();
    if (fecha) params = params.set('fecha', fecha);
    return this.http
      .get<ApiResponse<SemanaActual>>(`${this.base}/periodos/actual`, { params })
      .pipe(map(data));
  }

  listarPeriodos(page = 1, limit = 20): Observable<Paginado<PeriodoResumen>> {
    const params = new HttpParams().set('page', page).set('limit', limit);
    return this.http
      .get<ApiResponse<Paginado<PeriodoResumen>>>(`${this.base}/periodos`, { params })
      .pipe(map(data));
  }

  crearPeriodo(fecha?: string, notas?: string): Observable<PeriodoNomina> {
    return this.http
      .post<ApiResponse<PeriodoNomina>>(`${this.base}/periodos`, { fecha, notas })
      .pipe(map(data));
  }

  calcular(id: number): Observable<PeriodoNomina> {
    return this.http
      .post<ApiResponse<PeriodoNomina>>(`${this.base}/periodos/${id}/calcular`, {})
      .pipe(map(data));
  }

  cambiarEstado(id: number, estado: EstadoPeriodoNomina): Observable<PeriodoNomina> {
    return this.http
      .patch<ApiResponse<PeriodoNomina>>(`${this.base}/periodos/${id}/estado`, { estado })
      .pipe(map(data));
  }

  /** Pedidos que forman la base comisionable de un empleado en el periodo. */
  ventas(periodoId: number, usuarioId: number): Observable<DesgloseVentas> {
    const params = new HttpParams().set('usuario_id', usuarioId);
    return this.http
      .get<ApiResponse<DesgloseVentas>>(`${this.base}/periodos/${periodoId}/ventas`, { params })
      .pipe(map(data));
  }

  // ---- Conceptos manuales del recibo ----

  agregarConcepto(reciboId: number, body: NuevoConcepto): Observable<PeriodoNomina> {
    return this.http
      .post<ApiResponse<PeriodoNomina>>(`${this.base}/recibos/${reciboId}/conceptos`, body)
      .pipe(map(data));
  }

  /** Días que trabajó en la semana; los de su horario que falten son faltas. */
  fijarDias(reciboId: number, diasTrabajados: number): Observable<PeriodoNomina> {
    return this.http
      .patch<ApiResponse<PeriodoNomina>>(`${this.base}/recibos/${reciboId}/dias`, {
        dias_trabajados: diasTrabajados,
      })
      .pipe(map(data));
  }

  /** Horas extra de un día, calculadas contra su horario y pagadas al doble. */
  agregarHorasExtra(reciboId: number, body: NuevasHorasExtra): Observable<PeriodoNomina> {
    return this.http
      .post<ApiResponse<PeriodoNomina>>(`${this.base}/recibos/${reciboId}/horas-extra`, body)
      .pipe(map(data));
  }

  eliminarConcepto(conceptoId: number): Observable<PeriodoNomina> {
    return this.http
      .delete<ApiResponse<PeriodoNomina>>(`${this.base}/conceptos/${conceptoId}`)
      .pipe(map(data));
  }
}
