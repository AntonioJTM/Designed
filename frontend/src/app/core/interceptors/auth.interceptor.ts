import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TokenService } from '../services/token.service';

/** Adjunta el header `Authorization: Bearer <token>` cuando hay sesión. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(TokenService).token();
  if (token) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};
