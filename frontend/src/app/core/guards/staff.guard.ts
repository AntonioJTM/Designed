import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TokenService } from '../services/token.service';

/**
 * Restringe el acceso a personal (tipo 'usuario'). Debe ir junto a authGuard.
 * Los clientes autenticados se redirigen fuera del panel admin.
 */
export const staffGuard: CanActivateFn = () => {
  const router = inject(Router);
  const tipo = inject(TokenService).tipo();
  return tipo === 'usuario' ? true : router.createUrlTree(['/login']);
};
