---
name: verificar
description: Auditoría estricta módulo por módulo de Hitex (los 12 módulos, solo contra la base "hitex") con la "Prueba del Manual de Uso" (cifras que suman, promesas vs casillas reales, plazos unificados, diccionario Hitex) y ojo de experto en diseño de sistemas CRM / POS / inventario y Diseño UI/UX conectado con la lógica (DESIGN.md + Impeccable + UI/UX Pro Max). Es 100 % de solo lectura.
disable-model-invocation: true
---

# Verificar todo el sistema Hitex (Módulo por Módulo + Prueba del Manual de Uso + Experto CRM & UI/UX · Solo `hitex`)

El usuario pidió `/verificar`. Quiere una **auditoría estricta módulo por módulo** (en **solo lectura**, sin modificar ningún archivo ni escribir en la base de datos) que revise que cada pieza esté donde debe ir, que las cifras de cada pantalla cuadren, que no haya contradicciones ni palabras viejas, y que le propongas mejoras reales tanto de **lógica/CRM** como de **Diseño UI/UX conectado con la lógica**, trabajando **únicamente con la base `hitex`**.

## Pasos a seguir

1. **Corre el verificador automático profundo sobre `hitex` (1,472 comprobaciones):**
   Desde `backend/`:
   ```bash
   node scripts/verificar-sistema.js
   ```
   *(El script ya usa `hitex` por omisión e incluye reglas de arquitectura, `DESIGN.md`, ecuaciones de pantalla, plazos cruzados, promesas de mensajes contra controles reales y diccionario de palabras viejas).*

2. **Revisa migraciones en `hitex` y el estado de Git:**
   Desde `backend/`:
   ```bash
   node scripts/estado-migraciones.js --base hitex
   git status -s
   ```

3. **Aplica la «Prueba del Manual de Uso» (Revisión profunda de coherencia entre pantallas y código):**
   No te quedes solo con que el código compile; revisa activamente estas **6 familias de fallas** (apoyándote en `.claude/agents/revisor-general.md`):
   - **Promesas sin botón:** si un mensaje de error o texto dice *"hazlo en «X»"* o *"desactívala en «Precio y peso»"*, verifica en el `.html` que esa ventana realmente tenga esa casilla o botón.
   - **Las cifras de arriba siempre suman el total de abajo:**
     - En **Caja**: `Fondo + Ventas efectivo + Abonos y otros ingresos (abonos, anticipos, pagos de nota, entregas, ingresos) − Devoluciones − Retiros = Debería haber`.
     - En **Reportes › Ventas por día**: `Sin IVA − Descuentos + IVA + Envío = Total`.
     - En **PDFs (Nómina / Comisiones)**: que una devolución no cuente como venta ni sume al vendido, y que no se corten textos largos en las columnas.
     - En **Presentaciones (`_sincronizarConos`)**: que al cambiar el peso del paquete también se recalcule el peso (`peso_kg`) de sus conos.
   - **Un solo plazo y signo (`<` vs `<=`) en todo el sistema:**
     - **Atraso de cobranza (`15 días` desde el último abono):** igual en Caja, Campana, Clientes › Cuánto debe y Cómo va el negocio (nunca mezclar 15 y 30 días).
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

4. **Entrega el reporte en español sencillo con esta estructura:**
   - **Veredicto general** (las 1,472 comprobaciones automáticas y el estado de `hitex`).
   - **Tabla de estado de los 12 módulos** (`✓` o `✖`).
   - **Hallazgos encontrados**, separados en:
     - **Lo importante** (fallas donde el dinero, la deuda, el inventario, los plazos o un botón prometido no cuadran), y
     - **Menores** (palabras viejas en pantalla, plurales fijos, textos o detalles visuales),
     indicando archivo, línea y un ejemplo real con números.
   - **Propuestas de mejora de Experto (en 2 bloques obligatorios):**
     - **Bloque A · Mejoras de Lógica, Operación y CRM.**
     - **Bloque B · Mejoras de Diseño UI/UX conectadas con la lógica** (respetando al 100 % *"La bodega bien llevada"* de `DESIGN.md`).
   - Recuerda que **no se tocó ningún archivo ni dato en `hitex`** y pregunta qué hallazgos o mejoras quiere aplicar.
