/**
 * LOS PAQUETES DE UNA VENTA, POR LOTE (2026-10-20, usuario: "cada paquete que se
 * escanea tiene que tener el lote y, si hay más paquetes, que los ponga del lote
 * que le corresponda y cuántos paquetes van de cada lote en una venta").
 * La usan la caja, el ticket y el detalle de la venta, así los tres dicen lo mismo.
 */

export interface GrupoLote<B> {
  /** null: el paquete no trae lote. */
  lote: string | null;
  bultos: B[];
  kg: number;
}

/** Agrupados por lote, en el orden en que se escaneó el primero de cada uno. */
export function porLote<B extends { lote?: string | null; peso_kg: number | string }>(bultos: readonly B[] | null | undefined): GrupoLote<B>[] {
  const grupos = new Map<string, GrupoLote<B>>();
  for (const b of bultos ?? []) {
    const lote = b.lote ? String(b.lote) : null;
    const k = lote ?? '';
    let g = grupos.get(k);
    if (!g) {
      g = { lote, bultos: [], kg: 0 };
      grupos.set(k, g);
    }
    g.bultos.push(b);
    g.kg = Math.round((g.kg + Number(b.peso_kg ?? 0)) * 1000) / 1000;
  }
  return [...grupos.values()];
}

/** "Lote 0094853" o "Sin lote". */
export function nombreLote(lote: string | null): string {
  return lote ? `Lote ${lote}` : 'Sin lote';
}

/** "1 paquete" / "3 paquetes". */
export function paquetes(n: number): string {
  return `${n} ${n === 1 ? 'paquete' : 'paquetes'}`;
}
