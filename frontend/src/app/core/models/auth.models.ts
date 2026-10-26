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

/**
 * De qué tiendas es una persona (2026-10-15): `todas` (el administrador siempre)
 * o las de la lista. Quien no ve todas solo ve ventas, caja e inventario de las
 * suyas, y no ve Reportes, Cómo va el negocio, Nómina ni las miradas de Clientes.
 */
export interface Alcance {
  todas: boolean;
  almacenes: { id: number; nombre: string }[];
}

/** Usuario staff (tabla `usuarios`). Nunca incluye contrasena_hash. */
export interface Usuario {
  id: number;
  rol_id: number;
  rol: string;
  /** El de su puesto principal: 0/false = no entra al sistema (el cargador). */
  entra_al_sistema?: boolean | number;
  nombre: string;
  /** `null` = no entra al sistema (el cargador): no tiene correo ni contraseña. */
  correo: string | null;
  telefono?: string | null;
  activo: boolean;
  ultimo_acceso?: string | null;
  creado_en: string;
  actualizado_en: string;
  /**
   * Sus DEMÁS puestos (2026-10-06): `rol` es el principal —el de nómina— y estos
   * los que tiene además. Puede lo de todos juntos.
   */
  otros_roles?: Rol[];
  /** Lo que pueden ver y hacer sus puestos, sumados (Administración → Permisos). */
  permisos?: string[];
  /** Lo que guarda Personal: ve todas las tiendas, o las de `tiendas`. */
  todas_las_tiendas?: boolean;
  tiendas?: { id: number; nombre: string }[];
  /** Al entrar: las tiendas que de verdad ve (el administrador, todas). */
  alcance?: Alcance;
}

/** Rol de staff (tabla `roles`). */
export interface Rol {
  id: number;
  nombre: string;
  descripcion?: string | null;
  /**
   * `false` = el puesto NO entra al sistema (el cargador, 2026-10-14): sin
   * correo ni contraseña, sin otros puestos y fuera de Permisos.
   */
  entra_al_sistema?: boolean;
  /** Las pantallas que suman todas las tiendas que tiene el puesto (Personal lo dice con una sola tienda). */
  solo_todas?: string[];
  /** Lo que no podría hacer con una sola tienda ("cambiar los tipos de gasto"). */
  acciones_todas?: string[];
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
  /** Su id (solo staff): para no ofrecerle lo que es suyo (su propia nómina). */
  id?: number;
  nombre: string;
  correo: string;
  rol?: string; // solo staff: su puesto principal
  /** Todos sus puestos, el principal primero (solo staff). */
  puestos?: string[];
  /** Claves de Permisos del puesto (solo staff). El administrador las trae todas. */
  permisos?: string[];
  /** De qué tiendas es (solo staff). Sin dato: todas, como antes. */
  alcance?: Alcance;
}
