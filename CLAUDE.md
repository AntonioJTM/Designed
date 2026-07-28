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
  (`utils/xlsx.js`), sin dependencias, porque el formato es fijo. Solo se leen las columnas A
  (código), B (peso), C (lote) y F (conos): las de fecha vienen vacías y los renglones en blanco
  se ignoran sin avisar.
  **Es el vaciado masivo del catálogo.** `POST /remesas` acepta `producto_id` además de
  `variante_id`: desde la pantalla de presentaciones se sube el archivo y, si el producto todavía
  no tiene presentación, SE CREA —SKU derivado del nombre, tipo `paquete` (o `simple` si no es
  multipresentación), peso = PROMEDIO de los bultos, precio = `productos.precio_kg`— y luego entran
  los bultos y la mercancía. Una remesa posterior reutiliza la presentación. Se admite cargar sobre
  `paquete` o `simple` (ambos se llevan en kilos); sobre un `cono` da 422 `NO_ES_PAQUETE`.
  Varios lotes distintos pueden ser del MISMO hilo (el archivo real trae dos): el lote es una
  etiqueta del bulto y todos suman al mismo saldo, no se separa el inventario.
- **Se cobra por el peso del bulto, no por el nominal.** Los bultos pesan distinto entre sí
  (10.750 a 19.800 kg contra un nominal de 19.094). Al escanear un código en el mostrador,
  resuélvelo con `GET /variantes/resolver/:codigo`: devuelve `{ variante, bulto }`, donde `bulto`
  trae su `peso_kg` real, su lote y sus conos, o viene en `null` si el código es el principal de
  la presentación. Un 404 significa "no es un código" y el POS cae a la búsqueda por texto.
  Dos bultos distintos SUMAN sus pesos; el mismo bulto escaneado dos veces NO se cobra doble
  (es una pieza física única).
- **El pedido guarda de qué bultos salió.** `pedido_detalle_bultos` liga cada línea con los bultos
  que se entregaron. El código, el peso y el lote se **congelan** ahí, igual que
  `pedido_detalle.precio_unitario`: `variante_codigo_id` es la referencia viva y queda en `NULL`
  si el bulto se borra, pero el pedido sigue diciendo qué se entregó. Se insertan dentro de la
  MISMA transacción de la venta. Es opcional: la tienda en línea y las ventas a granel no mandan
  bultos.
- **Un bulto se consume UNA vez.** `variante_codigos.estado` es `disponible` | `vendido` |
  `desarmado`, con `consumido_en`, `consumido_tipo` (`'pedido'`|`'conversion'`) y `consumido_id`.
  Vender o desarmar exige que esté `disponible` y bloquea la fila con `SELECT … FOR UPDATE` dentro
  de la transacción: si no lo está, 409 `BULTO_NO_DISPONIBLE` y se revierte la operación completa.
  Cancelar o devolver el pedido regresa sus bultos a `disponible`; reactivarlo retoma solo los que
  nadie más haya tomado. Un bulto `desarmado` no vuelve: ya son conos.
  El bulto SABE en qué almacén está (`variante_codigos.almacen_id`): lo pone la remesa que lo trajo
  y lo cambia el traspaso. Los capturados a mano quedan en NULL.
  **La ubicación del bulto es APROXIMADA; los saldos por almacén son la verdad.** La tienda NO
  escanea al sacar mercancía del almacén, solo al vender, y el traspaso asigna bultos por FIFO
  mientras quien surte se lleva los que tiene a mano. Por eso vender o desarmar **no valida** que el
  bulto estuviera en ese almacén —validarlo bloquearía ventas legítimas— y en cambio le CORRIGE la
  ubicación al almacén donde se escaneó. No añadas esa validación.
- **Cancelar o devolver repone el inventario.** `cambiarEstado` es transaccional: al pasar a
  `cancelado`/`devuelto` la mercancía regresa al almacén DE DONDE SALIÓ (`pedidos.almacen_id`, el
  de la caja que vendió o el de la tienda en línea) con su `movimientos_inventario` de entrada
  (`referencia_tipo='pedido'`, motivo "Cancelación de …" o "Devolución de …"). Reactivar el pedido
  vuelve a descontar y EXIGE existencias: si no alcanzan, 409 `STOCK_INSUFICIENTE` y el pedido no
  se mueve. Se compara el estado anterior contra el nuevo, así que cancelar dos veces no repone
  doble, y el `UPDATE` del estado va al final para que nada quede a medias.
- **Cancelar una venta de mostrador saca el efectivo de la caja.** Se inserta `movimientos_caja`
  tipo `'devolucion'`, que el corte ya resta (`SIGNO_CAJA` en `caja/model.js`), y los `pagos` pasan
  a `'reembolsado'`. Solo el EFECTIVO: la tarjeta la reembolsa el banco. Al reactivar entra como
  `'ingreso'` —no como `'venta'`— para no contarlo dos veces en los reportes.
  El turno YA CERRADO no se toca: si la venta fue en un turno cerrado, el dinero sale del turno
  ABIERTO de la misma caja. Si no hay ninguno abierto, 409 `CAJA_CERRADA` y NO se cancela nada
  (ni inventario, ni bultos, ni estado): todo o nada.
  El movimiento del dinero va ANTES de tocar inventario, para que ese 409 no deje nada movido.
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
- **El DESTARE lo captura la tienda.** Al enconar, el hilo pesa más porque cada cono lleva su tubo.
  `POST /inventario/desarmes` acepta `destare_kg` (opcional, total en kilos del desarme, no por
  cono) y se guarda en `variante_conversiones.destare_kg` —NO en la presentación, porque cada
  desarme puede llevar uno distinto—. `kg_consumidos` no cambia: del paquete sale su peso real y eso
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
    **Se pide en KILOS**, no en paquetes: "cuando me hacen un pedido no me dicen cuántos paquetes,
    yo mando por kilos" (usuario, 2026-07-28). La pantalla muestra a cuántos paquetes equivale
    —con el peso promedio REAL de los bultos que hay en ese almacén— pero eso es solo referencia:
    lo que viaja en `items[].cantidad` son kilos. `paquetes` sigue existiendo para capturar por
    bultos si algún día hace falta, y entonces sí el peso sale de los bultos elegidos.
  · `POST /inventario/traspasos/:id/enviar` **envía**: elige los bultos AHÍ (no al solicitar, porque
    el mostrador pudo vender alguno), revalida, descuenta del origen con su movimiento, libera el
    apartado y manda los bultos al destino. La mercancía queda en camino: **salió del origen y
    todavía no entra al destino**, a propósito.
    Cuando se pidió en kilos, salen los kilos EXACTOS (no se redondea a bultos enteros) y los bultos
    se acomodan solos: se mueven los más antiguos que caben sin pasarse de esos kilos. **Nadie
    escanea al enviar** —solo se escanea al vender y al desarmar— así que la ubicación del bulto es
    aproximada, como siempre, y se corrige cuando lo escanean en la sucursal.
  · `POST /inventario/traspasos/:id/recibir` **recibe**: lo firma cualquiera del staff y queda su
    nombre y la hora. Acepta `recibido: [{detalle_id, paquetes|cantidad}]` para declarar lo que de
    verdad llegó; entra al destino solo eso y el faltante se asienta como **merma** con el folio
    (422 `RECIBE_MAS_DE_LO_ENVIADO` si dice que llegó más).
  · `POST /inventario/traspasos/:id/cancelar`: si estaba solicitado libera el apartado; si iba en
    tránsito la mercancía REGRESA al origen y los bultos vuelven. Un recibido ya no se cancela
    (409): eso se corrige con un traspaso de vuelta.
  **El apartado es BLANDO.** Se ve en inventario y otra solicitud no puede pedir lo ya apartado,
  pero la venta de mostrador NO lo respeta —el cliente que está enfrente manda— así que
  `cantidad_reservada` puede quedar por encima de `cantidad`; el envío lo detecta y avisa. No metas
  la reserva en la validación de la venta sin decidirlo con el usuario.
  **Solo PAQUETES.** Un cono da 422 `NO_SE_TRASPASAN_CONOS`: a la sucursal se le manda el paquete
  cerrado y allá se desarma.
- **Matriz → sucursales, por PAQUETES.** El almacén marcado con `almacenes.es_matriz` (único, como
  `es_tienda_linea`) es el que surte a las demás.
  Las líneas de `paquete` se capturan en PAQUETES —los paquetes son cerrados y nadie los pesa— y el
  backend toma los bultos que DE VERDAD hay en el origen, los más antiguos primero (FIFO),
  descuenta SU peso real y los MUEVE al destino. Así la cuenta cuadra aunque cada bulto pese
  distinto (10.75 a 19.80 kg). Si no hay bultos ubicados que cubran lo pedido, cae al peso nominal
  y lo marca con `peso_estimado`. NO se traspasa escaneando: en una bodega con cientos de bultos
  nadie busca uno concreto (decisión explícita del usuario). Para traducir kilos a paquetes está
  `GET /inventario/equivalencia-paquetes`, que usa el peso PROMEDIO REAL, no el nominal. Es todo-o-nada: si una línea no alcanza, se revierte el traspaso
  completo. En la sucursal se desarma después con `POST /inventario/desarmes`.
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
  desaparece. El CONO es la única variante extra y vive en su propia sección ("Conos para
  mostrador"), que solo aparece si ya hay paquete: existe únicamente para poder desarmar y vender
  por pieza. Su SKU se deriva del paquete (`<PAQUETE>-CONO`).
- **El formulario de producto NO captura presentaciones.** Ahí solo van los datos del hilo
  (nombre, material, línea, calibre, precio por kilo, banderas). Los SKU y las imágenes viven en
  `/admin/productos/:id/presentaciones`, y la idea es llenarlos con el vaciado masivo del Excel.
- **Precio por tipo de cliente.** `producto_variantes.precio` es el PRECIO PÚBLICO. Los demás tipos
  llevan su precio propio en `variante_precios` (variante + tipo). Al vender, la prelación es:
  precio del tipo > `precio_oferta` > público. `pedidos.tipo_cliente_id` deja constancia de con qué
  lista se cerró, y `pedido_detalle.precio_unitario` lo congela. El tipo marcado `es_publico` NO
  guarda filas en `variante_precios`: su precio vive en la variante y no se duplica.
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

## Convenciones de UI
- **Las notificaciones van en la barra, junto al nombre y el tipo de usuario** (la campana de
  `admin-layout`). Son pendientes VIVOS que se calculan de la base con `GET /notificaciones`
  (`modules/notificaciones`): solicitudes de traspaso por surtir, envíos por acusar recibo y
  existencias bajo su mínimo. **No hay tabla de notificaciones ni "marcar como leída"** a propósito:
  el aviso tiene que estar ahí hasta que el pendiente se resuelva, y una marca de leído solo lo
  taparía. Se refresca cada minuto y al abrir el panel. El panel FLOTA hacia arriba sobre el menú:
  dentro del flujo empujaba la barra (que mide 100vh) y se salía de la pantalla.
- **Inventario contesta tres preguntas, en ese orden.** Es como las hace la tienda y por eso la
  pantalla está armada así: (1) *cuánto hay en cada almacén* → una tarjeta por almacén con su
  cifra, su parte del total y el desglose paquete/enconado; (2) *dónde está cada hilo* → gráfica
  de barras apiladas (`shared/charts/stacked-bars.ts`), un renglón por hilo y un tramo por
  almacén; (3) *el detalle exacto* → tabla agrupada por hilo y buscador. **Las presentaciones del
  mismo hilo van JUNTAS** en la tabla, con el nombre una sola vez: antes cada una era un
  renglón suelto con el nombre repetido y parecía que la tabla tenía duplicados.
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
  "0 productos · sin existencias · 1 bajo mínimo" en un almacén vacío.
- **Gráficas: la paleta está validada, no la cambies a ojo.** `--viz-series-1..3` son los tres
  primeros slots de la paleta de referencia y pasan las puertas de daltonismo y de visión normal
  contra el fondo blanco de las tarjetas. Un CUARTO color no se agrega sin volver a correr el
  validador de la guía (`dataviz`): del cuarto almacén en adelante se usa `--viz-otros` (gris) y el
  detalle exacto lo da la tabla. Reglas que hay que respetar al tocar una gráfica: hueco de 2 px
  del color del fondo entre tramos (NUNCA un borde), redondeo de 4 px solo en el extremo del dato,
  leyenda siempre que haya dos series o más, y una sola etiqueta directa (el total) — los tramos de
  en medio los explica el tooltip.
- **Una gráfica ancha va en `.chart-box`.** El SVG se estira al ancho que le den, así que un
  viewBox angosto dentro de una tarjeta de 1,300 px escala el texto al doble y se ve tosca. El tope
  de `.chart-box` la deja dibujada casi a su tamaño real.
- **La pantalla es para MIRAR; las acciones son modales.** Los listados (productos, materiales,
  inventario) muestran datos y ponen las acciones en botones del encabezado o del renglón, que
  abren un modal. No dejes formularios desplegados en la pantalla: Inventario llegó a tener siete
  bloques apilados y no se encontraba nada. El modal se crea al abrirlo y se destruye al cerrarlo,
  así arranca limpio.
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
- **Nunca uses `computed()` para una vista previa que dependa de campos `[(ngModel)]`.** Un
  `computed` solo se invalida cuando cambia una SEÑAL; sobre propiedades normales se calcula una vez
  y se queda pegado, así que el preview miente al teclear. Ya pasó en el desarme (los "kilos reales"
  no movían el cálculo). Usa un MÉTODO normal —la detección de cambios lo reevalúa en cada tecla— o
  convierte los campos a señales. `computed` sí es correcto cuando todo lo que lee son señales
  (`input()`, `signal()`).
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
- [ ] Checkout de la tienda en línea: aún no captura dirección de envío, cupón ni pago,
      así que el pedido queda en estado `pendiente`.
- [x] Alta y edición de cajas desde el panel (POS → Administrar cajas), solo administradores.
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
- [ ] No hay pantalla para administrar tipos de cliente; hoy se crean por API
      (`POST /api/v1/tipos-cliente`). Solo existe "Público". Cuando el usuario defina los demás
      (medio mayoreo, mayoreo, especial), hace falta la pantalla.

## Pendientes concretos para el usuario
- La base se limpió el 2026-07-26 para empezar a capturar en serio: NO hay productos, ni
  inventario, ni pedidos. Se conservó el personal y la configuración (almacenes, cajas,
  materiales, líneas, unidades, métodos de pago, tipo de cliente). Respaldo del estado
  anterior en `db/dump_desarrollo_antes_de_limpiar.sql`.
- Los materiales se llaman `ACRILAN`, `ACRILAN2` y `VISCOSA`. Ahora que la línea (turco/nacional/
  chino) es campo aparte, conviene renombrarlos a "Acrilán" y "Viscosa" y eliminar el duplicado.
- El producto `TR1GRAFITO` está sin `multipresentacion`: si va a manejarse en paquetes, hay que
  marcarlo.

## Roadmap sugerido (en este orden)
1. Backend: conexión a BD + auth (registro/login usuarios y clientes con JWT).
2. Backend: CRUD de catálogo (categorías, productos, variantes, imágenes).
3. Backend: inventario (existencias, movimientos, alertas de stock).
4. Backend: ventas (crear pedido POS y online, pagos, envíos) + caja.
5. Backend: reportes (ventas del día, corte de caja, por reabastecer, más vendidos).
6. Frontend Angular: panel admin → POS → tienda en línea.
