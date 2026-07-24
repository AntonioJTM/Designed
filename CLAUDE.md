# Proyecto: Sistema de gestión para tienda de hilos

Contexto para el asistente de código. Léelo completo antes de generar o modificar archivos.

## Qué estamos construyendo
Un sistema integral para una tienda de hilos con cinco frentes que comparten **una sola base de datos**:
1. **Tienda en línea** (catálogo público, carrito, checkout, cuenta de cliente).
2. **Punto de venta (POS)** para mostrador (caja, escáner de código de barras, ticket).
3. **Panel administrador** (gestión de catálogo, inventario, compras, pedidos, reportes).
4. **Inventario** multi-almacén con kardex de movimientos.
5. **Reportes** (ventas del día, corte de caja, productos por reabastecer, más vendidos).

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
│   ├── schema_mysql.sql    ← esquema principal (VALIDADO, 36 tablas)
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
- **Inventario con bitácora.** Toda modificación de existencias debe (1) actualizar `inventario` y
  (2) insertar un registro en `movimientos_inventario`. Hacerlo dentro de una transacción.
- **Al confirmar una venta**, dentro de una sola transacción: crear `pedidos` + `pedido_detalle`,
  registrar `pagos`, descontar `inventario`, insertar `movimientos_inventario` (tipo `'salida'`),
  y si es POS, insertar `movimientos_caja` (tipo `'venta'`).
- **Campos calculados** de dinero (`subtotal`, `impuestos`, `total`) se calculan en el backend, no se
  confían al cliente.
- Los estados válidos están en los `CHECK` del esquema; respétalos como enums en el código.

## Convenciones de código
- API REST versionada bajo `/api/v1`. Recursos en plural: `/api/v1/productos`, `/api/v1/pedidos`.
- Respuestas JSON con forma `{ "data": ..., "error": null }` o `{ "data": null, "error": {...} }`.
- Nombres de tablas/campos en español (como en el esquema); en el código JS usar los mismos nombres.
- Validar entrada con una librería (p.ej. `zod` o `express-validator`) en cada endpoint de escritura.
- Nunca exponer `contrasena_hash` en respuestas.

## Estado actual
- [x] Base de datos diseñada y **validada** (corre sin errores en MySQL y PostgreSQL).
- [x] ERD completo.
- [x] Backend Node/Express: auth, catálogo, inventario, ventas/caja y reportes (probados E2E).
- [~] Frontend Angular: panel admin completo (catálogo, inventario, POS, pedidos, reportes).
      Falta la **tienda en línea** pública (catálogo/carrito/checkout de cliente).
- [x] Reportes: ventas del día, cortes de caja, por reabastecer y más vendidos.

## Roadmap sugerido (en este orden)
1. Backend: conexión a BD + auth (registro/login usuarios y clientes con JWT).
2. Backend: CRUD de catálogo (categorías, productos, variantes, imágenes).
3. Backend: inventario (existencias, movimientos, alertas de stock).
4. Backend: ventas (crear pedido POS y online, pagos, envíos) + caja.
5. Backend: reportes (ventas del día, corte de caja, por reabastecer, más vendidos).
6. Frontend Angular: panel admin → POS → tienda en línea.
