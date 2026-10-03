/**
 * ¿La tienda lleva el COSTO de lo que compra? NO, por decisión del usuario
 * (2026-10-03): "no necesito lo que me costó, solo me sirve en cuánto lo voy a
 * vender".
 *
 * Mientras esté en false, «Ver costos y márgenes» no lo tiene nadie —ni el
 * administrador— (`AuthService.puede`), así que se esconden el costo promedio,
 * la columna de costo del historial, la ganancia y el margen del tablero, y
 * tampoco se PIDE el precio de compra al cargar mercancía.
 *
 * Es el gemelo de `SE_LLEVA_COSTO` en `backend/src/modules/permisos/service.js`:
 * para volver a llevar el costo se ponen los dos en true. Las columnas y el
 * promedio ponderado siguen en la base.
 */
export const SE_LLEVA_COSTO = false;
