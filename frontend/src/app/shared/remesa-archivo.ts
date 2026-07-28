/**
 * El proveedor nombra sus listas de empaque con el HILO: "MARINO OSCURO 2-30.xlsx",
 * "ROJO 1-30.xlsx", "GRIS PERLA 2-30.xlsx". O sea color y calibre, con el calibre
 * escrito con guion porque la diagonal no se puede en un nombre de archivo.
 *
 * Eso se aprovecha para cotejar contra el producto al que se va a cargar. NO es
 * una garantía —es una convención del proveedor— así que solo AVISA, nunca
 * bloquea ni corrige solo.
 *
 * Por qué existe: se cargaron tres listas al producto equivocado, y la peor fue
 * "MARINO OSCURO 2-30.xlsx" sobre MARINO OSCURO **1/30** —color bueno, calibre
 * malo—, que a ojo no se ve. Ver CAMBIOS.txt del 2026-07-28.
 */

/** Lo que se pudo leer del nombre del archivo. */
export interface HiloDelArchivo {
  color: string;
  /** Con diagonal, como se guarda en el producto: "2/30". */
  calibre: string | null;
}

/** Mayúsculas, sin acentos y con los espacios colapsados, para comparar. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
}

/**
 * Saca el color y el calibre del nombre del archivo. Devuelve `null` si no sigue
 * la convención: entonces no hay nada que cotejar y no se opina.
 */
export function hiloDelArchivo(nombreArchivo: string): HiloDelArchivo | null {
  const sinRuta = nombreArchivo.split(/[\\/]/).pop() ?? nombreArchivo;
  const sinExt = sinRuta.replace(/\.(xlsx|xls)$/i, '');
  const limpio = normalizar(sinExt);
  if (!limpio) return null;

  // El calibre va al final y SIEMPRE con guion: un nombre de archivo no puede
  // llevar diagonal. "1 30" no se acepta: es demasiado ambiguo.
  const m = limpio.match(/^(.*?)[\s-]+(\d{1,2})\s*-\s*(\d{1,3})$/);
  if (m) {
    const color = m[1].trim();
    return color ? { color, calibre: `${m[2]}/${m[3]}` } : null;
  }
  // Sin calibre en el nombre: al menos se puede cotejar el color.
  return { color: limpio, calibre: null };
}

/** Un desacuerdo entre el archivo y el producto elegido. */
export interface AvisoArchivo {
  campo: 'color' | 'calibre';
  delArchivo: string;
  delProducto: string;
}

/**
 * Compara lo que dice el nombre del archivo con el producto elegido. Devuelve la
 * lista de diferencias; vacía significa que todo cuadra (o que no había nada que
 * cotejar).
 */
export function cotejarArchivo(
  nombreArchivo: string | null | undefined,
  producto: { producto?: string | null; calibre?: string | null }
): AvisoArchivo[] {
  if (!nombreArchivo) return [];
  const hilo = hiloDelArchivo(nombreArchivo);
  if (!hilo) return [];

  const avisos: AvisoArchivo[] = [];
  const colorProd = normalizar(producto.producto ?? '');
  if (colorProd && hilo.color !== colorProd) {
    avisos.push({ campo: 'color', delArchivo: hilo.color, delProducto: producto.producto ?? '' });
  }

  const calibreProd = (producto.calibre ?? '').trim();
  // Solo se compara si los dos lados lo traen: sin calibre capturado no hay
  // desacuerdo que reportar.
  if (hilo.calibre && calibreProd && hilo.calibre !== calibreProd) {
    avisos.push({ campo: 'calibre', delArchivo: hilo.calibre, delProducto: calibreProd });
  }
  return avisos;
}

/** Texto listo para la pantalla, en singular o plural según lo que difiera. */
export function textoAviso(avisos: AvisoArchivo[]): string | null {
  if (avisos.length === 0) return null;
  const partes = avisos.map(
    (a) => `el ${a.campo} del archivo dice «${a.delArchivo}» y el del producto es «${a.delProducto}»`
  );
  return `Revisa antes de cargar: ${partes.join(', y ')}.`;
}
