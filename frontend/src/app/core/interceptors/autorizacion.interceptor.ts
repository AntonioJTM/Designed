import {
  HttpErrorResponse, HttpEvent, HttpHandlerFn, HttpInterceptorFn, HttpRequest, HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, filter, from, map, of, switchMap, tap, throwError } from 'rxjs';
import { NecesitaAutorizacion } from '../models/autorizaciones.models';
import { AutorizacionDialogoService } from '../services/autorizacion-dialogo.service';

/**
 * AUTORIZACIONES (2026-10-19). Si el servidor contesta 428 NECESITA_AUTORIZACION
 * a una operación, pregunta qué hacer (`AutorizacionDialogoService`) y vuelve a
 * mandar LA MISMA petición:
 *   · "Pedir autorización" → con `X-Pedir-Autorizacion`: queda la solicitud. A
 *     la pantalla le llega un error AUTORIZACION_PEDIDA con un mensaje que lo
 *     dice (no se hizo todavía: que no crea que ya se registró);
 *   · "Autorizar aquí" → con `X-Autoriza` (quién autoriza y su clave): se hace y
 *     a la pantalla le llega su respuesta normal, como si lo hubiera hecho ella.
 *     Con la clave equivocada, la ventana lo dice y vuelve a preguntar;
 *   · "No hacerlo" → error AUTORIZACION_CANCELADA.
 */
export const autorizacionInterceptor: HttpInterceptorFn = (req, next) => {
  const dialogo = inject(AutorizacionDialogoService);
  return next(req).pipe(
    catchError((e: unknown) => {
      // La lista del proveedor se pide como TEXTO (contesta por partes): su error
      // llega como texto y se lee aquí (2026-10-19).
      let cuerpo = (e as HttpErrorResponse)?.error;
      if (typeof cuerpo === 'string') {
        try {
          cuerpo = JSON.parse(cuerpo);
        } catch {
          /* no es JSON: no es una autorización */
        }
      }
      const api = cuerpo?.error;
      if (!(e instanceof HttpErrorResponse) || e.status !== 428 || api?.code !== 'NECESITA_AUTORIZACION') {
        return throwError(() => e);
      }
      return resolver(req, next, dialogo, api.detalles as NecesitaAutorizacion, null);
    })
  );
};

function resolver(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  dialogo: AutorizacionDialogoService,
  info: NecesitaAutorizacion,
  errorPrevio: string | null
): Observable<HttpEvent<unknown>> {
  return from(dialogo.preguntar(info, errorPrevio)).pipe(
    switchMap((eleccion) => {
      if (eleccion.tipo === 'pedir') {
        return next(req.clone({ setHeaders: { 'X-Pedir-Autorizacion': '1' } })).pipe(
          filter((ev): ev is HttpResponse<unknown> => ev instanceof HttpResponse),
          switchMap((resp) => {
            // 202: se pidió y no se hizo nada todavía. Con `X-Autorizacion-Pedida`
            // (2026-10-19) lo demás SÍ se guardó y solo lo que necesita autorización
            // quedó pedido. Sin ninguno de los dos, ya lo podía hacer directo (le
            // dieron el permiso mientras): SE HIZO, y no se dice "se pidió".
            const pedida = resp.status === 202 || resp.headers.has('X-Autorizacion-Pedida');
            if (!pedida) {
              dialogo.cerrar();
              return of({ resp, yaEstaba: false });
            }
            // Ya había una igual esperando (2026-10-20): no se pidió otra, y se dice.
            // La lista del proveedor la pide como TEXTO (lee el avance por partes):
            // ahí el cuerpo hay que leerlo como JSON (2026-10-26, auditoría).
            let cuerpo = resp.body as { data?: { autorizacion?: { ya_estaba?: boolean } } } | string | null;
            if (typeof cuerpo === 'string') {
              try { cuerpo = JSON.parse(cuerpo); } catch { cuerpo = null; }
            }
            const yaEstaba = !!(cuerpo as { data?: { autorizacion?: { ya_estaba?: boolean } } } | null)
              ?.data?.autorizacion?.ya_estaba;
            return from(dialogo.avisarPedida(yaEstaba)).pipe(map(() => ({ resp, yaEstaba })));
          }),
          map(({ resp, yaEstaba }): HttpEvent<unknown> => {
            if (resp.status === 202) {
              throw comoError(req, 202, 'AUTORIZACION_PEDIDA', yaEstaba
                ? `Ya habías pedido la autorización para «${info.nombre}» y sigue esperando: no se pidió otra. La ves en Autorizaciones.`
                : `Se pidió la autorización para «${info.nombre}». Se hace cuando la acepten; la ves en Autorizaciones.`);
            }
            return resp;
          }),
          catchError((err) => {
            dialogo.cerrar();
            return throwError(() => err);
          })
        );
      }
      if (eleccion.tipo === 'aqui') {
        const cabecera = base64(JSON.stringify({ usuario_id: eleccion.usuario_id, clave: eleccion.clave }));
        return next(req.clone({ setHeaders: { 'X-Autoriza': cabecera } })).pipe(
          tap((ev) => {
            if (ev instanceof HttpResponse) dialogo.cerrar();
          }),
          catchError((err: HttpErrorResponse) => {
            const code = err?.error?.error?.code;
            if (code === 'AUTORIZACION_INVALIDA' || code === 'DEMASIADOS_INTENTOS') {
              return resolver(req, next, dialogo, info, err.error.error.message);
            }
            dialogo.cerrar();
            return throwError(() => err);
          })
        );
      }
      return throwError(() =>
        comoError(req, 428, 'AUTORIZACION_CANCELADA', `No se hizo: «${info.nombre}» necesita autorización.`));
    })
  );
}

/** Texto (con acentos) a base64, como lo lee el servidor. */
function base64(texto: string): string {
  let binario = '';
  for (const b of new TextEncoder().encode(texto)) binario += String.fromCharCode(b);
  return btoa(binario);
}

/** Un error con la forma de los del servidor, para que cada pantalla lo enseñe como siempre. */
function comoError(req: HttpRequest<unknown>, status: number, code: string, message: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    url: req.urlWithParams,
    error: { data: null, error: { code, message } },
  });
}
