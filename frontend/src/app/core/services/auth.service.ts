import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { TokenService } from './token.service';
import { SE_LLEVA_COSTO } from '../costos';
import {
  ApiResponse,
  Cliente,
  LoginClienteResp,
  LoginUsuarioResp,
  SesionActual,
  Usuario,
} from '../models/auth.models';

export interface DatosRegistroCliente {
  nombre: string;
  correo: string;
  contrasena: string;
  telefono?: string;
  acepta_marketing?: boolean;
}

/** ¿Alguno de los puestos de la sesión es el de administrador? Entonces lo puede todo. */
function esAdminSesion(s: SesionActual | null): boolean {
  if (!s || s.tipo !== 'usuario') return false;
  return s.rol === 'administrador' || (s.puestos ?? []).includes('administrador');
}

/**
 * Servicio central de autenticación. Habla con /usuarios y /clientes del API,
 * guarda el JWT vía TokenService y mantiene la sesión actual como signal.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly tokens = inject(TokenService);
  private readonly base = environment.apiUrl;

  /** Sesión actual (perfil) o null si no hay usuario autenticado. */
  readonly sesion = signal<SesionActual | null>(null);

  // ---- Login ----

  /**
   * Login sin tipo explícito: intenta como staff y, si las credenciales no
   * corresponden a un usuario (401), reintenta como cliente. Un 403
   * (cuenta inactiva) sí se propaga, porque el correo sí coincidió.
   */
  login(correo: string, contrasena: string): Observable<SesionActual> {
    // TIENDA EN LÍNEA APAGADA (2026-10): solo entra el personal. Para volver a
    // abrirla, regresar el reintento como cliente que está comentado abajo.
    return this.loginUsuario(correo, contrasena);
    // return this.loginUsuario(correo, contrasena).pipe(
    //   catchError((err: HttpErrorResponse) => {
    //     if (err?.status === 401) return this.loginCliente(correo, contrasena);
    //     return throwError(() => err);
    //   })
    // );
  }

  /**
   * ¿Puede el usuario de la sesión ver o hacer esto? `null` = cualquiera del
   * personal; 'admin' = solo el administrador. El administrador lo puede todo.
   */
  puede(permiso: string | null): boolean {
    const s = this.sesion();
    if (!s || s.tipo !== 'usuario') return false;
    // La tienda no lleva el costo (core/costos.ts): nadie lo ve.
    if (permiso === 'hacer:ver_costos' && !SE_LLEVA_COSTO) return false;
    if (esAdminSesion(s)) return true;
    if (permiso === null) return true;
    if (permiso === 'admin') return false;
    return (s.permisos ?? []).includes(permiso);
  }

  esAdmin(): boolean {
    return esAdminSesion(this.sesion());
  }

  private loginUsuario(correo: string, contrasena: string): Observable<SesionActual> {
    return this.http
      .post<ApiResponse<LoginUsuarioResp>>(`${this.base}/usuarios/login`, { correo, contrasena })
      .pipe(
        map((r) => this.desempaquetar(r)),
        map(({ usuario, token }) => this.establecerSesionUsuario(usuario, token))
      );
  }

  /** Login de cliente de la tienda en línea (apagada: nadie lo llama hoy). */
  loginCliente(correo: string, contrasena: string): Observable<SesionActual> {
    return this.http
      .post<ApiResponse<LoginClienteResp>>(`${this.base}/clientes/login`, { correo, contrasena })
      .pipe(
        map((r) => this.desempaquetar(r)),
        map(({ cliente, token }) => this.establecerSesionCliente(cliente, token))
      );
  }

  // ---- Registro ----

  registrarCliente(datos: DatosRegistroCliente): Observable<SesionActual> {
    return this.http
      .post<ApiResponse<LoginClienteResp>>(`${this.base}/clientes/registro`, datos)
      .pipe(
        map((r) => this.desempaquetar(r)),
        map(({ cliente, token }) => this.establecerSesionCliente(cliente, token))
      );
  }

  // ---- Perfil / sesión ----

  /** Consulta el perfil del sujeto autenticado (verifica el token contra el API). */
  cargarPerfil(): Observable<SesionActual> {
    const tipo = this.tokens.tipo();
    if (!tipo) throw new Error('No hay sesión activa');

    if (tipo === 'usuario') {
      return this.http
        .get<ApiResponse<Usuario>>(`${this.base}/usuarios/perfil`)
        .pipe(map((r) => this.establecerSesionUsuario(this.desempaquetar(r), this.tokens.token()!)));
    }
    return this.http
      .get<ApiResponse<Cliente>>(`${this.base}/clientes/perfil`)
      .pipe(map((r) => this.establecerSesionCliente(this.desempaquetar(r), this.tokens.token()!)));
  }

  logout(): void {
    this.tokens.limpiar();
    this.sesion.set(null);
  }

  // ---- Helpers ----

  /** Extrae `data` de la respuesta o lanza el error del API. */
  private desempaquetar<T>(resp: ApiResponse<T>): T {
    if (resp.error || resp.data === null) {
      throw resp.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía del servidor' };
    }
    return resp.data;
  }

  private establecerSesionUsuario(usuario: Usuario, token: string): SesionActual {
    this.tokens.guardar(token, 'usuario');
    const sesion: SesionActual = {
      tipo: 'usuario',
      nombre: usuario.nombre,
      correo: usuario.correo,
      rol: usuario.rol,
      puestos: [usuario.rol, ...(usuario.otros_roles ?? []).map((r) => r.nombre)],
      permisos: usuario.permisos ?? [],
    };
    this.sesion.set(sesion);
    return sesion;
  }

  private establecerSesionCliente(cliente: Cliente, token: string): SesionActual {
    this.tokens.guardar(token, 'cliente');
    const sesion: SesionActual = {
      tipo: 'cliente',
      nombre: cliente.nombre,
      correo: cliente.correo,
    };
    this.sesion.set(sesion);
    return sesion;
  }
}
