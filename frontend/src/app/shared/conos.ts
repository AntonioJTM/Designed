/**
 * CUÁNTOS CONOS HAY (2026-10-19), con los kilos y el peso real de un cono (lo
 * que pesaron al bajarlos, con su tubo; lo calcula el servidor en cada bajada).
 * "≈ 8 conos": se cuenta por peso, así que lleva el "≈". Vacío si no se sabe el
 * peso. Lo usan Inventario y la caja, para que digan lo mismo.
 */
export function textoConos(kg: number | string | null | undefined, pesoCono: number | string | null | undefined): string {
  const k = Number(kg ?? 0);
  const peso = Number(pesoCono ?? 0);
  if (!(peso > 0) || !(k > 0)) return '';
  const n = Math.round(k / peso);
  if (n < 1) return 'menos de 1 cono';
  return `≈ ${n.toLocaleString('es-MX')} ${n === 1 ? 'cono' : 'conos'}`;
}
