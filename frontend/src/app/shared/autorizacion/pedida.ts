import { ApiError } from '../../core/models/auth.models';

/**
 * ¿El "error" es que SE PIDIÓ la autorización? (2026-10-20, auditoría). El
 * interceptor lo entrega como error AUTORIZACION_PEDIDA porque todavía no se
 * hizo, pero no salió mal: la ventana "Listo: se pidió la autorización" ya lo
 * dijo. Cada pantalla, en vez de pintarlo en rojo, se cierra (o limpia la
 * captura y lo dice en verde), para que nadie lo vuelva a mandar creyendo que
 * falló. Devuelve el mensaje, o null si es otro error.
 */
export function autorizacionPedida(e: unknown): string | null {
  const api = (e as { error?: { error?: ApiError } })?.error?.error;
  return api?.code === 'AUTORIZACION_PEDIDA' ? api.message : null;
}
