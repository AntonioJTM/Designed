import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

/**
 * EL TÍTULO DE LA PESTAÑA DICE QUÉ PANTALLA ES (2026-10-13, auditoría): todas
 * decían "Hitex", así que con Caja, Inventario y Ventas abiertas a la vez había
 * tres pestañas iguales, y el lector de pantalla no tenía cómo decir dónde se
 * estaba. Cada ruta trae su `title` (los nombres salen de `core/navegacion.ts`)
 * y aquí se le pega el nombre del sistema: "Inventario · Hitex".
 *
 * El nombre del sistema se toma del título con que abrió la página, no se
 * escribe aquí: el sistema de pruebas abre como "PRUEBAS · Hitex" (lo pone
 * nginx) y así queda "PRUEBAS · Inventario · Hitex", con el aviso de pruebas
 * por delante.
 */
@Injectable({ providedIn: 'root' })
export class TituloPorPantalla extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly base = (typeof document !== 'undefined' && document.title.trim()) || 'Hitex';

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.title.setTitle(tituloCompleto(this.buildTitle(snapshot), this.base));
  }
}

/** "Inventario" + "PRUEBAS · Hitex" → "PRUEBAS · Inventario · Hitex". */
export function tituloCompleto(pantalla: string | undefined, base: string): string {
  if (!pantalla) return base;
  const partes = base.split(' · ');
  const marca = partes.pop() ?? base;
  return [...partes, pantalla, marca].join(' · ');
}
