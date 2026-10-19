import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TokenService } from '../services/token.service';
import { TiempoRealService } from '../services/tiempo-real.service';

/**
 * Adjunta el header `Authorization: Bearer <token>` cuando hay sesión, y
 * `X-Pestana` (2026-10-19): el aviso en vivo de lo que esta pestaña guarde no se
 * le manda a ella misma, que ya se recargó.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(TokenService).token();
  const pestana = inject(TiempoRealService).pestana;
  req = req.clone({
    setHeaders: token ? { Authorization: `Bearer ${token}`, 'X-Pestana': pestana } : { 'X-Pestana': pestana },
  });
  return next(req);
};
