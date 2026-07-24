import { Injectable, signal } from '@angular/core';
import { TipoAuth } from '../models/auth.models';

const KEY_TOKEN = 'th_token';
const KEY_TIPO = 'th_tipo';

/**
 * Persistencia del JWT y del tipo de sujeto en localStorage.
 * Expone el token como signal para que el interceptor y el guard reaccionen.
 */
@Injectable({ providedIn: 'root' })
export class TokenService {
  readonly token = signal<string | null>(localStorage.getItem(KEY_TOKEN));
  readonly tipo = signal<TipoAuth | null>(localStorage.getItem(KEY_TIPO) as TipoAuth | null);

  guardar(token: string, tipo: TipoAuth): void {
    localStorage.setItem(KEY_TOKEN, token);
    localStorage.setItem(KEY_TIPO, tipo);
    this.token.set(token);
    this.tipo.set(tipo);
  }

  limpiar(): void {
    localStorage.removeItem(KEY_TOKEN);
    localStorage.removeItem(KEY_TIPO);
    this.token.set(null);
    this.tipo.set(null);
  }
}
