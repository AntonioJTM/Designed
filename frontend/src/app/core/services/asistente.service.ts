import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';

/** Un turno de la conversación. */
export interface Turno {
  role: 'user' | 'assistant';
  content: string;
}

/** Qué consultó el asistente para contestar. Se muestra para poder confiar. */
export interface Consulta {
  herramienta: string;
  argumentos: Record<string, unknown>;
}

export interface Respuesta {
  respuesta: string;
  /** De dónde salieron los datos. */
  consultado: Consulta[];
  uso: { prompt_tokens: number; completion_tokens: number };
  vueltas: number;
  /** Se agotaron las vueltas sin llegar a una respuesta completa. */
  incompleto?: boolean;
}

export interface Capacidades {
  /** Si hay llave de IA configurada. Sin ella el asistente no funciona. */
  configurado: boolean;
  modelo: string;
  herramientas: { nombre: string; descripcion: string }[];
  ejemplos: string[];
}

/**
 * El asistente del negocio. Se le pregunta en palabras normales y contesta con
 * los datos de la tienda.
 *
 * La IA vive en el SERVIDOR: la llave nunca llega al navegador, y las consultas
 * las hace el backend con funciones ya programadas. Aquí solo se manda la
 * pregunta y se recibe la respuesta.
 */
@Injectable({ providedIn: 'root' })
export class AsistenteService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/asistente`;

  capacidades(): Observable<Capacidades> {
    return this.http
      .get<ApiResponse<Capacidades>>(`${this.base}/capacidades`)
      .pipe(map((r) => {
        if (r.error || r.data === null) throw r.error ?? { code: 'X', message: 'Sin datos' };
        return r.data;
      }));
  }

  preguntar(pregunta: string, historial: Turno[] = []): Observable<Respuesta> {
    return this.http
      .post<ApiResponse<Respuesta>>(`${this.base}/preguntar`, { pregunta, historial })
      .pipe(map((r) => {
        if (r.error || r.data === null) throw r.error ?? { code: 'X', message: 'Sin datos' };
        return r.data;
      }));
  }
}
