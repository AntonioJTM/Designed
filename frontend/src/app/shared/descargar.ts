/**
 * Guarda en el equipo un archivo que llegó del servidor (un PDF, por ejemplo).
 *
 * Los reportes se piden con `HttpClient` y no con un enlace normal porque el
 * servidor exige el token, y un `<a href>` no lo manda. Llega como Blob y aquí
 * se le da nombre y se descarga. Una descarga sí se permite aunque ocurra
 * después de esperar al servidor (abrir una ventana nueva, no).
 */
export function guardarArchivo(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Se libera un momento después: si se revoca en el acto, algunos navegadores
  // cancelan la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Nombre de archivo sin "/" ni caracteres que Windows no acepta ("2/30" → "2-30"). */
export function nombreArchivo(texto: string): string {
  return texto.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
}

/**
 * El mensaje de error de una petición que esperaba un archivo: el cuerpo del
 * error también llega como Blob, y hay que leerlo para saber qué dijo el servidor.
 */
export async function mensajeDeError(e: unknown, porOmision = 'No se pudo generar el PDF.'): Promise<string> {
  const cuerpo = (e as { error?: unknown })?.error;
  try {
    if (cuerpo instanceof Blob) {
      const j = JSON.parse(await cuerpo.text());
      return j?.error?.message ?? porOmision;
    }
    return (cuerpo as { error?: { message?: string } })?.error?.message ?? porOmision;
  } catch {
    return porOmision;
  }
}
