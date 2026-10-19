'use strict';

// EL PESO DE UN CONO, de verdad (2026-10-19). "La cantidad de conos se conoce
// cuando escaneas el paquete: te dice cuántos conos trae y cuánto pesa; ya solo
// se le suma el destare" (usuario). Es lo que pesaron los conos al bajarlos —el
// paquete escaneado más su destare— entre cuántos salieron, juntando TODAS las
// bajadas de ese cono. Con él Inventario y la caja dicen cuántos conos hay
// ("≈ 8 conos").
//
// Antes era el peso del Excel ÷ los conos del PRIMER paquete que se bajó, sin
// el tubo, y no cambiaba: si ese primer paquete era de los de 7 conos, decía
// "≈ 36 conos" donde había 65.

/** Peso promedio de un cono con sus bajadas ({ kg_consumidos, destare_kg, piezas_generadas }); null sin conos. */
function pesoPorCono(bajadas) {
  let kg = 0;
  let conos = 0;
  for (const b of bajadas) {
    const piezas = Number(b.piezas_generadas);
    if (!(piezas > 0)) continue;
    kg += Number(b.kg_consumidos) + Number(b.destare_kg ?? 0);
    conos += piezas;
  }
  return conos > 0 ? Math.round((kg / conos) * 1000) / 1000 : null;
}

/** Recalcula y guarda el peso de un cono con todas sus bajadas. Devuelve el peso, o null si no tiene. */
async function recalcularPesoCono(ejecutor, conoId) {
  const [bajadas] = await ejecutor.query(
    `SELECT kg_consumidos, destare_kg, piezas_generadas
       FROM variante_conversiones WHERE variante_destino_id = :id`,
    { id: conoId }
  );
  const peso = pesoPorCono(bajadas);
  if (peso != null) {
    await ejecutor.query('UPDATE producto_variantes SET peso_kg = :peso WHERE id = :id', { peso, id: conoId });
  }
  return peso;
}

module.exports = { pesoPorCono, recalcularPesoCono };
