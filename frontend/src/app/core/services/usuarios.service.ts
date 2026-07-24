import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse, Rol, Usuario } from '../models/auth.models';

function data<T>(r: ApiResponse<T>): T {
  if (r.error || r.data === null) throw r.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía' };
  return r.data;
}

export interface CrearUsuarioInput {
  rol_id: number;
  nombre: string;
  correo: string;
  telefono?: string;
  contrasena: string;
}

export interface ActualizarUsuarioInput {
  rol_id?: number;
  nombre?: string;
  telefono?: string | null;
  activo?: boolean;
  contrasena?: string;
}

/** Gestión de personal (staff). Todos los endpoints requieren rol administrador. */
@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  listar(q?: string, activo?: boolean): Observable<Usuario[]> {
    let params = new HttpParams();
    if (q) params = params.set('q', q);
    if (activo !== undefined) params = params.set('activo', activo);
    return this.http.get<ApiResponse<Usuario[]>>(`${this.base}/usuarios`, { params }).pipe(map(data));
  }

  roles(): Observable<Rol[]> {
    return this.http.get<ApiResponse<Rol[]>>(`${this.base}/usuarios/roles`).pipe(map(data));
  }

  crear(body: CrearUsuarioInput): Observable<Usuario> {
    return this.http.post<ApiResponse<Usuario>>(`${this.base}/usuarios`, body).pipe(map(data));
  }

  actualizar(id: number, body: ActualizarUsuarioInput): Observable<Usuario> {
    return this.http.put<ApiResponse<Usuario>>(`${this.base}/usuarios/${id}`, body).pipe(map(data));
  }
}
