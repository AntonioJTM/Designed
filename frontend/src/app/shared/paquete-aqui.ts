import { VarianteCodigo } from '../core/models/catalogo.models';

/**
 * Por qué un paquete NO se puede vender (ni apartar, ni meter a un pedido) en
 * una tienda; null si sí se puede.
 *
 * "Si está en Tienda Principal solo se venden los paquetes que están ahí; no
 * tiene por qué tomar los de almacén. Que diga que sí existe pero está en
 * almacén, que tome uno que sí esté registrado con la tienda" (usuario,
 * 2026-10-07). El servidor lo valida igual (409 PAQUETE_EN_OTRA_SUCURSAL o
 * PAQUETE_EN_CAMINO); esto es para avisar al escanear, no al cobrar.
 * Sin almacén (capturado a mano antes de ese día) se permite.
 */
export function paqueteFueraDeAqui(
  b: Pick<VarianteCodigo, 'codigo' | 'almacen_id' | 'almacen' | 'en_camino_folio'>,
  almacenId: number | null | undefined,
  aqui?: string | null
): string | null {
  if (b.en_camino_folio) {
    return `El paquete ${b.codigo} viene en camino (${b.en_camino_folio}): primero recibe el envío en Surtir sucursal.`;
  }
  if (b.almacen_id != null && almacenId != null && Number(b.almacen_id) !== Number(almacenId)) {
    return (
      `El paquete ${b.codigo} sí existe, pero está en «${b.almacen ?? 'otro almacén'}»` +
      (aqui ? `, no en «${aqui}»` : '') +
      ': toma uno que esté en esta tienda.'
    );
  }
  return null;
}
