# Proyecto: Sistema de gestión para tienda de hilos

Contexto para el asistente de código. Léelo completo antes de generar o modificar archivos.

> **Historial:** `CAMBIOS.txt` en la raíz tiene la bitácora de cada cambio, con el porqué de las
> decisiones y los incidentes. Consúltalo si algo no cuadra o si necesitas saber por qué algo
> está como está. Actualízalo al cerrar cada tarea que toque el proyecto.

## Qué estamos construyendo
Un sistema integral para una tienda de hilos con cinco frentes que comparten **una sola base de datos**:
1. **Tienda en línea** (catálogo público, carrito, checkout, cuenta de cliente).
2. **Punto de venta (POS)** para mostrador (caja, escáner de código de barras, ticket).
3. **Panel administrador** (gestión de catálogo, inventario, compras, pedidos, reportes).
4. **Inventario** multi-almacén con kardex de movimientos.
5. **Reportes** (ventas del día, corte de caja, productos por reabastecer, más vendidos).
6. **Nómina** semanal del personal (sueldo base + comisión por ventas, pago en sábado).

## Stack tecnológico
- **Base de datos:** MySQL 8 / MariaDB 10.5+ (esquema en `db/schema_mysql.sql`).
- **Backend/API:** Node.js + Express (REST, JSON). Usar `mysql2/promise` para el pool de conexiones.
- **Frontend:** Angular (standalone components + Angular Router; UI a definir).
- **Auth:** JWT. Contraseñas con `bcrypt`. Nunca guardar texto plano.

## Estructura de carpetas objetivo
```
tienda-hilos/
├── CLAUDE.md               ← este archivo
├── README.md
├── db/
│   ├── schema_mysql.sql    ← esquema principal (VALIDADO, 36 tablas)
│   └── erd.mermaid         ← diagrama entidad-relación completo
├── backend/                ← API Node/Express (por construir)
│   ├── src/
│   │   ├── config/         ← conexión a BD, variables de entorno
│   │   ├── middlewares/    ← auth JWT, manejo de errores, validación
│   │   ├── modules/        ← un subfolder por dominio (productos, inventario, ventas, ...)
│   │   │   └── <modulo>/   ← model.js, service.js, controller.js, routes.js
│   │   ├── app.js
│   │   └── server.js
│   └── package.json
└── frontend/               ← app Angular (por construir)
    └── src/app/
        ├── core/           ← servicios http, guards, interceptores
        ├── shared/         ← componentes reutilizables
        └── features/       ← admin/, pos/, tienda/
```

## El modelo de datos: reglas que NO se deben romper
- **Producto ≠ variante.** `productos` = la línea/modelo. `producto_variantes` = el SKU real que se
  vende e inventaría (color + presentación + precio + código de barras). El inventario, el carrito y
  el detalle de pedidos SIEMPRE apuntan a `producto_variantes`, nunca a `productos`.
- **Venta unificada.** `pedidos.canal` distingue `'tienda_linea'` de `'punto_venta'`. No crear tablas
  separadas para online y mostrador; es la misma tabla con campos opcionales según el canal.
- **Tienda = almacén con mostrador.** No hay dos entidades: `almacenes` guarda tanto sucursales
  como bodegas, y `es_punto_venta` distingue si además vende. Una sucursal nueva es un registro en
  `almacenes` más su caja. `GET /inventario/resumen` da el panorama de qué hay en cada uno.
- **Cada canal descuenta de su almacén.** El POS usa el almacén de la caja de la sesión; la tienda
  en línea usa el marcado con `almacenes.es_tienda_linea` (solo uno a la vez, lo garantiza el
  backend al guardar, y no deja quitarlo sin designar otro). Resuélvelo SIEMPRE con `almacenes/model.js → idTiendaLinea()`, nunca con una
  consulta ad hoc: el catálogo público y el checkout deben mirar el mismo almacén o el cliente verá
  existencias que no puede comprar.
- **Inventario con bitácora.** Toda modificación de existencias debe (1) actualizar `inventario` y
  (2) insertar un registro en `movimientos_inventario`. Hacerlo dentro de una transacción.
- **Al confirmar una venta**, dentro de una sola transacción: crear `pedidos` + `pedido_detalle`,
  registrar `pagos`, descontar `inventario`, insertar `movimientos_inventario` (tipo `'salida'`),
  y si es POS, insertar `movimientos_caja` (tipo `'venta'`).
- **Remesa → bultos.** La lista de empaque del proveedor trae un renglón por BULTO físico, con su
  código de barras, su peso real (varían entre sí) y su lote. El bulto no es una presentación del
  catálogo: la presentación es una sola y los bultos son sus ejemplares, en `variante_codigos`
  (`peso_kg`, `lote`, `conos`, `remesa_id`). Se cargan con `POST /remesas` tras revisar
  `POST /remesas/previa`; el inventario recibe la SUMA en kilos. El lector de `.xlsx` es propio
  (`utils/xlsx.js`), sin dependencias, porque el formato es fijo. En la lista de UN hilo solo se
  leen las columnas A (código), B (peso), C (lote) y F (conos): las de fecha vienen vacías y los
  renglones en blanco se ignoran sin avisar. (La lista con VARIOS colores va por encabezado: ver
  "La lista completa del proveedor".)
  **Es el vaciado masivo del catálogo.** `POST /remesas` acepta `producto_id` además de
  `variante_id`: desde la pantalla de presentaciones se sube el archivo y, si el producto todavía
  no tiene presentación, SE CREA —SKU derivado del nombre, tipo `paquete` (o `simple` si no es
  multipresentación), peso = PROMEDIO de los bultos, precio = `productos.precio_kg`— y luego entran
  los bultos y la mercancía. Una remesa posterior reutiliza la presentación. Se admite cargar sobre
  `paquete` o `simple` (ambos se llevan en kilos); sobre un `cono` da 422 `NO_ES_PAQUETE`.
  Varios lotes distintos pueden ser del MISMO hilo (el archivo real trae dos): el lote es una
  etiqueta del bulto y todos suman al mismo saldo, no se separa el inventario.
- **La LISTA COMPLETA del proveedor: varios hilos en un archivo** (2026-10-03). Recibir remesa
  abre en "Lista con varios colores"; "Un solo hilo" es la carga de siempre (el modo se recuerda en
  `localStorage['remesa_modo']`). El formato es el inventario que arma la tienda a partir del PDF
  del proveedor ("HTX 1.ARAC FFAU 721502-4 - INVENTARIO.xlsx"), leído con `utils/xlsx.js →
  leerLibro` (todas las hojas, ubicadas por `workbook.xml.rels`: hay programas que escriben la
  ruta absoluta). De la hoja GLOBAL —o la primera que tenga los encabezados— se lee por
  ENCABEZADO, no por letra: BOX NO (código), COLOR, CALIBRE, LOT, NET (lo que se carga), CONOS y
  NOTA; GROSS y TARE solo para avisar si bruto − tara ≠ neto. RESUMEN coteja bultos, kilos y conos
  por lote (solo avisa: pudo quedar viejo si se corrigió GLOBAL); DOCUMENTO da proveedor, número y
  fecha, que quedan en las notas de cada carga. INCIDENCIAS no se lee: lo mismo viene en NOTA.
  `remesas/lista.js`, `POST /remesas/lista/previa` y `POST /remesas/lista`; pantalla en
  `remesas/carga-lista.ts`.
  · **Cada COLOR + CALIBRE es un hilo, y la LÍNEA NO separa hilos** (decisión del usuario: el
    blanco 2/30 turco y el nacional son el mismo). El nombre es el de la columna COLOR tal cual: el
    usuario corrige los nombres EN EL EXCEL antes de subirlo, no hay tabla de equivalencias. El
    empate ignora mayúsculas, acentos y espacios, y "2-30" = "2/30". Dos hilos iguales en el
    catálogo son un error que impide cargar: no se adivina a cuál.
  · El que no existe **SE CREA SIN PRECIO** con el material y la línea que se eligen en la vista
    previa (el material lo sugiere el ARTÍCULO: "%100 ACRYLIC" → ACRILAN) y su calibre tiene que ser
    de ese material (422 `CALIBRE_NO_DEL_MATERIAL`). Su presentación: paquete, SKU = nombre +
    calibre ("MARINO-2-30"), peso = promedio real de sus bultos, precio $0.
  · Una CARGA por hilo —cada una con su folio y su PDF—, todas en UNA transacción: o entra la
    lista entera o nada. Al confirmar baja solo el PDF de toda la lista (`GET /remesas/pdf?ids=`:
    el resumen y una página por hilo).
  · **El costo por kilo va POR HILO y solo para administración y contabilidad** (2026-10-06): es
    una columna de la revisión que solo ven quienes tienen `hacer:ver_costos` (del 2026-10-03 a
    esa fecha la pantalla no lo pedía). Los papeles (proveedor, factura, pedimento, contenedor,
    fecha) son los mismos para toda la lista y sus cargas comparten la marca `remesas.lista`.
    El proveedor de la hoja DOCUMENTO se elige solo si ya está en la lista de proveedores.
  · **La carga dice lo que está haciendo.** Con `?progreso=1` (lo usa la pantalla),
    `POST /remesas/lista` contesta POR PARTES, un JSON por renglón (NDJSON): `hilo`, `bultos`
    (cuántos van), `hilo_listo`, `paso` y al final `fin` (el resultado) o `error`. Lleva
    `X-Accel-Buffering: no` para que nginx no junte las partes. La pantalla lo pinta en un panel:
    qué hace, barra de bultos, cada hilo (en espera / cargando / listo) y los segundos; con un
    "Cargando…" mudo parecía que no pasaba nada (lo dijo el usuario). Sin el parámetro contesta un
    JSON normal (lo usa `e2e-carga-lista.js`). `InventarioService.cargarLista` lee los renglones
    conforme llegan (`partialText`).
  · **Los bultos se insertan de 100 en 100** (`TANDA_BULTOS` en `remesas/model.js`, para las dos
    cargas): uno por uno, la lista real de 718 bultos tardó un minuto contra la base del servidor.
  · Impiden cargar, sin omitir el renglón en silencio (en cientos de bultos uno saltado no se
    nota): código repetido o ya registrado, sin color o calibre, neto vacío, y un código guardado
    como NÚMERO más corto que los demás (perdió los ceros de la izquierda). Las NOTA del proveedor
    y un bruto − tara que no da el neto solo avisan.
- **Un hilo SIN PRECIO no se vende** (2026-10-03). `producto_variantes.precio` es NOT NULL, así que
  "sin precio" se guarda como $0 (igual que `stock_minimo = 0` es "no configurado"). `_cotizar`
  rechaza la línea cuyo precio final sea ≤ 0 (422 `SIN_PRECIO`) ANTES de tocar existencias, y el
  POS ni la deja agregar ("Sin precio" en la búsqueda). Al ponerle `precio_kg` con
  `PUT /productos/:id`, sus presentaciones en $0 lo toman (y sus conos calculados): es la ÚNICA
  excepción a "cambiarlo no propaga". El listado trae `sin_precio` y `primera_carga`: Productos
  marca "Falta precio · Llegó en la carga de…" con el botón "Poner precio" y el filtro
  `?falta=precio`, y la campana y Hoy dicen "N hilos no tienen precio" (un aviso, con los primeros
  nombres) a quien ve `ver:catalogo`.
- **Cada carga tiene su reporte en PDF** (`remesas/reportes.js`, armado con `utils/pdf.js` sobre
  `pdfkit`). En pantalla, la remesa se llama **"Carga de producto"** (lo pidió el usuario el
  2026-10-03) y la pantalla **"Surtir inventario"** (antes "Recibir remesa"; 2026-10-06; la ruta
  sigue siendo `/admin/remesas` y el permiso `ver:remesa`). Dos reportes:
  · `GET /remesas/:id/pdf` — el comprobante de UNA carga: hilo, almacén, quién, cada bulto con su
    código, peso real, lote y conos. La pantalla lo BAJA SOLO al confirmar la carga (en Recibir
    remesa y en Presentaciones) y se vuelve a sacar cuando sea desde el historial.
  · `GET /remesas/producto/:id/pdf?desde=&hasta=` — todas las cargas de un hilo: cuánto entró, a
    qué almacén y cómo están hoy esos bultos. Botón "Reporte de entradas" en Presentaciones.
  Se arman AL MOMENTO con la base; no se guardan archivos: la carga conserva su total y cada bulto
  su `remesa_id`, así que el comprobante sale igual que el día de la carga. Solo la columna "Hoy"
  (en existencia / vendido / bajado a conos) cambia, y por eso se rotula así. Solo cuentan las
  CARGAS: un traspaso o un desarme no son mercancía nueva. Los pide quien tenga `ver:remesa`,
  `ver:catalogo` o `ver:inventario` (`requirePermisoAlguno`); el precio de compra solo sale con
  `hacer:ver_costos`. Las fuentes estándar del PDF traen acentos y ñ pero NO flechas ni "≈".
  El frontend los pide con `HttpClient` (blob) —un `<a href>` no manda el token— y los guarda con
  `shared/descargar.ts`.
- **Se cobra por el peso del bulto, no por el nominal.** Los bultos pesan distinto entre sí
  (10.750 a 19.800 kg contra un nominal de 19.094). Al escanear un código en el mostrador,
  resuélvelo con `GET /variantes/resolver/:codigo`: devuelve `{ variante, bulto }`, donde `bulto`
  trae su `peso_kg` real, su lote y sus conos, o viene en `null` si el código es el principal de
  la presentación. Un 404 significa "no es un código" y el POS cae a la búsqueda por texto.
  Dos bultos distintos SUMAN sus pesos; el mismo bulto escaneado dos veces NO se cobra doble
  (es una pieza física única).
  **En una línea con bultos, los kilos SON los de los bultos** (2026-10-06): la caja no deja
  teclearlos y cada bulto lleva su ✕ para quitar el que no se lleva (`pos.ts → quitarBulto`). Y
  el servidor rechaza una línea cuyos bultos pesen más de lo que se cobra (422
  `BULTOS_EXCEDEN_CANTIDAD`, con el peso guardado del bulto): bajar los kilos dejaba "vendido" un
  bulto que seguía en la bodega. Más kilos que bultos sí se puede (el resto va a granel).
- **Conos y venta por kilo en la caja: se PESAN** (2026-10-06: "la gente solo dice 'vengo por 6
  conos de tal color'; se pesan y se calcula con los precios por kilo"). La búsqueda del punto de
  venta va POR HILO (paquete y conos juntos) y dice qué hay en el almacén de la caja
  (`GET /variantes?almacen_id=` → `aqui: { cantidad, paquetes }`); un hilo con paquete y sin
  conos avisa que se bajan en Inventario. "Por kilo" (paquete) y "Agregar conos" abren la
  BÁSCULA (`pos/pesar-modal.ts`): se teclea lo que pesaron y, si son conos, cuántos eran; NUNCA
  se agrega 1 kg a ciegas. Se cobra y descuenta en KILOS; los conos van en `items[].piezas` y se
  guardan en `pedido_detalle.piezas` (informativo, como `piezas_generadas`; migración
  `2026-10_piezas_en_venta.sql`), y el detalle del pedido dice "· 6 conos". El paquete COMPLETO
  se sigue vendiendo escaneando su código. Teclear el color ("rojo") resuelve al código de la
  presentación (el código es el nombre): eso ahora BUSCA en vez de agregar.
  `e2e-venta-conos.js` recorre bajar a conos → buscar → vender 6 conos.
- **El pedido guarda de qué bultos salió.** `pedido_detalle_bultos` liga cada línea con los bultos
  que se entregaron. El código, el peso y el lote se **congelan** ahí, igual que
  `pedido_detalle.precio_unitario`: `variante_codigo_id` es la referencia viva y queda en `NULL`
  si el bulto se borra, pero el pedido sigue diciendo qué se entregó. Se insertan dentro de la
  MISMA transacción de la venta. Es opcional: la tienda en línea y las ventas a granel no mandan
  bultos.
- **Un bulto se consume UNA vez.** `variante_codigos.estado` es `disponible` | `apartado` |
  `vendido` | `desarmado`, con `consumido_en`, `consumido_tipo` (`'pedido'`|`'conversion'`) y
  `consumido_id`. **`apartado`** (2026-10-06, migración `2026-10_bulto_apartado.sql`) = ligado a un
  PEDIDO o un APARTADO que no se ha entregado: sigue en la tienda (el saldo lo incluye, el
  `consumido_en` va en NULL) pero ya tiene dueño, así que la caja, el desarme y el envío lo
  rechazan como a uno vendido (el 409 dice para qué pedido y de quién). Pasa a `vendido` al
  entregarse; cancelar lo regresa a `disponible`; reactivar lo vuelve a apartar.
  Vender o desarmar exige que esté `disponible` y bloquea la fila con `SELECT … FOR UPDATE` dentro
  de la transacción: si no lo está, 409 `BULTO_NO_DISPONIBLE` y se revierte la operación completa.
  Cancelar o devolver el pedido regresa sus bultos a `disponible`; reactivarlo retoma solo los que
  nadie más haya tomado. Un bulto `desarmado` no vuelve: ya son conos.
  El bulto SABE en qué almacén está (`variante_codigos.almacen_id`): lo pone la remesa que lo trajo
  y lo cambia el traspaso. Los capturados a mano quedan en NULL.
  **EXCEPCIÓN: para BAJAR CONOS el paquete tiene que estar en esa tienda** (usuario, 2026-10-06:
  "si no, que mande una alerta de que el paquete en esa sucursal no existe"). Si el sistema lo
  tiene en otro almacén, 409 `PAQUETE_EN_OTRA_SUCURSAL` (dice dónde está); si viene en camino en un
  traspaso enviado sin recibir, 409 `PAQUETE_EN_CAMINO`. Sin almacén (capturado a mano) se
  permite. La vista previa del desarme trae `bulto.almacen_id/almacen/en_tienda/en_camino_folio`
  y el modal avisa en un recuadro rojo y apaga "Bajar a mostrador". La VENTA sigue sin validarlo.
  **La ubicación del bulto es APROXIMADA; los saldos por almacén son la verdad.** Se escanea al
  vender, al desarmar y al SURTIR (desde el 2026-10-06), pero nada se escanea al recibir ni al
  acomodar en la bodega, y los capturados a mano no tienen almacén. Por eso vender o desarmar **no valida** que el
  bulto estuviera en ese almacén —validarlo bloquearía ventas legítimas— y en cambio le CORRIGE la
  ubicación al almacén donde se escaneó. No añadas esa validación.
- **El pago en efectivo se asienta por lo COBRADO, no por el billete.** Una venta de $432 pagada
  con $500 deja un `pagos` de $432: `crearPedido` resta el cambio del efectivo antes de
  insertarlo y devuelve `cambio` en la respuesta (no se guarda: no es dinero de la tienda). Si
  quedara el billete, al cancelar `_efectivoDelPedido` devolvería $500 y el corte saldría con un
  faltante que nadie se llevó. Solo el efectivo da cambio: un pago con tarjeta o transferencia
  por encima de lo que se cobra es 422 `PAGO_EXCEDE_TOTAL`. La caja manda lo recibido y pinta el
  cambio que le devuelve el servidor.
- **Cancelar o devolver repone el inventario.** `cambiarEstado` es transaccional: al pasar a
  `cancelado`/`devuelto` la mercancía regresa al almacén DE DONDE SALIÓ (`pedidos.almacen_id`, el
  de la caja que vendió o el de la tienda en línea) con su `movimientos_inventario` de entrada
  (`referencia_tipo='pedido'`, motivo "Cancelación de …" o "Devolución de …"). Reactivar el pedido
  vuelve a descontar y EXIGE existencias: si no alcanzan, 409 `STOCK_INSUFICIENTE` y el pedido no
  se mueve. Se compara el estado anterior contra el nuevo, así que cancelar dos veces no repone
  doble, y el `UPDATE` del estado va al final para que nada quede a medias.
  **Reactivar saca lo que REGRESÓ, no lo vendido** (2026-10-06): con una devolución a medias (se
  vendieron 10 kg, regresaron 4) sacar 10 dejaba el inventario 6 kg abajo. Se calcula con el
  propio kardex del pedido (lo vendido + el neto de sus movimientos de ese hilo). El 409
  `DEVUELTO_EN_OTRA_PRESENTACION` compara contra los hilos que SE VENDIERON en el pedido: antes
  comparaba cada línea contra las demás y una venta de dos hilos cancelada no se reactivaba.
- **Cancelar una venta de mostrador saca el efectivo de la caja.** Se inserta `movimientos_caja`
  tipo `'devolucion'`, que el corte ya resta (`SIGNO_CAJA` en `caja/model.js`), y los `pagos` pasan
  a `'reembolsado'`. Solo el EFECTIVO: la tarjeta la reembolsa el banco. Al reactivar entra como
  `'ingreso'` —no como `'venta'`— para no contarlo dos veces en los reportes.
  El turno YA CERRADO no se toca: si la venta fue en un turno cerrado, el dinero sale del turno
  ABIERTO de la misma caja. Si no hay ninguno abierto, 409 `CAJA_CERRADA` y NO se cancela nada
  (ni inventario, ni bultos, ni estado): todo o nada.
  El movimiento del dinero va ANTES de tocar inventario, para que ese 409 no deje nada movido.
- **Retiros e ingresos de efectivo** van por `POST /caja/sesiones/:id/movimientos` (modal "Sacar
  o meter efectivo" de la pantalla Caja, `caja/movimiento-caja-modal.ts`; pide
  `hacer:mover_efectivo`). El retiro EXIGE
  motivo —dinero que sale sin explicación es un faltante que nadie aclara— y no puede sacar más
  de lo que debería haber en el cajón (409 `EFECTIVO_INSUFICIENTE`, con la sesión bloqueada).
- **La mercancía puede regresar en OTRA presentación.** Se entrega el paquete y el cliente devuelve
  los conos: `PATCH /pedidos/:id/estado` acepta `devoluciones: [{detalle_id, variante_id, cantidad}]`
  y repone en la presentación indicada, no en la vendida. La equivalencia la calcula el backend
  (`paquete→conos: kg / peso_kg × piezas_por_origen`, y al revés) y el GET del pedido la expone en
  `detalle[].alternativas_devolucion` para que la pantalla no haga aritmética. Solo se admiten
  presentaciones emparentadas (el cono de ese paquete o su paquete de origen); otra da 422
  `PRESENTACION_INCOMPATIBLE`. La cantidad es editable —pueden regresar 10 conos de 12— y el motivo
  del kardex asienta el equivalente esperado. Un pedido devuelto así NO se puede reactivar
  (409 `DEVUELTO_EN_OTRA_PRESENTACION`): la mercancía ya no está como se vendió.
- **Bajar conos a mostrador = escanear el paquete.** Está en Admin → Inventario, en el botón
  "Bajar conos a mostrador" del encabezado, que abre un modal (`inventario/desarme-modal.ts`). El
  botón se muestra SIEMPRE: no lo condiciones a que existan conos, porque es justo donde nacen (ya
  pasó una vez y quedó invisible). El flujo vive en Inventario, no en el catálogo ni en el POS
  —se valoró ponerlo en el POS, donde de hecho ocurre, y el usuario decidió dejarlo en
  Inventario—. El modal NO se cierra al confirmar: bajar varios paquetes seguidos es lo normal. `GET /inventario/desarmes/previa/:codigo` dice qué trae el bulto (paquete, kilos
  reales, lote, cuántos conos rinde, si el cono ya existe y en qué almacenes hay existencias) sin
  mover nada. `POST /inventario/desarmes` acepta SOLO `codigo_bulto`: resuelve el paquete, toma los
  kilos y los conos del bulto, y CREA la presentación de cono si el producto no la tiene. No hay
  que configurar nada antes de bajar el primer paquete.
  **SOLO EN TIENDAS y donde está el paquete** (usuario, 2026-10-06: "solo se pueden bajar conos en
  tiendas, en bodega eso no se puede"). El almacén debe tener mostrador (`es_punto_venta`; si no,
  422 `SOLO_EN_TIENDA`) y el origen es el MISMO que el destino (422 `DESARME_EN_OTRO_ALMACEN`): un
  paquete que está en la bodega primero va a la tienda por Surtir sucursal —el traspaso es el único
  camino entre almacenes— y allá se abre. El modal ofrece solo tiendas ("Se abre en la tienda") y
  propone la tienda donde ESTÁ el paquete escaneado; si no está ahí, no se abre (ver la excepción
  en "Un bulto se consume UNA vez"). (`e2e-bajar-a-mostrador.js`, que no corre
  sin las listas de `muestras/`, todavía baja de bodega a mostrador: al recuperarla, ajustarla.)
- **El DESTARE lo captura la tienda, POR CONO.** Al enconar, el hilo pesa más porque cada cono lleva
  su tubo. El modal pide "Destare por cono" (lo que pesa UN tubo, en kg, con los gramos al lado; se
  recuerda en `localStorage['destare_por_cono']`) y `POST /inventario/desarmes` acepta
  `destare_por_cono_kg`, que el servidor multiplica por los conos que salen ("eso se le suma a cada
  cono", 2026-10-06); `destare_kg` (el total) se sigue aceptando. El total se guarda en
  `variante_conversiones.destare_kg` —NO en la presentación, porque cada desarme puede llevar uno
  distinto—. `kg_consumidos` no cambia: del paquete sale su peso real y eso
  es lo que se descuenta. El destare solo dice cuánto pesó el resultado
  (`kg_enconados = kg_consumidos + destare_kg`) y queda escrito en las dos patas del kardex.
  NO cambia el precio del cono (que es el del paquete, por kilo) ni su `peso_kg`, que queda como
  referencia de cuánto pesa un cono.
- **El desarme respeta lo que rinde el bulto.** `POST /inventario/desarmes` acepta `kg` (kilos
  reales) y `conos` (piezas reales), y guarda `codigo_bulto` para dejar el rastro. Sin esos datos
  usa los nominales. Importa porque hay bultos que rinden menos —el de 10.75 kg del archivo real
  da 7 conos y no 12, y ASÍ VIENE DE FÁBRICA, no es un defecto—: darles de alta los nominales
  infla el inventario de conos con piezas que no existen. La carga NO avisa de esos bultos: es
  normal y avisarlo sería ruido.
- **El movimiento manual solo sirve para AJUSTE y MERMA.** Está en el botón "Ajuste / merma" de
  Inventario (`inventario/movimiento-modal.ts`). El **ajuste SOBREESCRIBE** el saldo (la cantidad
  que se teclea es el saldo contado, `delta = contado − actual`) y la **merma RESTA**; los dos
  rechazan dejarlo en negativo (409 `STOCK_INSUFICIENTE`). Se captura en KILOS, pero como la tienda
  cuenta en PAQUETES el modal ofrece un selector kg/paquetes para las presentaciones `paquete`:
  traduce con el peso promedio REAL de los bultos que hay en ESE almacén
  (`GET /inventario/equivalencia-paquetes`, avisa si cayó al nominal) y al backend le manda siempre
  kilos. Ofrece esos dos tipos y nada más: `entrada` la hace la remesa, `devolucion` la cancelación del pedido y `salida` la
  reemplazó el traspaso. El **ajuste** es la ÚNICA forma de cuadrar el sistema con un conteo
  físico —no lo quites— y la **merma** de dar de baja hilo dañado. El endpoint
  `POST /inventario/movimientos` sigue aceptando los cinco tipos.
- **Un solo camino para mover mercancía entre almacenes: el traspaso.** Se eliminó
  `POST /inventario/transferencias` (y su tarjeta en Inventario) porque movía kilos sin mover los
  bultos, y eso descuadraba su ubicación. No lo reintroduzcas: todo va por
  `POST /inventario/traspasos`.
- **El traspaso tiene TRES pasos: solicitado → en tránsito → recibido.** Ya NO es inmediato; lo
  cambió el usuario el 2026-07-28 ("necesito un status de en tránsito y así pendiente de envío, y
  que el responsable acepte de que recibió y que diga qué recibió, para que no haya problemas").
  · `POST /inventario/traspasos` **solicita**: valida contra lo DISPONIBLE (existencia − apartado) y
    APARTA en el origen (`inventario.cantidad_reservada`). No mueve nada ni toca el kardex.
    **Se pide en PAQUETES** (lo cambió el usuario el 2026-10-06: "las nuevas solicitudes de
    traspaso se van a hacer con paquetes mostrando el aproximado en kilos"; del 2026-07-28 a esa
    fecha se pedía en kilos). La pantalla manda `items[].paquetes` y al lado dice MÁS O MENOS
    cuántos kilos son: **paquetes × el peso PROMEDIO real de los paquetes que hay en el origen**
    (kilos de sus bultos ÷ cuántos son, sin redondear el promedio antes de multiplicar: con el
    promedio a 3 decimales no dejaba pedir TODOS). Es un promedio y NO "los N más antiguos"
    porque quien surte agarra los paquetes de ese color y calibre que tenga a la mano, no los
    busca por fecha (usuario, 2026-10-06). Eso mismo aparta el servidor
    (`inventario/model.js → pesoPorPaquete`) y la pantalla lo calcula con `kg_en_bultos` y
    `paquetes` de `GET /inventario/equivalencia-paquetes`: si cambias uno, cambia el otro. Sin
    paquetes con peso en el origen se usa el peso del catálogo y se marca `peso_estimado`.
    El servidor sigue aceptando `cantidad` en kilos (la usa una presentación `simple`).
  · `POST /inventario/traspasos/:id/enviar` **envía**: elige los bultos AHÍ (no al solicitar, porque
    el mostrador pudo vender alguno), revalida, descuenta del origen con su movimiento, libera el
    apartado y manda los bultos al destino. La mercancía queda en camino: **salió del origen y
    todavía no entra al destino**, a propósito.
    **Al SURTIR se ESCANEAN los paquetes que suben a la camioneta, y SIN ESCANEAR NO SE ENVÍA**
    (usuario, 2026-10-06: "aquí cada cosa que sale se escanea, no se puede enviar si no se
    escanea"). Sin ningún código, 422 `SIN_ESCANEAR`. No hay salida "sin escanear": no la
    reintroduzcas sin preguntar. "Enviar" abre `traspasos/envio-modal.ts`, con el lector; manda
    `codigos` (y `notas`) y de cada hilo sale el peso REAL de sus paquetes escaneados y ESOS
    pasan a la sucursal.
    **SE MANDA LO QUE HAY** (usuario, 2026-10-06: "si pido 20 bultos de negro 1/30 y solo tengo
    15, que se envíen esos y nada más, y que en notas se ponga que era lo único que tenía"; NO
    quiere cancelar y pedir de nuevo). Un hilo con menos paquetes sale con los escaneados; uno
    sin NINGUNO no sale: su línea queda en 0 (`no_salio`), suelta su apartado y no toca saldo ni
    kardex. Lo PEDIDO queda en `traspaso_detalle.paquetes_solicitados` / `cantidad_solicitada`
    (`paquetes` y `cantidad` se reescriben con lo que salió; la `cantidad` admite 0 desde la
    migración `2026-10_traspaso_lo_que_salio.sql`). Lo que no salió completo se anota SOLO en
    `traspasos.envio_notas` ("BLACK 2/30: salieron 2 de 3; OPTIK 2/30: no salió (se pidieron
    2). Era lo único que había.") y después va lo que escriba quien surte. La pantalla lo
    enseña en Pendientes ("2 de 3 paq", "no salió (no había)", "Al enviar: …"), en el historial
    y en el acuse. Al recibir, la línea en 0 no entra ni cuenta como faltante; al cancelar en
    camino, no regresa nada de ella. Pueden salir más de los pedidos ("21 paq, se pidieron 20")
    y el apartado se libera completo. El servidor rechaza, sin mover nada: código repetido (`BULTO_REPETIDO`),
    desconocido (`CODIGO_DESCONOCIDO`), el de la presentación (`CODIGO_NO_ES_PAQUETE`), de un
    hilo que no está en el traspaso (`BULTO_NO_ES_DEL_TRASPASO`), vendido o desarmado (409
    `BULTO_NO_DISPONIBLE`) o sin peso (`BULTO_SIN_PESO`). NO valida que el paquete estuviera en
    el origen (la misma regla que al vender): le corrige la ubicación. El modal revisa cada
    código al leerlo para avisar en el momento, y vacía el campo DIRECTO en el DOM: con
    `eventCoalescing` el último dígito y el Enter del lector caen en el mismo ciclo y
    `codigo = ''` no se veía (el siguiente escaneo se pegaba al anterior).
    Lo apartado al pedir (el aproximado) solo sirve para reservar: al enviar se libera completo y
    sale lo escaneado. Una solicitud vieja en kilos también sale escaneando. Los bultos que
    viajaron quedan en `traspaso_bultos` (detalle + bulto).
  · `POST /inventario/traspasos/:id/recibir` **recibe**: lo firma cualquiera del staff y queda su
    nombre y la hora. Acepta `recibido: [{detalle_id, paquetes|cantidad}]` para declarar lo que de
    verdad llegó; entra al destino solo eso y el faltante se asienta como **merma** con el folio
    (422 `RECIBE_MAS_DE_LO_ENVIADO` si dice que llegó más).
  · `POST /inventario/traspasos/:id/cancelar`: si estaba solicitado libera el apartado; si iba en
    tránsito la mercancía REGRESA al origen y vuelven SOLO los bultos de ese envío (los de
    `traspaso_bultos`). Antes regresaban todos los del hilo que hubiera en la sucursal, también
    los de traspasos anteriores ya recibidos (2026-10-06). Un envío anterior a esa tabla no tiene
    renglones y sus bultos se quedan donde están. Un recibido ya no se cancela (409): eso se
    corrige con un traspaso de vuelta.
  **El apartado DEL TRASPASO es BLANDO.** Se ve en inventario y otra solicitud no puede pedir lo ya
  apartado, pero la venta de mostrador NO lo respeta —el cliente que está enfrente manda— así que
  `cantidad_reservada` puede quedar por encima de `cantidad`; el envío lo detecta y avisa. No metas
  esa reserva en la validación de la venta sin decidirlo con el usuario.
  **El apartado de un CLIENTE sí se respeta** (corregido el 2026-10-02, a petición del usuario):
  la venta y otro apartado validan contra la existencia MENOS lo apartado por clientes
  (`pedidos/model.js → _apartadoEnAlmacen`, sumado de los pedidos `apartado` sin descontar). Se
  calcula de los pedidos y NO de `cantidad_reservada` precisamente porque esa columna mezcla las
  dos reservas. Antes la caja vendía lo apartado y el día que venían por él no había con qué.
  La pantalla del traspaso compara contra lo LIBRE (`equivalencia-paquetes` devuelve
  `kg_apartado` y `kg_libre`), que es contra lo que valida el servidor.
  **Solo PAQUETES.** Un cono da 422 `NO_SE_TRASPASAN_CONOS`: a la sucursal se le manda el paquete
  cerrado y allá se desarma.
- **Matriz → sucursales, por PAQUETES.** El almacén marcado con `almacenes.es_matriz` (único, como
  `es_tienda_linea`) es el que surte a las demás.
  Las líneas de `paquete` se capturan en PAQUETES —los paquetes son cerrados y nadie los pesa— y se
  apartan y descuentan a N × el peso PROMEDIO REAL de los paquetes del origen (no el nominal: los
  bultos van de 10.75 a 19.80 kg). Al PEDIR los kilos son un APROXIMADO a propósito: quien surte
  agarra los que tenga a la mano, no busca uno concreto en una bodega con cientos (decisión del
  usuario). Al ENVIAR se escanean esos paquetes y sale su peso real (ver el traspaso, arriba). Para traducir kilos a paquetes está
  `GET /inventario/equivalencia-paquetes`, que usa el peso PROMEDIO REAL, no el nominal. Es todo-o-nada: si una línea no alcanza, se revierte el traspaso
  completo. En la sucursal se desarma después con `POST /inventario/desarmes`.
- **El checkout en línea NO cobra.** El cliente elige transferencia o efectivo en tienda y el
  pedido nace `pendiente`, con un `pagos` en estado `'pendiente'` por el total —la INTENCIÓN de
  pago, no dinero cobrado—. Un administrador lo confirma al ver el depósito o al cobrar en el
  mostrador. No hay pasarela y no se guardan datos de tarjeta. La tabla `metodos_pago` trae
  además tarjeta, PayPal y Mercado Pago: la tienda en línea **no los ofrece** (el filtro está
  en `metodosOfrecidos`, en `checkout.ts`), porque ofrecerlos sería prometer algo que no existe.
- **Dar por pagado un pedido en línea cobra su pago.** De `pendiente` a `pagado` (o más adelante)
  en `canal='tienda_linea'`, sus `pagos` pendientes pasan a `completado` en la misma
  transacción. Antes el pedido decía "pagado" y su pago seguía "pendiente". OJO: ese efectivo NO
  entra a ningún turno de caja; está por decidir si se cobra por la caja.
- **Al cliente NUNCA se le cree el dinero.** En `canal='tienda_linea'` creado por un CLIENTE, el
  backend ignora `costo_envio` (lo lee de `configuracion.envio_costo_fijo`) y DESCARTA `pagos`.
  Sin eso, cualquiera puede mandar `costo_envio: 0` o `pagos: [{monto: total}]` y quedar pagado
  sin depositar un peso. El STAFF sí puede fijar el envío a mano, para un pedido por teléfono.
  La bandera es `esCliente`, que el controller deduce del token, no del body.
- **La entrega vive en `pedidos.metodo_entrega`** (`recoger` | `envio`), no se deduce de si el
  pedido trae dirección: lo que se le prometió al cliente tiene que quedar escrito. `recoger` no
  cuesta envío y fuerza `direccion_envio_id = NULL`; `envio` exige dirección (422
  `FALTA_DIRECCION`) y cobra la tarifa fija. El mostrador siempre es `recoger`.
  La dirección se valida SIEMPRE contra el cliente del pedido, venga de donde venga (422
  `DIRECCION_INVALIDA`): un id ajeno filtrado por el panel también mandaría el paquete a la casa
  equivocada.
- **El total lo calcula `_cotizar`, y lo calcula UNA sola vez.** `pedidos/model.js → _cotizar`
  arma detalle, impuestos, cupón, envío y total; `crearPedido` la llama con `bloquear: true`
  (FOR UPDATE sobre inventario, bultos y cupón) y `POST /pedidos/cotizacion` con `false`, que
  solo consulta y no debe frenar a la caja. Si algún día hay que tocar el cálculo, se toca ahí y
  las dos rutas quedan iguales. **El checkout jamás suma nada por su cuenta:** pide la cotización
  cada vez que cambia la entrega, la dirección o el cupón, y pinta lo que le devuelvan.
- **La configuración de la tienda es una tabla clave/valor** (`configuracion`), no variables de
  entorno: el administrador la cambia desde Admin → Configuración sin reiniciar nada. `PUT` solo
  escribe claves que YA existen —la lista la define la migración— así que un typo no crea una
  clave fantasma que nadie lee. `publica` marca las que puede leer un visitante sin sesión.
  Agregar una opción es una línea de SQL: la pantalla la dibuja sola, agrupada por el prefijo de
  la clave.
  **Las CUENTAS DE BANCO para transferencias NO son claves (2026-10-06):** pueden ser varias y viven
  en `cuentas_bancarias` (banco, titular, `numero_cuenta`, `clabe`, `activa`), con su tarjeta y su
  modal en Configuración. La CLABE se valida con su dígito de control (`configuracion/cuentas.js`) y
  no se repite; se pide número de cuenta o CLABE. El público (`GET /configuracion`) recibe solo las
  activas en `cuentas_bancarias`. Las claves viejas `transferencia_*` se borraron en la migración.
- **El comprobante del depósito lo sube el PERSONAL, y da el pedido por pagado.** El cliente
  manda la captura por fuera (WhatsApp, correo) y el administrador la sube en el detalle del
  pedido. Es UN PASO —decisión del usuario el 2026-09-05—: el `pagos` queda `'completado'` y el
  `pedidos` pasa a `'pagado'` en la misma transacción, sin estado intermedio "por validar".
  Quitar la captura NO descobra el pedido: el dinero entró, y para deshacerlo está el cambio
  de estado.
  **La captura se pega a un pago, y NUNCA crea uno de más.** Por orden: el que ya tiene captura
  (se reemplaza), el que espera cobro, una transferencia ya cobrada (solo se le adjunta), y si no
  hay ninguno se crea uno por lo que FALTA, no por el total. Si ya está cobrado completo y sin
  transferencia: 409 `PEDIDO_YA_PAGADO`. A un apartado: 409 `APARTADO_USA_ABONOS`, porque se paga
  con abonos. Antes, en una venta en efectivo o en un apartado se creaba otro pago por el total y
  el apartado quedaba "liquidado" con dinero que no entró. La pantalla solo muestra la sección
  donde aplica (`aceptaComprobante()` en `pedido-detalle.ts`).
  El archivo vive en DISCO (`backend/uploads/comprobantes`, ruta en `env.uploadsDir`), no en la
  base: un dump pesa 90 KB y meterle imágenes lo volvería inmanejable. En `pagos` queda solo su
  nombre. **El `rsync --delete` del despliegue borraría esa carpeta**, así que está excluida en
  `deploy/deploy.sh`; si cambias la ruta, revisa esa exclusión.
  Se sirve por endpoint AUTENTICADO (`GET /pedidos/:id/comprobante`), nunca con `express.static`:
  un comprobante bancario no puede quedar accesible con solo adivinar la URL. Por eso el frontend
  lo baja con `HttpClient` y lo pinta con un object URL —un `<img src>` no manda el token— y lo
  libera al salir.
  El tipo se valida por los PRIMEROS BYTES del archivo (`utils/archivos.js`), no por la extensión
  ni por el `Content-Type`: los dos los pone quien sube. Se aceptan JPG, PNG, WEBP y PDF.
  El nombre en disco se GENERA (hex aleatorio + extensión); el original solo se guarda para
  mostrarlo, así un nombre con `../` no puede escribir fuera de la carpeta.
- **El detalle del pedido dice QUÉ hilo se vendió, no solo el color.** `pedido_detalle.descripcion`
  congela lo vendido ("BLANCO · Paquete") pero con eso no se atiende una duda: el mismo color en
  dos calibres son dos productos. El GET del pedido trae además `calibre`, `material`, `linea`,
  `tipo_presentacion` y `peso_kg`, leídos VIVOS del catálogo —no congelados— y los bultos con su
  código de barras, su peso real y su lote. El precio y la cantidad sí siguen congelados.
- **El cliente es un EXPEDIENTE, no solo una cuenta.** `clientes` tiene dos vidas en la misma
  fila: la CUENTA de la tienda en línea (correo + `contrasena_hash`, se registra el cliente solo) y
  el EXPEDIENTE de mostrador (lo captura el personal, sin cuenta: `correo` y `contrasena_hash` en
  NULL). Un cliente de años puede abrirse cuenta después y no hay que duplicarlo.
  · **`cliente_desde` NO es `creado_en`.** Los clientes de años se capturan hoy pero compran desde
    antes: `creado_en` dice cuándo entró al sistema, `cliente_desde` cuándo empezó a comprar. Sin
    esa distinción, el día que se capturen todos parecería que la tienda estrenó clientela.
  · **Se busca por el APODO y por el teléfono**, no por el nombre completo: `nombre_comercial`
    guarda como le dicen de verdad ("Doña Mari") y es con lo que el mostrador lo encuentra.
    `GET /clientes/buscar?q=` mira nombre, apodo, código y los dos teléfonos, y exige 2 letras.
  · `clientes.tipo_cliente_id` es su lista de precios habitual: al elegirlo en el POS se aplica
    sola, así nadie le cobra precio público a un cliente de mayoreo por descuido.
  · `direccion` es un campo libre y NO reemplaza a `direcciones`: esa tabla es para los envíos de
    la tienda en línea, con receptor y código postal.
  · Lo CANCELADO y lo DEVUELTO no cuenta en su historial ni en sus totales. Preguntar "cuánto me
    ha comprado" e incluir lo que devolvió sería mentir.
  · **Qué colores compra más se agrupa por `producto_id`, nunca por nombre:** el mismo color en dos
    calibres son dos productos y agruparlos por nombre los sumaría en un renglón que no existe.
- **El crédito es un LIBRO de movimientos, no un saldo.** `credito_movimientos` guarda cada cargo y
  cada abono; el saldo es su suma, igual que el kardex y los movimientos de caja. **No hay campo
  `saldo` en `clientes`** a propósito: un valor desnormalizado se descuadra en cuanto una
  transacción falla a medias, y entonces el sistema dice que alguien debe algo que no debe. La
  vista `v_clientes_saldo` lo resuelve de una consulta.
  El signo lo define el TIPO (como `SIGNO_CAJA`): `cargo` sube la deuda, `abono` la baja, y
  `ajuste` la corrige —es el único que admite monto negativo, para condonar o arreglar una captura
  mala, y EXIGE motivo: un saldo que cambia sin explicación no se puede aclarar después—.
- **Vender a crédito: `POST /pedidos` acepta `a_credito`** (cuánto se lleva a deber). Admite venta
  MIXTA —paga algo hoy y el resto queda a deber, que es como ocurre en el mostrador— y exige
  `cliente_id`: no se le fía a un desconocido (422 `FALTA_CLIENTE`).
  · **Lo fiado NO entra al cajón.** `efectivo = total − noEfectivo − aCredito`. Sin restarlo, el
    corte esperaría en el cajón un dinero que el cliente no dejó.
  · La venta con parte a crédito queda **`pendiente`**, no `pagado`: la mercancía salió pero el
    dinero no ha entrado.
  · El límite se valida con la fila del cliente bloqueada (`FOR UPDATE`), así dos cajas cobrando a
    la vez no pueden pasarlo entre las dos (409 `CREDITO_INSUFICIENTE`, con el mensaje diciendo
    cuánto le queda).
  · El cargo se inserta DENTRO de la transacción de la venta: si la venta se revierte, la deuda no
    queda.
- **Cancelar una venta a crédito quita la deuda, sin borrar el rastro.** `ajustarCreditoPorPedido`
  inserta un `ajuste` negativo con el folio en el motivo; el cargo original se queda. El libro de
  crédito no se borra, se corrige, igual que el kardex. Es IDEMPOTENTE —revierte el NETO de los
  movimientos del pedido— así que cancelar dos veces no perdona la deuda dos veces. Reactivar la
  repone.
- **Lo FIADO se da por PAGADO solo, al abonar** (2026-10-06: "pedí a crédito, lo aboné y la venta
  seguía pendiente"). El abono va a la CUENTA, pero `clientes/model.js → aplicarAbonos` lo reparte
  de lo MÁS ANTIGUO a lo más nuevo (FIFO) entre lo que debe cada venta, y
  `liquidarVentasACredito` pasa a `'pagado'` la venta 'pendiente' que queda cubierta. Corre en la
  misma transacción del abono, del ajuste (condonar), de la venta fiada (un saldo a favor la paga
  al nacer) y de cancelar o reactivar una fiada (los abonos se vuelven a repartir: cancelar la más
  antigua paga la siguiente). El detalle del pedido trae `credito_pagado`/`credito_por_pagar` y la
  lista calcula "Falta" con lo mismo; la pantalla dice "ya está pagado" o "debe $X".
  · **A mano no se marca pagada una fiada que se debe** (409 `VENTA_FIADA_SIN_PAGAR`) ni se
    regresa a pendiente una ya pagada con abonos (409 `VENTA_FIADA_PAGADA`); el selector del
    detalle ni las ofrece. Antes el pedido decía "pagado" con la cuenta debiéndolo.
  · **Saldo NEGATIVO = a su favor**: cancelar una fiada que ya se había abonado deja lo abonado a
    favor del cliente (el expediente dice "A su favor"), y paga lo próximo que se le fíe.
  · `scripts/liquidar-ventas-credito.js --base X [--confirmar]` pone al día las que ya estaban
    pagadas y AVISA (sin tocarlas) de las marcadas pagadas a mano que todavía se deben.
- **Un abono en EFECTIVO entra a la caja.** Se inserta `movimientos_caja` tipo `'ingreso'` —no
  `'venta'`, para que no lo cuenten los reportes de ventas: cobrar una deuda vieja no es vender
  hoy—. Con el turno cerrado se rechaza (409 `FALTA_SESION_CAJA`) ANTES de tocar el saldo: si no,
  habría dinero en el cajón que ninguna venta explica y el cajero aparecería con un sobrante
  inexplicable. Por transferencia no toca caja.
  Cobrar más de lo que se debe se rechaza (422 `ABONO_EXCEDE_DEUDA`): un saldo negativo se leería
  como crédito a favor, y no es eso.
- **EL COSTO, SOLO ADMINISTRACIÓN Y CONTABILIDAD (2026-10-06).** "Costo por kilo — solo
  administrador y contabilidad" (usuario, al pedir Surtir inventario). El interruptor
  `SE_LLEVA_COSTO` (en `backend/src/modules/permisos/service.js` y su gemelo
  `frontend/src/app/core/costos.ts`) volvió a `true`, y «Ver costos y márgenes»
  (`hacer:ver_costos`) lo tienen el administrador (siempre) y el puesto **Contabilidad**, creado
  por la migración `2026-10_carga_proveedor_costo.sql` (con Surtir inventario, Reportes, Cómo va
  el negocio, Inventario y Kardex); al GERENTE se le quitó. Con eso vuelven, solo para ellos: el
  costo por kilo al cargar y en el historial (y el aviso "Sin costo"), el costo promedio en
  Presentaciones, la ganancia y el margen del tablero, las herramientas de costo del asistente y
  el precio de compra en los PDF. A los demás el servidor ni se los manda, y si mandan un costo
  contestan 403.
  Del 2026-10-03 al 2026-10-06 estuvo APAGADO ("no necesito lo que me costó"): entonces no lo
  veía nadie, ni el administrador; con `false` se vuelve a ese estado.
- **SURTIR INVENTARIO: los datos de la carga (2026-10-06).** Cada carga guarda, además, de quién
  llegó y con qué papeles: `remesas.proveedor_id` (de la tabla `proveedores`, que se eligen de una
  LISTA y se dan de alta ahí mismo con su nombre: `GET/POST /proveedores`, el nombre no se repite,
  409 `PROVEEDOR_REPETIDO`), `factura`, `pedimento`, `contenedor` y `fecha_ingreso` (el día que
  llegó; sin ella, el de la captura; no puede ser futura). Todo es opcional al cargar y se completa
  o corrige después desde el historial (botón "Datos", `PATCH /remesas/:id`; con `toda_la_lista`
  va a todas las cargas del mismo archivo, menos el costo, que es de cada hilo). El bloque de
  captura es UNO (`remesas/datos-carga.ts`) en los tres cargadores y en la corrección. Los PDF los
  imprimen.
  **Poner o corregir el costo DESPUÉS rehace el promedio** (`remesas/model.js →
  recalcularCosto`): recorre las cargas del hilo en orden y aplica el promedio ponderado móvil con
  los kilos que había JUSTO ANTES de cada una (la suma de su kardex hasta ese movimiento). Da lo
  mismo que si el costo se hubiera capturado a tiempo; la venta ya hecha conserva su costo
  congelado.
- **El COSTO se captura en la remesa y se promedia.** `remesas.costo_kg` guarda a cómo salió el
  kilo en esa compra, y con eso se recalcula `producto_variantes.costo` por **promedio ponderado
  móvil**: `(kg_previos × costo_previo + kg_remesa × costo_remesa) ÷ (kg_previos + kg_remesa)`.
  Es el método estándar y el que se porta bien aquí: cuando el proveedor sube el precio, el margen
  lo refleja poco a poco —conforme se vende el hilo caro mezclado con el barato— en vez de dar un
  salto el día de la compra. Los "kg previos" son los de TODOS los almacenes: el costo es del hilo,
  no del sitio donde está guardado.
  **Se reutilizó `producto_variantes.costo`, que ya existía** (el CRUD ya la leía, pero estaba en
  NULL y nada la consumía). Crear un `costo_kg` al lado habría duplicado el dato, el mismo error
  que este proyecto ya cometió con el peso del producto. `costo_actualizado_en` dice de cuándo es:
  un costo viejo con remesas encima significa que alguien carga mercancía sin poner el precio de
  compra, y ese margen no es de fiar.
  Una remesa SIN `costo_kg` entra igual y **no toca** el costo del hilo.
- **El costo se CONGELA en la venta.** `pedido_detalle.costo_unitario` guarda a cómo salió ese kilo
  ese día, igual que `precio_unitario`. Sin congelarlo, el margen de una venta de enero cambiaría
  cada vez que llega una remesa, y un histórico que se mueve no sirve para decidir. **NULL significa
  "no se sabía el costo"**, y el reporte de margen lo dice y lo cuenta aparte en vez de suponer
  cero: un margen del 100% por un costo faltante llevaría a decisiones equivocadas.
  El costo NO viaja en la cotización del checkout: es información interna del negocio.
- **El tablero contesta cuatro preguntas** (`modules/analisis`, `GET /analisis/tablero`), todas
  calculadas de la base al momento — no hay tablas de resumen que mantener ni proceso nocturno.
  Llegan JUNTAS en ese único endpoint: tuvieron una ruta cada una, pero la pantalla siempre pide
  las cuatro y el asistente lee los models directo, así que se quitaron el 2026-10-01 por no
  tener quién las llamara.
  · **Cobranza** (`cartera`): quién debe, por antigüedad. Los días se miden desde el
    ÚLTIMO MOVIMIENTO de la cuenta, no desde el cargo: quien abonó la semana pasada está pagando, y
    tratarlo como moroso llevaría a cobrarle a quien no toca.
  · **Clientes enfriados** (ya NO se pintan en el tablero: viven en Clientes → Dejaron de venir;
    el endpoint los sigue mandando y el asistente los usa): exige **2 compras mínimo** —quien vino
    una vez hace meses no es un cliente perdido, es alguien que pasó— y compara los días sin venir
    contra SU PROPIO ritmo (`veces_su_ritmo`), no contra un número fijo.
  · **Hilo muerto** ("Hilo parado" en la pantalla): existencias sin venderse. **Lo ve todo el que
    abre el tablero**: sin «Ver costos» llega valorado a PRECIO DE VENTA (`conCosto: false` en
    `analisis/model.js → hiloMuerto`), que no expone nada. Lo pidió el usuario el 2026-10-03 al
    dejar de llevar el costo: "el hilo parado sí me sirve, calcúlalo con el precio de venta y en
    base al hilo que tenemos y que se ha vendido". Por eso cada renglón dice cuánto hay, cuánto
    vale (a qué precio por kg), cuánto se ha VENDIDO desde siempre y la fecha de su última venta. Viene un renglón por PRESENTACIÓN (el cono va
    aparte, rotulado "· cono"), pero `num_hilos` y `nunca_vendidos` cuentan HILOS
    (`producto_id`): contar renglones decía "15 hilos" donde había 10. Se valora AL COSTO cuando
    se conoce y al precio de venta cuando no, marcándolo con `valorado_a` para no presentar una
    cifra como si fuera lo que no es. Un hilo que NUNCA se vendió cuenta desde que entró: es el caso
    más importante y filtrarlo por "última venta" lo dejaría fuera justo por no tener ninguna.
  · **Margen**: sobre la VENTA, no sobre el costo, que es como se lee un margen
    comercial. Solo cuenta las líneas con costo capturado.
  El hilo muerto y el margen son **solo administradores y gerentes**: exponen costos. El menú se
  lo muestra a los DOS (antes solo al administrador, aunque el servidor dejaba entrar al gerente).
  · **Las cifras se suman sobre TODO, la lista se recorta.** El `limite` ya no va en el SQL:
    "cuántos se fueron" decía 15 cuando eran 40. Y el umbral del hilo parado es `dias_parado`,
    no `dias`: compartían el parámetro con "días sin venir" y moverlo cambiaba el otro bloque.
- **`v_movimiento_hilo` mira solo las salidas por VENTA** (`referencia_tipo='pedido'`, cantidad
  negativa). Un traspaso o un desarme mueven la mercancía de sitio pero no la venden, y contarlos
  haría parecer vivo un hilo que nadie compra.
- **Apartado = venta que todavía no se entrega.** Es un `pedidos` con estado `'apartado'`, NO una
  tabla aparte: mismo cliente, mismo detalle, mismos pagos, mismos precios congelados — una tabla
  `apartados` duplicaría todo eso, igual que habría pasado separando la tienda en línea del
  mostrador. Anticipo LIBRE y SIN fecha límite (decisión del usuario el 2026-09-10).
  · **RESERVA en vez de descontar.** La mercancía sigue en la bodega pero sale de lo DISPONIBLE
    (`inventario.cantidad_reservada`), así el mostrador no se la vende a otro. Y **NO se toca el
    kardex**: apuntar una salida que no ocurrió descuadraría el inventario contra el conteo físico.
  · **`pedidos.inventario_descontado`** dice si el pedido ya descontó. Existe por esto: sin ese
    dato, cancelar un apartado repondría mercancía que nunca salió y quedarían existencias
    fantasma. Un apartado nace en 0 y pasa a 1 al entregarse.
  · **Al cajón entra solo el ANTICIPO**, no el total: el resto no lo ha pagado nadie todavía.
  · Los abonos van por `POST /pedidos/:id/abonos` y entran a la caja como `'ingreso'`, NO como
    `'venta'`: la venta ya se contó el día que se apartó, y contarla otra vez duplicaría las
    ventas del día. En efectivo exigen turno abierto, validado ANTES de asentar el pago.
  · **`POST /pedidos/:id/entregar` es donde por fin se descuenta.** Exige estar LIQUIDADO (409
    `APARTADO_NO_LIQUIDADO`): entregar a medio pagar sería regalar mercancía, y si la tienda
    quiere hacerlo lo que corresponde es fiar el resto, que sí deja constancia de la deuda.
    Y EXIGE existencias: entre que se apartó y hoy pudo haber una merma o un traspaso.
  · **Cancelar libera la reserva y no inventa nada.** El anticipo se le devuelve (sale del turno
    como `'devolucion'`, igual que al cancelar una venta). Reactivar vuelve a apartar, y exige que
    la mercancía siga disponible.
  · **El cambio de estado genérico no tiene atajos para un apartado** (`_validarCaminoApartado`
    en `pedidos/model.js`, sobre `inventario_descontado = 0`). Vigente, solo se cancela: pasarlo a
    `pagado`/`entregado` desde `PATCH /estado` lo dejaba entregado SIN descontar y apartado para
    siempre (409 `APARTADO_SE_ENTREGA`), y devolverlo no aplica porque nunca salió (409
    `APARTADO_NO_ENTREGADO`). Cancelado, se reactiva SOLO como `'apartado'` (409
    `REACTIVAR_COMO_APARTADO`): como `pendiente` quedaba vivo sin reservar ni descontar. Y una venta
    que ya descontó no puede volverse apartado (409 `NO_SE_PUEDE_APARTAR`). El selector del
    detalle del pedido solo ofrece lo que se puede, y el panel de cancelación de un apartado dice
    que se libera lo apartado, no que "regresa al inventario".
  · Apartar Y fiar a la vez se rechaza (422 `APARTADO_A_CREDITO`): fiar es entregar sin cobrar,
    apartar es cobrar sin entregar. Y no se aparta desde la tienda en línea (422
    `APARTADO_SOLO_MOSTRADOR`).
  · `v_apartados` da los vigentes con lo abonado, lo pendiente y el `pct_pagado`, para poder
    ordenar por "los que están a punto de liquidar" — que son los que hay que llamar.
  · **Sin cliente no se aparta** (422 `APARTADO_SIN_CLIENTE`): si no se sabe a quién se le
    guarda, dentro de un mes nadie podrá reclamar esa mercancía ni identificarla.
  · En la pantalla, los LIQUIDADOS van en su propio bloque arriba, en verde: a ellos no se les
    cobra, se les ENTREGA. Con el orden "los que ya casi liquidan" quedaban primeros justo los
    que no hay que llamar, y su barra de $0 era ruido en una gráfica de "cuánto falta por
    cobrar". Son dos acciones distintas y la pantalla las separa.
  · El ticket del POS distingue los tres casos —venta, apartado y entrega a crédito—: decir
    "Venta" y "Cambio $0.00" en un apartado sería mentir sobre lo que acaba de pasar.
- **PEDIDOS de clientes (encargos) y VENTAS (2026-10-06).** "Eso que se llama Pedidos en realidad
  son ventas… hacer un apartado para realizar pedidos; tenemos chofer que los lleva, o hacen el
  pedido por WhatsApp y después van por él; no es un apartado, es una venta" (usuario). La pantalla
  de siempre (`/admin/ventas`, permiso `ver:pedidos`, rotulado "Ventas") es TODO lo vendido; los
  enlaces viejos `/admin/pedidos/:id` redirigen a `/admin/ventas/:id`. **Pedidos** (`/admin/pedidos`,
  permiso nuevo `ver:encargos`, `encargos/encargos.ts`) son los encargos.
  · Es un `pedidos` con `encargo = 1` (la venta es unificada, como el apartado), migración
    `2026-10_pedidos_encargo.sql`: `entrega_direccion` (texto libre, a dónde lo lleva el chofer),
    `entrega_para` (DATE) y el estado nuevo `listo`.
  · Se TOMA en el punto de venta (modo "Pedido" junto a Cobrar/Fiar/Apartar): exige cliente (422
    `PEDIDO_SIN_CLIENTE`), "Pasa por él" (`recoger`) o "Lo lleva el chofer" (`envio`, exige
    `entrega_direccion` al tomarlo —la cotización no—, `costo_envio` opcional que fija el
    mostrador), para cuándo, notas y lo que deja pagado (entra al turno como 'venta'). No se fía al
    tomarlo (422 `PEDIDO_A_CREDITO`). La mercancía se APARTA (`inventario_descontado = 0`,
    `cantidad_reservada`) igual que el apartado, y la venta del mostrador la respeta
    (`_apartadoEnAlmacen` suma TODO lo vendido sin entregar).
  · Pasos: `en_preparacion` (Por preparar) → `listo` → `enviado` (En camino, SOLO si va con el
    chofer: 409 `PEDIDO_SE_RECOGE`) por `PATCH /estado` (`_validarCaminoEncargo`). Se ENTREGA con
    `POST /pedidos/:id/entregar` (`entregar-modal.ts`), que cobra lo que falte (`pagos`, solo el
    efectivo da cambio, entra al turno `sesion_caja_id` como 'ingreso') y/o lo fía (`a_credito`,
    pide `hacer:fiar`; queda 'pendiente' como cualquier fiada); ahí descuenta del inventario. Sin
    cubrir lo que falta, 409 `PAGO_INSUFICIENTE`. Pasarlo a entregado a mano: 409
    `PEDIDO_SE_ENTREGA`. Se puede abonar antes (`POST /:id/abonos`, p.ej. transferencia).
  · Cancelado libera lo apartado y devuelve el efectivo; se reactiva SOLO como "por preparar" (409
    `REACTIVAR_COMO_PEDIDO`). Entregado ya no vuelve a los pasos (409 `PEDIDO_YA_ENTREGADO`).
  · `GET /pedidos/encargos?estado&q` (lista con qué lleva, cuánto falta, `a_favor` y conteo por
    paso; cada hilo trae `escaneados`). `etiquetaEstado(estado, canal, encargo)` dice "Por
    preparar / Listo / En camino". `e2e-pedidos-encargo.js` recorre todo (61).
  · **Queda LISTO al PREPARARLO, y sin prepararlo no se entrega** (2026-10-06: "cuando se pone el
    pedido se tienen que escanear los paquetes o pesar los conos que pidió, para corroborar").
    Al TOMARLO se pone lo que pidió aunque sea aproximado ("6 conos ≈ 9 kg"). `POST
    /pedidos/:id/preparar` (`ver:encargos`, `encargos/preparar-modal.ts`, botón "Preparar" /
    "Corregir") recibe `lineas: [{detalle_id, codigos?, cantidad?, piezas?}]`: los PAQUETES se
    escanean (sin ninguno, 422 `SIN_ESCANEAR`) y la línea queda con la suma de sus pesos reales;
    los conos y lo que va por kilo se pesan (`cantidad`). La línea se recalcula con su precio
    CONGELADO, lo apartado (`cantidad_reservada`) sigue a los kilos (si sube, tiene que haber:
    409 `STOCK_INSUFICIENTE`), los paquetes quedan ligados (`pedido_detalle_bultos`) y en
    `apartado` —los que ya no van se sueltan— y el total se rehace (`subtotal − descuento +
    impuestos + envío`). Valida como el envío: código desconocido, de presentación, de otro hilo
    (`BULTO_DE_OTRO_HILO`), repetido, tomado o sin peso; NO valida en qué almacén estaba. Se
    puede volver a preparar en "por preparar" o "listo" (409 `NO_SE_PREPARA` en camino o
    entregado). Marcarlo listo o en camino a mano desde "por preparar": 409 `PEDIDO_SE_PREPARA`;
    entregarlo sin preparar: 409 `PEDIDO_SIN_PREPARAR`.
  · **Si pesó MENOS de lo que dejó pagado**, la lista dice "A favor $X" y al ENTREGARLO se le
    devuelve en efectivo: `movimientos_caja` 'devolucion' del turno que se elija (sin turno, 409
    `FALTA_SESION_CAJA`; mandar pagos o crédito, 422 `NADA_POR_COBRAR`) y sus `pagos` se reducen
    a lo cobrado (primero el efectivo; uno devuelto completo se borra), para que cancelar
    después no devuelva la diferencia otra vez. La respuesta trae `devuelto`.
  · El POS manda los paquetes escaneados también al tomar un PEDIDO o un APARTADO: quedan
    `apartado` y pasan a `vendido` al entregarlos (antes no se mandaban y al entregar quedaban
    "disponibles": el conteo de paquetes no cuadraba).
  · Pendiente: el PEDIDO AL PROVEEDOR (compras), que el usuario también llama "pedido".
- **Precio de lista en el producto.** `productos.precio_kg` es el precio del HILO por unidad de
  peso, que es como lo piensa la tienda. NO es el que se cobra —ese sigue siendo
  `producto_variantes.precio`, y es el que congela el pedido— pero las presentaciones que se creen
  sin precio lo HEREDAN (`variantes/service.js → _exigirPrecio`). Cambiarlo NO propaga a las
  presentaciones ya creadas, a propósito. La prelación al vender no cambia.
- **El COLOR es el producto.** Cada color es un producto propio (CARAMEL, HUESO, rojo, azul), no un
  atributo de la presentación. NO existe `producto_variantes.color_id` ni la tabla `colores`: se
  eliminaron (estaban vacías), igual que se hizo con `materiales`, para que "color" signifique una
  sola cosa. Tampoco existe `GET /opciones/colores`. En el panel, la columna "Nombre" del producto
  se rotula **Color** y `categorias` se rotula **Material**.
- **Un producto = UNA presentación (paquete), creada SOLA.** Al dar de alta el producto se crea su
  presentación sin preguntar nada: tipo `paquete` (o `simple` si no es multipresentación), SKU y
  `codigo_barras` = el nombre del producto normalizado (`variantes/service.js → skuDesdeNombre`,
  con contador si ya está ocupado), precio heredado de `productos.precio_kg`, y **el peso en NULL**.
  El peso NO se exige al crear —todavía no ha llegado mercancía— lo completa la primera carga del
  Excel con el promedio real de los bultos, y el DESARME sí lo exige (422 `PAQUETE_SIN_PESO`).
  Las remesas siguientes le agregan BULTOS, no presentaciones. Cuando el producto ya tiene la suya, el formulario de alta manual
  desaparece.
  **Sin precio por kilo la presentación no se puede crear** (no tiene de dónde heredarlo): el
  producto se guarda igual y la respuesta trae `presentacion_pendiente` con el motivo, para que la
  pantalla lo diga en vez de presumir que se creó. En cuanto un `PUT` le pone precio y no tiene
  presentación, se crea sola. El formulario lo exige al crear y trae "Multipresentación" marcada.
  **Precio público y peso se cambian con `PATCH /variantes/:id`** (precio, oferta, peso y activo;
  solo administrador y gerente; botón "Precio y peso" en Presentaciones). Es angosto a propósito:
  el SKU, el tipo y el origen del cono no se tocan con existencias y ventas encima. Si es el
  paquete, los conos de precio calculado lo siguen. El CONO es la única variante extra y vive en su propia sección ("Conos para
  mostrador"), que solo aparece si ya hay paquete: existe únicamente para poder desarmar y vender
  por pieza. Su SKU se deriva del paquete (`<PAQUETE>-CONO`).
- **Un producto solo se elimina si NO tiene nada cargado** (regla del usuario, 2026-10-03).
  Borrar el producto se lleva en CASCADA sus presentaciones, y con ellas sus bultos y renglones de
  inventario, sin rastro (antes un hilo con un bulto capturado a mano se borraba así). Ahora
  `DELETE /productos/:id` revisa, en la misma transacción y con el producto bloqueado
  (`productos/model.js → eliminarSiVacio`), que ninguna de sus presentaciones tenga bultos, cargas,
  existencias o apartado, movimientos de kardex, ventas, traspasos, desarmes, órdenes de compra ni
  carritos; si tiene algo, 409 `PRODUCTO_CON_MOVIMIENTOS` diciendo qué tiene. La presentación
  VACÍA que se crea sola al dar de alta NO cuenta: un producto recién capturado sí se borra.
  `GET /productos/:id/eliminacion` responde `{ se_puede, motivos, mensaje }` y el modal apaga
  "Eliminar" y explica por qué junto a "Activo" (que es lo que se hace en su lugar).
- **El formulario de producto NO captura presentaciones.** Ahí solo van los datos del hilo
  (nombre, material, línea, calibre, precio por kilo, banderas). **"Se vende por" va FIJO en
  kilogramo y deshabilitado** (decisión del usuario, 2026-10-03): se sigue mandando al guardar
  (`getRawValue`), pero ya no se puede elegir tonelada por descuido. **El impuesto está OCULTO**
  (comentado en la plantilla, no borrado): al editar se conserva el que tenga y al crear va sin
  impuesto. Los SKU y las imágenes viven en
  `/admin/productos/:id/presentaciones`, y la idea es llenarlos con el vaciado masivo del Excel.
- **Precio por tipo de cliente.** `producto_variantes.precio` es el PRECIO PÚBLICO. Los demás tipos
  llevan su precio propio en `variante_precios` (variante + tipo). Al vender, la prelación es:
  precio del tipo > `precio_oferta` > público. `pedidos.tipo_cliente_id` deja constancia de con qué
  lista se cerró, y `pedido_detalle.precio_unitario` lo congela. El tipo marcado `es_publico` NO
  guarda filas en `variante_precios`: su precio vive en la variante y no se duplica.
  `GET /productos/:id` trae `variantes[].precios` SOLO al personal (token `usuario`; la ruta es
  pública y un visitante no ve a cuánto se vende a mayoreo). La pantalla de presentaciones recarga
  con esa ruta: sin los precios ahí, los guardaba y los volvía a enseñar vacíos (2026-10-06,
  `e2e-precios-lista.js`).
- **Banderas del producto.** `multipresentacion` habilita las presentaciones paquete/cono: sin ella
  el backend rechaza crear variantes que no sean `simple`. `por_lotes` habilita capturar
  `producto_variantes.lote`, que es solo una ETIQUETA de remesa: el inventario NO se separa por
  lote, el saldo sigue siendo uno por variante y almacén.
- **Paquete → conos, TODO por kilo.** El producto entra en paquetes y se desarma en conos para
  bajarlos a mostrador. **El cono NO se vende por pieza: es el mismo hilo, solo enconado, y se
  cobra al MISMO precio por kilo del paquete.** Su inventario va en KILOS.
  `producto_variantes.tipo_presentacion` (`paquete` | `cono` | `simple`) dice la presentación, pero
  las tres se llevan en kilos. Un cono apunta a su paquete con `origen_variante_id` +
  `piezas_por_origen`; con `modo_precio='calculado'` su precio ES el del paquete y se resincroniza
  al cambiarlo. `piezas_por_origen` y `variante_conversiones.piezas_generadas` son INFORMATIVOS
  —cuántos conos son— no la unidad de inventario. La ganancia de enconar viene del DESTARE: el tubo
  pesa, así que de 18.5 kg salen 19 kg vendibles. Desarmar va SIEMPRE por `POST /inventario/desarmes`, nunca moviendo existencias a
  mano: es una transacción que descuenta kilos, da entrada a piezas y deja las dos patas en el
  kardex con `referencia_tipo='conversion'` y el mismo folio. El desarme acepta un `kg` opcional
  para consumir el peso REAL del bulto cuando no coincide con el nominal; los conos generados no
  cambian.
- **Todo se vende por peso, SIN excepciones.** `unidades_medida` solo contiene gramo, kilogramo y
  tonelada; no hay unidades de conteo. El precio de la variante es *por esa unidad* y las cantidades
  son decimales (`DECIMAL(12,3)`, o sea hasta 1 gramo de resolución). Cualquier campo de captura de
  cantidad debe usar `step="0.001"`, nunca enteros, y mostrar la unidad junto al número.
  Los conos TAMBIÉN van en kilos: `unidad_venta` devuelve `kg` para las tres presentaciones.
- **Campos calculados** de dinero (`subtotal`, `impuestos`, `total`) se calculan en el backend, no se
  confían al cliente.
- Los estados válidos están en los `CHECK` del esquema; respétalos como enums en el código.
- **Nómina semanal.** La semana va de **domingo a sábado** y se paga ese mismo sábado. La comisión
  se calcula sobre la **venta neta** (`pedidos.subtotal - pedidos.descuento`, sin IVA ni envío) de
  los pedidos donde el empleado es el vendedor (`pedidos.usuario_id`), excluyendo cancelados y
  devueltos. Al calcular un recibo, `ventas_netas` y `porcentaje_comision` se **congelan** en
  `nomina_recibos` para que el histórico no cambie si después se edita la configuración del
  empleado. Un periodo `pagado` es inmutable: no se recalcula ni se reabre.
  **Por días, horario, horas extra y vacaciones (2026-10-06, decisiones del usuario):**
  · Cada empleado tiene su HORARIO día por día (`nomina_horarios`, 0 = domingo; día sin
    renglón = descanso) y `comida_min`. El DÍA vale sueldo semanal ÷ días que trabaja; la HORA,
    sueldo semanal ÷ horas de su semana (menos la comida). Sin horario, el recibo paga la
    semana completa como antes.
  · El recibo paga `dias_trabajados` × día (+ `pago_vacaciones`) y congela días, salario
    diario y valor de la hora. Las FALTAS (días del horario que no trabajó ni fueron
    vacaciones) se conservan al recalcular. Se calcula sueldo × días ÷ días del horario, así
    6 de 6 dan el sueldo exacto.
  · HORAS EXTRA: se captura el día y la hora real de salida (o entrada); cuentan contra su
    horario de ESE día —en su descanso, todo— y se pagan AL DOBLE, siempre (no doble/triple).
    Llegar tarde o salir temprano no resta. Un renglón por día.
  · VACACIONES por ley (art. 76 LFT 2023: 12, 14… 20, luego +2 cada 5 años), SIN prima, desde
    `fecha_ingreso`, por rango de fechas (`nomina_vacaciones`); gastan solo días de trabajo de
    su horario y se pagan como días normales. Cuentan contra el año (aniversario a aniversario)
    donde EMPIEZAN. No antes del primer año, no más de las que quedan, no encimadas y no en una
    semana PAGADA. Registrarlas o quitarlas recalcula sola la semana en borrador.
  · Las cuentas viven en `modules/nomina/jornada.js` (con `jornada.test.js`) y su gemela de
    vista previa en `features/admin/nomina/jornada.ts`: si cambia una regla, cambian las dos.
- **Material, línea y calibre.** El hilo se clasifica por tres cosas independientes:
  · **Material** → tabla `categorias`, rotulada "Material" en el panel (acrilán, viscosa). El
    nombre de la tabla se conservó para no arrastrar un rename por todo el catálogo público.
  · **Línea** de procedencia → tabla `lineas` (turco, nacional, chino), `productos.linea_id`.
    Antes era `marcas`/`marca_id`.
  · **Calibre** → `productos.grosor_calibre`, pero los valores válidos los define el material en
    `categorias.calibres` (lista separada por coma: acrilán `1/30,2/30`, viscosa `2/48`). El alta
    de producto solo ofrece los del material elegido, así que agregar un calibre nuevo es editar
    el material, no tocar código.
  No existe `materiales` ni `productos.material_id`: se eliminaron para que "material" signifique
  una sola cosa.
  **Un color en dos calibres son DOS productos**, porque el calibre vive en el producto: "MARINO
  OSCURO 1/30" y "MARINO OSCURO 2/30" se capturan por separado, cada uno con su `precio_kg` (que
  suele cambiar con el calibre) y sus propias presentaciones. Se valoró mover el calibre a la
  presentación y se decidió no hacerlo: el vaciado masivo resuelve "la presentación en kilos del
  producto" y con dos calibres bajo el mismo producto eso sería ambiguo. El listado del panel
  muestra Calibre y Línea como columnas para distinguirlos.
- **Los materiales van por NOMBRE.** El campo "Orden" se quitó de la pantalla y del modal de
  Materiales (lo pidió el usuario el 2026-10-03) y `GET /categorias` ordena solo por nombre: si el
  `ORDER BY` siguiera usando `orden`, un valor viejo que nadie ve decidiría el lugar. La columna
  `categorias.orden` sigue en la base (al crear queda en 0; al editar no se toca).
- **Categorías planas.** `categorias` NO tiene `padre_id`: la jerarquía se eliminó porque el
  catálogo filtra por `productos.categoria_id` exacto, sin recursión, así que una categoría padre
  nunca mostraba los productos de sus hijas. Es una lista simple.
- **Sin slugs.** `productos` y `categorias` NO tienen columna `slug`: se eliminó porque nada la
  consumía (la tienda en línea navega por id) y su `UNIQUE` impedía capturar dos productos con el
  mismo nombre. Si algún día se quieren URLs legibles hay que reintroducirla y regenerarla desde
  el nombre.
- **Un solo peso, y vive en la variante.** `producto_variantes.peso_kg` es EL peso: dice cuánto
  pesa un paquete y con eso el backend calcula el precio del cono y el desarme. `productos` NO
  tiene peso ni longitud: los tuvo y se eliminaron porque duplicaban el dato y se confundían con
  las existencias. Todos los pesos y cantidades son `DECIMAL(12,3)` en KILOS —
  `producto_variantes.peso_kg`, `inventario.cantidad`, `traspaso_detalle.cantidad`— sin
  conversiones en el camino: lo que se teclea es lo que se guarda.
- **Fechas `DATE` de MySQL.** `mysql2` las devuelve como objeto `Date`, no como string. Selecciónalas
  con `DATE_FORMAT(col, '%Y-%m-%d')` cuando el valor se use para armar rangos o se envíe al frontend.
- **TODO va en la HORA DE LA TIENDA: México centro, UTC-6** (2026-10-06). El MariaDB del servidor
  corre en UTC y las conexiones no decían su hora: NOW()/CURDATE()/CURRENT_TIMESTAMP guardaban UTC
  y después de las 18:00 el sistema creía que era mañana (una venta de las 23:09 no salía en
  Pedidos; todas las horas se veían 6 h adelantadas). Ahora `config/db.js` hace `SET time_zone =
  DB_TIMEZONE` ('-06:00') en cada conexión y `config/env.js` pone `TZ` (America/Mexico_City) a
  Node. Las fechas se siguen leyendo como texto (`dateStrings`). Para "hoy" en JS usa
  `utils/fechas.js → hoyLocal()`, nunca `toISOString().slice(0,10)`. Lo ya guardado en UTC lo
  corrigió `scripts/ajustar-hora.js` (una vez por base, marca `_zona_horaria`; con la muestra
  sembrada solo recorre lo posterior a la siembra). Un script con su propia conexión (las E2E)
  habla en UTC: no compares horas suyas con las del sistema.

- **El asistente con IA no ve la base y no escribe SQL.** `modules/asistente` le da al
  modelo un catálogo de **herramientas** —14 consultas ya programadas, TODAS de solo
  lectura— y él elige cuál necesita; el servidor la ejecuta y le devuelve el resultado, y
  la IA solo redacta la respuesta. **No dejes que genere consultas:** una consulta generada
  puede leer lo que no debe (sueldos, `contrasena_hash`) o bloquear tablas en plena venta,
  y un modelo se equivoca en un JOIN y devuelve una cifra que parece buena. El asistente
  **no puede cambiar nada**: no registra ventas, no mueve inventario, no perdona deudas.
  · Las herramientas llaman a los **services**, no a los modelos: los services ya
    normalizan los rangos de fecha (`hastaExcl` es exclusivo) y son los mismos que
    alimentan los reportes, así que el asistente y las pantallas nunca se contradicen.
  · **El rol sale del TOKEN**, no del body. Las que exponen costo o margen llevan
    `soloJefes: true` y a un cajero ni se le ofrecen; si el modelo insiste, la ejecución
    las niega con un motivo.
  · Una herramienta que falla o no existe devuelve `{ error: '…' }` **en texto**, no lanza:
    así el modelo puede corregir en vez de tumbar la conversación.
  · El bucle tiene tope (`IA_MAX_VUELTAS`) y el historial se recorta a 6 turnos: mandar
    toda la charla en cada pregunta la encarece sin mejorarla.
  · Al agregar una herramienta, **agrégala también a `scripts/e2e-asistente.js`**, que las
    corre TODAS contra la base. Cuatro de ellas nacieron llamando a funciones que no
    existen y eso solo se ve ejecutándolas: si no, el error aparece cuando el modelo la
    pide, o sea en producción.
  · El proveedor vive aislado en `proveedor.js`, y ESO YA SE COBRÓ: el 2026-09-10 se
    cambió de DeepSeek a **Google Gemini** (capa gratuita) y el bucle de herramientas no
    se tocó ni una línea. Se le habla por el endpoint **compatible con OpenAI** de Google
    (`/v1beta/openai/chat/completions`), que acepta el mismo `messages` + `tools`.
    Cambiar de proveedor es cambiar `IA_BASE_URL` y `IA_MODELO`; las pruebas lo sustituyen
    por un doble y no gastan cuota. La llave **nunca** se manda al cliente ni a los logs.
  · **`IA_MODELO` usa el alias `-latest`** a propósito: los nombres fijos se RETIRAN
    (`gemini-2.5-flash-lite` ya contesta 404 "no longer available to new projects") y el
    asistente dejaría de funcionar sin que nadie tocara nada. Un 404 se traduce a
    `IA_MODELO_NO_EXISTE`, que dice qué variable cambiar.
  · **El error de Gemini viene dentro de un ARREGLO** (`[{ error: {...} }]`), no como
    objeto suelto: leerlo con `cuerpo.error.message` daba `undefined` y todos los fallos
    se veían como un "HTTP 429" sin explicación. `leerError` normaliza las dos formas.
  · **La cuota agotada NO es lo mismo que no tener saldo.** `IA_SIN_CUOTA` (429 /
    `RESOURCE_EXHAUSTED`) se repone sola, así que el mensaje dice "espera unos minutos";
    `IA_SIN_SALDO` (proveedor de paga) dice "recarga". Decirle "recarga" a quien está en
    la capa gratuita lo mandaría a pagar algo que no necesita.
  · **El 503 pasajero se reintenta UNA vez.** Gemini contesta "high demand" de cuando en
    cuando —pasó en la primera prueba que se le hizo— y es algo que se arregla solo. Solo
    se reintenta lo pasajero: una llave mala o la cuota agotada no se arreglan insistiendo.
- **Un cliente registrado desde la caja nace SIN crédito.** El alta rápida del POS pide
  nombre, apodo y teléfono y nada más, con `limite_credito: 0`, así que el cobro sale
  completo. Es la decisión del usuario para un cliente nuevo: no se le fía todavía. La
  campana avisa a los 15 días (`nuevos_sin_credito`) para que se decida si se le abre
  crédito o se le sigue cobrando todo.

- **Permisos por PUESTO (2026-10).** Los asigna el administrador en Admin → Permisos ("los
  permisos los asigna el administrador"). Viven en `permisos` + `rol_permisos` (migración
  `2026-10_permisos_por_puesto.sql`, solo datos) y el catálogo con nombre y ayuda está en
  `modules/permisos/catalogo.js`: una clave nueva se agrega en LOS DOS lados.
  · `ver:*` es una pantalla: la cuida la guarda de la ruta (`core/guards/permiso.guard.ts`) y el
    menú (`core/navegacion.ts`) solo enseña lo que se puede abrir. `hacer:*` es una acción y la
    valida el SERVIDOR (`requirePermiso` en `middlewares/auth.js`, 403 `SIN_PERMISO`); esconder
    el botón (`AuthService.puede`) es solo para no ofrecer lo que va a fallar.
  · El ADMINISTRADOR no se configura: lo puede todo siempre (por código, no por filas), para que
    nunca se quede nadie sin poder entrar a Permisos. Permisos es solo suyo.
  · **Solo un administrador da —o toca— el puesto de administrador** (403 `SOLO_ADMINISTRADOR` en
    `usuarios/controller.js`): Personal se puede abrir a otros puestos, y sin esto quien lo
    tuviera podría darse el puesto que lo puede todo. Vale también como puesto EXTRA: no se da
    como "también trabaja como", y a quien lo tiene de extra solo lo edita un administrador.
  · Los permisos de cada puesto se cachean en memoria y se invalidan al guardar: lo que valida el
    servidor cambia en el acto; el menú, cuando la persona vuelve a entrar.
  · **Una persona puede tener VARIOS puestos (2026-10-06**: "que una persona pueda tener más de 2
    puestos; ese cambio va en Personal"). `usuarios.rol_id` es el PRINCIPAL (el de nómina y el que
    sale junto a su nombre) y `usuario_roles` guarda los DEMÁS, sin repetir el principal (migración
    `2026-10_varios_puestos.sql`). Puede la SUMA de lo de todos, y si alguno es administrador, lo
    puede todo. En Personal: "Puesto principal" + casillas "También trabaja como"; la API manda y
    recibe `otros_roles`. **Los puestos se leen de la BASE por el id del token**
    (`permisos/service.js → puestosDe`, en caché que se tira al guardar a alguien), NO del `rol` del
    token: dar o quitar un puesto vale en el acto, y quien queda "Sin acceso" ya no pasa ninguna
    guarda aunque su token siga vivo. Por eso `esAdmin` es async y `requireRol` mira todos los
    puestos. Una E2E que firme un token tiene que usar el id de alguien que DE VERDAD tenga ese
    puesto (`e2e-surtir-inventario.js` firmaba como almacenista con el id del administrador).
    `scripts/e2e-varios-puestos.js` lo prueba (28 comprobaciones).
  · `scripts/e2e-permisos.js` prueba cada guarda sin escribir nada (ids que no existen o cuerpos
    inválidos: 403 al que no tiene, 404/422 al que sí).
- **El COSTO no sale en las rutas públicas ni a quien no tiene `hacer:ver_costos`.** (Hoy lo
  tienen el administrador y Contabilidad, ver arriba. El historial de cargas también lo quita.)
  `GET /productos/:id`, `GET /variantes` y el escáner de la caja traen presentaciones con `costo`;
  `permisos/service.js → sinCostosSiNoVe` lo quita si quien pregunta no puede verlo (con token
  opcional: sin sesión, no). Antes el precio de compra de cada hilo lo veía cualquiera. El tablero
  (`GET /analisis/tablero`) tampoco calcula hilo parado ni margen para quien no los puede ver.
- **La tienda en línea está APAGADA (2026-10)**: "el cliente por ahora no la quiere; no la elimines,
  solo coméntala". Se COMENTÓ, no se borró: las rutas de `tienda` y `registro` en `app.routes.ts`,
  registro/login/perfil de clientes en `clientes/routes.js`, el reintento como cliente en
  `AuthService.login`, y en las pantallas lo que solo le servía a ella (filtro "En línea", marca
  `es_tienda_linea`, tarifa de envío, "Destacado"). Cada comentario dice cómo regresarlo.
  `e2e-checkout-online.js` sale en 0 salvo con `E2E_TIENDA_EN_LINEA=si`.
- **Reportes → "Venta por color"** (2026-10-06: "en cierto rango de tiempo cuántos kg se han
  vendido de cierto color y qué porcentaje lo representa, y qué porcentaje del color ya se vendió
  y cuánto queda"). `GET /reportes/venta-por-color?desde&hasta[&q]`, `reportes/venta-color.js`:
  un renglón por HILO (`producto_id`, paquete y cono sumados), con los kg vendidos en el rango, su
  % de TODO lo vendido en el rango (aunque se filtre por color), el importe sin IVA, lo vendido
  desde siempre, lo que queda (todos los almacenes, sin restar apartados) y el % ya vendido =
  vendido / (vendido + lo que queda). "Vendido" es lo que salió del inventario: sin cancelados,
  devueltos ni apartados sin entregar (`inventario_descontado = 1`) — por eso puede salir un
  poco abajo de "Más vendidos", que sí cuenta los apartados.
- **Clientes son SEIS miradas** (`GET /clientes/analisis/:vista?dias=30|90|365|3650`,
  `clientes/analisis.js`): frecuencia de compra (contra el ritmo de CADA cliente, y cuánto se lleva
  en KILOS y en DINERO), dejaron de
  venir, cuánto debe (cartera por antigüedad, igual que el tablero), qué compra (por
  `producto_id`, con calibre), cuándo compra (día × hora) y cuánto gasta (contra el periodo
  anterior). El expediente trae las miradas para un cliente (`habitos` en `GET /clientes/:id`).
  El cajero las ve todas, incluida "Cuánto debe" (decisión del usuario).
  **La frecuencia dice también cuánto se llevan** (2026-10-03: "tiene que ser igual por kg y por
  dinero"): `ritmos()` trae de cada cliente los kilos y el dinero desde siempre y POR VISITA (por
  día con compra, igual que el ritmo), y `frecuencia` los del periodo y la visita típica
  (mediana). El dinero es `pedidos.total`, como en Cuánto gasta. La tabla se puede ordenar por
  kilos o por dinero del periodo.
  **"Dejaron de venir"** (2026-10-03, `vistas/vista-dejaron.ts`) son EXACTAMENTE los del aviso de
  la campana "N clientes dejaron de venir": 2 compras o más y 60 días o más sin venir
  (`DIAS_SIN_VENIR`). La campana y la pestaña salen de la MISMA consulta
  (`analisis/model.js → clientesEnfriados`), así el número del aviso y la lista nunca se
  contradicen. Nació porque la campana llevaba a Frecuencia de compra, que mide contra el ritmo de
  cada quien (decía "16 se están enfriando" y no los 5 del aviso): "doy clic y no me dice quiénes".
  No va por periodo sino por corte de días sin venir (`?sin_venir=30|60|90|180`, 60 por omisión);
  arriba los que más compraban, con teléfono, "Ver" y "Venderle". Se QUITÓ de "Cómo va el negocio"
  ("esa información no tiene que ir ahí").
- **Hoy** (`GET /hoy`, `ver:hoy`) es la pantalla de entrada: los mismos pendientes vivos de la
  campana, lo vendido hoy por hora y lo que debería haber en cada cajón. El cajero entra al punto
  de venta (`rutaDeInicio` en `core/navegacion.ts`).
- **Caja es su propia pantalla** (`/admin/caja`): abrir turno, sacar o meter efectivo, el corte y
  el alta de cajas. El punto de venta solo cobra. Las dos recuerdan la caja elegida en
  `localStorage['caja_sel']`, así abren la misma. El abono en efectivo (expediente y Apartados)
  entra al turno de ESA caja; con varias abiertas y ninguna elegida, hay que escogerla (antes caía
  en la primera de la lista y descuadraba dos cortes). "Venderle" en el expediente abre el punto de
  venta con `?cliente=<id>` y el cliente ya elegido.

## Convenciones de UI
- **La página va a TODO lo ancho** (`.pagina` sin tope): "ocupa lo más que se pueda". El lienzo
  tenía 1,120 px y en la pantalla de la tienda (1,920) quedaban franjas vacías a los lados.
- **El menú lateral no tiene barra de desplazamiento** (la quitó el usuario): solo la LISTA de
  pantallas se desplaza, con la rueda, y el final se desvanece mientras haya opciones abajo
  (`revisarMenu` en `admin-layout.ts`). El nombre, la campana y "Salir" quedan SIEMPRE abajo y a
  la vista: antes la barra se desplazaba entera y la campana se perdía bajo el menú del
  administrador. Las barras de la página son delgadas (`scrollbar-width: thin` en `html`).
- **Los estilos del panel de avisos viven en `admin-avisos.scss`**, aparte de `admin-layout.scss`:
  juntos pasaban el límite de 4 kB por hoja de `angular.json`. Separar la hoja es la salida; no
  subas el límite.
- **El sistema de diseño está en `styles.scss`** (rediseño aprobado el 2026-10-02, lienzo
  "Rediseño · Menú y Clientes"): tokens (`--fondo`, `--tinta-*`, `--acento`, pares de estado
  `--ok-f/--ok-t`…), IBM Plex Sans/Mono INSTALADAS en el proyecto (`@fontsource`, no Google: en el
  mostrador no siempre hay buen internet) y las piezas de siempre: `.pagina`, `header.page-head`,
  `.card` + `.card-head`, `.kpis/.kpi`, `.fila > .ancha/.angosta/.mitad`, `.filtros-barra`,
  `.tabs`, `.seg`, `.pill.*`, `.barras`, `.columnas`, `.pendiente`, `.pila`. Antes de inventar un
  estilo en una pantalla, búscalo ahí; lo propio de una pantalla va en su componente. No inventes
  colores fuera de los tokens y la paleta de gráficas.
- **El menú es UNO** (`core/navegacion.ts`): de ahí salen el menú lateral, la guarda de cada ruta
  y la pantalla de inicio de cada puesto. Siete grupos por tarea; los nombres de pantalla son los
  de siempre (el usuario pidió conservarlos).
- **Nombres genéricos en `styles.scss` CHOCAN.** La revisión del rediseño encontró tres: el
  `.linea` y el `.detalle` de la tienda en línea centraban los artículos del pedido y partían en
  dos la tabla de Inventario, y un `.avance` viejo recortaba el de Surtir sucursal. Los de la
  tienda ahora van dentro de `.tienda-shell` y se quitaron 91 reglas que ya nadie usaba. Si una
  clase global no la usa ninguna plantilla, bórrala; si es de una sola pantalla, va en su componente.
- **`.tabla-scroll` lleva `position: relative`.** Sin él, los `.oculto` (texto para lector de
  pantalla, `position: absolute`) de las columnas de la derecha escapaban de la caja y
  ensanchaban la página ENTERA en el celular, aunque la tabla sí se desplazaba.
- **En las listas va el folio CORTO** (`shared/folio.pipe.ts`: "POS-1790864580000-79FA" →
  "POS-79FA"), con el completo en el `title`. El largo partía la celda en tres renglones y sacaba
  columnas de la tarjeta. El detalle del pedido y el ticket llevan el completo; buscar "79FA" lo
  encuentra igual.
- **Las notificaciones van en la barra, junto al nombre y el tipo de usuario** (la campana de
  `admin-layout`). Son pendientes VIVOS que se calculan de la base con `GET /notificaciones`
  (`modules/notificaciones`): solicitudes de traspaso por surtir, envíos por acusar recibo y
  existencias bajo su mínimo. **No hay tabla de notificaciones ni "marcar como leída"** a propósito:
  el aviso tiene que estar ahí hasta que el pendiente se resuelva, y una marca de leído solo lo
  taparía. Los avisos de CLIENTES cuentan **uno por tema**, no uno por cliente: "5 clientes
  te deben desde hace más de 30 días" es un aviso, no cinco, o la campana marcaría 40 y
  nadie la abriría. Los umbrales tienen nombre en `notificaciones/model.js`
  (`DIAS_SIN_ABONAR`, `DIAS_SIN_VENIR`, `DIAS_CLIENTE_NUEVO`), no van sueltos en el SQL. Se refresca cada minuto y al abrir el panel.
  **El panel se abre A LA DERECHA del menú** (`position: fixed`, 460 px, pegado abajo junto a la
  campana), sobre la página: dentro de la barra de 248 px los textos se cortaban, salía una barra
  de desplazamiento y media pantalla quedaba vacía al lado (lo señaló el usuario el 2026-10-02).
  Agrupa como Hoy (Mercancía, Ventas, Clientes), dice las fechas en palabras ("hoy a las 0:18") y
  lista a quién cobrarle con su monto a la derecha. Se cierra con la ✕, con Escape o tocando
  fuera. OJO con los nombres: vive DENTRO de `.user`, así que una clase como `.quien` (la del
  nombre y la campana) se le hereda; por eso sus renglones son `.aviso-fila` y `.deudor`.
  Y OJO con las capas: el panel vive dentro de la barra, que es `sticky` y por eso es su propia
  capa; sin `z-index: 30` en `.side`, los puntos y líneas de las gráficas de la página se
  pintaban ENCIMA del panel y parecía transparente (lo vio el usuario). Los modales (50) siguen
  quedando arriba de la barra.
- **Inventario contesta tres preguntas, en ese orden.** Es como las hace la tienda y por eso la
  pantalla está armada así: (1) *cuánto hay en cada almacén* → una tarjeta por almacén con su
  cifra, su parte del total y el desglose paquete/enconado; (2) *dónde está cada hilo* → gráfica
  de barras apiladas (`shared/charts/stacked-bars.ts`), un renglón por hilo y un tramo por
  almacén; (3) *el detalle exacto* → tabla agrupada por hilo y buscador. **Las presentaciones del
  mismo hilo van JUNTAS** en la tabla, con el nombre una sola vez: antes cada una era un
  renglón suelto con el nombre repetido y parecía que la tabla tenía duplicados.
- **Tocar un hilo en Inventario abre su DETALLE** (2026-10-06: "cuando doy clic en cualquier hilo,
  que me diga los bultos que están y su lote; selecciono el lote y me da las presentaciones que
  tiene cada uno"). El nombre del hilo en "Detalle por hilo" es un botón, y al lado va "Lotes y
  paquetes ›"; abren `inventario/hilo-modal.ts`, que SOLO MIRA. Dos vistas: el HILO (cuánto hay
  por presentación y almacén —los saldos, que son la verdad— con los paquetes que se cree que
  están ahí y "no cuadra con lo que hay" si sus kilos difieren más de medio kilo; y sus LOTES con
  lo que queda en paquete y dónde, lo que ya se bajó a conos o se vendió, y en qué carga llegó) y
  un LOTE (las mismas cifras y sus paquetes uno por uno, con filtro En paquete / A conos /
  Vendidos / Todos, almacén y código). Sale de `GET /inventario/hilos/:productoId` y
  `GET /inventario/hilos/:productoId/bultos?lote=|sin_lote=1` (`inventario/hilo.js`). El cono NO se
  lleva por lote: del lote se dice cuántos paquetes se bajaron a conos y cuántos conos salieron, no
  cuántos quedan. `e2e-detalle-hilo.js` (solo lectura) cuadra todo contra la base.
  OJO con los nombres de clase en esa ventana: `.cifra`, `.dato` y `.pie` son GLOBALES en
  `styles.scss` y la descomponían; las suyas son `.hilo-datos`/`.hilo-dato`/`.dato-pie`.
- **El hilo se nombra con su CALIBRE en todas partes, también ante el cliente.** El catálogo y
  la página del producto de la tienda, el carrito (el nombre se guarda con calibre), el carrito
  del POS y "Más vendidos" dicen "ROJO 2/30", no "ROJO": había dos tarjetas "ROJO" con precios
  distintos y parecía un duplicado.
- **Donde se elige un hilo, la opción lleva COLOR + CALIBRE + material + línea.** No solo el
  color: el mismo color en dos calibres son dos productos y con "AMARILLO · AMARILLO" no hay forma
  de elegir bien. Ya costó caro — ver abajo. Aplica al selector de la remesa y a cualquier otro que
  se agregue; las variantes traen `calibre`, `material` y `linea` desde `variantes/model.js`.
- **El nombre del archivo de la remesa se COTEJA con el hilo elegido.** El proveedor las nombra
  «COLOR CALIBRE.xlsx» (`ROJO 1-30.xlsx`), así que `shared/remesa-archivo.ts` lo lee y avisa cuando
  no cuadra, en los dos cargadores y en el historial. **Avisa, NUNCA bloquea ni corrige solo:** es
  una convención del proveedor, no una garantía. Nació porque tres listas entraron al hilo
  equivocado —`ROJO 1-30.xlsx` a AMARILLO, `ROSA MEXICANO 2-30.xlsx` a DEV_2 y `MARINO OSCURO
  2-30.xlsx` a MARINO OSCURO **1/30**—; la del calibre es la que a ojo no se ve.
  **Solo opina si el nombre trae CALIBRE al final** ("COLOR 2-30"): sin él no es un nombre de hilo
  —"HTX 1.ARAC FFAU 721502-4 - INVENTARIO" es la lista con varios colores y salían sus tres cargas
  "no cuadra" (2026-10-03)—. Y en el historial no se coteja un archivo que dejó VARIAS cargas: es
  una lista con varios colores.
- **En inventario, el hilo se identifica con COLOR + CALIBRE, y se agrupa por `producto_id`.**
  Nunca por el nombre: "MARINO OSCURO 1/30" y "MARINO OSCURO 2/30" son dos productos y agrupar por
  nombre los sumaría en un renglón. La pantalla muestra además material y línea (`categorias` y
  `lineas`), porque con el color solo no se sabe qué hilo es.
- **Un número en pantalla lleva su unidad, y una barra dice contra qué se mide.** Los encabezados de
  almacén dicen "· kg", el total del hilo va como "1,919.71 kg · 29% del inventario", y esa barra se
  llena con ese mismo porcentaje. Antes se medía contra el hilo más grande, que no aparecía en
  ninguna parte, así que la barra no significaba nada.
- **Sin mínimo capturado no hay alerta de stock.** `stock_minimo = 0` significa "no configurado",
  no "el mínimo es cero". La condición vive en `COND_ALERTA` (`inventario/model.js`) y exige
  `stock_minimo > 0`; sin eso, una fila en cero contaba como alerta y la pantalla decía
  "0 productos · sin existencias · 1 bajo mínimo" en un almacén vacío. La vista
  `v_alertas_stock` (Reportes → Por reabastecer y el asistente) aplica la MISMA regla desde la
  migración `2026-10_alertas_stock_con_minimo.sql`: antes listaba hilos agotados sin mínimo y
  contradecía a la campana.
  **El mínimo se captura en Inventario**, en la columna "Mínimo" de la tabla de existencias, que
  se dibuja SIEMPRE —antes se escondía cuando no había mínimos y entonces no había dónde
  ponerlos—. Su botón abre `inventario/minimo-modal.ts`: es por presentación y almacén, se puede
  teclear en paquetes (con el peso promedio REAL de los bultos de ahí, como en Ajuste / merma) y
  se guarda en kilos con `PUT /inventario/configuracion`. Ese endpoint escribe mínimo, máximo y
  ubicación juntos, así que el modal manda los dos que no cambia para no borrarlos.
- **Si algo tarda más de unos segundos, la pantalla lo dice.** El asistente avisa
  "Consultando tus datos… suele tardar medio minuto" a los 6 s (señal `tardando` en
  `asistente.ts`), porque la capa gratuita de Gemini se toma ~30 s en una respuesta
  con datos. Tres puntitos parpadeando durante medio minuto se leen como que se
  trabó: la gente vuelve a preguntar o cierra la pantalla. El reloj se limpia al
  contestar Y al fallar, o el aviso salta después de una respuesta ya recibida.
- **Una gráfica se MIRA antes de darla por buena.** El validador de la paleta revisa color, no
  geometría: hay que renderizarla y verla. Así se encontraron tres cosas que ninguna prueba
  detecta: la gráfica de "quién debe más" venía ordenada por antigüedad (la barra más larga
  quedaba en medio y el título prometía otra cosa), el valor negativo salía como `$-3,200` en vez
  de `-$3,200`, y el carril gris de fondo dejaba un hueco vacío del lado contrario a las barras
  negativas. El patrón que usa este proyecto es generar el mismo SVG en un HTML de prueba con
  datos reales y capturarlo con Chrome headless.
- **`shared/charts/barras.ts` pone el cero EN SU SITIO.** Con todos los valores positivos es una
  barra normal desde la izquierda; con negativos, el cero se coloca donde toca y las barras crecen
  a los dos lados — que es lo que hace falta para leer un margen. El carril de fondo **solo se
  dibuja cuando no hay negativos**, y el signo va antes del símbolo de moneda.
  `shared/charts/composicion.ts` es UNA barra partida en tramos (la cartera por antigüedad):
  hueco de 2 px entre tramos, redondeo solo en los extremos libres, y el porcentaje se escribe
  dentro **solo si cabe** (más de 50 px), eligiendo blanco o tinta según lo oscuro del relleno.
- **Gráficas: la paleta está validada, no la cambies a ojo.** `--viz-series-1..3` son los tres
  primeros slots de la paleta de referencia y pasan las puertas de daltonismo y de visión normal
  contra el fondo blanco de las tarjetas. Un CUARTO color no se agrega sin volver a correr el
  validador de la guía (`dataviz`): del cuarto almacén en adelante se usa `--viz-otros` (gris) y el
  detalle exacto lo da la tabla. Reglas que hay que respetar al tocar una gráfica: hueco de 2 px
  del color del fondo entre tramos (NUNCA un borde), redondeo de 4 px solo en el extremo del dato,
  leyenda siempre que haya dos series o más, y una sola etiqueta directa (el total) — los tramos de
  en medio los explica el tooltip.
- **Una gráfica SVG no va en media tarjeta.** El SVG se estira (o se encoge) al ancho que le den:
  en una tarjeta de 1,300 px un viewBox angosto escala el texto al doble, y en media tarjeta la de
  "quién debe más" dejaba su letra ilegible. En el rediseño esas van a todo lo ancho, y las
  gráficas nuevas son de cajas HTML (`.barras`, `.columnas`), que no escalan el texto.
  (`.chart-box` ya no existe.)
- **La celda de acciones de una tabla sigue siendo CELDA** (`table.grid td.acciones` con
  `white-space: nowrap`). Con `display: flex` dejaba de estirarse a la altura del renglón —el
  borde quedaba desalineado— y encogía los botones hasta partir "▸ Precios" en dos líneas. El
  `flex` solo aplica cuando `.acciones` es un `div`.
- **El panel en el celular:** la columna del layout es `minmax(0, 1fr)`, no `1fr`, y el menú se
  desliza de lado (`overflow-x: auto`). Con `1fr` la columna medía lo que el menú en una fila
  (18 opciones) y la página entera se ensanchaba a ~1,600 px.
- **La tienda carga el perfil del cliente al abrir** (`tienda-layout.ts`), igual que el panel:
  sin eso, tras recargar, el checkout decía "Comprando como cliente" en vez de su nombre. Por
  eso `GET /clientes/perfil` NO se quitó en la limpieza aunque parecía usarse solo desde la
  pantalla de prueba `/dashboard`.
- **Al cliente se le habla en sus palabras:** "Mis pedidos" traduce el estado
  (`en_preparacion` → "En preparación") y los montos van con separador de miles.
- **La pantalla es para MIRAR; las acciones son modales.** Los listados (productos, materiales,
  inventario) muestran datos y ponen las acciones en botones del encabezado o del renglón, que
  abren un modal. No dejes formularios desplegados en la pantalla: Inventario llegó a tener siete
  bloques apilados y no se encontraba nada. El modal se crea al abrirlo y se destruye al cerrarlo,
  así arranca limpio.
  · **Un `<form>` que envuelve cuerpo y botones encoge con el modal** (`.modal > form` en
    `styles.scss`, 2026-10-06): sin eso, con más contenido que pantalla, el recuadro blanco se
    acababa a media ventana y el resto —y los botones— se salía sobre el fondo oscuro (el horario
    de nómina). El form va como hijo DIRECTO de `.modal`, como en los diez modales que lo usan.
  · **Nunca cierra al hacer clic en el fondo** (se pierde la captura). Sale con la ✕, con
    "Cancelar"/"Cerrar" o con **Escape**.
  · **Los datos que ya tiene el listado entran por input**, no se vuelven a pedir: así el modal
    abre armado y de un solo tamaño. Cuando SÍ hay que ir al servidor (el modal de producto),
    dibuja el formulario completo desde el primer cuadro y tápalo con `.modal-cargando`
    —el velo con spinner— en vez de pintar un "Cargando…" chico que luego crece.
  · **Los inputs de señal se leen en `ngOnInit`, NUNCA en el constructor:** ahí todavía no están
    asignados y el modal abre en blanco. Ya pasó con el de producto; hay pruebas que lo cubren.
  · Un modal que se usa varias veces seguidas (bajar conos, ajuste/merma, capturar colores) NO se
    cierra al confirmar: avisa, se limpia y espera el siguiente.
- **Nada de `confirm()`, `alert()` ni `prompt()` del navegador** (lo pidió el usuario el
  2026-10-03: el cuadro gris de "localhost:4200 dice" no se puede diseñar). Para preguntar antes
  de algo sin vuelta: `await inject(ConfirmacionService).pedir({ titulo, mensaje, aceptar,
  peligro })` (`core/services/confirmacion.service.ts`), que devuelve `true`/`false`. La ventana
  (`shared/confirmacion/confirmacion.ts`) va UNA vez en `app.ts`: queda encima de cualquier modal
  (z-index 60), no se cierra al tocar el fondo, Enter acepta y su Escape se atiende en la fase de
  captura para que NO cierre también el modal de abajo. El botón lleva el verbo ("Eliminar",
  "Cerrar el turno"), no "Aceptar"; `peligro` lo pinta rojo. En una prueba se provee un doble:
  `{ provide: ConfirmacionService, useValue: { pedir: () => Promise.resolve(true) } }`.
- **Nunca uses `computed()` para una vista previa que dependa de campos `[(ngModel)]`.** Un
  `computed` solo se invalida cuando cambia una SEÑAL; sobre propiedades normales se calcula una vez
  y se queda pegado, así que el preview miente al teclear. Ya pasó en el desarme (los "kilos reales"
  no movían el cálculo). Usa un MÉTODO normal —la detección de cambios lo reevalúa en cada tecla— o
  convierte los campos a señales. `computed` sí es correcto cuando todo lo que lee son señales
  (`input()`, `signal()`).
- **Un hilo se busca por PALABRAS** (`utils/query.js → porPalabras`): cada palabra tiene que
  aparecer en alguna columna, así "rojo 2/30" encuentra el rojo de ese calibre —el color y el
  calibre viven en columnas distintas— y "2-30" también, como lo escribe el proveedor. Lo usan
  variantes (caja, traspasos, ajuste), inventario y el catálogo. Los códigos de bulto van con
  EXISTS, nunca con GROUP_CONCAT: se corta a 1,024 caracteres y en una remesa de 80 bultos los
  últimos códigos dejaban de encontrarse.
- **El dinero va con el pipe `dinero`** (`shared/dinero.pipe.ts`): separador de miles, dos
  decimales y el signo antes del símbolo. Nunca `${{ x }}` ni `toFixed(2)` en una plantilla.
- **El punto de venta tiene su propia rejilla** (`.pos-layout`, columnas `minmax(0, …)`). Con la
  `.form-grid` de `1fr` una columna no encoge por debajo de su contenido, y el nombre largo de la
  caja en el selector sacaba la columna de cobro de la pantalla. Un `select` nunca es más ancho
  que su campo.
- **La campana no manda a nadie a una pantalla que no puede abrir**, y cada puesto ve solo los
  avisos de lo que atiende (el globo cuenta solo esos). La cobranza lleva a Clientes → Cuánto debe;
  los que dejaron de venir, a Clientes → Dejaron de venir; los apartados ya pagados, a Apartados.
- **Cantidades sin ceros de relleno.** MySQL devuelve `DECIMAL(12,3)` siempre con tres decimales
  (`350000.000`). En pantalla usa el pipe `cantidad` (`shared/cantidad.pipe.ts`), que recorta los
  ceros sobrantes y agrupa miles: `350,000`, `2.5`, `1.25`. Acepta la unidad como argumento:
  `{{ x | cantidad: 'kg' }}`.
- **El kardex habla de documentos, no de tipos.** `listarMovimientos` resuelve `concepto`, `folio`
  y `detalle_tipo`/`detalle_id` a partir de `referencia_tipo`; la pantalla nunca debe reconstruir
  esa etiqueta por su cuenta.

## Convenciones de código
- API REST versionada bajo `/api/v1`. Recursos en plural: `/api/v1/productos`, `/api/v1/pedidos`.
- Respuestas JSON con forma `{ "data": ..., "error": null }` o `{ "data": null, "error": {...} }`.
- Nombres de tablas/campos en español (como en el esquema); en el código JS usar los mismos nombres.
- Validar entrada con una librería (p.ej. `zod` o `express-validator`) en cada endpoint de escritura.
- Nunca exponer `contrasena_hash` en respuestas.

## Estado actual
- [x] Base de datos diseñada y **validada** (corre sin errores en MySQL).
- [x] ERD completo.
- [x] Backend Node/Express: auth, catálogo, inventario, ventas/caja, reportes y nómina (probados E2E).
- [x] Frontend Angular: panel admin (catálogo, inventario, POS, pedidos, reportes, nómina) y
      tienda en línea pública (catálogo, carrito, checkout, mis pedidos).
- [x] Reportes: ventas del día, cortes de caja, por reabastecer y más vendidos.
- [x] Nómina semanal: sueldo base, comisión por ventas, horas extra y descuentos.
- [x] Tienda en línea: muestra existencias y bloquea agregar al carrito lo que está agotado.
- [x] Checkout de la tienda en línea: captura entrega (recoger en tienda o envío con tarifa
      fija), dirección, cupón y forma de pago (transferencia o efectivo en tienda). El total
      lo calcula el backend con `POST /pedidos/cotizacion`, la MISMA función que la venta.
      No se cobra en línea: el pedido nace `pendiente` con un `pagos` en estado `pendiente`
      por el total, que un administrador confirma.
- [x] Direcciones de entrega del cliente (`GET/POST/PUT/DELETE /direcciones`), con captura
      dentro del propio checkout.
- [x] Configuración de la tienda (Admin → Configuración, solo administradores): tarifa de
      envío, datos para depositar, dirección y teléfono. Tabla `configuracion` clave/valor.
- [x] Comprobante del depósito: el administrador sube la captura en el detalle del pedido y
      con eso queda pagado. Se valida por los bytes del archivo y se sirve autenticado.
- [x] El detalle del pedido muestra calibre, material y línea de cada artículo, y los bultos
      entregados con su código de barras, peso real y lote, en su propia tabla.
- [x] Alta y edición de cajas desde el panel (Caja → Cajas de la tienda; pide `ver:almacenes`).
- [x] Alta y edición de almacenes desde el panel (Admin → Almacenes), solo administradores.
      Incluye mover la marca de `es_tienda_linea` y ver qué cajas cuelgan de cada uno.
- [x] Surtir sucursales: traspaso multi-producto capturado en paquetes (Admin → Surtir sucursal).
- [x] Panorama de existencias por almacén (matriz producto × almacén, arriba en Inventario).
- [x] Recibir remesas: se sube la lista de empaque `.xlsx` del proveedor, se revisa la vista previa
      y cada renglón entra como un bulto con su peso real y su lote (Admin → Recibir remesa).
      Probado con el archivo real: 80 bultos, 1,527.5 kg, 2 lotes.
- [x] El traspaso tiene estados: pendiente de envío → en tránsito → recibido, con acuse de quien
      recibe (queda su nombre y la hora) y captura de lo que de verdad llegó; el faltante se asienta
      como merma. Validación de existencias al solicitar, con alerta de inventario insuficiente.
      Migración: `db/migrations/2026-07_traspasos_estados.sql` (aplicada en "desarrollo").
- [x] Banderas del producto: `multipresentacion` (habilita paquete/cono) y `por_lotes` (etiqueta
      de remesa en la presentación, sin separar existencias).
- [x] El desarme acepta el peso REAL del bulto cuando no coincide con el nominal.
- [x] El POS cobra por el peso del bulto escaneado; el ticket muestra de qué bultos salió la
      cantidad y no deja cobrar dos veces el mismo bulto. Falta probarlo con el lector físico.
- [x] El desarme precarga los kilos y los CONOS reales escaneando el bulto, y deja constancia de
      cuál se desarmó. Un bulto que rinde menos genera sus 7 conos, no 12.
- [x] El pedido guarda de qué bultos salió lo vendido, con su lote, congelado para el histórico.
- [x] Estado del bulto (disponible/vendido/desarmado): no se puede vender ni desarmar dos veces,
      ni con dos cajas a la vez. Cancelar el pedido libera sus bultos.
- [x] Cancelar o devolver un pedido regresa la mercancía al inventario del almacén que vendió, con
      su movimiento en el kardex. Reactivar vuelve a descontar y exige existencias.
- [x] Al cancelar una venta de mostrador el efectivo sale de la caja ('devolucion') y el corte
      cuadra; los pagos quedan reembolsados. Con la caja cerrada se rechaza en vez de perderlo.
- [x] Botón de cancelar/devolver en el detalle del pedido, con panel de confirmación: dice a qué
      almacén regresa la mercancía, permite cambiar la presentación por línea (paquete → conos) y
      avisa cuánto efectivo sale de la caja.
- [x] El alta de producto captura el precio por kilo del hilo y ya no pide SKU: las presentaciones
      se administran en su propia pantalla y heredan ese precio. Se llega con el botón
      "Presentaciones" de cada renglón del listado, sin pasar por Editar.
- [x] Inventario quedó solo con lo de mirar: KPIs por almacén, panorama producto × almacén y
      existencias. "Bajar conos a mostrador" y "Ajuste / merma" son botones del encabezado con su
      modal; las bajadas recientes viven dentro del modal de conos (las últimas 5).
- [x] Materiales: el alta y la edición también son un MODAL sobre el listado
      (`categorias/material-form-modal.ts`). No pide nada al servidor —el renglón ya trae el
      material completo—, así que abre armado y sin velo.
- [x] El alta y la edición del producto son un MODAL sobre el listado
      (`productos/producto-form-modal.ts`), no una pantalla aparte: ya no existe
      `/admin/productos/:id` (redirige al listado). No se cierra al hacer clic en el fondo —se
      perdería la captura—; sale con ✕, "Cancelar" o Escape. Al crear ofrece "Capturar otro
      color" (conserva material, línea, impuesto y calibre) e "Ir a presentaciones".
- [x] Vaciado masivo: el Excel del proveedor se sube desde la pantalla de presentaciones del
      producto, crea la presentación si falta, registra los bultos y da entrada al inventario.
- [ ] Nada del escaneo, el panel de cancelación, la pantalla de presentaciones ni la carga masiva
      se ha probado en el NAVEGADOR: solo compila y pasa contra los endpoints.
- [ ] Nada de la captura por lector se ha probado con la pistola física en el navegador.
- [x] Precios por tipo de cliente: precio público en la presentación + precio propio por tipo en
      `variante_precios`. El POS trae selector de tipo y el pedido congela con qué lista se cerró.
- [x] Pantalla de listas de precio (Admin → Listas de precio, solo administradores): alta,
      edición y baja de tipos de cliente, en modal sobre el listado. El público no se puede
      eliminar ni desactivar.
- [ ] Las listas de precio REALES siguen sin definirse: hoy solo hay "Público" y dos DEMO.
      Falta que el usuario diga cuáles son (medio mayoreo, mayoreo, especial) y capturarles
      precio en las presentaciones.
- [x] Asistente con IA (Admin → Asistente, `modules/asistente`): se le pregunta en
      español y contesta con datos reales, diciendo qué consultó. 14 herramientas de
      solo lectura, 5 de ellas solo para jefes.
      **Proveedor: Google Gemini** (`gemini-flash-lite-latest`), por su endpoint
      compatible con OpenAI. Se cambió de DeepSeek el 2026-09-10 porque Gemini tiene
      capa gratuita. Probado contra la IA real: contesta con datos de la base y a un
      cajero le niega el margen sin dar cifras.
- [ ] **El asistente TARDA ~30 s** en una respuesta que consulta datos (picos de 50 s);
      medido con el flujo real en la capa gratuita. La pantalla avisa a los 6 segundos.
      Si molesta, activar facturación en Google sube los límites sin tocar código.
- [x] Alta rápida de cliente desde el POS, sin salir de la venta.
- [ ] El checkout se abrió en el navegador y se armó el pedido, pero NUNCA se ha confirmado
      uno desde la pantalla (sí por E2E: 31 comprobaciones).
- [x] Expediente del cliente y crédito (BACKEND, 36 comprobaciones E2E): alta sin cuenta desde
      el panel, búsqueda por apodo y teléfono, historial de compras, qué colores compra más,
      límite de crédito, venta a crédito (incluso mixta), abonos que entran a la caja, estado de
      cuenta y lista de quién debe.
      Migración: `db/migrations/2026-09_clientes_expediente_credito.sql`.
- [x] Frontend de clientes: el POS identifica al cliente, Clientes tiene sus cinco pestañas y el
      expediente su Resumen y las mismas miradas (rediseño 2026-10).
- [ ] Falta el asistente de preguntas predefinidas (sin IA, por decisión del usuario el
      2026-09-09).
- [x] Costo y margen (BACKEND): el costo se captura en la remesa, se promedia ponderado y se
      congela en la venta. Migración: `db/migrations/2026-09_costo_y_margen.sql`.
- [x] Módulo de análisis (BACKEND): cobranza por antigüedad, clientes enfriados, hilo muerto y
      margen por hilo. `GET /api/v1/analisis/tablero` los trae los cuatro de un viaje.
- [x] La campana avisa de cobranza atrasada (30 días sin abonar) y de clientes que dejaron de
      venir (60 días). El globo cuenta UN aviso por asunto, no uno por cliente: contar cada uno
      lo inflaría a decenas y dejaría de significar nada.
- [x] **Tablero visual** (Admin → Cómo va el negocio, solo administradores): las cuatro
      preguntas con cifra grande, gráfica y tabla. Componentes nuevos en `shared/charts/`:
      `barras.ts` (con el cero en su sitio, soporta negativos) y `composicion.ts` (una barra
      partida en tramos).
- [x] Pantallas de clientes (Admin → Clientes): listado con búsqueda y ORDEN por la pregunta
      que contesta ("quién me debe más", "quién compra más", "quién vino más reciente"), alta y
      edición en modal, y el EXPEDIENTE con cuánto compra, su cuenta de crédito con sus
      movimientos, qué colores se lleva (con gráfica) y sus compras.
      El único campo obligatorio es el nombre: el usuario captura clientes de años y exigirle
      correo o dirección haría que no los capturara.
- [x] El POS identifica al cliente (opcional: la mayoría de las ventas son a quien pasa) y al
      elegirlo **aplica su lista de precios sola**, así nadie le cobra precio público a un
      cliente de mayoreo por descuido. Muestra su crédito disponible ANTES de cobrar y permite
      FIAR, con venta mixta (paga algo, debe el resto).
- [x] El POS muestra el TOTAL REAL con IVA, pidiéndolo a `POST /pedidos/cotizacion` cada vez
      que cambia el carrito (con un `effect`, no en los cinco sitios donde se toca el carrito).
      Antes solo mostraba un "subtotal estimado sin IVA", inservible para fiar.
- [x] Campo de precio de compra en los DOS cargadores de remesa (Surtir inventario y la pantalla
      de presentaciones del producto). Es lo que desbloquea el margen.
- [ ] Falta la pantalla de cobranza como tal (hoy los abonos se registran desde el expediente
      del cliente, que cubre el caso).
- [ ] El cargador masivo de clientes se DESCARTÓ: el usuario los va a capturar uno por uno
      (2026-09-10).
- [x] APARTADOS (BACKEND, 33 comprobaciones E2E): el cliente deja un anticipo, la mercancía se
      RESERVA sin descontar, abona hasta liquidar y al entregar se descuenta de verdad.
      Cancelar libera la reserva sin inventar existencias.
      Migración: `db/migrations/2026-09_apartados.sql`.
- [x] Frontend de apartados: se aparta desde el POS (exige cliente, anticipo libre) y la
      pantalla Admin → Apartados separa los LISTOS PARA ENTREGAR de los que aún deben —son
      dos acciones distintas y mezclarlas escondía la urgente—. Abonar y entregar desde ahí.
- [x] Auditoría de lo que se usa (2026-10-01). Se corrigieron cinco fallas —un apartado se
      podía marcar entregado sin descontar y no se podía reactivar como apartado; "Por
      reabastecer" contaba hilos sin mínimo; no había dónde capturar el mínimo; el script que
      vaciaba la base no tenía la protección contra producción; el despliegue podía subir un
      `.env.*` y el rollback manual borraba los comprobantes— y se quitaron 18 rutas sin uso,
      la pantalla de prueba `/dashboard`, 13 métodos de servicio sin llamadas y
      `limpiar-para-pruebas.js`. El detalle, en `CAMBIOS.txt`.
- [x] Revisión en el navegador (Chrome headless, 2026-10-01): todas las pantallas del panel y la
      tienda, como administrador, cajero, cliente y visitante, a ancho de escritorio y de
      celular, con los modales abiertos y el checkout armado hasta ANTES de confirmar. Sin
      errores de consola ni peticiones fallidas. Lo que se encontró se corrigió (ver
      CAMBIOS.txt). NO se confirmó ninguna venta, cancelación ni captura desde la pantalla.

- [x] Siete fallas y detalles de diseño (2026-10-02): el efectivo se asienta por lo cobrado, la
      caja no vende lo apartado, la lista de precio regresa al público, se elige otra caja con
      turno abierto, el corte enseña su diferencia, retiros e ingresos de efectivo, ajuste de
      deuda, precio y peso editables, alta de producto honesta, búsqueda por calibre, pesos con
      miles en todas partes. 17 E2E en producción y 117 unitarias. Detalle en CAMBIOS.txt.

- [x] **Rediseño de TODO el panel (2026-10-02)**, aprobado en el lienzo "Rediseño · Menú y
      Clientes": menú por tareas en siete grupos, permisos por puesto, pantallas nuevas Hoy, Caja,
      Permisos y Clientes (cinco pestañas), y las demás rehechas con el mismo sistema de diseño.
      Revisado en Chrome headless como administrador, gerente, cajero y almacenista, a 1280 px y
      a 390 px (ninguna pantalla se ensancha en el celular). 215 unitarias. Detalle en CAMBIOS.txt.
- [x] **Carga de la lista completa del proveedor (2026-10-03)**: un archivo con varios colores
      crea los hilos que falten (sin precio), con sus lotes y todos sus bultos, una carga por hilo y
      un PDF de toda la lista. Los hilos sin precio no se venden y la campana avisa. 50
      comprobaciones E2E (`e2e-carga-lista.js`) y 237 unitarias. EL USUARIO YA CARGÓ LA LISTA
      REAL (17:14): CAMEL, OPTIK y MARINO 2/30, 718 bultos. Después: sin precio de compra en la
      pantalla, panel de avance mientras carga e inserción por tandas: 60 comprobaciones E2E
      contra la base (incluida la carga con avance) y probada DESDE LA PANTALLA con 1,800 bultos
      en Chrome headless (el panel se vio a media carga). Sin desplegar.

## Pendientes concretos para el usuario
- **`hitex` SE LIMPIÓ (2026-10-06, a petición del usuario: "configuración se queda tal cual; se
  borra lo que está en inventario y las ventas, y el cliente que se hizo; siguen siendo
  pruebas").** Se borraron los 3 hilos (CAMEL, OPTIK, MARINO 2/30) con sus presentaciones, sus
  718 paquetes, existencias y mínimos, las 3 cargas, el kardex, el traspaso, la venta POS-8FE6, el
  cliente "la esperanza" con su crédito, el turno de caja abierto y la semana de nómina de prueba;
  los contadores de esas tablas volvieron a 1. Se quedaron: configuración, cuentas de banco,
  almacenes, la caja, el personal (5), puestos y permisos, materiales, líneas, listas de precio,
  métodos de pago, paqueterías y los empleados de nómina con su horario. Respaldo previo:
  `/root/respaldos/hitex_antes_de_limpiar_20261006-202201.sql.gz`. La próxima carga de la lista
  del proveedor vuelve a crear los hilos SIN precio.
- **SE SUBE TODO LO QUE SE TERMINA (2026-10-06).** "Todo lo que vayas haciendo lo vas subiendo"
  (usuario): cada cambio terminado y probado se despliega sin preguntar (con su migración en las
  dos bases y respaldo previo de `hitex`). El commit sigue siendo solo cuando lo pida.
- **DETALLE DE UN HILO EN INVENTARIO (2026-10-06): DESPLEGADO** (20261006-141455). No necesita nada
  en la base. En producción, OPTIK 2/30 sale "no cuadra" por 1 kg: la venta POS-8FE6 se cobró por
  kilos sin escanear un paquete.
- **VARIOS PUESTOS POR PERSONA (2026-10-06): DESPLEGADO** (despliegue 20261006-131654, a petición
  del usuario: "hazlo y súbelo al servidor"). La migración `2026-10_varios_puestos.sql` está en
  LAS DOS bases (respaldo previo: `/root/respaldos/hitex_antes_varios_puestos_20261006-191639.sql.gz`).
  Nadie tiene puestos extra todavía: se dan en Personal → Editar → "También trabaja como".
- **TODO DESPLEGADO OTRA VEZ (2026-10-06, despliegue 20261006-124453).** "Ahora vas a subir cambios
  y ya no utilizaremos el de pruebas, ahora vamos a trabajar con producción 100%" (usuario).
  Subió todo lo del 2026-10-06: nómina por días/horario/horas extra/vacaciones, varias cuentas de
  banco, filtros de bultos, Surtir sucursal (en paquetes, se escanea al enviar, sale lo que hay),
  Vender revisado (hora de la tienda y lo fiado que se liquida solo), Surtir inventario (proveedor
  y papeles de la carga, costo solo para administración y Contabilidad) y Reportes → Venta por
  color. Se hizo con el servicio de producción PARADO: respaldo
  (`/root/respaldos/hitex_antes_despliegue_20261006-184304.sql.gz`), las cinco migraciones en
  `hitex` (nómina, cuentas, traspaso_bultos, traspaso_lo_que_salio, carga_proveedor_costo),
  `ajustar-hora.js --base hitex --confirmar` (764 filas en 20 tablas), `remesas.fecha_ingreso`
  recalculada con la hora ya local, código, y `liquidar-ventas-credito` (nada que liquidar).
  `estado-migraciones.js` dice que `hitex` está al día; el servicio contesta en `-06:00`.
  Las tres cargas de `hitex` se marcaron como una sola lista; ya no existen (ver la limpieza de
  abajo). Sin commit (el despliegue sube el working tree).
  Para dar el puesto Contabilidad a alguien: Personal → su puesto "contabilidad".
  **Falta decidir qué se hace con el sistema de pruebas** (8443, base `desarrollo`): el usuario
  ya no lo va a usar, pero las E2E solo corren ahí (en `hitex` nunca).
- **El usuario quitó 8 listas de `muestras/` el 2026-10-06** (dejó NEGRO 2-30 y puso seis
  `HTX … INVENTARIO.xlsx`). Siete E2E las usan y no corren sin ellas: remesas, cancelacion,
  carga-por-producto, bultos-estado, trazabilidad (MARINO OSCURO 2-30), traspaso-paquetes
  (BLANCO 2-30) y bajar-a-mostrador (ROJO 1-30). Siguen en git: preguntar si se recuperan o si se
  cambian las pruebas (`e2e-surtir-inventario.js` ya arma sus bultos en el código).
- **Nómina:** falta capturar el horario y la fecha de ingreso de cada empleado (sin horario, el
  recibo paga la semana completa como antes; sin fecha de ingreso no hay vacaciones).
- **DOS SISTEMAS Y DOS BASES EN EL SERVIDOR (2026-10-05).** "Créame ahora sí la base de producción
  solo con el usuario admin… y esta me la dejas para hacer pruebas; que la base se llame hitex".
  · **Producción**: https://devtristan.cloud → servicio `tienda-hilos-api` (puerto 3000) → base
    **`hitex`**. Nació con la estructura clonada de `desarrollo` (idéntica en `information_schema`)
    y SOLO con lo que no tiene pantalla: roles, permisos y `rol_permisos`, unidades, métodos de
    pago, IVA, líneas, paqueterías, el tipo de cliente "Público" y las claves de `configuracion`
    vacías; y un solo usuario, el administrador (id 1, mismo correo y contraseña). Todo lo demás
    lo captura el usuario desde el panel.
  · **Pruebas**: https://devtristan.cloud:8443 → servicio `tienda-hilos-pruebas` (puerto 3001,
    mismo código, `/etc/tienda-hilos/pruebas.env` con `DB_NAME`, `PORT`, `UPLOADS_DIR` y un
    `JWT_SECRET` propio) → base **`desarrollo`**, con la muestra. nginx le pone "PRUEBAS ·" al
    título y una etiqueta roja (`sub_filter` en `conf.d/tienda-hilos-pruebas.conf`).
  · El `.env` LOCAL apunta a `desarrollo`: lo que se hace desde aquí es PRUEBA.
  · **Ninguna E2E ni el sembrado corren contra `hitex`**, ni con `E2E_ACEPTO_PRODUCCION`
    (`backend/scripts/_produccion.js`). El seguro anterior miraba solo el host, y ahora las dos
    bases viven en el mismo.
  · **Una migración nueva se aplica en LAS DOS bases** (y se audita en las dos).
  · `npm run deploy` reinicia los dos servicios; ver `deploy/README.md`.
- **TODO ESTÁ DESPLEGADO (2026-10-04, despliegue 20261004-181551)**: el rediseño y todo lo del
  2026-10-03 (cargas en PDF, lista completa del proveedor con avance, costo apagado, hilo parado a
  precio de venta, Clientes → Dejaron de venir, frecuencia en kilos y dinero). El usuario lo pidió:
  "súbeme cambios al servidor, ahora sí sube todo". Se aplicó también la migración
  `2026-10_alertas_stock_con_minimo.sql` (la base está al día). NO se hizo commit: el despliegue
  sube el working tree. Siguen esperando su visto bueno: los permisos de
  fábrica (al cajero se le dejaron fuera "confirmar que llegó un envío" y "bajar conos", que el
  diseño le marcaba, porque no ve Surtir ni Inventario), y que el almacén marcado
  `es_tienda_linea` no se puede dar de baja mientras esa marca siga escondida.
- **LA HORA DE LA TIENDA YA SE CORRIGIÓ EN LAS DOS BASES (2026-10-06).** `ajustar-hora.js` dejó su
  marca `_zona_horaria` en `desarrollo` y en `hitex`, y no se vuelve a correr. Lo que escriben los
  scripts con conexión propia (E2E, `aplicar-migracion.js`) sigue en UTC: un `NOW()` dentro de
  una migración nueva queda 6 h adelante. Ver "2026-10-06 (8)" y "(10)" en CAMBIOS.txt.
- **El efectivo de un pedido en línea pagado en el mostrador no entra a ningún turno.** Se marca
  pagado, pero el corte no lo espera. Falta decidir si se cobra por la caja.
- **Las E2E corren contra la base de PRUEBAS (`desarrollo`, remota)** con `E2E_ACEPTO_PRODUCCION=si`
  (lo autorizó el usuario el 2026-10-01 cuando esa era la de producción; desde el 2026-10-05 la
  real es `hitex` y ahí no corren nunca). Apartados,
  crédito y margen abren su PROPIA caja temporal —antes vendían en el turno REAL 88 de
  Cuautepec— y borran los movimientos por turno, no por `referencia_id`. Las que limpiaban con
  `nuevos(tabla)` —TODO lo creado durante la corrida— ahora borran solo lo nuevo que es suyo:
  `scripts/_propios.js` lo reconoce por el prefijo TMP o porque cuelga de algo TMP (2026-10-02).
  Una prueba nueva tiene que nombrar lo que crea con TMP y limpiar con `soloPropios`; si abre
  caja, borra sus turnos con `borrarTurnosPropios` y sus cajas con `borrarCajasSinTurnos`, que
  respetan el turno donde alguien más cobró: el 2026-10-03 un abono hecho desde el panel cayó en
  la caja de una prueba, porque el modal de abono propone el primer turno abierto (era una prueba
  del usuario; se borró). **No se corren mientras alguien use el sistema de pruebas.**
  Para correrlas TODAS contra un solo servidor hay que pasar `BASE=http://localhost:3210/api/v1`:
  cada script trae su propio puerto por omisión (3210, 3216… 3234) y sin `BASE` la mitad sale
  con ECONNREFUSED sin haber probado nada. La del 2026-10-02: 20 pasan (492 comprobaciones), la
  del checkout se salta mientras la tienda esté apagada, y la base quedó idéntica.
  **La caja de Cuautepec está DESACTIVADA con su turno 88 abierto** (desde antes del rediseño):
  las pruebas que toman "la primera caja activa" usan la de Moroleón.
  Para comprobar que no tocaron nada: una foto de conteos y sumas de ids por tabla antes y
  después.
- **La base de PRUEBAS (`desarrollo`) tiene una MUESTRA sembrada (2026-10-01):** 18 hilos, 40
  clientes y tres meses de ventas INVENTADOS, mezclados con lo capturado antes, para enseñarle el
  sistema a un cliente. (Hasta el 2026-10-05 era la de producción; `hitex` nació sin ella.) No los tomes por datos del negocio. Todo está anotado en `_demo_registros`. Se borra
  con `node scripts/demo/limpiar.js --base desarrollo --confirmar` (desde `backend/`), que
  además regresa la configuración, vuelve a desactivar "tienda moroleon" y recalcula la nómina
  real que tocó. Las ventas de la muestra solo usan hilos de la muestra: nunca le cargues una
  venta de muestra a un hilo real, o la limpieza ya no podrá separar lo uno de lo otro.
- La base se limpió el 2026-07-26 para empezar a capturar en serio: NO hay productos, ni
  inventario, ni pedidos. Se conservó el personal y la configuración (almacenes, cajas,
  materiales, líneas, unidades, métodos de pago, tipo de cliente). Respaldo del estado
  anterior en `db/dump_desarrollo_antes_de_limpiar.sql`.
- Los materiales se llaman `ACRILAN` y `VISCOSA`, en mayúsculas. Conviene renombrarlos a
  "Acrilán" y "Viscosa". (El duplicado `ACRILAN2` y el producto `TR1GRAFITO` ya se
  eliminaron.)
- **La configuración de la tienda está vacía en `hitex`.** El checkout ya funciona, pero el envío
  sale en $0.00 y no hay datos de depósito, así que al cliente que elija transferencia se le pide
  que llame. Va en Admin → Configuración. (En pruebas tiene datos de demostración.)
- **Cambiar dos contraseñas.** La contraseña de root de MySQL del servidor y la
  llave de la API de Google Gemini se escribieron en el chat del asistente de
  código, así que quedaron en un historial de conversación. Al cambiarlas,
  actualizar `backend/.env`, `backend/.env.produccion` y el `.env` del servidor.
  La de Gemini se saca en aistudio.google.com/apikey. Conviene además borrar la
  llave de DeepSeek en su consola: ya no se usa, pero sigue viva.
- **Cerrar el puerto 3306 del servidor.** Hoy MySQL acepta conexiones desde
  cualquier parte de internet y lo único que la protege es la contraseña; adentro
  hay correos de clientes y hashes. Debería aceptar solo local y llegarle por
  túnel SSH. Pendiente porque en esta máquina no hay llave SSH.
- **Comprobar las migraciones antes de dar una por aplicada.** El 2026-09-05 se descubrió que
  `2026-07_traspasos_estados.sql` nunca corrió en "desarrollo" pese a que la bitácora la daba
  por aplicada: la campana y Surtir sucursal devolvían 500. Se auditan contra
  `information_schema`, no contra `CAMBIOS.txt`, y desde el 2026-10-05 en LAS DOS bases
  (`hitex` y `desarrollo`): `/root/comparar_bases.sh` en el servidor dice si sus estructuras
  siguen idénticas.

## Roadmap sugerido (en este orden)
1. Backend: conexión a BD + auth (registro/login usuarios y clientes con JWT).
2. Backend: CRUD de catálogo (categorías, productos, variantes, imágenes).
3. Backend: inventario (existencias, movimientos, alertas de stock).
4. Backend: ventas (crear pedido POS y online, pagos, envíos) + caja.
5. Backend: reportes (ventas del día, corte de caja, por reabastecer, más vendidos).
6. Frontend Angular: panel admin → POS → tienda en línea.
