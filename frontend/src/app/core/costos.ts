/**
 * ¿La tienda lleva el COSTO de lo que compra? SÍ, desde el 2026-10-06: "costo
 * por kilo, solo administrador y contabilidad". Lo ve quien tenga
 * «Ver costos y márgenes» (`hacer:ver_costos`): el administrador y el puesto
 * Contabilidad. Del 2026-10-03 a esa fecha estuvo apagado ("no necesito lo que
 * me costó"); con false no lo ve nadie, ni el administrador.
 *
 * Es el gemelo de `SE_LLEVA_COSTO` en `backend/src/modules/permisos/service.js`:
 * los dos van iguales.
 */
export const SE_LLEVA_COSTO = true;
