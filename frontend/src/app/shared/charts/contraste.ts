/**
 * La rampa azul ordinal de las gráficas (de claro a oscuro): antigüedad de una
 * deuda, frecuencia de compra. Los colores viven en la hoja (`--viz-rampa-*`,
 * `styles.scss`): aquí solo se nombran, para que no haya una copia que se
 * quede vieja si un día cambian.
 */
export const RAMPA_AZUL = ['var(--viz-rampa-1)', 'var(--viz-rampa-2)', 'var(--viz-rampa-3)', 'var(--viz-rampa-4)'] as const;

const BLANCO = '#FFFFFF';
/** La tinta del sistema (`--tinta`). */
const TINTA = '#161A23';

/**
 * El color de verdad detrás de un `var(--token)`, leído de la hoja de estilos.
 * Un color escrito (#RRGGBB) se devuelve tal cual.
 */
export function colorReal(c: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(c.trim());
  if (!m || typeof document === 'undefined') return c;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || c;
}

function luminancia(color: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(colorReal(color).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const canal = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
}

/** Contraste WCAG entre dos colores (#RRGGBB o `var(--token)`). */
export function contraste(a: string, b: string): number {
  const la = luminancia(a) ?? 0;
  const lb = luminancia(b) ?? 0;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * La letra que se lee mejor sobre un relleno: blanca o la tinta del sistema,
 * la de MAYOR contraste WCAG (auditoría 2026-10-13). Antes se decidía por el
 * "brillo" del relleno y sobre el azul medio salía blanca a 3.64:1; con la
 * tinta da 4.78:1. Un `var(--token)` se lee de la hoja; un color que no se
 * puede leer se trata como oscuro.
 */
export function tintaSobre(relleno: string): string {
  if (luminancia(relleno) === null) return BLANCO;
  return contraste(relleno, BLANCO) >= contraste(relleno, TINTA) ? BLANCO : TINTA;
}
