'use strict';

/**
 * Prueba de punta a punta del rastro de los bultos: qué bultos se le vendieron a
 * quién, y el desarme de un bulto que rinde menos conos, con sus datos reales.
 *
 *   cd backend
 *   PORT=3216 node src/server.js &        # en otra terminal
 *   node scripts/e2e-trazabilidad.js      # BASE=http://localhost:3216/api/v1
 *
 * Crea producto, presentaciones, almacén, caja y una venta temporales (prefijo
 * TMPT) y borra al terminar todo lo que creó. Sale 1 si algo falla.
 */

const path = require('node:path');
const fs = require('node:fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const m = require('mysql2/promise');
const RAIZ = path.join(__dirname, '..', '..');
const t=jwt.sign({sub:1,tipo:'usuario',rol_id:1,rol:'administrador'},process.env.JWT_SECRET,{expiresIn:'1h'});
const B = process.env.BASE ?? 'http://localhost:3216/api/v1';
const api=async(me,r,b)=>{const x=await fetch(B+r,{method:me,headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:b===undefined?undefined:JSON.stringify(b)});return {status:x.status,...(await x.json().catch(()=>({})))}};

// Los códigos del archivo real ya están en la base: la tienda lo cargó de verdad.
// Cada corrida les pone un sufijo propio para no chocar y para que la prueba no
// dependa del estado de la base. `cod()` traduce del código del archivo al de
// esta corrida.
const SUF = '-T' + Date.now().toString(36);
const _cod = new Map();
function marcar(bultos) {
  return bultos.map((b) => {
    const codigo = b.codigo + SUF;
    _cod.set(b.codigo, codigo);
    return { ...b, codigo };
  });
}
const cod = (original) => _cod.get(original) ?? original + SUF;

let f=0;const ck=(n,ok,d)=>{console.log((ok?'  ok  ':' FALLA')+' · '+n+(d!==undefined?' → '+d:''));if(!ok)f++;};
(async()=>{
 const db=await m.createConnection({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
 const foto={};for(const x of ['productos','almacenes','pedidos','sesiones_caja','cajas']) foto[x]=new Set((await db.query('SELECT id FROM '+x))[0].map(r=>r.id));
 try{
  const cat=(await api('GET','/categorias')).data.items[0].id;
  const kgu=(await api('GET','/opciones/unidades')).data.find(u=>u.abreviatura==='kg').id;
  const p=(await api('POST','/productos',{categoria_id:cat,unidad_medida_id:kgu,nombre:'TMPT Marino',multipresentacion:true,por_lotes:true})).data.id;
  const paq=(await api('POST','/variantes',{producto_id:p,sku:'TMPT-PAQ',presentacion:'Paquete',tipo_presentacion:'paquete',peso_kg:19.094,precio:200})).data.id;
  const cono=(await api('POST','/variantes',{producto_id:p,sku:'TMPT-CONO',presentacion:'Cono',tipo_presentacion:'cono',origen_variante_id:paq,piezas_por_origen:12,modo_precio:'calculado'})).data.id;
  const alm=(await api('POST','/almacenes',{nombre:'TMPT Bodega',es_punto_venta:true})).data.id;
  const caja=(await api('POST','/caja/cajas',{almacen_id:alm,nombre:'TMPT Caja'})).data.id;
  const buf=fs.readFileSync(RAIZ+'/MARINO OSCURO 2-30.xlsx');
  const pr=await (await fetch(B+'/remesas/previa',{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/octet-stream'},body:buf})).json();
  await api('POST','/remesas',{variante_id:paq,almacen_id:alm,bultos:marcar(pr.data.bultos)});

  console.log('=== 1. VENTA: el pedido guarda de qué bultos salió ===');
  const s=(await api('POST','/caja/sesiones',{caja_id:caja,monto_inicial:0})).data;
  const b1=(await api('GET',`/variantes/resolver/${cod('00531332')}`)).data.bulto;
  const b2=(await api('GET',`/variantes/resolver/${cod('00531338')}`)).data.bulto;
  const cantidad=Math.round((Number(b1.peso_kg)+Number(b2.peso_kg))*1000)/1000;
  let r=await api('POST','/pedidos',{canal:'punto_venta',sesion_caja_id:s.id,
    items:[{variante_id:paq,cantidad,bultos:[
      {codigo:b1.codigo,peso_kg:Number(b1.peso_kg),lote:b1.lote},
      {codigo:b2.codigo,peso_kg:Number(b2.peso_kg),lote:b2.lote}]}],
    pagos:[{metodo_pago_id:1,monto:cantidad*200}]});
  ck('la venta se crea', r.status===201, r.data?.numero_pedido+' · '+cantidad+' kg');
  const ped=r.data.id;
  r=await api('GET','/pedidos/'+ped);
  const linea=r.data.detalle[0];
  ck('la línea trae sus 2 bultos', linea.bultos?.length===2,
     linea.bultos?.map(b=>b.codigo+' ('+b.peso_kg+' kg)').join(' + '));
  ck('con su lote congelado', linea.bultos?.every(b=>b.lote==='0094886'), 'lote '+linea.bultos?.[0]?.lote);
  const suma=linea.bultos.reduce((a,b)=>a+Number(b.peso_kg),0);
  ck('los pesos suman la cantidad vendida', Math.abs(suma-Number(linea.cantidad))<0.001,
     suma.toFixed(3)+' kg = '+linea.cantidad);

  console.log('');console.log('=== 2. Se puede responder "de qué lote fue lo que le vendí" ===');
  const [q]=await db.query(
    `SELECT pd.pedido_id, b.lote, COUNT(*) bultos, SUM(b.peso_kg) kg
       FROM pedido_detalle_bultos b JOIN pedido_detalle pd ON pd.id=b.detalle_id
      WHERE pd.pedido_id=? GROUP BY pd.pedido_id, b.lote`,[ped]);
  ck('la consulta por lote funciona', q.length===1 && q[0].bultos===2, 'lote '+q[0]?.lote+': '+q[0]?.bultos+' bultos, '+q[0]?.kg+' kg');

  console.log('');console.log('=== 3. El histórico no cambia si se borra el bulto ===');
  await db.query('DELETE FROM variante_codigos WHERE codigo=?',[b1.codigo]);
  r=await api('GET','/pedidos/'+ped);
  const tras=r.data.detalle[0].bultos;
  ck('el pedido sigue diciendo qué se entregó', tras.length===2 && tras.some(b=>b.codigo===b1.codigo),
     tras.map(b=>b.codigo).join(' + '));
  const [[fk]]=await db.query('SELECT variante_codigo_id FROM pedido_detalle_bultos WHERE codigo=?',[b1.codigo]);
  ck('y la referencia viva quedó en NULL, no rompió', fk.variante_codigo_id===null, String(fk.variante_codigo_id));

  console.log('');console.log('=== 4. DESARME de un bulto que rinde 7 conos, no 12 ===');
  const inc=(await api('GET',`/variantes/resolver/${cod('00548087')}`)).data.bulto;
  ck('el bulto dice 10.75 kg y 7 conos', Number(inc.peso_kg)===10.75 && inc.conos===7, inc.peso_kg+' kg · '+inc.conos+' conos');
  const [[antesC]]=await db.query('SELECT COALESCE(cantidad,0) c FROM inventario WHERE variante_id=? AND almacen_id=?',[cono,alm]);
  r=await api('POST','/inventario/desarmes',{cono_variante_id:cono,almacen_origen_id:alm,almacen_destino_id:alm,
    paquetes:1,kg:Number(inc.peso_kg),conos:inc.conos,codigo_bulto:inc.codigo});
  ck('el desarme respeta los 7 conos', r.status===201 && Number(r.data.piezas_generadas)===7,
     '−'+r.data?.kg_consumidos+' kg → +'+r.data?.piezas_generadas+' conos');
  ck('y consume el peso real, no el nominal', Number(r.data.kg_consumidos)===10.75,
     r.data?.kg_consumidos+' kg (nominal seria 19.094)');
  const [[desC]]=await db.query('SELECT cantidad c FROM inventario WHERE variante_id=? AND almacen_id=?',[cono,alm]);
  // El cono entra en KILOS: los del bulto (10.75), no las 7 piezas. Se vende por
  // peso, así que las piezas son solo un dato del desarme.
  ck('el inventario de conos subió los KILOS del bulto',
     Math.abs((Number(desC.c)-Number(antesC?.c??0))-10.75)<0.001,
     (Number(desC.c)-Number(antesC?.c??0))+' kg');
  const [[cv]]=await db.query('SELECT codigo_bulto FROM variante_conversiones ORDER BY id DESC LIMIT 1');
  ck('queda el rastro de cuál bulto se desarmó', cv.codigo_bulto===inc.codigo, cv.codigo_bulto);

  console.log('');console.log('=== 5. Sin escanear sigue usando los nominales ===');
  r=await api('POST','/inventario/desarmes',{cono_variante_id:cono,almacen_origen_id:alm,almacen_destino_id:alm,paquetes:1});
  ck('12 conos y 19.094 kg', Number(r.data.piezas_generadas)===12 && Number(r.data.kg_consumidos)===19.094,
     '−'+r.data?.kg_consumidos+' kg → +'+r.data?.piezas_generadas+' conos');
 } finally {
  console.log('');console.log('=== Limpieza ===');
  await db.query('SET FOREIGN_KEY_CHECKS=0');
  const nuevos=async(x)=>(await db.query('SELECT id FROM '+x))[0].map(r=>r.id).filter(i=>!foto[x].has(i));
  for(const id of await nuevos('pedidos')){
    await db.query('DELETE FROM pedido_detalle_bultos WHERE detalle_id IN (SELECT id FROM pedido_detalle WHERE pedido_id=?)',[id]);
    await db.query('DELETE FROM pedido_detalle WHERE pedido_id=?',[id]);
    await db.query('DELETE FROM pagos WHERE pedido_id=?',[id]);
    await db.query('DELETE FROM pedidos WHERE id=?',[id]);
  }
  for(const id of await nuevos('sesiones_caja')){await db.query('DELETE FROM movimientos_caja WHERE sesion_caja_id=?',[id]);await db.query('DELETE FROM sesiones_caja WHERE id=?',[id]);}
  for(const id of await nuevos('cajas')) await db.query('DELETE FROM cajas WHERE id=?',[id]);
  for(const id of await nuevos('productos')){
    const sub='(SELECT id FROM producto_variantes WHERE producto_id=?)';
    for(const tb of ['variante_codigos','movimientos_inventario','inventario']) await db.query('DELETE FROM '+tb+' WHERE variante_id IN '+sub,[id]);
    await db.query('DELETE FROM variante_conversiones WHERE variante_origen_id IN '+sub+' OR variante_destino_id IN '+sub,[id,id]);
    await db.query('DELETE FROM remesas WHERE variante_id IN '+sub,[id]);
    await db.query('UPDATE producto_variantes SET origen_variante_id=NULL WHERE producto_id=?',[id]);
    await db.query('DELETE FROM producto_variantes WHERE producto_id=?',[id]);
    await db.query('DELETE FROM productos WHERE id=?',[id]);
  }
  for(const id of await nuevos('almacenes')) await db.query('DELETE FROM almacenes WHERE id=?',[id]);
  await db.query('SET FOREIGN_KEY_CHECKS=1');
  const [[{n}]]=await db.query('SELECT COUNT(*) n FROM pedidos');
  ck('la base quedó como antes', n===foto.pedidos.size, n+' pedidos');
  await db.end();
 }
 console.log('');console.log(f===0?'OK · todo pasó':'FALLAS: '+f);
 process.exit(f?1:0);
})();
