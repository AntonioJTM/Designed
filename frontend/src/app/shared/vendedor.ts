/**
 * EL VENDEDOR DE LA NOTA (2026-10-23): ¿la vendió alguien distinto de quien la
 * registró («Elaboró»)? Se compara por PERSONA (id): dos empleados pueden llamarse
 * igual. Sin los ids, por el nombre.
 */
export function vendioOtraPersona(p: {
  usuario_id?: number | string | null;
  vendedor_id?: number | string | null;
  usuario?: string | null;
  vendedor?: string | null;
}): boolean {
  if (!p.vendedor) return false;
  if (p.usuario_id != null && p.vendedor_id != null) return Number(p.usuario_id) !== Number(p.vendedor_id);
  return !!p.usuario && p.vendedor !== p.usuario;
}
