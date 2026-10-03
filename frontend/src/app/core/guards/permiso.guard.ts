import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, catchError, map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { rutaDeInicio } from '../navegacion';

/**
 * Hace falta la sesión (con sus permisos) para decidir. Al recargar la página
 * directo en una pantalla todavía no está en memoria: se pide el perfil.
 */
function conSesion<T>(auth: AuthService, router: Router, decidir: () => T): T | Observable<T | UrlTree> {
  if (auth.sesion()) return decidir();
  return auth.cargarPerfil().pipe(
    map(() => decidir()),
    catchError(() => of(router.createUrlTree(['/login'])))
  );
}

/**
 * Lo que no se ve en el menú tampoco se abre escribiendo la dirección. La ruta
 * dice qué permiso pide en `data.permiso` (mismo valor que en `navegacion.ts`).
 * Sin permiso se manda a su pantalla de inicio, no a un error: el menú ya no le
 * enseña esa opción y lo normal es que haya llegado por un enlace viejo.
 */
export const permisoGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const permiso = (route.data?.['permiso'] ?? null) as string | null;
  return conSesion(auth, router, () =>
    auth.puede(permiso) ? true : router.createUrlTree([rutaDeInicio((p) => auth.puede(p))])
  );
};

/** Entrar a /admin a secas: cada quien a su pantalla de inicio. */
export const inicioGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return conSesion(auth, router, () => router.createUrlTree([rutaDeInicio((p) => auth.puede(p))]));
};
