'use strict';

/**
 * Lo que se siembra para la MUESTRA: hilos y clientes inventados, pensados
 * para que cada pantalla tenga algo que enseñar.
 *
 * Ningún hilo repite el nombre de los reales (MARINO OSCURO, VERDE BOTELLA,
 * AMARILLO, BLANCO, BEIGE, NEGRO): la siembra se niega a correr si alguno ya
 * existe, porque las ventas de la muestra SOLO tocan estos hilos y nunca el
 * inventario real.
 */

// demanda: peso relativo de cuánto se vende (0 = nunca se vende → hilo muerto).
// costos:  costo por kilo de cada remesa; null = remesa capturada SIN costo
//          (el margen lo reporta aparte en vez de suponer cero).
// peso:    peso nominal del bulto en kilos; conos: cuántos rinde ese bulto.
const HILOS = [
  { nombre: 'ROJO', calibre: '1/30', material: 'ACRILAN', linea: 'Turco', precio: 135, peso: 19.1, conos: 12, demanda: 10, costos: [88, 91, 93], color: '#C62828', destacado: true },
  { nombre: 'ROJO', calibre: '2/30', material: 'ACRILAN', linea: 'Turco', precio: 128, peso: 22.4, conos: 16, demanda: 6, costos: [84, 86], color: '#A31515' },
  { nombre: 'AZUL REY', calibre: '1/30', material: 'ACRILAN', linea: 'Nacional', precio: 125, peso: 19.1, conos: 12, demanda: 8, costos: [82, 85, 86], color: '#1E3FA8', destacado: true },
  { nombre: 'ROSA MEXICANO', calibre: '2/30', material: 'ACRILAN', linea: 'Turco', precio: 140, peso: 22.4, conos: 16, demanda: 7, costos: [92, 95, 96], color: '#E4007C', destacado: true },
  { nombre: 'GRIS OXFORD', calibre: '1/30', material: 'ACRILAN', linea: 'Nacional', precio: 118, peso: 19.1, conos: 12, demanda: 9, costos: [77, 80, 81], color: '#4A4F55' },
  { nombre: 'GRIS PERLA', calibre: '2/30', material: 'ACRILAN', linea: 'Chino', precio: 110, peso: 18.2, conos: 12, demanda: 5, costos: [72, 74], color: '#BFC3C7' },
  { nombre: 'CAFE CHOCOLATE', calibre: '1/30', material: 'ACRILAN', linea: 'Nacional', precio: 122, peso: 19.1, conos: 12, demanda: 6, costos: [80, 83], color: '#5D3A1A' },
  { nombre: 'VINO', calibre: '2/30', material: 'ACRILAN', linea: 'Turco', precio: 138, peso: 22.4, conos: 16, demanda: 6, costos: [90, 92], color: '#7B1E3A' },
  { nombre: 'TURQUESA', calibre: '1/30', material: 'ACRILAN', linea: 'Chino', precio: 115, peso: 18.2, conos: 12, demanda: 4, costos: [76, 78], color: '#1BA6A6' },
  // El proveedor le subió el precio y el kilo ya cuesta más de lo que se vende:
  // es el hilo que el tablero de margen tiene que señalar en rojo.
  { nombre: 'NARANJA', calibre: '2/30', material: 'ACRILAN', linea: 'Chino', precio: 112, peso: 18.2, conos: 12, demanda: 4, costos: [104, 140], color: '#F57C00' },
  { nombre: 'MORADO', calibre: '1/30', material: 'ACRILAN', linea: 'Turco', precio: 136, peso: 19.1, conos: 12, demanda: 3, costos: [89], color: '#6A1B9A' },
  { nombre: 'VERDE BANDERA', calibre: '2/30', material: 'ACRILAN', linea: 'Nacional', precio: 124, peso: 22.4, conos: 16, demanda: 5, costos: [81, 84], color: '#1B7A3A' },
  // Remesas capturadas sin precio de compra: el margen dice "sin costo".
  { nombre: 'CAMEL', calibre: '1/30', material: 'ACRILAN', linea: 'Nacional', precio: 126, peso: 19.1, conos: 12, demanda: 5, costos: [null, null], color: '#C19A6B' },
  // Casi no se mueven: hilo muerto.
  { nombre: 'CELESTE', calibre: '2/30', material: 'ACRILAN', linea: 'Chino', precio: 108, peso: 18.2, conos: 12, demanda: 1, demandaHasta: '2026-07-25', costos: [70], color: '#8EC9EE' },
  { nombre: 'LILA', calibre: '1/30', material: 'ACRILAN', linea: 'Turco', precio: 134, peso: 19.1, conos: 12, demanda: 0.5, demandaHasta: '2026-07-25', costos: [null], color: '#B39DDB' },
  { nombre: 'MARFIL', calibre: '2/48', material: 'VISCOSA', linea: 'Turco', precio: 210, peso: 20.0, conos: 12, demanda: 3, costos: [142], color: '#EFE6CF', destacado: true },
  { nombre: 'CORAL', calibre: '2/48', material: 'VISCOSA', linea: 'Turco', precio: 220, peso: 20.0, conos: 12, demanda: 2, costos: [150], color: '#FF6F61' },
  // Nunca se ha vendido: el caso que más le importa al tablero de hilo muerto.
  { nombre: 'PLATA', calibre: '2/48', material: 'VISCOSA', linea: 'Chino', precio: 195, peso: 20.0, conos: 12, demanda: 0, costos: [128], color: '#AEB4BA' },
];

const DESCRIPCION = {
  ACRILAN: (h) => `Acrilán ${h.linea.toLowerCase()} calibre ${h.calibre}. Suave y firme, para suéter, chamarra y tejido de punto.`,
  VISCOSA: (h) => `Viscosa antipilling ${h.linea.toLowerCase()} calibre ${h.calibre}, con caída y brillo para prendas finas.`,
};

/*
 * Clientes. `tienda`: 'hgo' compra en la Caja Cuautepec (Tienda principal),
 * 'gto' en la Caja Moroleón.
 *   tipo      publico | medio | mayoreo  → lista de precios que se le aplica.
 *   freq      visitas por semana, aproximadas.
 *   credito   cómo paga lo que se le fía: puntual (liquida en una o dos
 *             semanas), lento (abona de a poco), moroso (dejó de pagar).
 *   hasta     último día que viene (enfriado o moroso que ya no regresa).
 *   alta      cuándo se capturó, si es cliente NUEVO de estos meses.
 *   cuenta    correo de su cuenta en la tienda en línea.
 *   gustos    índices de HILOS que compra más (para "qué colores se lleva").
 *   apartado  clave del apartado que se le arma (ver APARTADOS).
 */
const CLIENTES = [
  // ---- Hidalgo · Caja Cuautepec ----
  { nombre: 'María Guadalupe Hernández Soto', apodo: 'Doña Lupe', tel: '7750000101', ciudad: 'Cuautepec de Hinojosa', estado: 'Hidalgo', tienda: 'hgo', tipo: 'mayoreo', limite: 30000, desde: '2016-03-01', como: 'Ya era cliente', freq: 2, credito: 'puntual', gustos: [0, 4, 2] },
  { nombre: 'Roberto Islas Cabrera', apodo: 'Beto Islas', tel: '7750000102', ciudad: 'Tulancingo', estado: 'Hidalgo', tienda: 'hgo', tipo: 'mayoreo', limite: 40000, desde: '2019-08-15', como: 'Recomendación', freq: 1.5, credito: 'lento', gustos: [4, 5, 6], rfc: 'IACR780512AB3' },
  { nombre: 'Ana Laura Vargas Pérez', apodo: 'Taller Ana Laura', tel: '7750000103', ciudad: 'Santiago Tulantepec', estado: 'Hidalgo', tienda: 'hgo', tipo: 'medio', limite: 15000, desde: '2021-02-10', como: 'Facebook', freq: 1, credito: 'puntual', gustos: [3, 0, 8] },
  { nombre: 'José Luis Ortega Mendoza', apodo: 'Don Pepe', tel: '7750000104', ciudad: 'Cuautepec de Hinojosa', estado: 'Hidalgo', tienda: 'hgo', tipo: 'medio', limite: 10000, desde: '2018-05-20', como: 'Ya era cliente', freq: 1.2, credito: 'moroso', hasta: '2026-07-23', gustos: [6, 4] },
  { nombre: 'Claudia Rivera Monroy', apodo: 'Clau Tejidos', tel: '7750000105', ciudad: 'Tulancingo', estado: 'Hidalgo', tienda: 'hgo', tipo: 'medio', limite: 0, desde: '2022-09-01', como: 'Facebook', freq: 0.7, gustos: [3, 15, 2], cuenta: 'claudia.rivera@example.com' },
  { nombre: 'Francisca Téllez Ramírez', apodo: 'Doña Panchita', tel: '7750000106', ciudad: 'Cuautepec de Hinojosa', estado: 'Hidalgo', tienda: 'hgo', tipo: 'publico', limite: 0, desde: '2015-01-12', como: 'Pasaba por la tienda', freq: 0.6, gustos: [0, 10] },
  { nombre: 'Martín Cruz Escamilla', apodo: 'Martín del mercado', tel: '7750000107', ciudad: 'Tulancingo', estado: 'Hidalgo', tienda: 'hgo', tipo: 'publico', limite: 0, desde: '2023-04-03', como: 'Pasaba por la tienda', freq: 0.5, gustos: [4, 11] },
  { nombre: 'Silvia Pérez Olvera', apodo: 'Silvia', tel: '7750000108', ciudad: 'Acatlán', estado: 'Hidalgo', tienda: 'hgo', tipo: 'publico', limite: 0, desde: '2020-10-22', como: 'Recomendación', freq: 2, hasta: '2026-07-28', gustos: [3, 8] },
  { nombre: 'Hilda Moreno Licona', apodo: 'Tejidos Hilda', tel: '7750000109', ciudad: 'Cuautepec de Hinojosa', estado: 'Hidalgo', tienda: 'hgo', tipo: 'mayoreo', limite: 25000, desde: '2017-06-30', como: 'Ya era cliente', freq: 1, credito: 'lento', gustos: [2, 7, 0] },
  { nombre: 'Ricardo Austria Gómez', apodo: 'Ricardo', tel: '7750000110', ciudad: 'Pachuca', estado: 'Hidalgo', tienda: 'hgo', tipo: 'medio', limite: 8000, desde: '2022-01-18', como: 'Google', freq: 0.8, credito: 'moroso', hasta: '2026-08-17', gustos: [5, 4], cuenta: 'ricardo.austria@example.com' },
  { nombre: 'Rosa Elena Badillo Ruiz', apodo: 'Rosy', tel: '7750000111', ciudad: 'Tulancingo', estado: 'Hidalgo', tienda: 'hgo', tipo: 'publico', limite: 0, desde: '2024-02-14', como: 'Instagram', freq: 0.6, gustos: [3, 15, 8], cuenta: 'rosy.badillo@example.com' },
  { nombre: 'Gerardo Lugo Fuentes', apodo: 'Gerry', tel: '7750000112', ciudad: 'Santiago Tulantepec', estado: 'Hidalgo', tienda: 'hgo', tipo: 'publico', limite: 0, desde: '2021-07-07', como: 'Pasaba por la tienda', freq: 1.8, hasta: '2026-07-30', gustos: [6, 12] },
  { nombre: 'Leticia Sánchez Copca', apodo: 'Lety', tel: '7750000113', ciudad: 'Cuautepec de Hinojosa', estado: 'Hidalgo', tienda: 'hgo', tipo: 'medio', limite: 12000, desde: '2019-11-11', como: 'Recomendación', freq: 0.8, credito: 'puntual', gustos: [0, 3, 9] },
  { nombre: 'Juana Ramírez Ortiz', apodo: 'Doña Juanita', tel: '7750000114', ciudad: 'Cuautepec de Hinojosa', estado: 'Hidalgo', tienda: 'hgo', tipo: 'publico', limite: 0, desde: '2010-05-05', como: 'Ya era cliente', freq: 0.4, gustos: [12, 6], apartado: 'A6' },
  { nombre: 'Fernando Gayosso Vite', apodo: 'Fer Gayosso', tel: '7750000115', ciudad: 'Tulancingo', estado: 'Hidalgo', tienda: 'hgo', tipo: 'mayoreo', limite: 35000, desde: '2018-03-27', como: 'Recomendación', freq: 1.3, credito: 'puntual', gustos: [4, 0, 1], rfc: 'GAVF820901QW4' },
  { nombre: 'Patricia Lara Trejo', apodo: 'Paty', tel: '7750000116', ciudad: 'Acatlán', estado: 'Hidalgo', tienda: 'hgo', tipo: 'publico', limite: 0, desde: '2026-08-04', alta: '2026-08-04', como: 'Facebook', freq: 0.5, gustos: [10, 8] },
  { nombre: 'Alejandra Mejía Castelán', apodo: 'Ale', tel: '7750000117', ciudad: 'Tulancingo', estado: 'Hidalgo', tienda: 'hgo', tipo: 'publico', limite: 0, desde: '2026-08-11', alta: '2026-08-11', como: 'Tienda en línea', freq: 0.4, gustos: [3, 8], cuenta: 'ale.mejia@example.com' },
  { nombre: 'Óscar Valdez Rubio', apodo: 'Óscar', tel: '7750000118', ciudad: 'Pachuca', estado: 'Hidalgo', tienda: 'hgo', tipo: 'medio', limite: 0, desde: '2026-09-09', alta: '2026-09-09', como: 'Recomendación', freq: 1, gustos: [2, 4] },
  { nombre: 'Teresa Monter Islas', apodo: 'Tere', tel: '7750000119', ciudad: 'Cuautepec de Hinojosa', estado: 'Hidalgo', tienda: 'hgo', tipo: 'publico', limite: 0, desde: '2026-09-14', alta: '2026-09-14', como: 'Pasaba por la tienda', freq: 0.8, gustos: [0, 3] },
  { nombre: 'Daniel Zúñiga Barrera', apodo: 'Dany', tel: '7750000120', ciudad: 'Tulancingo', estado: 'Hidalgo', tienda: 'hgo', tipo: 'medio', limite: 10000, desde: '2020-06-01', como: 'Ya era cliente', freq: 1.3, credito: 'puntual', hasta: '2026-08-28', gustos: [7, 2] },
  { nombre: 'Elvira Cortés Hidalgo', apodo: 'Doña Elvira', tel: '7750000121', ciudad: 'Cuautepec de Hinojosa', estado: 'Hidalgo', tienda: 'hgo', tipo: 'publico', limite: 0, desde: '2014-09-19', como: 'Ya era cliente', freq: 0.3, gustos: [7, 0], apartado: 'A1' },
  { nombre: 'Marisol Aguilar Quiroz', apodo: 'Marisol', tel: '7750000122', ciudad: 'Tulancingo', estado: 'Hidalgo', tienda: 'hgo', tipo: 'publico', limite: 0, desde: '2022-12-02', como: 'Instagram', freq: 0.3, gustos: [3, 15], apartado: 'A2' },

  // ---- Guanajuato · Caja Moroleón ----
  { nombre: 'Juan Carlos López Gallardo', apodo: 'Tejidos JC', tel: '4450000201', ciudad: 'Moroleón', estado: 'Guanajuato', tienda: 'gto', tipo: 'mayoreo', limite: 50000, desde: '2012-02-20', como: 'Ya era cliente', freq: 2, credito: 'lento', gustos: [0, 2, 4, 1], rfc: 'LOGJ750314KL8' },
  { nombre: 'María de Jesús Zavala Ríos', apodo: 'Chuy Zavala', tel: '4450000202', ciudad: 'Uriangato', estado: 'Guanajuato', tienda: 'gto', tipo: 'mayoreo', limite: 40000, desde: '2015-10-08', como: 'Ya era cliente', freq: 1.5, credito: 'puntual', gustos: [3, 7, 0] },
  { nombre: 'Ernesto Guzmán Pantoja', apodo: 'Neto', tel: '4450000203', ciudad: 'Moroleón', estado: 'Guanajuato', tienda: 'gto', tipo: 'medio', limite: 15000, desde: '2019-04-25', como: 'Recomendación', freq: 1.5, credito: 'moroso', hasta: '2026-07-03', gustos: [4, 11] },
  { nombre: 'Verónica Ruiz Durán', apodo: 'Vero', tel: '4450000204', ciudad: 'Uriangato', estado: 'Guanajuato', tienda: 'gto', tipo: 'medio', limite: 12000, desde: '2020-08-17', como: 'Facebook', freq: 1, credito: 'puntual', gustos: [8, 3, 15] },
  { nombre: 'Arturo Pérez Cerna', apodo: 'Don Arturo', tel: '4450000205', ciudad: 'Yuriria', estado: 'Guanajuato', tienda: 'gto', tipo: 'mayoreo', limite: 30000, desde: '2016-01-09', como: 'Ya era cliente', freq: 0.9, credito: 'lento', gustos: [6, 4, 12] },
  { nombre: 'Gabriela Torres Ledesma', apodo: 'Gaby', tel: '4450000206', ciudad: 'Moroleón', estado: 'Guanajuato', tienda: 'gto', tipo: 'publico', limite: 0, desde: '2023-03-30', como: 'Instagram', freq: 0.6, gustos: [15, 16, 3], cuenta: 'gaby.torres@example.com' },
  { nombre: 'Salvador Ayala Cano', apodo: 'Chava', tel: '4450000207', ciudad: 'Uriangato', estado: 'Guanajuato', tienda: 'gto', tipo: 'medio', limite: 8000, desde: '2018-11-14', como: 'Ya era cliente', freq: 1.2, credito: 'puntual', hasta: '2026-08-20', gustos: [1, 4] },
  { nombre: 'Norma Alicia Ledesma Ríos', apodo: 'Norma', tel: '4450000208', ciudad: 'Moroleón', estado: 'Guanajuato', tienda: 'gto', tipo: 'publico', limite: 0, desde: '2021-05-06', como: 'Pasaba por la tienda', freq: 0.4, gustos: [9, 0], apartado: 'A8' },
  { nombre: 'Raúl Gaona Saavedra', apodo: 'Raúl', tel: '4450000209', ciudad: 'Salvatierra', estado: 'Guanajuato', tienda: 'gto', tipo: 'medio', limite: 10000, desde: '2022-07-21', como: 'Google', freq: 0.8, credito: 'moroso', hasta: '2026-08-27', gustos: [2, 11] },
  { nombre: 'Imelda Cerna Ruiz', apodo: 'Doña Imelda', tel: '4450000210', ciudad: 'Moroleón', estado: 'Guanajuato', tienda: 'gto', tipo: 'publico', limite: 0, desde: '2011-12-01', como: 'Ya era cliente', freq: 0.3, gustos: [7, 15], apartado: 'A3' },
  { nombre: 'Jorge Pantoja Villagómez', apodo: 'Jorge Pantoja', tel: '4450000211', ciudad: 'Uriangato', estado: 'Guanajuato', tienda: 'gto', tipo: 'mayoreo', limite: 25000, desde: '2017-09-13', como: 'Recomendación', freq: 1, credito: 'puntual', gustos: [4, 5, 2] },
  { nombre: 'Lucía Martínez Guzmán', apodo: 'Lucy', tel: '4450000212', ciudad: 'Valle de Santiago', estado: 'Guanajuato', tienda: 'gto', tipo: 'publico', limite: 0, desde: '2024-06-18', como: 'Tienda en línea', freq: 0.3, gustos: [3, 16], cuenta: 'lucy.martinez@example.com', apartado: 'A7' },
  { nombre: 'Ramón Durán Ortiz', apodo: 'Ramón', tel: '4450000213', ciudad: 'Moroleón', estado: 'Guanajuato', tienda: 'gto', tipo: 'publico', limite: 0, desde: '2019-02-02', como: 'Pasaba por la tienda', freq: 1, hasta: '2026-08-08', gustos: [4, 6] },
  { nombre: 'Elizabeth García Zamudio', apodo: 'Eli', tel: '4450000214', ciudad: 'Uriangato', estado: 'Guanajuato', tienda: 'gto', tipo: 'publico', limite: 0, desde: '2026-08-06', alta: '2026-08-06', como: 'Recomendación', freq: 0.5, gustos: [3, 8] },
  { nombre: 'Alberto Villagómez Ruiz', apodo: 'Beto Villagómez', tel: '4450000215', ciudad: 'Moroleón', estado: 'Guanajuato', tienda: 'gto', tipo: 'medio', limite: 0, desde: '2026-09-10', alta: '2026-09-10', como: 'Pasaba por la tienda', freq: 1, gustos: [0, 4] },
  { nombre: 'Carmen Gallardo Pérez', apodo: 'Carmelita', tel: '4450000216', ciudad: 'Yuriria', estado: 'Guanajuato', tienda: 'gto', tipo: 'publico', limite: 0, desde: '2020-03-03', como: 'Ya era cliente', freq: 0.3, gustos: [15, 7], apartado: 'A4' },
  { nombre: 'Hugo Saavedra León', apodo: 'Hugo', tel: '4450000217', ciudad: 'Celaya', estado: 'Guanajuato', tienda: 'gto', tipo: 'medio', limite: 5000, desde: '2021-10-10', como: 'Google', freq: 0.4, credito: 'puntual', gustos: [16, 15] },
  { nombre: 'Rocío Zamudio Cano', apodo: 'Rocío', tel: '4450000218', ciudad: 'Moroleón', estado: 'Guanajuato', tienda: 'gto', tipo: 'publico', limite: 0, desde: '2023-01-25', como: 'Facebook', freq: 0.5, gustos: [3, 0], apartado: 'A5' },
];

// Direcciones de envío de quienes compran en línea (inventadas).
const DIRECCIONES = {
  'claudia.rivera@example.com': { calle: 'Calle Hidalgo', numero_ext: '214', colonia: 'Centro', ciudad: 'Tulancingo', estado: 'Hidalgo', codigo_postal: '43600' },
  'ricardo.austria@example.com': { calle: 'Av. Juárez', numero_ext: '1180', numero_int: '3', colonia: 'Periodistas', ciudad: 'Pachuca', estado: 'Hidalgo', codigo_postal: '42060' },
  'rosy.badillo@example.com': { calle: 'Calle Morelos', numero_ext: '45', colonia: 'La Floresta', ciudad: 'Tulancingo', estado: 'Hidalgo', codigo_postal: '43640' },
  'ale.mejia@example.com': { calle: 'Privada Las Rosas', numero_ext: '9', colonia: 'Jardines del Sur', ciudad: 'Tulancingo', estado: 'Hidalgo', codigo_postal: '43630' },
  'gaby.torres@example.com': { calle: 'Calle Allende', numero_ext: '302', colonia: 'Centro', ciudad: 'Moroleón', estado: 'Guanajuato', codigo_postal: '38800' },
  'lucy.martinez@example.com': { calle: 'Calle Libertad', numero_ext: '77', colonia: 'San Antonio', ciudad: 'Valle de Santiago', estado: 'Guanajuato', codigo_postal: '38400' },
};

/*
 * Apartados con guion: cuándo se apartan, cuánto se abona y en qué terminan.
 * Cada uno cubre un caso de la pantalla de Apartados.
 *   lineas   [índice de HILOS, kilos] — se apartan en conos (por kilo).
 *   anticipo fracción del total que deja el día que aparta.
 *   abonos   [fecha, fracción del total] — se ajusta el último si liquida.
 *   fin      'entregado' (con fecha) | 'listo' (liquidado sin entregar) |
 *            'vigente' | 'cancelado' (con fecha).
 */
const APARTADOS = {
  A1: { fecha: '2026-07-20 12:10', lineas: [[7, 8], [0, 6]], anticipo: 0.3, abonos: [['2026-08-03 11:30', 0.25], ['2026-08-17 12:40', 0.25], ['2026-08-25 10:15', 0.2]], fin: 'entregado', finFecha: '2026-08-27 11:00' },
  A2: { fecha: '2026-08-10 16:20', lineas: [[3, 10], [15, 4]], anticipo: 0.25, abonos: [['2026-08-24 13:05', 0.25], ['2026-09-07 12:20', 0.25], ['2026-09-19 17:40', 0.25]], fin: 'entregado', finFecha: '2026-09-22 10:30' },
  A3: { fecha: '2026-08-15 11:45', lineas: [[7, 12], [15, 5]], anticipo: 0.2, abonos: [['2026-08-29 12:00', 0.2], ['2026-09-12 11:10', 0.3], ['2026-09-26 12:30', 0.3]], fin: 'listo' },
  A4: { fecha: '2026-09-01 10:40', lineas: [[15, 6], [7, 8]], anticipo: 0.3, abonos: [['2026-09-15 13:15', 0.15], ['2026-09-26 11:20', 0.15]], fin: 'vigente' },
  A5: { fecha: '2026-09-10 17:05', lineas: [[3, 9], [0, 9]], anticipo: 0.2, abonos: [['2026-09-24 12:45', 0.1]], fin: 'vigente' },
  A6: { fecha: '2026-09-21 10:20', lineas: [[12, 10], [6, 6]], anticipo: 0.2, abonos: [], fin: 'vigente' },
  A7: { fecha: '2026-07-25 13:30', lineas: [[3, 7], [16, 3]], anticipo: 0.25, abonos: [['2026-08-08 12:00', 0.15]], fin: 'cancelado', finFecha: '2026-08-21 16:10' },
  A8: { fecha: '2026-09-25 11:00', lineas: [[9, 6], [0, 5]], anticipo: 0.5, abonos: [['2026-09-30 12:15', 0.5]], fin: 'listo' },
};

const CUPONES = [
  { codigo: 'BIENVENIDA10', tipo: 'porcentaje', valor: 10, compra_minima: 500, usos_maximos: null, fecha_inicio: '2026-07-01', fecha_fin: '2026-12-31' },
  { codigo: 'HILO200', tipo: 'monto_fijo', valor: 200, compra_minima: 3000, usos_maximos: 25, fecha_inicio: '2026-08-01', fecha_fin: '2026-10-31' },
];

// Lo que se escribe en Admin → Configuración mientras dure la muestra. Al
// limpiar se regresan los valores que había.
const CONFIGURACION = {
  envio_costo_fijo: '150.00',
  transferencia_banco: 'Banco de ejemplo (demostración)',
  transferencia_clabe: '000000000000000000',
  transferencia_titular: 'Cuenta de demostración',
};

module.exports = { HILOS, DESCRIPCION, CLIENTES, DIRECCIONES, APARTADOS, CUPONES, CONFIGURACION };
