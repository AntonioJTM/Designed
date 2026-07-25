# Backend · Tienda de hilos

API REST en Node.js + Express con `mysql2/promise`. Autenticación JWT y contraseñas con bcrypt.

## Requisitos
- Node.js >= 18
- MySQL 8 / MariaDB 10.5+ con el esquema de [`db/schema_mysql.sql`](../db/schema_mysql.sql) ya cargado.

## Puesta en marcha
```bash
cd backend
cp .env.example .env      # y ajusta credenciales de BD + JWT_SECRET
npm install
npm run dev               # nodemon, recarga en caliente
# o
npm start
```

El servidor arranca en `http://localhost:3000` y verifica la conexión a la BD al iniciar.

## Estructura
```
src/
├── config/       env.js (variables) · db.js (pool + withTransaction)
├── middlewares/  auth.js (JWT) · error.js · validate.js (zod)
├── utils/        jwt.js · password.js (bcrypt)
├── modules/
│   ├── usuarios/ staff  → model/service/controller/routes
│   ├── clientes/ cuenta de cliente
│   └── nomina/   nómina semanal del personal
├── routes.js     enrutador /api/v1
├── app.js        app Express
└── server.js     arranque + apagado ordenado
```

## Endpoints de autenticación
Todas las respuestas tienen la forma `{ "data": ..., "error": null }` o `{ "data": null, "error": {...} }`.

| Método | Ruta | Descripción | Auth |
| ------ | ---- | ----------- | ---- |
| POST | `/api/v1/usuarios/registro` | Alta de staff (`rol_id`, `nombre`, `correo`, `contrasena`, `telefono?`) | — |
| POST | `/api/v1/usuarios/login` | Login de staff | — |
| GET  | `/api/v1/usuarios/perfil` | Perfil del staff autenticado | Bearer (staff) |
| POST | `/api/v1/clientes/registro` | Alta de cliente (`nombre`, `correo`, `contrasena`, `telefono?`, `acepta_marketing?`) | — |
| POST | `/api/v1/clientes/login` | Login de cliente | — |
| GET  | `/api/v1/clientes/perfil` | Perfil del cliente autenticado | Bearer (cliente) |

El token se envía en el header `Authorization: Bearer <token>`. El payload incluye
`{ sub, tipo: 'usuario'|'cliente', rol_id?, rol? }`.

### Ejemplo
```bash
# Registro de staff (rol_id 1 = administrador, ver seed del esquema)
curl -X POST http://localhost:3000/api/v1/usuarios/registro \
  -H "Content-Type: application/json" \
  -d '{"rol_id":1,"nombre":"Ana","correo":"ana@tienda.mx","contrasena":"secreta123"}'

# Login y uso del token
curl -X POST http://localhost:3000/api/v1/usuarios/login \
  -H "Content-Type: application/json" \
  -d '{"correo":"ana@tienda.mx","contrasena":"secreta123"}'

curl http://localhost:3000/api/v1/usuarios/perfil \
  -H "Authorization: Bearer <token>"
```

## Presentaciones: paquetes y conos

El producto entra en **paquetes** (peso fijo, se venden por kilo) y se "desarma" para bajarlo a
mostrador convertido en **conos** (se venden por pieza). Cada presentación es una variante propia,
con su existencia y su código de barras.

`producto_variantes.tipo_presentacion` define cómo se captura la cantidad y qué significa `precio`:

| tipo | cantidad en | `precio` es | campos que exige |
| --- | --- | --- | --- |
| `paquete` | kilos | precio por kilo | `peso_kg` |
| `cono` | piezas | precio de un cono | `origen_variante_id`, `piezas_por_origen`, `modo_precio` |
| `simple` | unidad del producto | precio por unidad | — |

Con `modo_precio: 'calculado'` el precio del cono lo deriva el backend repartiendo el valor del
paquete; con `'manual'` lo captura el usuario.

```
precio_cono = (paquete.precio × paquete.peso_kg) / piezas_por_origen
peso_cono   =  paquete.peso_kg / piezas_por_origen
```

Ejemplo: paquete de 10 kg a $200/kg = $2,000, 8 conos por paquete → cada cono pesa 1.250 kg y
cuesta $250.00. Al cambiar el precio por kilo del paquete, los conos con precio calculado se
recalculan solos; los de precio manual no se tocan.

Las respuestas de `/variantes` incluyen `unidad_venta` (`kg` o `pieza`) para que el POS y el
carrito rotulen la cantidad, y `paquete_sku` / `paquete_precio_kg` / `paquete_peso_kg` para poder
explicar de dónde salió el precio de un cono.

### Recibir remesas (carga masiva de bultos)

El proveedor manda una lista de empaque en Excel donde **cada renglón es un bulto físico**: su
código de barras, su peso real y su lote. El bulto NO es una presentación del catálogo: la
presentación es una sola (el paquete, con su precio por kilo) y los bultos son sus ejemplares, que
viven en `variante_codigos`.

Formato del archivo (una hoja, encabezado en el primer renglón):

| Col | Campo | Uso |
| --- | --- | --- |
| A | Código presentación* | Código de barras del bulto. Obligatorio y único en toda la base. |
| B | Cantidad * | Peso real del bulto en kilos. Obligatorio. |
| C | Lote | Lote de la remesa. |
| D | Fecha produccion | Se ignora (viene vacía). |
| E | Fecha caducidad | Se ignora (viene vacía). |
| F | CONO | Conos que rinde ese bulto. |
| G | PAQUETE | Se ignora (siempre 1: es el bulto). |

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| POST | `/api/v1/remesas/previa` | Recibe el `.xlsx` en crudo y devuelve la vista previa sin guardar nada |
| POST | `/api/v1/remesas` | Confirma: registra los bultos y da entrada al total en kilos |
| GET | `/api/v1/remesas` | Historial |
| GET | `/api/v1/remesas/:id` | Una remesa con sus bultos |

La vista previa devuelve el resumen (bultos, kilos, rango de peso, conos, desglose por lote), los
bultos ya normalizados y los avisos: renglones sin código o con peso inválido, códigos repetidos
dentro del archivo, códigos ya registrados en la base (bloqueantes) y bultos que rinden distinto
que la mayoría, que suelen venir incompletos.

Al confirmar, en una sola transacción: crea el folio `REM-…`, inserta los bultos en
`variante_codigos` y suma el total al inventario con un movimiento `entrada` de
`referencia_tipo='remesa'`. La presentación debe ser de tipo `paquete`, porque la remesa entra en
kilos.

El lector de `.xlsx` es propio (`src/utils/xlsx.js`, sin dependencias): la librería `xlsx` de npm
arrastra un aviso de seguridad sin arreglo publicado y el formato que se importa es fijo.

### Surtir sucursales (traspasos)

La matriz manda mercancía a las sucursales en **paquetes**: "70 de azul marino y 30 de verde".
Es un documento con folio y varias líneas; el movimiento es **inmediato** (no se modela el tiempo
de camino). En la sucursal deciden después si los desarman en conos o los venden por paquete.

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| POST | `/api/v1/inventario/traspasos` | `almacen_origen_id`, `almacen_destino_id`, `notas?`, `items[]` |
| GET | `/api/v1/inventario/traspasos` | Historial con sus líneas (`?almacen_destino_id=` filtra) |
| GET | `/api/v1/inventario/traspasos/:id` | Un traspaso con su contenido, para abrirlo desde el kardex |

Cada línea manda `paquetes` cuando la variante es de tipo `paquete`, o `cantidad` en la unidad de
la variante en los demás casos. **El inventario de un paquete se lleva en kilos**, así que el
backend convierte: 70 paquetes × 10 kg = 700 kg. La línea guarda ambos valores para poder auditar
lo que se capturó y lo que se movió.

Se escriben dos movimientos por línea (salida en origen, entrada en destino) con
`referencia_tipo='traspaso'` y el mismo `referencia_id`. Si una sola línea no tiene existencias
suficientes, **todo el traspaso se revierte** (una transacción).

```bash
curl -X POST http://localhost:3000/api/v1/inventario/traspasos \
  -H "Authorization: Bearer <token-staff>" -H "Content-Type: application/json" \
  -d '{"almacen_origen_id":1,"almacen_destino_id":3,"notas":"Envío semanal",
       "items":[{"variante_id":5,"paquetes":70},{"variante_id":6,"paquetes":30}]}'
```

### Desarmar

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| POST | `/api/v1/inventario/desarmes` | `cono_variante_id`, `almacen_origen_id`, `almacen_destino_id`, `paquetes` |
| GET | `/api/v1/inventario/conversiones` | Historial (`?variante_id=` filtra) |

En una sola transacción descuenta `paquetes × peso_kg` kilos del paquete en el origen, da entrada a
`paquetes × piezas_por_origen` conos en el destino, y escribe en el kardex una `salida` y una
`entrada` con `referencia_tipo='conversion'` y el mismo `referencia_id`, que es el folio en
`variante_conversiones`.

```bash
curl -X POST http://localhost:3000/api/v1/inventario/desarmes \
  -H "Authorization: Bearer <token-staff>" -H "Content-Type: application/json" \
  -d '{"cono_variante_id":3,"almacen_origen_id":2,"almacen_destino_id":1,"paquetes":2}'
```

Un paquete no se puede eliminar mientras tenga conos colgando (409 `PAQUETE_CON_CONOS`).

## Almacenes

Un almacén es **cualquier lugar que guarda existencias**: una tienda o una bodega. La diferencia la
marca `es_punto_venta` — una tienda es un almacén con mostrador, que vende y almacena a la vez. Al
abrir una sucursal se da de alta **un solo registro** aquí y se le asigna su caja.

Cada almacén lleva **su propio inventario**: una sucursal por almacén evita que dos tiendas
compartan existencias. Consultarlos es abierto (el catálogo público los necesita); crearlos,
editarlos o borrarlos es de **administrador**.

| Método | Ruta | Descripción | Auth |
| ------ | ---- | ----------- | ---- |
| GET | `/api/v1/almacenes` | Lista (`?activo=true` filtra) | — |
| GET | `/api/v1/inventario/resumen` | Qué hay en cada almacén: totales + matriz producto × almacén | Bearer (staff) |
| GET | `/api/v1/almacenes/tienda-linea` | El que surte la tienda en línea | — |
| GET | `/api/v1/almacenes/matriz` | El que surte a las sucursales | — |
| GET | `/api/v1/almacenes/:id` | Detalle | — |
| POST | `/api/v1/almacenes` | `nombre`, `direccion?`, `es_punto_venta?`, `es_tienda_linea?`, `es_matriz?`, `activo?` | Bearer (admin) |
| PUT | `/api/v1/almacenes/:id` | Igual, todo opcional | Bearer (admin) |
| DELETE | `/api/v1/almacenes/:id` | Solo si no tiene nada colgando | Bearer (admin) |

Reglas que aplica el backend:

- `es_tienda_linea` solo puede estar encendido en **un** almacén: al marcarlo en uno, se apaga en
  los demás.
- `es_matriz` marca el almacén que surte a las sucursales y también es único. El formulario de
  traspasos lo propone como origen. A diferencia del anterior, no tenerlo no rompe nada: solo
  obliga a elegir el origen a mano.
- No se puede quitar la marca ni desactivar el almacén que surte la tienda en línea sin designar
  otro antes (409 `TIENDA_SIN_ALMACEN`); si no, el catálogo web se quedaría sin existencias.
- No se puede borrar un almacén con existencias, movimientos, cajas, pedidos o desarmes
  (409 `ALMACEN_EN_USO`); el mensaje enumera qué lo está usando. Se desactiva en su lugar.

## Cajas del punto de venta

Cada caja pertenece a un almacén y **de ahí descuentan sus ventas**. Verlas es de cualquier staff
(el cajero las necesita para abrir turno); darlas de alta o modificarlas es de **administrador**.

| Método | Ruta | Descripción | Auth |
| ------ | ---- | ----------- | ---- |
| GET | `/api/v1/caja/cajas` | Lista con el nombre del almacén resuelto | Bearer (staff) |
| POST | `/api/v1/caja/cajas` | `almacen_id`, `nombre`, `activo?` | Bearer (admin) |
| PUT | `/api/v1/caja/cajas/:id` | Renombrar, cambiar almacén o activar/desactivar | Bearer (admin) |
| DELETE | `/api/v1/caja/cajas/:id` | Solo si la caja nunca abrió turno | Bearer (admin) |

Una caja que ya tuvo sesiones no se puede borrar (409 `CAJA_CON_HISTORIAL`), porque los cortes de
caja dependen de ella; en su lugar se desactiva con `activo: false`.

```bash
curl -X POST http://localhost:3000/api/v1/caja/cajas \
  -H "Authorization: Bearer <token-admin>" -H "Content-Type: application/json" \
  -d '{"almacen_id":1,"nombre":"Caja Cuautepec de Hinojosa"}'
```

## Kardex

`GET /api/v1/inventario/movimientos` no devuelve solo el tipo crudo: cada renglón trae el documento
que lo originó, resuelto a lenguaje de tienda.

| Campo | Qué trae |
| --- | --- |
| `concepto` | "Venta mostrador", "Traspaso a Tienda Moroleón", "Desarme de paquetes", "Entrada de mercancía"… |
| `folio` | `POS-…` o `TRA-…` cuando el movimiento viene de una venta o un traspaso |
| `detalle_tipo` / `detalle_id` | Documento que la pantalla puede abrir (`pedido`, `traspaso`, `conversion`) |
| `producto` | Nombre del producto, además del SKU |

Las dos patas de un traspaso comparten folio y se distinguen por el sentido: la salida dice
"Traspaso **a** <destino>" y la entrada "Traspaso **desde** <origen>". Desde el kardex se abre el
traspaso con `GET /inventario/traspasos/:id` para ver exactamente qué se mandó.

## Endpoints de nómina
Nómina semanal del personal. **Todos requieren rol `administrador`** porque exponen sueldos.

La semana va de **domingo a sábado** y se paga ese mismo sábado. La comisión se calcula sobre la
**venta neta** (`subtotal - descuento` de `pedidos`, sin IVA ni envío) de los pedidos donde el
empleado figura como vendedor (`pedidos.usuario_id`); los cancelados y devueltos no cuentan.

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/api/v1/nomina/empleados` | Staff con su configuración (`?solo_nomina=true` filtra a los activos) |
| PUT | `/api/v1/nomina/empleados/:usuarioId` | Alta/edición: `sueldo_base_semanal`, `paga_comision`, `porcentaje_comision`, `valor_hora_extra`, `activo` |
| GET | `/api/v1/nomina/periodos/actual` | Semana que contiene `?fecha=YYYY-MM-DD` (hoy por omisión) y su periodo, o `null` si no existe |
| GET | `/api/v1/nomina/periodos` | Histórico paginado con el total de cada semana |
| POST | `/api/v1/nomina/periodos` | Crea el periodo de la semana de `fecha` (se ajusta al domingo) |
| GET | `/api/v1/nomina/periodos/:id` | Periodo con sus recibos y conceptos |
| GET | `/api/v1/nomina/periodos/:id/ventas` | `?usuario_id=` · pedidos que forman la base comisionable |
| POST | `/api/v1/nomina/periodos/:id/calcular` | Recalcula sueldos y comisiones (solo en `borrador`) |
| PATCH | `/api/v1/nomina/periodos/:id/estado` | `borrador` → `pagado` \| `cancelado` |
| POST | `/api/v1/nomina/recibos/:id/conceptos` | Horas extra o descuentos sobre un recibo |
| DELETE | `/api/v1/nomina/conceptos/:conceptoId` | Quita un concepto y recalcula el total |

Estados del periodo: `borrador` (editable) → `pagado` (definitivo) o `cancelado`. Una nómina pagada
no se puede reabrir ni recalcular.

Fórmula del recibo:
```
total_pagar = sueldo_base + comision + otras_percepciones - deducciones
comision    = ventas_netas × porcentaje_comision / 100
```
`ventas_netas` y `porcentaje_comision` se **congelan** en el recibo al calcular, de modo que el
histórico sigue siendo auditable aunque después cambie la configuración del empleado.

En `clave: 'horas_extra'`, si se omite `importe` se calcula como `cantidad × valor_hora_extra` del
empleado. `clave` `falta`/`descuento` son deducciones; `otro` exige `tipo` explícito.

### Ejemplo
```bash
# Vendedor con sueldo base y 10% de comisión
curl -X PUT http://localhost:3000/api/v1/nomina/empleados/6 \
  -H "Authorization: Bearer <token-admin>" -H "Content-Type: application/json" \
  -d '{"sueldo_base_semanal":1500,"paga_comision":true,"porcentaje_comision":10,"valor_hora_extra":50}'

# Abrir y calcular la nómina de la semana
curl -X POST http://localhost:3000/api/v1/nomina/periodos \
  -H "Authorization: Bearer <token-admin>" -H "Content-Type: application/json" -d '{}'
curl -X POST http://localhost:3000/api/v1/nomina/periodos/1/calcular \
  -H "Authorization: Bearer <token-admin>"
```

## Notas de seguridad
- Nunca se expone `contrasena_hash` en las respuestas.
- Errores de credenciales son genéricos para no revelar si el correo existe.
- La validación de entrada usa `zod` con `.strict()` (rechaza campos no esperados).
