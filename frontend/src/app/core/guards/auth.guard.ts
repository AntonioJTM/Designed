import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TokenService } from '../services/token.service';

/** Permite el acceso solo si hay un token; si no, redirige a /login. */
export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const hayToken = !!inject(TokenService).token();
  return hayToken ? true : router.createUrlTree(['/login']);
};
