/**
 * LO QUE EL LECTOR DE PANTALLA DICE DE UNA GRÁFICA (2026-10-13, auditoría).
 *
 * Una gráfica SVG va con `role="img"`, y eso le esconde al lector todo lo que
 * lleva adentro —los nombres y las cifras de cada barra—: sin nombre, solo decía
 * "imagen". Su nombre (`aria-label`) es entonces el título que le pone la
 * pantalla seguido de los datos, en el orden en que se dibujan:
 * "Quién debe más. Doña Mari: $3,200; Tejidos JC: $1,500; y 4 más."
 *
 * Se corta a los primeros `max`: la tabla de al lado tiene el detalle completo.
 */
export function resumenGrafica(titulo: string, datos: string[], max = 10): string {
  const t = titulo.trim();
  if (!datos.length) return t ? `${t}. Sin datos.` : 'Gráfica sin datos.';
  const lista = datos.slice(0, max).join('; ');
  const resto = datos.length > max ? `; y ${datos.length - max} más` : '';
  return `${t ? t + '. ' : ''}${lista}${resto}.`;
}
