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
- **El checkout en línea NO cobra.** El cliente elige transferencia o efectivo en tienda y el
  pedido nace `pendiente`, con un `pagos` en estado `'pendiente'` por el total —la INTENCIÓN de
  pago, no dinero cobrado—. Un administrador lo confirma al ver el depósito o al cobrar en el
  mostrador. No hay pasarela y no se guardan datos de tarjeta. La tabla `metodos_pago` trae
  además tarjeta, PayPal y Mercado Pago: la tienda en línea **no los ofrece** (el filtro está
  en `metodosOfrecidos`, en `checkout.ts`), porque ofrecerlos sería prometer algo que no existe.
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
- **El comprobante del depósito lo sube el PERSONAL, y da el pedido por pagado.** El cliente
  manda la captura por fuera (WhatsApp, correo) y el administrador la sube en el detalle del
  pedido. Es UN PASO —decisión del usuario el 2026-09-05—: el `pagos` queda `'completado'` y el
  `pedidos` pasa a `'pagado'` en la misma transacción, sin estado intermedio "por validar".
  Quitar la captura NO descobra el pedido: el dinero entró, y para deshacerlo está el cambio
  de estado.
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
- **Un abono en EFECTIVO entra a la caja.** Se inserta `movimientos_caja` tipo `'ingreso'` —no
  `'venta'`, para que no lo cuenten los reportes de ventas: cobrar una deuda vieja no es vender
  hoy—. Con el turno cerrado se rechaza (409 `FALTA_SESION_CAJA`) ANTES de tocar el saldo: si no,
  habría dinero en el cajón que ninguna venta explica y el cajero aparecería con un sobrante
  inexplicable. Por transferencia no toca caja.
  Cobrar más de lo que se debe se rechaza (422 `ABONO_EXCEDE_DEUDA`): un saldo negativo se leería
  como crédito a favor, y no es eso.
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
  calculadas de la base al momento — no hay tablas de resumen que mantener ni proceso nocturno:
  · **Cobranza** (`/analisis/cobranza`): quién debe, por antigüedad. Los días se miden desde el
    ÚLTIMO MOVIMIENTO de la cuenta, no desde el cargo: quien abonó la semana pasada está pagando, y
    tratarlo como moroso llevaría a cobrarle a quien no toca.
  · **Clientes enfriados** (`/analisis/clientes-enfriados`): exige **2 compras mínimo** —quien vino
    una vez hace meses no es un cliente perdido, es alguien que pasó— y compara los días sin venir
    contra SU PROPIO ritmo (`veces_su_ritmo`), no contra un número fijo.
  · **Hilo muerto** (`/analisis/hilo-muerto`): existencias sin venderse. Se valora AL COSTO cuando
    se conoce y al precio de venta cuando no, marcándolo con `valorado_a` para no presentar una
    cifra como si fuera lo que no es. Un hilo que NUNCA se vendió cuenta desde que entró: es el caso
    más importante y filtrarlo por "última venta" lo dejaría fuera justo por no tener ninguna.
  · **Margen** (`/analisis/margen`): sobre la VENTA, no sobre el costo, que es como se lee un margen
    comercial. Solo cuenta las líneas con costo capturado.
  El hilo muerto y el margen son **solo administradores y gerentes**: exponen costos.
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

## Convenciones de UI
- **Las notificaciones van en la barra, junto al nombre y el tipo de usuario** (la campana de
  `admin-layout`). Son pendientes VIVOS que se calculan de la base con `GET /notificaciones`
  (`modules/notificaciones`): solicitudes de traspaso por surtir, envíos por acusar recibo y
  existencias bajo su mínimo. **No hay tabla de notificaciones ni "marcar como leída"** a propósito:
  el aviso tiene que estar ahí hasta que el pendiente se resuelva, y una marca de leído solo lo
  taparía. Los avisos de CLIENTES cuentan **uno por tema**, no uno por cliente: "5 clientes
  te deben desde hace más de 30 días" es un aviso, no cinco, o la campana marcaría 40 y
  nadie la abriría. Los umbrales tienen nombre en `notificaciones/model.js`
  (`DIAS_SIN_ABONAR`, `DIAS_SIN_VENIR`, `DIAS_CLIENTE_NUEVO`), no van sueltos en el SQL. Se refresca cada minuto y al abrir el panel. El panel FLOTA hacia arriba sobre el menú:
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
- [ ] Nada del checkout se ha probado en el NAVEGADOR: compila, pasa 12 pruebas unitarias y
      31 comprobaciones E2E, pero nadie lo ha abierto.
- [x] Expediente del cliente y crédito (BACKEND, 36 comprobaciones E2E): alta sin cuenta desde
      el panel, búsqueda por apodo y teléfono, historial de compras, qué colores compra más,
      límite de crédito, venta a crédito (incluso mixta), abonos que entran a la caja, estado de
      cuenta y lista de quién debe.
      Migración: `db/migrations/2026-09_clientes_expediente_credito.sql`.
- [ ] **Falta el FRONTEND de clientes:** capturar al cliente en el POS al vender, la pantalla de
      clientes del panel con su expediente, y la pantalla de cobranza. El backend está listo y
      probado, pero sin pantallas no se puede usar.
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
- [x] Campo de precio de compra en los DOS cargadores de remesa (Recibir remesa y la pantalla
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

## Pendientes concretos para el usuario
- La base se limpió el 2026-07-26 para empezar a capturar en serio: NO hay productos, ni
  inventario, ni pedidos. Se conservó el personal y la configuración (almacenes, cajas,
  materiales, líneas, unidades, métodos de pago, tipo de cliente). Respaldo del estado
  anterior en `db/dump_desarrollo_antes_de_limpiar.sql`.
- Los materiales se llaman `ACRILAN` y `VISCOSA`, en mayúsculas. Conviene renombrarlos a
  "Acrilán" y "Viscosa". (El duplicado `ACRILAN2` y el producto `TR1GRAFITO` ya se
  eliminaron.)
- **La configuración de la tienda está vacía.** El checkout ya funciona, pero el envío sale
  en $0.00 y no hay datos de depósito, así que al cliente que elija transferencia se le pide
  que llame. Va en Admin → Configuración.
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
  `information_schema`, no contra `CAMBIOS.txt`.

## Roadmap sugerido (en este orden)
1. Backend: conexión a BD + auth (registro/login usuarios y clientes con JWT).
2. Backend: CRUD de catálogo (categorías, productos, variantes, imágenes).
3. Backend: inventario (existencias, movimientos, alertas de stock).
4. Backend: ventas (crear pedido POS y online, pagos, envíos) + caja.
5. Backend: reportes (ventas del día, corte de caja, por reabastecer, más vendidos).
6. Frontend Angular: panel admin → POS → tienda en línea.
