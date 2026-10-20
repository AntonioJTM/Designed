import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import { Paginado } from '../models/catalogo.models';
import {
  ConfigEmpleadoInput,
  ComisionesSemana,
  EmpleadoNomina,
  EstadoPeriodoNomina,
  NuevasHorasExtra,
  NuevoConcepto,
  PeriodoNomina,
  PeriodoResumen,
  SemanaActual,
  VacacionesEmpleado,
  MisVacaciones,
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

  /** "Mis vacaciones" (2026-10-19): las de quien tiene la sesión. */
  misVacaciones(): Observable<MisVacaciones> {
    return this.http.get<ApiResponse<MisVacaciones>>(`${this.base}/mis-vacaciones`).pipe(map(data));
  }

  /**
   * Pide sus vacaciones: se quedan esperando a quien las autoriza (`pedidas`).
   * Al administrador (el dueño) se le registran directo (`pedidas: false`).
   */
  pedirVacaciones(body: { fecha_inicio: string; fecha_fin: string; notas?: string }): Observable<{ pedidas: boolean }> {
    return this.http
      .post<ApiResponse<object>>(`${this.base}/mis-vacaciones`, body, { headers: { 'X-Pedir-Autorizacion': '1' } })
      .pipe(map((r) => ({ pedidas: 'autorizacion' in (data(r) as object) })));
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

  /** Pedir que se pague (fase 3): se queda esperando a quien autoriza pagarla. */
  pedirPago(id: number): Observable<void> {
    return this.http
      .patch<ApiResponse<object>>(`${this.base}/periodos/${id}/estado`, { estado: 'pagado' }, { headers: { 'X-Pedir-Autorizacion': '1' } })
      .pipe(map(() => undefined));
  }

  cambiarEstado(id: number, estado: EstadoPeriodoNomina): Observable<PeriodoNomina> {
    return this.http
      .patch<ApiResponse<PeriodoNomina>>(`${this.base}/periodos/${id}/estado`, { estado })
      .pipe(map(data));
  }

  /**
   * El reporte de comisiones de la semana: qué venta paga cada quien y qué le
   * falta por liquidar. Con `usuarioId`, solo esa persona.
   */
  comisiones(periodoId: number, usuarioId?: number): Observable<ComisionesSemana> {
    let params = new HttpParams();
    if (usuarioId) params = params.set('usuario_id', usuarioId);
    return this.http
      .get<ApiResponse<ComisionesSemana>>(`${this.base}/periodos/${periodoId}/comisiones`, { params })
      .pipe(map(data));
  }

  /**
   * La nómina de la semana en PDF: el resumen y un recibo por persona. Con
   * `usuarioId`, solo el recibo de esa persona. Llega como Blob (el enlace
   * normal no manda el token).
   */
  pdf(periodoId: number, usuarioId?: number): Observable<Blob> {
    let params = new HttpParams();
    if (usuarioId) params = params.set('usuario_id', usuarioId);
    return this.http.get(`${this.base}/periodos/${periodoId}/pdf`, { params, responseType: 'blob' });
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
