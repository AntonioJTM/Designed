import { Component, DestroyRef, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AsistenteService,
  Capacidades,
  Consulta,
  Turno,
} from '../../../core/services/asistente.service';
import { ApiError } from '../../../core/models/auth.models';
import { FechaPipe } from '../../../shared/fecha.pipe';

/** Un mensaje en la pantalla: lo que se preguntó o lo que contestó. */
interface Mensaje {
  quien: 'yo' | 'asistente';
  texto: string;
  /** De dónde salieron los datos de esta respuesta. */
  consultado?: Consulta[];
  /** No pudo terminar: se agotaron las vueltas. */
  incompleto?: boolean;
  error?: boolean;
  /** A qué hora contestó ("13:50"): la cifra es de ese momento. */
  hora?: string;
}

/**
 * Cómo se dice cada consulta en el renglón "Consulté: …". El nombre técnico de
 * la herramienta ("quien_me_debe") no le dice nada a la tienda; esto sí. Una
 * herramienta nueva que no esté aquí sale con su nombre en palabras, así que no
 * se rompe nada si se agrega en el backend y se olvida aquí.
 */
const NOMBRE_CONSULTA: Record<string, string> = {
  ventas_del_dia: 'ventas del día',
  ventas_por_rango: 'ventas entre dos fechas',
  mas_vendidos: 'los más vendidos',
  existencias: 'existencias por almacén',
  resumen_almacenes: 'kilos por almacén',
  por_reabastecer: 'existencias bajo su mínimo',
  quien_me_debe: 'cobranza por antigüedad',
  clientes_que_no_vuelven: 'clientes que dejaron de venir',
  buscar_cliente: 'búsqueda de clientes',
  expediente_cliente: 'expediente del cliente',
  apartados: 'apartados',
  hilo_parado: 'hilo parado',
  margen_por_hilo: 'margen por hilo',
  cortes_de_caja: 'cortes de caja',
};

/**
 * Pregúntame (rediseño 2026-10): se le pregunta en palabras normales y contesta
 * con los datos de la tienda. No cambia nada.
 *
 * DE DÓNDE SALIÓ LA RESPUESTA se muestra debajo de cada contestación. Es lo que
 * hace que se pueda confiar en ella: si dice "vendiste $12,400 hoy", debajo se
 * ve que lo consultó en las ventas del día y no que se lo inventó. Un asistente
 * cuyas cifras no se pueden rastrear no sirve para decidir nada. Por eso
 * también se dice cuando contestó SIN consultar datos.
 */
@Component({
  selector: 'app-asistente',
  imports: [FormsModule],
  templateUrl: './asistente.html',
  styleUrl: './asistente.scss',
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

  constructor() {
    // Si se sale de la pantalla mientras espera, el reloj no debe quedar vivo.
    inject(DestroyRef).onDestroy(() => clearTimeout(this.relojTardanza));
  }

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
            hora: this.horaActual(),
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

  /**
   * El renglón de debajo de la respuesta: "Consulté: ventas del día · hoy 13:50".
   * Cuando no consultó nada se dice también: esa respuesta no salió de los datos.
   */
  nota(m: Mensaje): string {
    const hora = m.hora ? `hoy ${m.hora}` : '';
    const fuentes = (m.consultado ?? []).map((c) => this.nombreConsulta(c));
    // La misma consulta dos veces (con otras fechas) se nombra una sola vez.
    const unicas = [...new Set(fuentes)];
    const que = unicas.length > 0 ? `Consulté: ${unicas.join(', ')}` : 'Sin consultar datos';
    return [que, hora].filter(Boolean).join(' · ');
  }

  /** El nombre de una consulta, en palabras, con sus fechas si las llevó. */
  nombreConsulta(c: Consulta): string {
    const base = NOMBRE_CONSULTA[c.herramienta] ?? c.herramienta.replace(/_/g, ' ');
    const a = c.argumentos ?? {};
    const f = (v: unknown) => new FechaPipe().transform(String(v), true);
    if (typeof a['fecha'] === 'string' && a['fecha']) return `${base} (${f(a['fecha'])})`;
    if (typeof a['desde'] === 'string' && typeof a['hasta'] === 'string' && a['desde'] && a['hasta']) {
      return `${base} (${f(a['desde'])} al ${f(a['hasta'])})`;
    }
    return base;
  }

  private horaActual(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error
      ?? (e as ApiError | undefined);
    const m = api && 'message' in (api as object) ? (api as ApiError).message : null;
    return m ?? 'No se pudo preguntar. Revisa la conexión.';
  }
}
