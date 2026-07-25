# Proyecto: Sistema de gestión para tienda de hilos

Contexto para el asistente de código. Léelo completo antes de generar o modificar archivos.

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
  - Alternativa PostgreSQL disponible en `db/schema_postgres.sql`.
- **Backend/API:** Node.js + Express (REST, JSON). Usar `mysql2/promise` para el pool de conexiones.
- **Frontend:** Angular (standalone components + Angular Router; UI a definir).
- **Auth:** JWT. Contraseñas con `bcrypt`. Nunca guardar texto plano.

## Estructura de carpetas objetivo
```
tienda-hilos/
├── CLAUDE.md               ← este archivo
├── README.md
├── db/
│   ├── schema_mysql.sql    ← esquema principal (VALIDADO, 44 tablas)
│   ├── schema_postgres.sql ← equivalente en PostgreSQL
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
  (`utils/xlsx.js`), sin dependencias, porque el formato es fijo.
- **Matriz → sucursales.** El almacén marcado con `almacenes.es_matriz` (único, como
  `es_tienda_linea`) es el que surte a las demás; el formulario de traspasos lo propone como
  origen. Se surte con `POST /inventario/traspasos`:
  un documento con folio y varias líneas, movimiento inmediato (no hay estado "en tránsito"). Las
  líneas de variantes `paquete` se capturan en PAQUETES y el backend las convierte a kilos, que es
  como se lleva su inventario. Es todo-o-nada: si una línea no alcanza, se revierte el traspaso
  completo. En la sucursal se desarma después con `POST /inventario/desarmes`.
- **Precio por tipo de cliente.** `producto_variantes.precio` es el PRECIO PÚBLICO. Los demás tipos
  llevan su precio propio en `variante_precios` (variante + tipo). Al vender, la prelación es:
  precio del tipo > `precio_oferta` > público. `pedidos.tipo_cliente_id` deja constancia de con qué
  lista se cerró, y `pedido_detalle.precio_unitario` lo congela. El tipo marcado `es_publico` NO
  guarda filas en `variante_precios`: su precio vive en la variante y no se duplica.
- **Banderas del producto.** `multipresentacion` habilita las presentaciones paquete/cono: sin ella
  el backend rechaza crear variantes que no sean `simple`. `por_lotes` habilita capturar
  `producto_variantes.lote`, que es solo una ETIQUETA de remesa: el inventario NO se separa por
  lote, el saldo sigue siendo uno por variante y almacén.
- **Paquete → conos.** El producto entra en paquetes (peso fijo, se venden por kilo) y se desarma
  en conos (se venden por pieza) para bajarlos a mostrador. Lo dice
  `producto_variantes.tipo_presentacion` (`paquete` | `cono` | `simple`), que además define si la
  cantidad va en kilos o en piezas y qué significa `precio`. Un cono apunta a su paquete con
  `origen_variante_id` + `piezas_por_origen`; con `modo_precio='calculado'` su precio lo deriva el
  backend —`(paquete.precio × paquete.peso_kg) / piezas_por_origen`— y se resincroniza al cambiar
  el paquete. Desarmar va SIEMPRE por `POST /inventario/desarmes`, nunca moviendo existencias a
  mano: es una transacción que descuenta kilos, da entrada a piezas y deja las dos patas en el
  kardex con `referencia_tipo='conversion'` y el mismo folio. El desarme acepta un `kg` opcional
  para consumir el peso REAL del bulto cuando no coincide con el nominal; los conos generados no
  cambian.
- **Todo se vende por peso.** `unidades_medida` solo contiene gramo, kilogramo y tonelada; no hay
  unidades de conteo. El precio de la variante es *por esa unidad* y las cantidades son decimales
  (`DECIMAL(12,3)`, o sea hasta 1 gramo de resolución). Cualquier campo de captura de cantidad debe
  usar `step="0.001"`, nunca enteros, y mostrar la unidad junto al número. La excepción son los
  conos, que son piezas: usa `unidad_venta` de la variante para saber cuál rotular.
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
- [x] Base de datos diseñada y **validada** (corre sin errores en MySQL y PostgreSQL).
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
- [ ] Los traspasos son inmediatos: no hay estado "en tránsito" ni confirmación de recepción.
      Decisión explícita del usuario; si algún día importa el tiempo de camino, hay que agregarlo.

## Roadmap sugerido (en este orden)
1. Backend: conexión a BD + auth (registro/login usuarios y clientes con JWT).
2. Backend: CRUD de catálogo (categorías, productos, variantes, imágenes).
3. Backend: inventario (existencias, movimientos, alertas de stock).
4. Backend: ventas (crear pedido POS y online, pagos, envíos) + caja.
5. Backend: reportes (ventas del día, corte de caja, por reabastecer, más vendidos).
6. Frontend Angular: panel admin → POS → tienda en línea.
