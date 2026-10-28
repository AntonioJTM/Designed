# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Todo el personal de **Hitex**, y todos pesan igual (confirmado por el dueño el 2026-10-13: el
sistema no se diseña para un puesto por encima de los demás):

- **Mostrador (cajeras).** Cobran en el punto de venta con la pistola lectora, pesan conos en la
  báscula, toman pedidos de clientes (los recogen o los lleva el chofer) y apartados, fían a los
  clientes con crédito y abren y cortan su caja.
- **Bodega (almacenista).** Carga la lista del proveedor (un Excel con cientos de paquetes), surte
  a las tiendas escaneando cada paquete que sube a la camioneta, recibe envíos y hace ajustes y
  mermas.
- **Dueño, administración y gerente.** Inventario por almacén, ventas, clientes y cobranza, "Cómo
  va el negocio", nómina semanal con comisiones y los permisos de cada puesto.
- **Contabilidad.** Costos y márgenes: solo este puesto y el administrador ven lo que costó el hilo.

Una persona puede tener varios puestos. Los clientes de la tienda **no** usan el sistema hoy: la
tienda en línea existe en el código pero está apagada por decisión del dueño.

## Product Purpose

Hitex es una tienda de hilo (acrilán, viscosa) que vende **por kilo** en mostrador y surte varias
tiendas desde una bodega matriz. El sistema junta en una sola base todo lo que pasa con la
mercancía y el dinero: punto de venta, inventario por almacén con su kardex, cargas del proveedor,
envíos entre almacenes, pedidos de clientes, apartados, crédito, caja, reportes y nómina.

Sale bien cuando:

- los kilos y los paquetes de cada almacén cuadran con lo que hay físicamente;
- cada peso cobrado, fiado, devuelto o sacado de la caja queda asentado, con su motivo;
- cada quien hace su tarea sin tener que pensar en el sistema.

## Positioning

Está hecho alrededor de cómo se mueve el hilo de verdad, cosa que un punto de venta genérico que
cuenta piezas no puede hacer:

- **Cada paquete es único:** tiene su código, su peso real (de 10.75 a 19.80 kg), su lote y sus
  conos, y se consume una sola vez.
- **Todo se vende y se inventaría en kilos:** el paquete se cobra por su peso real y los conos se
  pesan.
- La lista del proveedor carga cientos de paquetes de una vez.
- Los paquetes se abren en conos **solo en una tienda**.
- La mercancía pasa de un almacén a otro **solo por un envío escaneado**, y la caja vende solo los
  paquetes de su tienda.

## Operating Context

- **Equipos (confirmado):** PC de mostrador con pistola lectora (escribe el código y manda Enter),
  computadora en la bodega y celular para consultar. No se usa tablet.
- **Lugares:** una bodega matriz (Almacén General) que surte a las tiendas (Tienda Principal,
  Tienda Moroleón); cada tienda tiene su caja.
- **Rutinas de la tienda:** abrir turno y hacer corte de caja; nómina de domingo a sábado, que se
  paga el sábado; cargas del proveedor turco (listas "HTX … INVENTARIO.xlsx"); pedidos por
  WhatsApp; chofer que entrega; clientes de mayoreo con crédito, a quienes se busca por su apodo
  ("Doña Chela").
- **Internet:** en el mostrador no siempre es bueno; las fuentes van instaladas en el proyecto,
  no se cargan de internet.
- **Hora:** la de la tienda, México centro.

## Capabilities and Constraints

Las reglas completas del negocio y de la interfaz están en `CLAUDE.md`. Las que más pesan al
diseñar:

- **Peso:** todo va en kilos, con decimales hasta el gramo; nunca por pieza. El cono se cobra al
  precio por kilo de su paquete.
- **Qué es un hilo:** color + calibre = un hilo. Siempre se nombra con su calibre ("ROJO 2/30"), y
  se distingue además por material y línea.
- **Lector:** escanear es el camino principal. El sistema avisa en el momento qué pasa con cada
  código, no al final.
- **Permisos por puesto:** cada quien ve solo sus pantallas. El costo es solo de administración y
  contabilidad.
- **Idioma y forma de trabajo:**
  - Toda la interfaz va en español de México, con las palabras de la tienda: paquete, cono, kilos,
    surtir, nota en espera, a crédito, corte. (Desde el 2026-10-13 ya no se aparta ni se "fía":
    se dice "nota en espera" y "a crédito".)
  - Las acciones van en ventanas que no se cierran al tocar el fondo.
  - No se usan los diálogos del navegador.
  - Debe verse bien en celular, además de en la computadora.
- **Técnico:** ya existe y está en uso. Angular + Node/Express + MariaDB, en un servidor propio
  (devtristan.cloud), con un sistema de producción y otro de pruebas.
- **Pendientes:**
  - Las listas de precio reales (medio mayoreo, mayoreo, especial) no están definidas.
  - Falta el pedido al proveedor (compras).
  - La tienda en línea está apagada.
- "Pregúntame" (el asistente con IA) se quitó el 2026-10-13; no se vuelve a ofrecer sin
  preguntar.

## Brand Commitments

- **Nombre:** Hitex (confirmado el 2026-10-13). Ya está en el menú, en la pantalla de entrar, en
  el título del navegador y en los PDF. En el proyecto no hay logo registrado.
- **Voz:**
  - Español sencillo, como habla la tienda.
  - Cada mensaje dice qué pasó y qué hacer, con números concretos ("Faltan $3,890", "sí existe,
    pero está en Almacén General").
  - Sin tecnicismos ni nombres de código.
  - El dueño pide que se le explique con casos y ejemplos con números.
- **Diseño aprobado:** el dueño aprobó el 2026-10-02 el rediseño del panel. Está registrado en
  `DESIGN.md`.

## Evidence on Hand

- **Datos en producción (base `hitex`):** 8 hilos 2/30 —PERLA JASPE, HUESO, ROJO, OXFORD JASPE,
  CAFE JASPE, CAMEL, OPTIK y MARINO—, unos 1,400 paquetes y 3 almacenes. El dueño los trata
  todavía como pruebas.
- **Listas del proveedor:** en `muestras/` (`HTX … INVENTARIO.xlsx`).
- **Manual de uso para el personal:** en PDF, fuera del repositorio
  (`D:\Imagenes\Manual de uso - Tienda de hilos.pdf`).
- **Lo que NO existe:** testimonios, clientes publicables, precios públicos ni cifras del negocio
  para mostrar. No se inventan.
- **El repositorio es público:** nada de datos reales del negocio ni secretos en el código.

## Product Principles

1. **Lo físico manda.** Los kilos y los paquetes de cada almacén cuadran con lo que hay. El
   sistema no inventa ni pierde mercancía, y todo movimiento deja su rastro.
2. **Cada peso queda asentado.** Lo cobrado, lo fiado, lo devuelto y lo que sale de la caja, con
   su motivo.
3. **Habla como la tienda.** Palabras del mostrador, mensajes que dicen qué hacer, con números.
4. **Escanear es lo rápido y lo seguro.** El lector manda, y el aviso llega en el momento, no al
   cobrar.
5. **A cada puesto, lo suyo.** Nadie ve una pantalla o un dato que no le toca, empezando por el
   costo.
