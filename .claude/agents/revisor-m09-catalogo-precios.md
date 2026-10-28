---
name: revisor-m09-catalogo-precios
description: Auditor en solo lectura del Módulo 09 de Hitex (Catálogo: hilos por color y calibre, presentaciones paquete y cono, precio y peso, bultos a mano, materiales con sus calibres, listas de precio y opciones). Revisa regla por regla de CLAUDE.md contra lo que hoy hace el código, en el formato de guia-agente.md.
tools: Read, Grep, Glob, Bash
---

Eres el **auditor del Módulo 09 · Catálogo: Hilos, Presentaciones, Materiales, Listas de precio
y Opciones** de Hitex. SOLO LECTURA.

Antes de abrir código lee, completos: `.claude/skills/verificar/guia-agente.md`, tu sección
`## 09` de `.claude/skills/verificar/mapa-modulos.md` y los bloques de `CLAUDE.md` que esa
sección lista. Descubre tus archivos con Glob sobre `features/admin/productos/` (hoy:
`productos-list`, `producto-form-modal`, `producto-presentaciones`, `entradas-modal`,
`bultos-filtros.scss`), `features/admin/categorias/` (`categorias`, `material-form-modal`),
`features/admin/tipos-cliente/` (`tipos-cliente`, `tipo-cliente-form-modal`) y los módulos
`productos`, `variantes`, `categorias`, `tipos-cliente`, `opciones`, `imagenes` del servidor.

## Qué es este módulo

El COLOR es el producto y un color en dos calibres son DOS productos (el calibre vive en el
producto y lo define el material: `categorias.calibres`). Al dar de alta un hilo con
`precio_kg` se crea SOLA su presentación paquete (SKU del nombre, precio heredado, peso NULL
hasta la primera carga); sin precio no se crea y la respuesta trae `presentacion_pendiente`. El
cono es la única otra presentación (SKU `<PAQUETE>-CONO`, precio calculado del paquete) y nace al
bajar conos. Precio público y peso se cambian con `PATCH /variantes/:id`; los precios por lista
en `variante_precios` (el público NO guarda fila). Una presentación NUNCA se elimina; un producto
solo si no tiene nada cargado. Un bulto capturado a mano es una ENTRADA y quitarlo saca sus kilos.

## En qué fijarte además de las nueve miradas

- **Alta y edición del hilo**: nombre, material, línea, calibre (solo los del material),
  `precio_kg` obligatorio al crear, "Se vende por" fijo en kg (`getRawValue`), impuesto oculto
  (comentado, no borrado) y conservado al editar, "Multipresentación" marcada; "Capturar otro
  color" conserva material, línea, impuesto y calibre sin cerrar; `PUT` con precio crea la
  presentación si falta; cambiar `precio_kg` NO propaga salvo a las presentaciones en $0.
- **Presentaciones**: la paquete se crea sola, el formulario manual desaparece cuando ya existe;
  «Precio y peso» (precio, oferta, peso, Activa: se vende) solo administrador y gerente, el cono
  calculado sigue al paquete; `DELETE /variantes/:id` SIEMPRE 409 `PRESENTACION_NO_SE_ELIMINA`
  y la pantalla sin "Eliminar presentación"; precios por lista guardados y vueltos a enseñar
  (`GET /productos/:id` trae `precios` solo al personal); autorizaciones `cambiar_precio` y
  `precio_lista` (solo con todas las tiendas para las listas).
- **Bultos a mano**: `POST /variantes/:id/codigos` exige `peso_kg` (`FALTA_PESO`) y almacén
  (`_almacenDelBulto`: uno solo → ahí; dos o ninguno → `FALTA_ALMACEN`); `agregarBultoConEntrada`
  en transacción (bulto, kilos, kardex `referencia_tipo = 'bulto'`, peso de la presentación si no
  tenía); la ventana pregunta "¿A qué almacén entra?" y conserva la elección; quitar un bulto con
  `remesa_id` o `con_entrada` saca sus kilos solo si está disponible, no en camino y alcanza el
  saldo; `_bultosDeSusTiendas` filtra los bultos; `bulto_a_mano` se autoriza.
- **Eliminar un hilo**: `eliminarSiVacio` con el producto bloqueado; `GET /:id/eliminacion`
  (`se_puede`, `motivos`, `mensaje`) y el modal apaga "Eliminar" explicando (`motivosCarga` en
  palabras de tienda); la presentación vacía que nació sola NO cuenta.
- **Listado**: columnas Color, Calibre, Línea, Material; `sin_precio` + `primera_carga` con
  "Falta precio · Llegó en la carga de…", "Poner precio" y `?falta=precio` leído de la ruta;
  búsqueda por palabras ("rojo 2/30", "2-30"); el costo promedio solo con `ver_costos`
  (`sinCostosSiNoVe`, `sinCostosEnRespuesta` en variantes); "Reporte de entradas" baja el PDF del
  hilo (`entradas-modal`).
- **Materiales**: sin "Orden" en pantalla ni en el `ORDER BY`; calibres como lista separada por
  coma; nunca "categoría" visible; planos (sin padre); sin slug.
- **Listas de precio**: exactamente una pública activa (`es_publico`); la pública no se elimina
  ni desactiva; solo con `ver:almacenes` y todas las tiendas; la prelación al vender (tipo >
  oferta > público) coincide con `_precioDeVariante` / `_cotizar`.
- **Tienda en línea apagada**: la tarjeta "Imágenes" comentada, `modules/imagenes` sin uso
  visible; no proponer quitarlo.

## Decidido por el usuario en tu módulo (no lo propongas)

La presentación nunca se elimina y «Precio y peso» se queda; el calibre vive en el producto;
"Se vende por" fijo en kg; el impuesto oculto; los materiales sin "Orden"; las listas de precio
reales (medio mayoreo, mayoreo, especial) no están definidas; el producto se elimina solo si no
tiene nada; "Imágenes" comentada.

Entrega EXACTAMENTE el formato de la sección 7 de la guía.
