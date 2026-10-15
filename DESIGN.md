---
name: Hitex
description: Sistema de gestión de la tienda de hilo Hitex (mostrador, bodega y administración).
colors:
  fondo: "#F4F5F7"
  superficie: "#FFFFFF"
  superficie-2: "#FAFBFC"
  borde: "#E3E6EB"
  borde-suave: "#EEF0F3"
  borde-campo: "#D5D9E0"
  tinta: "#161A23"
  tinta-2: "#3F4552"
  tinta-3: "#5B6270"
  acento: "#2457C5"
  acento-oscuro: "#1D4596"
  acento-suave: "#E8EEFB"
  acento-tenue: "#F7F9FE"
  sobre-acento: "#DCE6FA"
  barra: "#12161F"
  barra-tinta: "#C9CED8"
  barra-titulo: "#8C93A1"
  barra-linea: "#262C38"
  barra-hover: "#1C212C"
  barra-borde: "#333A48"
  barra-claro: "#E2E6EE"
  barra-suave: "#A9B0BD"
  barra-foco: "#8FB2F2"
  punto-aviso: "#E9A23B"
  punto-alerta: "#C2410C"
  foco: "#2457C533"
  velo: "#12161F99"
  velo-claro: "#FFFFFFE0"
  desplazamiento: "#C5CAD3"
  ok-f: "#E6F4EC"
  ok-t: "#17663F"
  ok-suave: "#F2FAF5"
  ok-borde: "#BFE3CC"
  ok-oscuro: "#12512F"
  aviso-f: "#FDF1DC"
  aviso-t: "#7A4A00"
  alerta-f: "#FCE9E1"
  alerta-t: "#9A3412"
  peligro-f: "#FBE4E2"
  peligro-t: "#A12318"
  peligro-borde: "#F1C7BE"
  peligro-oscuro: "#861D14"
  viz-series-1: "#2a78d6"
  viz-series-2: "#eb6834"
  viz-series-3: "#1baf7a"
  viz-otros: "#a3a2a0"
  viz-rampa-1: "#86b6ef"
  viz-rampa-2: "#3987e5"
  viz-rampa-3: "#1c5cab"
  viz-rampa-4: "#0d366b"
  viz-series-1-suave: "#BFD6F4"
  viz-columna: "#9EC3F2"
  punto-aviso-suave: "#F6DDB0"
  punto-alerta-suave: "#F3C7B1"
  viz-calor-1: "#DCE8FA"
  viz-calor-2: "#9EC3F2"
  viz-calor-tinta: "#0F2E5C"
typography:
  headline:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  cifra:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  title-ventana:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 600
  title:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
  body:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
  overline:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.08em"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  full: "999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.acento}"
    textColor: "{colors.superficie}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.acento-oscuro}"
    textColor: "{colors.superficie}"
  button-ghost:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-ghost-hover:
    backgroundColor: "{colors.superficie-2}"
  button-danger:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.peligro-t}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-danger-hover:
    backgroundColor: "{colors.peligro-f}"
  button-ok:
    backgroundColor: "{colors.ok-t}"
    textColor: "{colors.superficie}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  input:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  card:
    backgroundColor: "{colors.superficie}"
    rounded: "{rounded.lg}"
    padding: "22px 24px"
  kpi:
    backgroundColor: "{colors.superficie}"
    typography: "{typography.cifra}"
    rounded: "{rounded.lg}"
    padding: "18px 20px"
  pill-ok:
    backgroundColor: "{colors.ok-f}"
    textColor: "{colors.ok-t}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  pill-aviso:
    backgroundColor: "{colors.aviso-f}"
    textColor: "{colors.aviso-t}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  pill-peligro:
    backgroundColor: "{colors.peligro-f}"
    textColor: "{colors.peligro-t}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  nav-bar:
    backgroundColor: "{colors.barra}"
    textColor: "{colors.barra-tinta}"
    width: "248px"
  nav-item-active:
    backgroundColor: "{colors.acento}"
    textColor: "{colors.superficie}"
    rounded: "{rounded.md}"
    height: "38px"
  tab-active:
    textColor: "{colors.acento-oscuro}"
    height: "44px"
  modal:
    backgroundColor: "{colors.superficie}"
    rounded: "{rounded.xl}"
    width: "900px"
---

# Design System: Hitex

## Overview

**Creative North Star: "La bodega bien llevada"**

Todo en su lugar y contado. El sistema se ve como una bodega en orden, no como una vitrina: un
fondo gris muy claro, tarjetas blancas con un borde fino, un solo azul que señala lo que se puede
hacer, y el menú oscuro a la izquierda que no se mueve. Es **práctico, de trabajo**: cada pantalla
existe para una tarea —cobrar, surtir, contar, pagar— y lo que no ayuda a esa tarea no está.

La densidad es de herramienta. Muchas cifras, tablas y paquetes a la vista, pero en bloques
separados por un mismo espacio (24 px) y con letras de un solo tipo. Los números mandan:
cantidades en kilos, dinero y paquetes, siempre alineados, con su unidad y sin ceros de relleno.
Los botones, campos y tarjetas son **firmes y cómodos**: altos y fáciles de tocar en el mostrador,
con la pistola lectora en una mano.

El color se gasta en significado, no en adorno. Los estados (pagado, en espera, falta, cancelado)
llevan su pareja de fondo + tinta, y las gráficas usan una paleta de tres colores validada para
daltonismo.

**Key Characteristics:**
- Fondo gris claro, tarjetas blancas planas con borde de 1 px; la sombra solo existe en la
  ventana que flota encima.
- Un solo acento azul para lo activo y lo que se puede hacer.
- Menú oscuro fijo a la izquierda (248 px); en el celular se vuelve barra arriba con botón.
- IBM Plex Sans y Plex Mono, instaladas en el proyecto (no dependen de internet).
- Controles de 44 px de alto como mínimo; cifras grandes y alineadas.
- Las acciones se hacen en ventanas (modales); la pantalla es para mirar.

## Colors

Una paleta fría y contenida: grises con un poco de azul, un azul firme como acento y estados en
parejas suaves.

### Primary
- **Azul de bodega** (`acento`): el botón principal, la opción activa del menú, la pestaña elegida,
  los enlaces, el anillo de foco de los campos y la cifra total destacada. Al pasar el puntero baja
  a **Azul noche** (`acento-oscuro`), que también es la tinta del texto activo y de los avisos
  informativos. **Azul neblina** (`acento-suave`) es el fondo de una opción elegida, de un aviso
  informativo y del círculo con las iniciales del cliente. **Azul apenas** (`acento-tenue`) marca
  el renglón con un cambio sin guardar (Permisos), y **azul sobre azul** (`sobre-acento`) es el
  texto secundario encima del azul lleno (la cifra total).

### Neutral
- **Gris de piso** (`fondo`): el fondo de toda la página, detrás de las tarjetas.
- **Blanco de tarjeta** (`superficie`): tarjetas, campos, ventanas y botones secundarios.
- **Blanco humo** (`superficie-2`): pie de las ventanas, renglón que agrupa un hilo en una tabla,
  campo deshabilitado y tarjeta "suave".
- **Línea de estante** (`borde`), **línea tenue** (`borde-suave`) y **marco de campo**
  (`borde-campo`): bordes de tarjeta, separadores de renglón y bordes de campos y botones
  secundarios, en ese orden de fuerza.
- **Tinta carbón** (`tinta`), **tinta pizarra** (`tinta-2`) y **tinta gris** (`tinta-3`): texto
  principal, texto de etiquetas y texto de apoyo. `tinta-3` es el gris más claro que todavía da
  4.5:1 sobre blanco.
- **Menú de noche** (`barra`) con sus tintas (`barra-tinta`, `barra-titulo`), su línea
  (`barra-linea`) y sus controles (`barra-hover` bajo el puntero, `barra-borde` y `barra-claro`
  para el botón del menú en el celular): solo la barra del menú lateral.
- **Puntos de las cifras clave:** el punto de color junto a la etiqueta de una cifra usa el
  acento, **ámbar punto** (`punto-aviso`), **naranja punto** (`punto-alerta`, también el globo de
  la campana), **tinta carbón** (`.tono-tinta`, el "Total a pagar" de Nómina) o un color de
  serie. Van por clase (`.punto.tono-…`), nunca con `style=`, y nunca un hexadecimal suelto en la
  pantalla.
- **Velo de ventana** (`velo`): el oscuro translúcido detrás de una ventana; **velo blanco**
  (`velo-claro`): el de "cargando" encima de una ventana.
- **Riel de desplazamiento** (`desplazamiento`): la barra de desplazamiento de la página y de las
  tablas.

### Estados (parejas fondo + tinta)
- **Verde pagado** (`ok-f` / `ok-t`): pagado, entregado, listo, a favor.
- **Ámbar en espera** (`aviso-f` / `aviso-t`): en espera, falta, revisar.
- **Naranja atención** (`alerta-f` / `alerta-t`): atrasado, alerta de inventario.
- **Rojo cancelado** (`peligro-f` / `peligro-t`): errores, cancelado, quitar, borrar.
- El informativo usa `acento-suave` / `acento-oscuro`, y el neutro usa `borde-suave` / `tinta-2`.
- **Tonos de apoyo:** **verde listo** (`ok-suave` / `ok-borde`), el fondo y el borde de la tarjeta
  "verde"; **verde hondo** (`ok-oscuro`), el botón Ok bajo el puntero; **borde rosado**
  (`peligro-borde`), el borde del botón Danger; y **rojo hondo** (`peligro-oscuro`), el botón rojo
  lleno de la ventana de confirmación bajo el puntero.

### Gráficas
- **Serie azul, serie naranja y serie aqua** (`viz-series-1..3`) para hasta tres series, y
  **gris "otros"** (`viz-otros`) del cuarto almacén en adelante.
- **Rampa azul** (`viz-rampa-1..4`, de claro a oscuro) para lo que va en orden: la antigüedad de
  una deuda, qué tan seguido compra un cliente.
- **Fondos suaves del ritmo** (`viz-series-1-suave`, `punto-aviso-suave`, `punto-alerta-suave`):
  el hueco entre visitas de un cliente al corriente, al que ya le toca y al que se enfría.
- **Mapa de calor** (`viz-calor-1`, `viz-calor-2` y luego la rampa azul): "Cuándo compra" (día ×
  hora). Sobre el segundo paso la letra es `viz-calor-tinta`.
- Los colores de gráfica se nombran en el código como `var(--token)`, nunca en hexadecimal.

### Named Rules
**The Un Solo Azul Rule.** El acento señala lo que se puede hacer o lo que está activo; nunca
decora. Ningún otro color compite con él por la atención.

**The Pareja Rule.** Un estado nunca va en tinta suelta: siempre su fondo y su tinta juntos, para
que el texto se lea.

**The Tres Colores Rule.** Las gráficas usan tres colores validados para daltonismo y visión
normal. Un cuarto no se agrega sin volver a correr el validador: del cuarto en adelante, gris.

**The Letra Que Se Lee Rule.** El número escrito DENTRO de un tramo de color lleva la letra
(blanca o carbón) que dé MÁS contraste contra ese relleno, calculado con la fórmula de WCAG
(`shared/charts/contraste.ts → tintaSobre`), no a ojo. La rampa de azules de la cartera por
antigüedad (`RAMPA_AZUL`) vive en ese mismo archivo: en el segundo azul la letra blanca daba 3.6:1
y la carbón da 4.8:1.

## Typography

**Display Font:** IBM Plex Sans (con system-ui, Segoe UI y sans-serif de respaldo)
**Body Font:** IBM Plex Sans
**Label/Mono Font:** IBM Plex Mono, para códigos de paquete, SKU y folios

**Character:** una sola familia, de oficina técnica: clara en tamaños chicos y con números que se
alinean. La Mono distingue lo que se escanea o se copia, como los códigos y los folios.

### Hierarchy
- **Headline** (`headline`): el título de cada pantalla.
- **Cifra** (`cifra`): el número grande de una cifra clave (kilos, dinero, paquetes), con dígitos
  de ancho fijo.
- **Title** (`title-ventana`, `title`): el título de una ventana y el de una tarjeta.
- **Body** (`body`): tablas, campos y texto corrido.
- **Label** (`label`): etiquetas de campo, encabezados de tabla y el pie de una cifra.
- **Overline** (`overline`): títulos de grupo en mayúsculas espaciadas (los grupos del menú van un
  punto más chicos).
- **Mono** (`mono`): códigos de barras, SKU y folios.

### Named Rules
**The Letra En Rem Rule.** Todos los tamaños de letra van en `rem` (1 rem = 16 px), nunca en
`px`: así la letra crece si alguien sube el tamaño en su navegador o en su celular. Los espacios,
bordes y alturas de control sí van en `px`.

**The Cifra Alineada Rule.** Todo número que se compara con otro va con dígitos de ancho fijo
(`tabular-nums`), con su unidad al lado ("1,919.71 kg") y sin ceros de relleno ("2.5", no "2.500").
El dinero lleva separador de miles y el signo antes del símbolo ("-$3,200").

## Layout

- **Marco:** una cuadrícula de dos columnas, el menú fijo de 248 px y el contenido, que va a TODO
  lo ancho (sin tope: se pidió ocupar toda la pantalla). El contenido tiene 28 px de margen arriba
  y 32 px a los lados.
- **Contenido:** una columna de bloques separados por 24 px (`lg`). Las tarjetas se acomodan en
  filas que se envuelven solas: ancha (3 partes), angosta (2) o mitad.
- **Formularios:** cuadrícula de dos columnas con 16 px (`md`) de separación; pasa a una sola
  columna por debajo de 640 px.
- **Cifras clave:** una fila de tarjetas de 220 px mínimo cada una, separadas por 16 px.
- **Celular y tableta chica (menos de 900 px):** el menú se vuelve una barra arriba con un botón
  que lo despliega, el margen baja a 16 px, y el punto de venta apila el carrito sobre el cobro.
  Ninguna pantalla debe ensancharse más que el celular: las columnas son `minmax(0, …)` y las
  tablas anchas se desplazan dentro de su propia caja.

**The Bloques Sin Margen Rule.** Los bloques de una pantalla no llevan margen propio: el espacio
lo pone su contenedor (24 px). Así nunca se suman ni se pierden separaciones.

## Elevation & Depth

El sistema es **plano**. La profundidad se da con capas de tono (el gris de piso, la tarjeta
blanca y el blanco humo) y con bordes de 1 px, no con sombras. La única sombra es la de la
ventana que flota sobre la pantalla, encima de un velo oscuro. El anillo de foco de un campo es
un halo azul translúcido de 3 px (`foco`), y el de un botón o enlace al llegar con el teclado, un
contorno azul de 2 px separado 2 px del borde (en el menú oscuro, un azul claro).

### Shadow Vocabulary
- **Ventana flotante** (`box-shadow: 0 20px 50px rgba(18, 22, 31, 0.25)`): solo los modales,
  sobre el velo (`velo`, `#12161F99`).
- **Anillo de foco** (`box-shadow: 0 0 0 3px var(--foco)`): campos, buscador y el botón que
  abre el selector de archivo, con el cursor dentro.
- **Contorno de teclado** (`outline: 2px solid var(--acento); outline-offset: 2px`, solo con
  `:focus-visible`): botones, enlaces, pestañas y opciones cuando se llega con Tab. Con el ratón
  no aparece.

**The Plano Por Defecto Rule.** Las tarjetas, las cifras y las tablas no llevan sombra. Si algo
necesita sobresalir, se resuelve con borde, tono o el azul; la sombra queda para lo que de verdad
flota encima.

## Shapes

Esquinas suavemente curvas y parejas: 8 px (`md`) en botones y campos, 10 px (`lg`) en tarjetas y
cifras, 12 px (`xl`) en las ventanas y 6 px (`sm`) en fichas chicas. Las etiquetas de estado son
cápsulas (`full`). Las barras de las gráficas solo redondean (4 px) la punta del dato, con un
hueco de 2 px del color del fondo entre tramos, nunca un borde.

## Components

### Buttons
Firmes y cómodos: altos, con texto de peso medio y nada de mayúsculas.
- **Shape:** curva suave (8 px).
- **Primary:** azul de bodega con texto blanco, 44 px de alto y 16 px a los lados; al pasar el
  puntero, azul noche.
- **Ghost (secundario):** blanco con borde de campo y texto carbón; al pasar el puntero, blanco
  humo.
- **Danger:** blanco con borde rosado (`peligro-borde`) y texto rojo; al pasar el puntero, fondo
  rojo suave. Es el que lleva el verbo de lo que no tiene vuelta ("Eliminar", "Cancelar el
  pedido"). Lleno de rojo en la ventana de confirmación, baja a rojo hondo (`peligro-oscuro`).
- **Ok:** verde pagado lleno, para confirmar una entrega o un cobro; al pasar el puntero, verde
  hondo (`ok-oscuro`).
- **Tamaños:** chico de 36 px para acciones dentro de una tabla y grande de 52 px para el cobro.
  Deshabilitado, al 55% de opacidad. **En el celular y en pantallas táctiles** (menos de 900 px o
  puntero grueso) el chico, el de solo ícono, los selectores y el "Volver" suben a 44 px, y los
  enlaces y botones de texto agrandan su zona de toque con un área invisible (`::after`) sin
  cambiar cómo se ven.
- **Enlace:** azul sin caja, para acciones secundarias dentro de un texto.

### Chips
- **Etiqueta de estado:** cápsula de 12 px de letra, seminegrita, con la pareja de su estado
  (verde, ámbar, naranja, rojo, azul o gris).
- **Ficha:** rectángulo chico de 6 px de curva, con la pareja neutra (`neutro-f` / `neutro-t`),
  para un calibre o un dato al margen.
- **Ficha de paquete:** la misma ficha con el código (mono), el peso (seminegrita) y una ✕ dibujada
  para quitarlo (`.ficha-paquete`). Es la pieza de un paquete escaneado en la caja y en la
  devolución; con el dedo, la ✕ mide 44 px.

### Cards / Containers
- **Corner Style:** 10 px.
- **Background:** blanco de tarjeta; "suave" en blanco humo; "verde" (`ok-suave` con borde
  `ok-borde`) para lo que ya está listo (por ejemplo, los apartados liquidados).
- **Shadow Strategy:** ninguna (ver Elevation & Depth).
- **Border:** 1 px de línea de estante.
- **Internal Padding:** 22 px arriba y abajo, 24 px a los lados. Su encabezado lleva el título a
  la izquierda, la explicación debajo y la acción a la derecha.

### Inputs / Fields
- **Style:** blanco, borde de campo de 1 px, 8 px de curva y 44 px de alto. La etiqueta va arriba
  en tono pizarra, y la ayuda debajo, en gris.
- **Opcional:** el texto de la etiqueta va envuelto en un `<span>`
  (`<span>Teléfono <span class="muted">(opcional)</span></span>`), para que quede en un renglón y
  los campos vecinos se alineen.
- **Focus:** el borde se vuelve azul con el halo de 3 px; sin el contorno del navegador.
- **Disabled:** blanco humo con texto gris.
- **Cantidades:** paso de 0.001 y la unidad junto al número ("kg").
- **Escaneo:** el campo del lector va con su botón al lado y se vacía solo después de cada código.

### Navigation
- **Menú lateral:** fondo menú de noche, opciones de 38 px en tinta clara, agrupadas por tarea
  bajo títulos en mayúsculas espaciadas. La opción activa es una pastilla azul con texto blanco y
  la que está bajo el puntero, un tono apenas más claro que la barra. Abajo, siempre a la vista,
  van el nombre, el puesto, la campana y "Salir". La lista se desplaza sin barra visible y se
  desvanece al final mientras haya más opciones.
- **Pestañas:** texto de 15 px con un subrayado azul de 2 px en la elegida; las demás van en
  `tinta-2`.
- **Opciones excluyentes** (Cobrar / Fiar / Apartar / Pedido): botones del mismo ancho; el elegido
  lleva borde azul y fondo azul neblina. Si no caben (celular muy angosto, letra grande) bajan de
  renglón en vez de salirse.
- **Título de la pestaña:** cada pantalla dice cuál es ("Inventario · Hitex"), con el mismo nombre
  que el menú.
- **"Saltar al contenido":** el primer Tab del panel; un botón principal arriba a la izquierda que
  solo aparece con el cursor, y lleva al título de la pantalla.

### Modales
Las acciones se hacen aquí, sin salir del listado. Velo oscuro, ventana blanca de 900 px máximo
(620 px para formularios cortos) con 12 px de curva. Tiene encabezado con título y ✕, un cuerpo
que se desplaza y un pie en blanco humo con los botones a la derecha, siempre a la vista. Aparece
con un desvanecido corto (0.12–0.14 s), sin moverse. No se cierra al tocar el fondo. La nota del
pie ocupa lo que dejan los botones, pero no menos de 14rem; si no le alcanza (celular), toma su
renglón ARRIBA de los botones.

**El foco entra y sale con la ventana** (`core/services/foco-ventanas.service.ts`, uno solo para
todas): al abrirse, el cursor va al primer campo de su cuerpo (o a lo que la ventana enfoque por
su cuenta, como el lector); Tab da la vuelta DENTRO de la ventana de más arriba; al cerrarse, el
foco regresa al botón que la abrió. En pantalla táctil no se enfoca un campo, para no tapar la
ventana con el teclado del celular. Toda ventana lleva `role="dialog"` (o `alertdialog`) y
`aria-modal="true"`: sin eso el servicio no la ve.

### Tablas que se mueven de lado
Una tabla ancha va en `.tabla-scroll` y se desplaza dentro de su caja. Cuando no cabe, el servicio
`core/services/tablas-desplazables.service.ts` (arrancado una vez en `app.ts`, como el foco de las
ventanas) la deja enfocable con Tab (`tabindex="0"`), le da nombre para el lector de pantalla
(`role="region"`, "Tabla: <título de su tarjeta>") y desvanece con `mask-image` la orilla donde
hay más columnas (`hay-mas-der` / `hay-mas-izq`). Con el cursor del teclado dentro se ve completa,
con su contorno por dentro. Sin sombras: el sistema es plano.

### Punto de venta: el lector
El campo del lector tiene el cursor siempre que no se esté escribiendo en otro campo: al abrir la
caja, después de cobrar, al cerrar la báscula u otra ventana. Si el cursor quedó en un botón, la
primera tecla de la pistola lo lleva al lector y el código entra completo; lo que ya estaba escrito
queda marcado para que el siguiente código lo reemplace.

### Cifras clave
Una tarjeta por número: la etiqueta con un punto de color, la cifra grande y un pie que dice
contra qué se mide. La cifra "total" puede ir llena de azul con texto blanco.

### Marca
Los logos publicados (`frontend/public/`) van a su tamaño de uso: `hitex-marca.png` (65 × 96, el
cono del menú y de Entrar) y `hitex-logo.png` (720 × 420), con paleta de 64 colores. Sobre la barra
oscura la marca va en un cuadro blanco. Los originales (`Hitex.jpeg`, `hitex-*-original.png`,
`icono-512.png`) viven en `frontend/marca/`, que no se publica.

## Do's and Don'ts

### Do:
- **Do** usar solo los colores de los tokens, y para una gráfica, solo la paleta validada de tres
  colores más el gris "otros".
- **Do** poner todo control a 44 px de alto como mínimo (36 px solo dentro de una tabla).
- **Do** escribir los números con dígitos de ancho fijo, su unidad y separador de miles, y el
  dinero con el signo antes del símbolo.
- **Do** separar los bloques con el espacio del contenedor (24 px) y dejar que las tablas anchas
  se desplacen en su caja.
- **Do** nombrar el hilo con su calibre ("ROJO 2/30") en cualquier lista o selector.
- **Do** mirar una gráfica ya dibujada antes de darla por buena.
- **Do** marcar los mensajes que aparecen solos: el error (`.alert`) con `role="alert"` y el de
  "listo" (`.ok-msg`, el último escaneo) con `role="status"`, para que el lector de pantalla los
  diga. Un campo con error lleva `aria-invalid` con la misma condición que lo pinta rojo.
- **Do** escribir los tamaños de letra en `rem`.
- **Do** ponerle `descripcion` a una gráfica SVG: el lector de pantalla dice eso y sus datos.
- **Do** darle `title` a cada pantalla nueva en sus rutas.

### Don't:
- **Don't** usar `confirm()`, `alert()` ni `prompt()` del navegador: se pregunta con la ventana
  de confirmación del sistema, y el botón lleva el verbo.
- **Don't** cerrar una ventana al tocar el fondo, ni dejar formularios desplegados en una pantalla
  de consulta.
- **Don't** cargar fuentes desde internet: IBM Plex va instalada en el proyecto.
- **Don't** poner sombras a tarjetas o cifras, ni bordes entre los tramos de una gráfica.
- **Don't** crear nombres de clase genéricos en la hoja global (`.linea`, `.detalle`, `.dato`):
  lo de una sola pantalla va en su componente.
- **Don't** meter un SVG de gráfica en media tarjeta: el texto se deforma con el ancho.
- **Don't** esconder con `hidden` un campo de archivo que se abre desde una etiqueta: no se llega
  a él con el teclado. Va con la clase `oculto`.
- **Don't** escribir un color suelto en una pantalla: si se repite, es un token.
- **Don't** ponerle `tabindex` a mano a una tabla desplazable, ni sombras en sus orillas: eso lo
  hace el servicio de las tablas, con `mask-image`.
