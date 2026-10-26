'use strict';

const { escribirLibro } = require('../../utils/xlsx-escritor');

// PLANTILLAS PARA LLENAR (2026-10-22, usuario: "que al cargar el Excel también
// haya una opción Plantilla o Formato; que me dé el Excel en limpio para que
// nosotros lo llenemos, tanto en Lista con varios colores como en Un solo hilo").
//
// Cada una trae EXACTAMENTE los encabezados que leen `lista.js` y `service.js →
// analizar`, en la primera hoja (la de un hilo se lee de la primera), y una hoja
// INSTRUCCIONES que dice qué va en cada columna. Las columnas de código, calibre,
// lote y fecha van con formato de TEXTO: un código "00633586" no pierde sus ceros
// y un calibre "1/30" no se vuelve fecha. `plantillas.test.js` comprueba que lo
// que se escribe en ellas se lee bien.

/** La lista con VARIOS colores: la hoja GLOBAL (un renglón por paquete) y DOCUMENTO. */
function plantillaLista(filas = []) {
  return escribirLibro([
    {
      nombre: 'GLOBAL',
      columnas: [
        { titulo: 'BOX NO', ancho: 18, texto: true },
        { titulo: 'COLOR', ancho: 26 },
        { titulo: 'CALIBRE', ancho: 10, texto: true },
        { titulo: 'LOT', ancho: 14, texto: true },
        { titulo: 'GROSS', ancho: 10 },
        { titulo: 'TARE', ancho: 10 },
        { titulo: 'NET', ancho: 10 },
        { titulo: 'CONOS', ancho: 9 },
        { titulo: 'ARTICULO', ancho: 26 },
        { titulo: 'NOTA', ancho: 40 },
      ],
      filas,
    },
    {
      nombre: 'DOCUMENTO',
      columnas: [{ titulo: 'DATO', ancho: 16, texto: true }, { titulo: 'VALOR', ancho: 40, texto: true }],
      filas: [['PROVEEDOR', ''], ['FOLIO', ''], ['FECHA', '']],
    },
    {
      nombre: 'INSTRUCCIONES',
      congelar: false,
      columnas: [{ titulo: 'Columna', ancho: 14 }, { titulo: 'Qué se escribe', ancho: 100, parrafo: true }],
      filas: [
        ['', 'En la hoja GLOBAL va UN RENGLÓN POR PAQUETE, de todos los colores de la lista. No cambies los encabezados.'],
        ['BOX NO', 'Obligatorio. El código de barras del paquete, tal cual la etiqueta, con sus ceros a la izquierda. No se puede repetir.'],
        ['COLOR', 'Obligatorio. El nombre del color como se va a llamar el hilo en el sistema (MARINO, ROJO, CAMEL…). Si ya existe, se le suman los paquetes; si no, se crea sin precio.'],
        ['CALIBRE', 'Obligatorio. 1/30, 2/30, 2/48… (también "2-30"). El mismo color en otro calibre es otro hilo.'],
        ['LOT', 'El lote del paquete. Puede haber varios lotes del mismo color.'],
        ['GROSS', 'Opcional. El peso bruto en kilos. Con TARE sirve para revisar que bruto − tara = neto.'],
        ['TARE', 'Opcional. La tara en kilos.'],
        ['NET', 'Obligatorio. El peso neto del paquete en kilos (19.25): es lo que entra al inventario.'],
        ['CONOS', 'Los conos que rinde ese paquete (12, o 7 si es de los chicos).'],
        ['ARTICULO', 'Opcional. Lo que dice el proveedor ("%100 ACRYLIC…"): sugiere el material de los hilos nuevos.'],
        ['NOTA', 'Opcional. Cualquier observación del paquete; solo se avisa al cargar.'],
        ['', ''],
        ['DOCUMENTO', 'Opcional: el proveedor, el folio de la lista y la fecha, en la columna VALOR. Quedan en las notas de la carga.'],
        ['', 'Los renglones vacíos se ignoran. Un paquete sin código, color, calibre o peso NO deja cargar la lista (se dice cuál).'],
        ['', 'Se sube en Surtir inventario → «Lista con varios colores».'],
      ],
    },
  ]);
}

/** La lista de UN SOLO hilo: código (A), peso (B), lote (C) y conos (F). */
function plantillaHilo(filas = []) {
  return escribirLibro([
    {
      nombre: 'Paquetes',
      columnas: [
        { titulo: 'Código presentación*', ancho: 22, texto: true },
        { titulo: 'Cantidad * (kg)', ancho: 15 },
        { titulo: 'Lote', ancho: 14, texto: true },
        { titulo: 'Fecha produccion (no se usa)', ancho: 14, texto: true },
        { titulo: 'Fecha caducidad (no se usa)', ancho: 14, texto: true },
        { titulo: 'CONO', ancho: 8 },
      ],
      filas,
    },
    {
      nombre: 'INSTRUCCIONES',
      congelar: false,
      columnas: [{ titulo: 'Columna', ancho: 26 }, { titulo: 'Qué se escribe', ancho: 90, parrafo: true }],
      filas: [
        ['', 'En la hoja Paquetes va UN RENGLÓN POR PAQUETE de un solo hilo (un color y un calibre). No cambies los encabezados ni muevas las columnas.'],
        ['A · Código presentación', 'Obligatorio. El código de barras del paquete, tal cual la etiqueta, con sus ceros a la izquierda. No se puede repetir.'],
        ['B · Cantidad (kg)', 'Obligatorio. El peso real del paquete en kilos (19.25): es lo que entra al inventario.'],
        ['C · Lote', 'El lote del paquete.'],
        ['D y E · Fechas', 'Déjalas vacías: no se usan.'],
        ['F · CONO', 'Los conos que rinde ese paquete (12, o 7 si es de los chicos).'],
        ['', ''],
        ['', 'El hilo se elige en la pantalla antes de subir el archivo. Si lo nombras «COLOR CALIBRE.xlsx» (ROJO 1-30.xlsx), el sistema revisa que coincida con el hilo elegido.'],
        ['', 'Se sube en Surtir inventario → «Un solo hilo», o en Productos → Presentaciones del hilo.'],
      ],
    },
  ]);
}

const PLANTILLAS = {
  lista: { armar: plantillaLista, nombre: 'Plantilla - Lista con varios colores.xlsx' },
  hilo: { armar: plantillaHilo, nombre: 'Plantilla - Un solo hilo.xlsx' },
};

module.exports = { plantillaLista, plantillaHilo, PLANTILLAS };
