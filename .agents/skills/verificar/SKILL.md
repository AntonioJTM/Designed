---
name: verificar
description: Auditoría estricta módulo por módulo de Hitex (los 12 módulos, solo contra la base "hitex") con la "Prueba del Manual de Uso" (cifras que suman, promesas vs casillas reales, plazos unificados, diccionario Hitex), "Auditoría de Operatividad de Usuario" (pistola lectora, teclado, prevención de errores de dedo, vistas previas Antes→Después, continuidad de trabajo) y ojo de experto CRM / POS / UI/UX (DESIGN.md). Es 100 % de solo lectura.
disable-model-invocation: true
---

# Verificar todo el sistema Hitex (Módulo por Módulo + Prueba del Manual de Uso + Operatividad de Usuario + Experto CRM & UI/UX · Solo `hitex`)

El usuario pidió `/verificar`. Quiere una **auditoría estricta módulo por módulo** (en **solo lectura**, sin modificar ningún archivo ni escribir en la base de datos) que revise que cada pieza esté donde debe ir, que las cifras de cada pantalla cuadren, que no haya contradicciones ni palabras viejas, que la **operatividad real del usuario** (mostrador, bodega y administración) sea rápida y a prueba de errores de dedo, y que le propongas mejoras reales tanto de **lógica/operatividad/CRM** como de **Diseño UI/UX conectado con la lógica**, trabajando **únicamente con la base `hitex`**.

## Pasos a seguir

1. **Corre el verificador automático profundo sobre `hitex` (más de 1,600 comprobaciones; el número exacto lo dice el propio script):**
   Desde `backend/`:
   ```bash
   node scripts/verificar-sistema.js
   ```
   *(El script usa `hitex` por omisión e incluye reglas de arquitectura, `DESIGN.md`, ecuaciones de pantalla, plazos cruzados, promesas de mensajes contra controles reales, diccionario de palabras viejas y los 6 pilares de **Operatividad de Usuario**: anti-doble clic en todos los `submit`, anti-negativos en todos los `input[type="number"]`, cierre seguro de modales sin clic accidental afuera, pistola lectora con `autocomplete="off"` y auto-enfoque, vistas previas Antes → Después y captura en serie).*

2. **Revisa migraciones en `hitex` y el estado de Git:**
   Desde `backend/`:
   ```bash
   node scripts/estado-migraciones.js --base hitex
   git status -s
   ```

3. **Aplica la «Prueba del Manual de Uso» (Coherencia entre pantallas y código):**
   No te quedes solo con que el código compile; revisa activamente estas **6 familias de fallas** (apoyándote en `.claude/agents/revisor-general.md`):
   - **Promesas sin botón:** si un mensaje de error o texto dice *"hazlo en «X»"* o *"desactívala en «Precio y peso»"*, verifica en el `.html` que esa ventana realmente tenga esa casilla o botón.
   - **Las cifras de arriba siempre suman el total de abajo:**
     - En **Caja**: `Fondo + Ventas efectivo + Abonos y otros ingresos (abonos, anticipos, pagos de nota, entregas, ingresos) − Devoluciones − Retiros = Debería haber`.
     - En **Reportes › Ventas por día**: `Sin IVA − Descuentos + IVA + Envío = Total`.
     - En **PDFs (Nómina / Comisiones)**: que una devolución no cuente como venta ni sume al vendido, y que no se corten textos largos en las columnas.
   - **Un solo plazo y signo (`<` vs `<=`) en todo el sistema:**
     - **Atraso de cobranza (el vencimiento de CADA nota, 2026-10-20):** una nota a crédito vence el día en que se fió más sus días de crédito (`pedidos.dias_credito`; sin decirlos, `DIAS_SIN_ABONAR` = 15); una cuenta está atrasada si alguna nota ya venció. La misma cuenta (`vencimientoDe` / `diasSinAbonarDeTodos`) en Caja, Campana, Clientes › Cuánto debe y Cómo va el negocio.
     - **Cliente nuevo en Hoy:** capturado en los *últimos* 15 días (nunca decir *"hace 15 días o más"*).
     - **Stock mínimo (`<=`):** decir *"N paquetes o menos"* (nunca *"menos de N"*) y abrir en Paquetes.
   - **Candados de cobro y cierre de operaciones:**
     - Una venta **a crédito** que aún se debe jamás debe ofrecer *"Subir captura"* en el pedido (se cobra como abono en su expediente).
     - Al entregar una **nota en espera** (`encargos`), igual que en ventas y abonos, ofrecer **Imprimir ticket** y **Mandar por WhatsApp**.
     - En **WhatsApp**, una vez enviado el ticket, ocultar *"Le llega a…"* y *"Cambiar número"*.
   - **Rótulos de Kardex y permisos por tienda:**
     - En Kardex (`_describir`), distinguir el envío normal de un traspaso del **faltante (merma)** al recibirlo y del **regreso al cancelar** uno en camino.
     - Ocultar *"Cobranza atrasada"* en Hoy a quien solo trabaja en una tienda.
   - **Diccionario Hitex, plurales y centavos:**
     - Sin palabras viejas en pantalla (*"categoría"*, *"remesa"*, *"fiar/fiado"*, *"apartado"* de venta, *"las cinco pestañas"*, *"dado de alta"* fijo en masculino), sin plurales rotos (*"1 paquetes"*, *"1 solicitudes"*) y con centavos visibles en saldos del expediente.

4. **Aplica la «Auditoría de Operatividad de Usuario» (Mostrador, Bodega y Administración):**
   Ponte en los zapatos del cajero con fila, del almacenista con pistola lectora y del administrador, y revisa estos **6 pilares de operatividad**:
   - **Pilar 1 · Velocidad en mostrador, pistola lectora y teclado:** auto-enfoque al abrir pantallas de escaneo, `autocomplete="off"` en entradas de pistola, 1 solo `Enter` para mandar WhatsApp, cálculo de cambio en vivo y acceso en 1 clic a los hilos frecuentes del cliente.
   - **Pilar 2 · Prevención de errores humanos (Poka-Yoke):** todos los botones de guardar/cobrar bloqueados contra doble clic (`[disabled]`), todos los campos numéricos protegidos contra negativos (`min="0"` o `min="1"`), y que **ningún modal de captura se cierre por clic accidental en el fondo oscuro**.
   - **Pilar 3 · Claridad «Antes → Después» antes de confirmar:** toda acción delicada (retiro/ingreso de caja, cambio de stock mínimo, desarme de conos, abono a deuda, recepción de traspaso con faltantes) debe mostrar cómo está hoy y cómo quedará después antes de confirmar.
   - **Pilar 4 · Continuidad de trabajo (sin callejones sin salida):** las tareas repetitivas (*"Capturar otro color"*, *"Agregar bulto a mano"*) limpian el campo y siguen sin cerrar la ventana; todo cobro/entrega cierra ofreciendo Ticket y WhatsApp; cada aviso en `Hoy` o `Campana` lleva con 1 clic a la pantalla filtrada.
   - **Pilar 5 · Mensajes humanos accionables:** cuando algo se bloquea (paquete de otra sucursal, hilo con historial, efectivo insuficiente en caja, cliente con atraso), el mensaje dice exactamente en qué almacén o nota está y cómo resolverlo.
   - **Pilar 6 · Diseño UI/UX operativo (`DESIGN.md`):** un solo botón azul primario por vista, `tabular-nums`, códigos en `IBM Plex Mono`, botones táctiles $\ge 44\text{ px}$ y `.tabla-scroll` en tablas anchas.

5. **Entrega el reporte en español sencillo con esta estructura:**
   - **Veredicto general** (cuántas comprobaciones automáticas pasaron y el estado de `hitex`).
   - **Tabla de estado de los 12 módulos** (`✓` o `✖`).
   - **Hallazgos encontrados**, separados en:
     - **Lo importante** (fallas donde el dinero, la deuda, el inventario, los plazos, un botón prometido o la operatividad del usuario fallan), y
     - **Menores** (palabras viejas en pantalla, plurales fijos, textos o detalles visuales),
     indicando archivo, línea y un ejemplo real con números.
   - **Propuestas de mejora de Experto (en 2 bloques obligatorios):**
     - **Bloque A · Mejoras de Lógica, Operatividad de Usuario y CRM.**
     - **Bloque B · Mejoras de Diseño UI/UX conectadas con la lógica** (respetando al 100 % *"La bodega bien llevada"* de `DESIGN.md`).
   - Recuerda que **no se tocó ningún archivo ni dato en `hitex`** y pregunta qué hallazgos o mejoras quiere aplicar.
