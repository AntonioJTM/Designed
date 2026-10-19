---
name: verificar
description: Auditoría estricta módulo por módulo de Hitex (los 12 módulos, solo contra la base "hitex") con ojo de experto en diseño de sistemas CRM / POS / inventario y Diseño UI/UX conectado con la lógica (DESIGN.md + Impeccable + UI/UX Pro Max). Es 100 % de solo lectura y entrega hallazgos + propuestas de mejora en español sencillo. Úsalo con /verificar o cuando el usuario pida revisar que todo esté bien.
---

# Auditoría estricta módulo por módulo + Experto en CRM y Diseño UI/UX (`/verificar`)

Esta revisión es **100 % de solo lectura**: no modifica ningún archivo, no escribe en la base de datos y no sube nada al servidor. Trabaja **únicamente con la base de datos `hitex`** (olvídate de `desarrollo`), revisa con rigor estricto cada uno de los **12 módulos de Hitex** y entrega propuestas de mejora tanto de **lógica/CRM** como de **Diseño UI/UX conectado con la lógica de trabajo**.

## 1. Correr las verificaciones automáticas en `hitex` (989 comprobaciones)

1. **Verificador estricto módulo por módulo + reglas de `DESIGN.md` (archivos, pantallas `.ts`/`.html`/`.scss`, los 12 módulos y la base `hitex`):**
   - `cd backend && node scripts/verificar-sistema.js`
2. **Estado de migraciones en `hitex`:**
   - `cd backend && node scripts/estado-migraciones.js --base hitex`
3. **Pruebas unitarias del servidor y de las pantallas (cuando hubo cambios de código o se pida revisión a fondo):**
   - Servidor: `cd backend && npm test`
   - Pantallas: `cd frontend && npx ng test --watch=false --browsers=ChromeHeadless`

## 2. Auditar con rigor estricto MÓDULO POR MÓDULO (los 12 módulos)

Apóyate en el agente `revisor-general` (y en `revisor-tiendas` si hubo cambios en tiendas/permisos) para verificar que cada módulo cumpla estrictamente `CLAUDE.md`, `PRODUCT.md` y `DESIGN.md`:

| # | Módulo | Qué exigir sin concesiones |
|---|---|---|
| **01** | **Hoy y Campana de avisos** (`hoy`, `notificaciones`) | Umbrales con nombre (`DIAS_SIN_ABONAR = 15`, `DIAS_SIN_VENIR = 45`, `DIAS_CLIENTE_NUEVO = 7`), filtrado por tiendas del usuario y enlaces directos a resolver cada pendiente. |
| **02** | **Punto de venta (POS) y Tickets** (`pos`, `shared/ticket`) | Foco permanente en el lector (`enfocarLector`), paquetes escaneados solo de esa tienda (`_exigirPaqueteAqui`), 4 modos (`cobrar`, `credito`, `espera`, `pendiente`), efectivo guardado por lo cobrado (sin el cambio), envío sin pago en efectivo, conos pesados en báscula al precio del paquete y 6 tickets térmicos de 80 mm sin `size:` en `@page`. |
| **03** | **Caja y Cortes de turno** (`caja`) | Efectivo del cajón calculado con `SIGNO_CAJA`, bloqueo de retiros o devoluciones mayores al efectivo disponible (`EFECTIVO_INSUFICIENTE`) y permiso `hacer:mover_efectivo`. |
| **04** | **Ventas, Devoluciones, Notas en espera y Pendientes** (`pedidos`, `encargos`, `notas-pendientes`) | Un solo cálculo (`_cotizar`), devolución de nota con saldo pendiente descontada primero de esa misma nota (`debeDeVenta` / `descontarDeVenta`), notas en espera que solo apartan paquetes y notas pendientes que descuentan inventario al entregar. |
| **05** | **CRM Clientes, Expediente, Crédito y Saldo a favor** (`clientes` + 8 pestañas) | 8 pestañas del CRM activas y rápidas, cruce por `producto_id` (color + calibre), código `C-0001` automático, sin apodo ni cumpleaños, abonos FIFO (`repartirAbonos`) que liquidan ventas a crédito (`liquidarVentasACredito`) y saldo a favor nunca negativo (`SALDO_FAVOR_INSUFICIENTE`). |
| **06** | **Inventario, Detalle por hilo, Conos y Kardex** (`inventario`, `kardex`) | Pantalla de Inventario solo para consultar (bajar conos, ajuste/merma y detalle del hilo en ventanas modales), bajar conos solo en tiendas (`SOLO_EN_TIENDA`), destare por cono y cuadre exacto entre kilos de `inventario` y paquetes de `variante_codigos`. |
| **07** | **Surtir inventario y Proveedores** (`remesas`, `proveedores`) | Carga de listas `.xlsx` en tandas (`TANDA_BULTOS`), progreso en vivo (`X-Accel-Buffering: no`), costo promedio ponderado móvil y etiquetas térmicas por paquete. |
| **08** | **Surtir sucursal (Traspasos)** (`traspasos`) | Prohibido enviar sin escanear paquetes (`SIN_ESCANEAR`), guardado parcial (`guardarEscaneos`) y reubicación automática al origen (`_traerAlOrigen`) con rastro en Kardex. |
| **09** | **Catálogo (Hilos, Presentaciones, Materiales, Precios)** (`productos`, `variantes`, `categorias`, `tipos-cliente`) | Hilo siempre identificado por Color + Calibre, 1 paquete + 1 cono ligado (`origen_variante_id`), borrado solo si nunca tuvo movimientos (`eliminarSiVacio`), costos ocultos sin permiso (`sinCostosEnRespuesta`) y 1 lista `Público`. |
| **10** | **Cómo va el negocio y Reportes** (`analisis`, `reportes`, `tablero`) | Protegidos con `requireTodasLasTiendas` / `SOLO_TODAS_LAS_TIENDAS`, vistas SQL sanas y "Venta por color" restando devoluciones. |
| **11** | **Nómina semanal, Horarios, Vacaciones y Comisiones** (`nomina`) | Jornada y horas extra iguales en servidor y pantalla, vacaciones de ley y comisión por kilo pagada una sola vez al liquidarse la venta, menos devoluciones y sin envío. |
| **12** | **Administración (Almacenes, Personal, Permisos, Config)** (`almacenes`, `usuarios`, `permisos`, `configuracion`) | 1 almacén Matriz, `cargador` sin acceso al sistema, `SOLO_ADMINISTRADOR` y `SOLO_SUS_TIENDAS` en Personal, `SE_LLEVA_COSTO` sincronizado, CLABE válida de 18 dígitos y candado `_produccion.js` activo. |

## 3. Evaluar con ojo de Experto en CRM y en Diseño UI/UX conectado con la lógica

En cada revisión evalúa el sistema desde dos ángulos complementarios:
1. **Arquitectura de CRM, POS e Inventario:** velocidad en mostrador, seguimiento de clientes tejedores y cobranza en las 8 pestañas del CRM, control físico de bultos/conos y candados antifraude en cortes, devoluciones y nómina.
2. **Diseño UI/UX conectado con la lógica (`DESIGN.md` *"La bodega bien llevada"* + `.claude/skills/impeccable` + heurísticas UI/UX Pro Max):**
   - Que la interfaz guíe visualmente la lógica: si cambia un estado o modo de venta, la pantalla debe ocultar lo que no aplica y destacar el siguiente paso con **Un Solo Azul** (`.btn-primary`) o verde de cierre (`.btn-ok`).
   - Que los números (kilos, dinero, paquetes, deuda) se lean de un vistazo con dígitos alineados (`tabular-nums`), unidades claras y parejas de color de estado (`.pill`).
   - Que las pantallas sean para mirar y las acciones vivan en ventanas modales cómodas (`role="dialog" aria-modal="true"`), con botones de al menos `44 px` pensados para usarse con la pistola lectora en la mano.

## 4. Cómo entregar el reporte al usuario

Contesta **siempre en español sencillo**, como se habla en la tienda, con enlaces clicables a los archivos:

1. **Veredicto general arriba:** resultado de las 989 comprobaciones automáticas y estado de la base **`hitex`**.
2. **Estado módulo por módulo (los 12 módulos):** lista o tabla clara con `✓` o `✖` en cada módulo.
3. **Hallazgos encontrados** (si algo está fuera de lugar, con dónde está, por qué no tiene sentido y un ejemplo con números de la tienda).
4. **Propuestas de mejora de Experto (en 2 bloques):**
   - **Bloque A · Propuestas de Lógica, Flujo y CRM** (mejoras operativas y comerciales con ejemplos de la tienda).
   - **Bloque B · Propuestas de Diseño UI/UX conectadas con la lógica** (cómo mejorar el acomodo visual, las tablas, los formularios, los indicadores en vivo y los botones dentro del estilo *"La bodega bien llevada"* de `DESIGN.md` para que la pantalla acompañe a la lógica sin fricción).
5. **No modifiques nada todavía:** pregunta al final qué propuestas quiere que implementemos.
