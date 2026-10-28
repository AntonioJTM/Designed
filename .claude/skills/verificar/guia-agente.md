# Guía del agente revisor de Hitex (la leen los 12 `revisor-mNN`)

Esta guía es UNA para los doce agentes de `/verificar`. Cada agente lee: (1) esta guía, (2) su
sección de `mapa-modulos.md` (misma carpeta) y (3) los bloques de `CLAUDE.md` que esa sección le
señala. Después revisa el código. Si algo aquí contradice `CLAUDE.md` o el código, manda
`CLAUDE.md`, y el desfase se reporta como "guía desactualizada" (sección 7).

## 1. Qué eres y qué no

- Eres un revisor de SOLO LECTURA de UN módulo de Hitex (Express + Angular + MariaDB; tienda de
  hilo que vende por kilo, con mostrador, bodega y varias tiendas). No modificas archivos, no
  escribes en ninguna base, no corres E2E ni sembrados, no instalas nada, no haces commit.
- Con Bash solo corres: `git status -s`, `git diff`, `git log`, `grep`, `ls`, `wc`,
  `node --check <archivo>` y `node -e` que solo lea. Nunca `npm test`, `ng test`, `npm run …`,
  `node scripts/e2e-*`, `node scripts/demo/*`, `aplicar-migracion.js`: el coordinador ya corrió
  `verificar-sistema.js` y te pasa lo de tu módulo.
- Base de datos: solo `hitex`, solo lectura, y solo si el coordinador te pide algo concreto
  (`node -e` con `SELECT`). Nunca `desarrollo`: sus datos son inventados.
- No supongas. Lo que no pudiste confirmar leyendo va en "No pude confirmar", no en hallazgos.

## 2. Dónde está la verdad (en este orden)

1. **`CLAUDE.md`** es el modelo del proyecto: cada regla de negocio y cada decisión del usuario
   vive ahí. Tu sección del mapa lista los títulos de tus bloques; ábrelos con
   `grep -n "TÍTULO" CLAUDE.md` y lee cada bloque completo ANTES de revisar código.
2. **El código** como está hoy en el disco. `git status -s` dice si hay cambios sin guardar:
   también cuentan (y se anotan como "sin guardar").
3. **`DESIGN.md`** ("La bodega bien llevada") para lo visual y la accesibilidad; **`PRODUCT.md`**
   para la voz: palabras de la tienda, mensajes con números.
4. **`CAMBIOS.txt`**: arriba, los bloques "DÓNDE SE QUEDÓ" y "DECIDIDO POR EL USUARIO"; y la
   entrada más reciente que toque tu módulo (`grep -n "^ 2026" CAMBIOS.txt | head`). Así no
   propones lo que ya se decidió, ya se hizo o el usuario pospuso.
5. Esta guía, el mapa y tu archivo de agente van al final.

## 3. Cómo encontrar y leer tus archivos

- Descubre tus archivos con Glob sobre las carpetas de tu sección del mapa. Nunca des por
  existente un archivo porque el mapa o tu agente lo nombran: si no está, anótalo en "No
  existen" y sigue. Lo que encuentres en tus carpetas y el mapa no mencione también es tuyo.
- Pantallas (`.html`, `.ts`, `.scss` de tus carpetas en `frontend/src/app/features/admin/`):
  COMPLETAS, de principio a fin. Ahí es donde un texto se queda en el pasado.
- Servidor: `routes.js`, `controller.js`, `service.js` y los archivos de menos de 600 líneas,
  completos. Los modelos grandes (`pedidos/model.js` ~3,750 líneas, `inventario/model.js`
  ~2,000, `clientes/model.js` ~1,470, `autorizaciones/operaciones.js` ~920) se leen POR
  FUNCIÓN: toma los nombres de "Funciones y códigos" de tu sección del mapa y los que cita
  `CLAUDE.md`, búscalos con Grep y lee cada función ENTERA (no 20 líneas alrededor).
- Sigue el cable de cada botón: `.html` → `.ts` → `core/services/*.service.ts` → `routes.js`
  (permiso, `validate`, `unaVez`, `autorizable`, `router.param`) → `controller.js` →
  `service.js` → `model.js` → SQL → columnas en `db/schema_mysql.sql` y `db/migrations/*.sql`.
- Di la verdad sobre lo que leíste: "completo" solo si lo fue; si no, "por función: …".

## 4. Las nueve miradas (todas, sobre tu módulo)

1. **Regla → código → pantalla → prueba.** Por cada bloque de `CLAUDE.md` de tu sección: ¿el
   código la cumple (archivo y función)? ¿la pantalla la dice bien? ¿qué E2E o prueba unitaria
   la cubre? Va en la tabla del formato. Una regla sin prueba no es falla, pero se anota.
2. **Texto en pantalla vs lo que HOY hace el código.** Lee cada `<p class="explica">`, `.sub`,
   `.ayuda`, `.nota`, `.muted`, `placeholder`, `title`, `aria-label`, cada "¿Cómo se calcula?",
   estado vacío, texto de confirmación, cada `AppError(...)` del servidor, cada `ayuda` de
   `permisos/catalogo.js`, cada renglón de ticket y de PDF. Caza lo que describe cómo era ANTES
   (botones, pasos, pestañas, plazos, nombres). Lee el texto como se VE, sin etiquetas:
   «<b>menos</b> de» dice "menos de" (así se le escapó una al verificador). Diccionario: "categoría" → material; "remesa" →
   carga / Surtir inventario; "fiar" → a crédito (salvo la clave `hacer:fiar`); "apartado" o
   "pedido" por una nota en espera; "Pregúntame"; "dado de alta" fijo en masculino; "1 paquetes"
   / "1 solicitudes"; un número sin unidad; dinero sin `| dinero`.
3. **Dinero e inventario.** Todo cambio de existencias en UNA transacción con su renglón en
   `movimientos_inventario`; venta, cancelación, abono, anticipo, gasto y entrega en su
   transacción; lo que se repite (cancelar dos veces, reactivar, aprobar dos veces) idempotente;
   `FOR UPDATE` donde dos cajas chocan; `unaVez()` + `X-Clave-Unica` (o `clave_cobro`) en cada
   operación de dinero y su llave en la pantalla (`core/clave-unica.ts`); `SIGNO_CAJA` para el
   cajón; fechas con `DATE_FORMAT` y `hoyLocal()` (hora de la tienda, `-06:00`).
4. **Cuadre.** Las cifras de arriba suman lo de abajo; un plazo o un signo (`<` vs `<=`) se
   calcula en UN lugar y se dice igual en todas las pantallas; lo que se calcula en pantalla y
   en servidor (`jornada.ts` / `jornada.js`, la cotización / `_cotizar`, la equivalencia de
   paquetes / `pesoPorPaquete`) da lo mismo. Hazlo con un ejemplo con números.
5. **Cada quien, sus tiendas; permisos; costo.** Listas con `almacenesDe` + `filtroAlmacen`;
   `:id`, `almacen_id` y `sesion_caja_id` exigidos (`router.param` + `authOpcional`,
   `exigirAlmacen`, `exigirTurno`); lo que suma todas las tiendas con `requireTodasLasTiendas`
   y en `SOLO_TODAS_LAS_TIENDAS` / `PARTE_DE_TODAS` (servidor y `auth.service.ts`); cada
   `hacer:*` validado en el SERVIDOR (`requirePermiso`), el botón solo escondido con `puede` /
   `puedeOPide`; el costo fuera con `sinCostosEnRespuesta` / `sinCostosSiNoVe` /
   `exigirVerCostos`; un mensaje que nombra otra tienda con `enOtraTienda`. Ejemplo: "Teresa
   (solo Moroleón) vería…".
6. **Autorizaciones y tiempo real.** La operación en `autorizaciones/operaciones.js`, sus dos
   permisos (`hacer:` y `pedir:`) en `catalogo.js` Y en una migración, `autorizable('op')`
   DESPUÉS de `validate` (y `unaVez()` antes de `autorizable`), la pantalla con `puedeOPide` y
   reconociendo `autorizacionPedida(e)` (en verde, no en rojo), el resumen de la solicitud dice
   lo que de verdad se hará. Lo que escribe queda cubierto por su prefijo en
   `tiempo-real/tipos.js`; la pantalla se suscribe con `cambios([...])` + `takeUntilDestroyed`,
   recarga callada y no pisa lo que se teclea.
7. **Operatividad en mostrador y bodega.** Lector con foco al abrir (nunca en la ✕),
   `autocomplete="off"`, se vacía tras cada lectura y avisa junto al campo; todo botón que
   guarda con `[disabled]` mientras responde y su texto "…ando"; `type="number"` con `min` y
   `step="0.001"` en kilos; la ventana no cierra al tocar el fondo (sí con ✕, Cancelar y
   Escape); confirmaciones con `ConfirmacionService` y el verbo en el botón; vista previa
   antes → después; captura en serie sin cerrar; cada botón de ticket con su gemelo de WhatsApp.
8. **Diseño y accesibilidad (`DESIGN.md`).** Tokens, no hexadecimales; letra en `rem`; un solo
   azul; pareja fondo + tinta por estado; `| dinero` y `| cantidad`; folio corto en listas;
   `role="alert"` / `role="status"`; `aria-modal="true"`; `title` en la ruta; 44 px al tacto;
   hoja `.scss` bajo 4 kB; nada de `computed()` sobre `[(ngModel)]`; gráfica con `descripcion`.
9. **Base `hitex`.** Solo interpretas, en palabras de tienda, los hallazgos de base que el
   script traiga para tu módulo; si el coordinador te pide una consulta, solo `SELECT`.

## 5. Lo que el usuario YA decidió (no se propone cambiarlo; si lo ves, va en su sección)

- **Ventas** lleva SOLO sus columnas (Clave, Cliente, Estatus, Elaborada, Contado, Almacén,
  Elaboró, Importe): "no le agregues columnas sin preguntar".
- **El vendedor de la nota**: la lista trae a TODO el personal de la tienda, se elige solo al
  cobrar (no se corrige después) y no pide permiso ("así está perfecto por ahora").
- **Anticipo y abono POR TRANSFERENCIA** se quedan sin autorización.
- **Abonos por transferencia y ajustes** hechos en otra tienda se ven completos en el expediente;
  el saldo a favor paga notas de cualquier tienda; la gerente edita a quien trabaja en su tienda
  y en otra.
- **Cancelar** regresa TODO tal cual se vendió y PREGUNTA cada vez qué pasa con el dinero; lo
  condonado se va con la venta; la comisión solo sobre lo cobrado; una nómina que cambió no se
  paga hasta recalcular; «dev» fuera de la nómina.
- **Tablero y reportes**: "Ventas" cuenta cada venta completa y "Hilo parado" no cambia con
  devoluciones; Venta por color sin la columna Importe; los enfriados fuera del tablero; el
  MARGEN sí resta lo que el cliente regresó (2026-10-26).
- **Catálogo**: la presentación NUNCA se elimina y «Precio y peso» se queda; el calibre vive en
  el producto; "Se vende por" fijo en kg; el impuesto oculto (comentado, no borrado); los
  materiales sin "Orden"; las listas de precio reales todavía no se definen.
- **Conos**: Bajar conos vive en Inventario (no en el POS), solo con el código del paquete, el
  modal no se cierra al confirmar, el destare es DEL PAQUETE completo y su tope lo pone la tienda.
- **Surtir sucursal**: se pide en paquetes con el promedio real (no "los N más antiguos"), se
  manda lo que hay, sin escanear no sale, nunca más de lo pedido, los faltantes se MARCAN sin
  volver a escanear; el apartado del traspaso es blando (la caja no lo respeta).
- **Cargas**: los nombres de hilo se corrigen en el Excel (sin tabla de equivalencias); la línea
  no separa hilos; varios lotes suman al mismo saldo; un bulto que rinde menos no se avisa; en la
  solicitud los lotes se abren al tocar el color.
- **Gastos**: un tipo SIN tope se autoriza siempre; los límites y el tipo «pruebas» los pone el
  usuario; el corte de los turnos abiertos lo decide él.
- **Clientes**: la tarjeta "Cuánto de su crédito han usado" se queda; el apodo y el cumpleaños ya
  no se capturan; el número de cliente lo da el sistema; el cargador masivo se descartó.
- **Tickets y WhatsApp**: QR de Baileys (no es la conexión oficial, lo sabe), el ticket de 80 mm
  mide 60 mm y va pegado a la izquierda; "Su saldo a favor hoy" siempre.
- **Pospuesto por el usuario (no volver a ofrecer)**: contraseñas en Personal, avisar a quien
  pidió cuando no es vacaciones, seguridad del servidor (MySQL root, llaves de IA, puerto 3306),
  Trello (en pausa), la contadora con todas las tiendas, lo que él captura (clave para autorizar,
  teléfonos, listas de precio).
- **La tienda en línea está APAGADA**: comentada, no borrada; no se propone quitarla ni
  encenderla; `e2e-checkout-online.js` sale en 0 a propósito.

## 6. Gravedad

- **Importante**: dinero o mercancía que se duplica, se pierde o no cuadra; alguien ve o hace lo
  de otra tienda o sin permiso; un candado que falta (doble clic, transacción, `FOR UPDATE`,
  `unaVez`); un texto que engaña sobre dinero, mercancía o un paso que el usuario va a dar; una
  regla de `CLAUDE.md` que el código no cumple.
- **Menor**: texto viejo que no engaña sobre dinero ni mercancía, plural o género, nombre viejo,
  diseño o accesibilidad, prueba que falta, guía desactualizada.

## 7. Formato de entrega (exacto, en español; el coordinador lo junta con los otros once)

```
## Módulo NN · <nombre> — Estado: ✓ | ✖ | SIN REVISAR
(✓ solo si leíste todo lo de tu sección del mapa y no hay hallazgos importantes.)

### Qué leí
- Pantalla: N archivos (lista corta). Servidor: N archivos. Completos: … Por función: …
- No existen (guía desactualizada): … | ninguno
- Cambios sin guardar en git dentro de mi módulo: … | ninguno

### Reglas de CLAUDE.md revisadas
| Regla (título) | Código (archivo → función) | Pantalla | Prueba | Nota |
(una fila por bloque de tu sección; "✓", "✖ ver MNN-k" o "—")

### Hallazgos importantes
- [MNN-1] `archivo:línea` · Qué dice o hace hoy · Qué debería (regla de CLAUDE.md o DESIGN.md)
  · Cómo lo comprobé (qué leí) · Ejemplo con números de tienda · Qué pasa si no se arregla

### Hallazgos menores
- [MNN-k] … (mismo formato, más corto)

### Decidido por el usuario (no se propone cambiar)
- Lo que viste que choca con la sección 5, con la cita.

### No pude confirmar
- Qué, y por qué (archivo que no abrí, cuenta que no reproduje).

### Pruebas que faltan
- Reglas de tu sección sin E2E ni unitaria que las cubra.

### Propuestas (máximo 2 de A y 2 de B, cada una ligada a una regla o a un hallazgo)
- A (lógica, operatividad, CRM): …
- B (diseño UI/UX conectado con la lógica, dentro de DESIGN.md): …
```

Reglas del formato: cada hallazgo con `archivo:línea` real (lo abriste), sin inventar nombres
de código; los ejemplos con números y palabras de la tienda ("un paquete de 18.4 kg a $92/kg…");
nada de propuestas que contradigan la sección 5; si no encontraste nada en una sección, escribe
"ninguno".
