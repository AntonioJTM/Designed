// Modelos compartidos de autenticación. Reflejan las respuestas del backend.

/** Tipo de sujeto autenticado: staff (usuario) o cliente de la tienda. */
export type TipoAuth = 'usuario' | 'cliente';

/** Envoltura estándar de todas las respuestas del API: { data, error }. */
export interface ApiResponse<T> {
  data: T | null;
  error: ApiError | null;
}

export interface ApiError {
  code: string;
  message: string;
  detalles?: unknown;
}

/** Usuario staff (tabla `usuarios`). Nunca incluye contrasena_hash. */
export interface Usuario {
  id: number;
  rol_id: number;
  rol: string;
  nombre: string;
  correo: string;
  telefono?: string | null;
  activo: boolean;
  ultimo_acceso?: string | null;
  creado_en: string;
  actualizado_en: string;
}

/** Rol de staff (tabla `roles`). */
export interface Rol {
  id: number;
  nombre: string;
  descripcion?: string | null;
}

/** Cliente de la tienda (tabla `clientes`). */
export interface Cliente {
  id: number;
  nombre: string;
  correo: string;
  telefono?: string | null;
  acepta_marketing: boolean;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
}

export interface LoginUsuarioResp {
  usuario: Usuario;
  token: string;
}

export interface LoginClienteResp {
  cliente: Cliente;
  token: string;
}

/** Perfil normalizado para la UI, independientemente del tipo. */
export interface SesionActual {
  tipo: TipoAuth;
  nombre: string;
  correo: string;
  rol?: string; // solo staff
}
