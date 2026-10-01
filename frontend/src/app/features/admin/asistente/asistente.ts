import { Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AsistenteService,
  Capacidades,
  Consulta,
  Turno,
} from '../../../core/services/asistente.service';
import { ApiError } from '../../../core/models/auth.models';

/** Un mensaje en la pantalla: lo que se preguntó o lo que contestó. */
interface Mensaje {
  quien: 'yo' | 'asistente';
  texto: string;
  /** De dónde salieron los datos de esta respuesta. */
  consultado?: Consulta[];
  /** No pudo terminar: se agotaron las vueltas. */
  incompleto?: boolean;
  error?: boolean;
}

/**
 * El asistente: se le pregunta en palabras normales y contesta con los datos de
 * la tienda.
 *
 * DE DÓNDE SALIÓ LA RESPUESTA se muestra debajo de cada contestación. Es lo que
 * hace que se pueda confiar en ella: si dice "vendiste $12,400 hoy", debajo se
 * ve que lo consultó en las ventas del día y no que se lo inventó. Un asistente
 * cuyas cifras no se pueden rastrear no sirve para decidir nada.
 */
@Component({
  selector: 'app-asistente',
  imports: [FormsModule],
  templateUrl: './asistente.html',
})
export class Asistente implements OnInit {
  private readonly svc = inject(AsistenteService);
  private readonly hilo = viewChild<ElementRef<HTMLElement>>('hilo');

  readonly mensajes = signal<Mensaje[]>([]);
  readonly pensando = signal(false);
  /**
   * La IA se está tardando MÁS DE LO NORMAL y hay que decirlo.
   *
   * No es un adorno: se midió el flujo real contra la capa gratuita de Gemini y
   * una respuesta que consulta datos tarda unos 30 segundos, con picos de 50.
   * Con solo tres puntitos parpadeando, medio minuto se lee como "se trabó" y
   * la gente vuelve a preguntar o cierra la pantalla.
   */
  readonly tardando = signal(false);
  private relojTardanza?: ReturnType<typeof setTimeout>;
  readonly error = signal<string | null>(null);
  readonly capacidades = signal<Capacidades | null>(null);
  readonly verQuePuede = signal(false);

  pregunta = '';

  /** Solo hay algo que mostrar cuando ya se preguntó algo. */
  readonly empezado = computed(() => this.mensajes().length > 0);

  ngOnInit(): void {
    this.svc.capacidades().subscribe({
      next: (c) => this.capacidades.set(c),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  /** Una de las preguntas de ejemplo: se manda tal cual. */
  usarEjemplo(texto: string): void {
    this.pregunta = texto;
    this.enviar();
  }

  enviar(): void {
    const texto = this.pregunta.trim();
    if (!texto || this.pensando()) return;

    this.mensajes.update((m) => [...m, { quien: 'yo', texto }]);
    this.pregunta = '';
    this.pensando.set(true);
    this.error.set(null);
    this.alFinal();

    // A los 6 segundos ya no es "un momento": se avisa qué está pasando.
    this.tardando.set(false);
    clearTimeout(this.relojTardanza);
    this.relojTardanza = setTimeout(() => this.tardando.set(true), 6000);

    // El historial que se manda son los turnos de la charla, sin los detalles
    // de qué se consultó: al modelo le sirve el hilo, no la mecánica.
    const historial: Turno[] = this.mensajes()
      .slice(0, -1)
      .filter((m) => !m.error)
      .map((m) => ({ role: m.quien === 'yo' ? 'user' : 'assistant', content: m.texto }));

    this.svc.preguntar(texto, historial).subscribe({
      next: (r) => {
        this.mensajes.update((m) => [
          ...m,
          {
            quien: 'asistente',
            texto: r.respuesta,
            consultado: r.consultado,
            incompleto: r.incompleto,
          },
        ]);
        this.dejarDePensar();
        this.alFinal();
      },
      error: (e) => {
        // El error va COMO MENSAJE en el hilo, no en una barra aparte: así se
        // ve a qué pregunta corresponde.
        this.mensajes.update((m) => [
          ...m,
          { quien: 'asistente', texto: this.msg(e), error: true },
        ]);
        this.dejarDePensar();
        this.alFinal();
      },
    });
  }

  /** Apaga el estado de espera y su reloj, para que no salte después. */
  private dejarDePensar(): void {
    this.pensando.set(false);
    this.tardando.set(false);
    clearTimeout(this.relojTardanza);
  }

  limpiar(): void {
    this.mensajes.set([]);
    this.error.set(null);
  }

  /** Baja el hilo para que la última respuesta quede a la vista. */
  private alFinal(): void {
    setTimeout(() => {
      const el = this.hilo()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  /** El nombre de una herramienta, en palabras. */
  nombreConsulta(c: Consulta): string {
    const n = c.herramienta.replace(/_/g, ' ');
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error
      ?? (e as ApiError | undefined);
    const m = api && 'message' in (api as object) ? (api as ApiError).message : null;
    return m ?? 'No se pudo preguntar. Revisa la conexión.';
  }
}
