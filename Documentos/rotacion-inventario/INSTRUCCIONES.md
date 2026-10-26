# Rotación de inventario: instrucciones para construirla

Pantalla nueva del panel, en el grupo **Números** del menú, junto a «Cómo va el negocio» y
«Reportes». Contesta tres preguntas de la tienda, **solo en kilos y toneladas, nunca en dinero**:

1. ¿Cuándo se vende más hilo, y en qué fechas?
2. ¿Qué hilos se mueven más, y en qué temporada?
3. ¿Cuándo hay que pedirle al proveedor, y cuánto?

El diseño aprobado está en `diseno/` (junto a este archivo). Son maquetas en HTML con estilos
en línea y **datos de ejemplo**. Sírvete de ellas para el acomodo, los textos y los colores, pero
constrúyelas con los componentes y los tokens del proyecto (`DESIGN.md`): nunca copies un
hexadecimal suelto. El menú lateral de las maquetas está recortado; usa el menú real.

| Archivo | Qué es |
|---|---|
| `diseno/resumen.html` | Pestaña **Resumen** |
| `diseno/temporadas.html` | Pestaña **Temporadas** |
| `diseno/por-hilo.html` | Pestaña **Por hilo** (de ejemplo, MARINO 2/30) |
| `diseno/que-pedir.html` | Pestaña **Qué pedir** |
| `diseno/como-se-calcula.html` | Ventana **«¿Cómo se calcula?»** |

Antes de empezar, lee `CLAUDE.md`, `DESIGN.md` y `PRODUCT.md`: aquí no se repiten sus reglas.
Sigue sus convenciones de siempre (migración en las dos bases con respaldo previo, pruebas,
anotar en `CLAUDE.md` y `CAMBIOS.txt`, despliegue).

---

## 1. Reglas que no se rompen

- **Cero dinero.** Ningún endpoint de esta pantalla selecciona `subtotal`, `importe`, `total`,
  `precio`, `costo` ni `costo_unitario`. No hace falta `sinCostosEnRespuesta`: no se pide nada de
  eso.
- **Unidades:** kilos con su unidad («1,720 kg»). De 1,000 kg para arriba, en las cifras grandes
  y los totales, en toneladas con hasta dos decimales y sin ceros de relleno («31.3 t», «5.24 t»,
  «1.97 t»). Separador de miles siempre. Los paquetes van como cantidad aproximada
  («≈ 96 paquetes»), calculada con el peso promedio REAL de los paquetes de ese hilo.
- **El hilo es `productos.id`** (color + calibre), con paquete y cono sumados. Nunca agrupes por
  nombre. Se nombra con su calibre («MARINO 2/30»).
- **Junta todas las tiendas**: la ve solo quien ve todas (`requireTodasLasTiendas` y
  `data.todasLasTiendas` en la ruta), igual que Reportes.
- **Se calcula al momento**, como el tablero: sin tablas de resumen ni procesos nocturnos.
- **No inventa temporada.** Si no hay historia suficiente, la pantalla lo dice (sección 5).
- **Diseñada para computadora.** No hay versión de celular todavía, pero en pantalla angosta no
  se rompe: las tablas anchas van en `.tabla-scroll` y los filtros bajan de renglón.
- Sin librerías nuevas. El «Excel» que se descarga es un **CSV con BOM UTF-8**, que Excel abre
  directo; `CLAUDE.md` explica por qué no se usa la librería `xlsx`.

---

## 2. Dónde va

**Menú** (`frontend/src/app/core/navegacion.ts`), grupo `Números`, después de Reportes:

```ts
rotacion: 'M4 12a8 8 0 0 1 14-5.3 M20 4v4h-4 M20 12a8 8 0 0 1-14 5.3 M4 20v-4h4',
// …
{ clave: 'rotacion', nombre: 'Rotación de inventario', ruta: '/admin/rotacion', icono: I.rotacion, permiso: 'ver:rotacion' },
```

**Rutas** (`admin.routes.ts`): con el mismo patrón que `VISTAS_CLIENTES`. Son cuatro pestañas
con su título de pestaña («Temporadas · Rotación de inventario · Hitex») y
`data: { permiso: 'ver:rotacion', vista, todasLasTiendas: true }`:

| Ruta | Pestaña |
|---|---|
| `/admin/rotacion` | redirige a `/admin/rotacion/resumen` |
| `/admin/rotacion/resumen` | Resumen |
| `/admin/rotacion/temporadas` | Temporadas |
| `/admin/rotacion/hilo/:productoId` | Por hilo (sin `:productoId`, abre el que más se vende) |
| `/admin/rotacion/que-pedir` | Qué pedir. La pestaña lleva la cápsula naranja «N ya» cuando hay hilos en «Pedir ya» |

**Permisos** (`backend/src/modules/permisos/catalogo.js` y la migración):

- `ver:rotacion`, grupo «Catálogo y números»: nombre «Rotación de inventario», ayuda «Cuánto
  hilo se vende, en qué temporada y cuándo pedirlo». La migración se lo da a los puestos que hoy
  tienen `ver:reportes`, como hizo `2026-10_transferencias.sql`.
- `hacer:cargar_ventas_anteriores`: solo para la parte 2 (sección 8). Por omisión no lo tiene
  nadie más que el administrador.

**Migración** `db/migrations/2026-10_rotacion_inventario.sql`, en las dos bases:

- Los dos permisos de arriba.
- Las claves de `configuracion` (internas, `publica = 0`):
  `rotacion_semanas_proveedor` = 10, `rotacion_semanas_colchon` = 3,
  `rotacion_meses_cubre` = 4, `rotacion_kg_contenedor` = vacío y
  `rotacion_ajustes_confirmados` = 0.
- La tabla `ventas_anteriores` de la sección 8.

---

## 3. De dónde sale cada número (todo ya existe)

| Dato | De dónde |
|---|---|
| **Kilos vendidos** | `pedido_detalle.cantidad` menos lo devuelto (`devolucion_detalle`), con las mismas reglas que `reportes/model.js → ventaPorColor` (`KG_NETO`, `VENDIDO`, `DEVUELTO`). **Reutiliza esas constantes**, no las copies. |
| **Fecha de la venta** | `COALESCE(pedidos.entregado_en, pedidos.creado_en)`. Una nota en espera vende el día que se entrega, no el día que se tomó. |
| **Tienda de la venta** | `pedidos.almacen_id` |
| **Paquete o cono** | `producto_variantes.tipo_presentacion` |
| **Hay hoy (kg)** | `inventario.cantidad` (lo físico, igual que Inventario), por almacén |
| **En camino entre almacenes** | Envíos con `traspasos.estado = 'en_transito'`. Súmalos al total para que el hilo no «desaparezca» mientras viaja. |
| **Hay hoy (paquetes) y peso promedio** | `variante_codigos` con `estado IN ('disponible','apartado')`: `COUNT` y `AVG(peso_kg)`. Si no hay paquetes, el peso de catálogo (`producto_variantes.peso_kg`). |
| **Existencia de un día pasado** | La suma del kardex (`movimientos_inventario.cantidad`) hasta ese día, la misma cuenta de `remesas/model.js → recalcularCosto`. Antes de usarla, comprueba que la suma de hoy cuadre con `inventario.cantidad`; el detalle del hilo ya avisa cuando no cuadra. |
| **Cargas del proveedor** | `remesas` del hilo: `fecha_ingreso` (o `creado_en`) y `kg_total` |
| **Ajustes** (proveedor, colchón, meses, contenedor) | `configuracion` (claves de la sección 2) |
| **Almacén que no vende** | `almacenes.es_matriz = 1` (Almacén General). Para él, «vendido» se lee como **«surtido a tiendas»**: las salidas por envío. Así su rotación es cuánto surte contra lo que guarda. Nunca escribas el nombre del almacén en el código. |

**No** cuentan como venta: canceladas, devueltas, apartadas sin entregar, envíos entre almacenes,
mermas ni ajustes.

---

## 4. Las cuentas

Ponlas en funciones puras (`backend/src/modules/rotacion/cuentas.js`) con su prueba
(`cuentas.test.js`), como `reportes/venta-color.js`. Los números de ejemplo son los del diseño:
úsalos en las pruebas.

**Rotación** (veces al año) = kilos vendidos en los últimos 365 días ÷ existencia promedio diaria
en esos 365 días.
- Ejemplo: 6,799 ÷ 2,615 = **2.6**. «Se renueva cada» 365 ÷ 2.6 = **140 días**.
- «Se mueve»: 2 o más = **Rápido** (pareja azul informativa); de 1 a 2 = **Normal** (neutra);
  menos de 1 = **Lento** (ámbar).
- Con menos de 365 días de ventas, se anualiza con los días que haya y la pantalla lo dice
  («calculada con 9 semanas de ventas»). Con existencia promedio 0, se pone «—».

**Qué tan fuerte es un mes** (índice) = kilos del mes ÷ (kilos del año ÷ 12), del mismo hilo.
- Ejemplo: 851 ÷ (6,205 ÷ 12 = 517) = **1.65**, o sea 65% más que un mes normal.
- **Su temporada** = los meses seguidos con índice de 1.3 o más; puede cruzar de diciembre a
  enero. Sin ninguno, es «Parejo todo el año».
- **Mapa de calor**, cinco tramos:

  | Índice | Fondo | Leyenda |
  |---|---|---|
  | menos de 0.7 | `--viz-calor-1` | «30% menos o más abajo» |
  | 0.7 a 0.9 | `--viz-calor-2` | «10% a 30% menos» |
  | 0.9 a 1.1 | `--viz-rampa-2` | «Un mes normal» |
  | 1.1 a 1.4 | `--viz-rampa-3` | «10% a 40% más» |
  | 1.4 o más | `--viz-rampa-4` | «40% más o arriba» |

  La letra la elige `tintaSobre()` (`shared/charts/contraste.ts`).

**Tendencia** = kilos del año en curso ÷ kilos del año anterior, de enero al último mes completo,
**redondeada a 2 decimales** (la misma cifra que se enseña).
- Ejemplo: 4,824 ÷ 4,304 = **1.12**.
- Solo se calcula con 3 meses comparables o más. Si no, vale 1. Nunca baja de 0.5 ni pasa de 2.

**Pronóstico de un mes** = kilos del mismo mes del año anterior × tendencia. El de un día es el
del mes entre los días que tiene ese mes.
- Ejemplo: 626 × 1.12 = **701 kg**.
- Sin un año de historia: el promedio diario de las últimas 8 semanas (o las que haya, desde
  4), sin temporada.

**Se vende ahora** (kg por semana) = el pronóstico de los próximos 28 días ÷ 4.

**Alcanza para** (semanas) = existencia ÷ se vende ahora.

**Le alcanza hasta** (fecha) = se descuenta el pronóstico día por día desde hoy hasta que la
existencia llega a 0. Esta fecha **sí** cuenta la temporada: HUESO «alcanza 37 semanas» al ritmo
de hoy, pero se acaba en marzo porque en primavera vende casi el triple.

**Pedir a más tardar** = le alcanza hasta − (semanas del proveedor + semanas de colchón) × 7.
- Ejemplo: 14 de enero de 2027 − 91 días = **15 de octubre de 2026**.

**Cuánto pedir** = el pronóstico desde que llegaría (la fecha de pedir, o hoy si ya pasó, más las
semanas del proveedor) hasta `meses_cubre` meses después más el colchón, menos lo que quede al
llegar (si es negativo, 0).
- Se redondea a 10 kg. Los paquetes son kg ÷ peso promedio del paquete, redondeado.
- Ejemplo: se esperan vender unos 1,800 kg y quedan 221 kg al llegar: 1,800 − 221 ≈
  **1,580 kg**, unos **96 paquetes** de 16.4 kg.

**Estado de cada hilo en «Qué pedir»:**

| Estado | Cuándo | Pareja |
|---|---|---|
| **Pedir ya** | la fecha para pedir ya pasó o cae en los próximos 7 días; si ya pasó, la fila dice «· ya pasó» en tinta naranja | naranja (`alerta-f`/`alerta-t`) |
| **En <mes>** («En diciembre») | la fecha cae en los próximos 90 días | ámbar |
| **Con calma** | más adelante | neutra |
| **Sobra** | alcanza para más de 52 semanas: no se propone pedir | azul informativa |

**Calendario de compras de cada año** (Temporadas):
- «Pedir» va en el mes de (inicio de su temporada − semanas del proveedor − 3 semanas).
- «Llega» va en el mes de (inicio − 3 semanas).
- El texto es «Principios / mediados / fines de <mes>, para <mes de inicio>»: días 1–10, 11–20
  y 21 en adelante.
- Los hilos que comparten fechas van en un solo renglón («MARINO, OXFORD JASPE, CAMEL y CAFE
  JASPE»).
- Sin temporada: «Sin temporada: se pide cuando le queden 4 meses de venta», y su estado de hoy.

---

## 5. Con poca historia (importante hoy)

La base `hitex` quedó en blanco el **14 de octubre de 2026**, así que hoy tiene muy pocas semanas
de ventas reales. Cada respuesta del backend trae
`historia: { desde, dias, nivel }`, y la pantalla se porta así:

| `nivel` | Cuándo | Qué enseña |
|---|---|---|
| `poca` | menos de 28 días de ventas | Solo **Hay hoy** (kg, paquetes, por almacén). Lo demás dice: «Faltan N semanas de ventas para calcular la rotación y qué pedir». |
| `sin_temporada` | de 28 días a menos de 12 meses | Rotación anualizada, Qué pedir con el promedio de las últimas semanas. Temporadas enseña los kilos por mes que haya, **sin colores ni calendario**, con el aviso «Hay ventas desde <fecha>: la temporada se ve con un año completo». |
| `completa` | de 12 a menos de 24 meses | Todo, con el aviso azul «La temporada ya se puede ver, y se va a confiar más cuando haya dos años completos». |
| `confiable` | 24 meses o más | Todo, sin aviso. |

`desde` es la venta más vieja: la del sistema o la de `ventas_anteriores` (sección 8).

**Nunca** uses los datos de la base `desarrollo` para sacar temporadas: sus ventas son inventadas
(`_demo_registros`).

---

## 6. Backend

Módulo nuevo `backend/src/modules/rotacion/`: `routes.js`, `controller.js`, `service.js`,
`model.js` y `cuentas.js`. Se monta en `routes.js` como `/rotacion`. Todas las rutas llevan
`authRequired, requireTipo('usuario'), requirePermiso('ver:rotacion'), requireTodasLasTiendas`.

| Endpoint | Qué devuelve |
|---|---|
| `GET /rotacion/resumen?almacen_id=` | `historia`; cifras clave (vendido 12 meses, contra el año anterior, hay hoy en kg y paquetes, rotación, alcanza para, se vende por semana); `meses`: los dos años, por mes, con su origen (`real`, `en_curso` con el día de corte, `pronostico`); temporada alta y baja de todo junto (los 3 meses seguidos con el índice promedio más alto y más bajo, con su %); `pedir_pronto` (hasta 5); `hilos`: el ranking |
| `GET /rotacion/temporadas?almacen_id=&anio=AAAA\|promedio` | `historia`; por hilo, los 12 meses con kg e índice, su total y su temporada; los totales por mes en t; el calendario de compras; las tarjetas por temporada (kg de cada hilo en su temporada y qué % de su año es) |
| `GET /rotacion/hilo/:productoId` | El hilo: cifras clave, sus meses de los dos años, su temporada (mejor mes, mes más flojo, contra el año pasado), la proyección semanal de 27 semanas («si se pide hoy» y «si no se pide»), por almacén, paquete contra cono y sus últimas cargas del proveedor |
| `GET /rotacion/que-pedir` | `ajustes` (con `confirmados`); un renglón por hilo con hay hoy, se vende ahora, le alcanza hasta, pedir a más tardar, cuánto pedir (kg y paquetes), estado y la nota corta del diseño («En marzo vende casi el triple», «Aguanta su temporada de diciembre»); totales de «Pedir ya» y de «Próximos 3 meses» |
| `GET /rotacion/que-pedir.csv?hilos=1,2,3` | El CSV para el proveedor: Hilo, Calibre, Material, Kilos a pedir, Paquetes aprox., Pedir a más tardar. Sin precios. |
| `GET /rotacion/ajustes` y `PUT /rotacion/ajustes` | Las 4 claves. Validación: proveedor 1–52 semanas, colchón 0–12, cubre 1–12 meses, contenedor vacío o más de 0 kg. Al guardar, `rotacion_ajustes_confirmados = 1`. |

- **Rendimiento:** son 8 hilos y 3 almacenes. Trae las ventas agrupadas por día y hilo en una
  sola consulta, y el kardex agrupado por día y variante en otra; el resto se hace en JS.
- **Proyección «por almacén»** (pestaña Por hilo): la venta semanal de cada tienda es el
  pronóstico del hilo repartido según lo que vendió cada tienda en los últimos 90 días. La tienda
  lleva «Surtirle pronto» si le alcanza para menos de 4 semanas y la matriz tiene. El aviso dice
  «<Tienda> se queda sin <HILO> hacia el <fecha>. <Matriz> tiene <kg> para surtirle», con su botón
  a Surtir sucursal.

---

## 7. Frontend

Carpeta `frontend/src/app/features/admin/rotacion/`:

- `rotacion.ts`: la pantalla. Lleva el encabezado («Rotación de inventario» y «Cuánto hilo se
  vende, en qué meses y cuándo conviene pedirlo. Todo en kilos.»), los botones «¿Cómo se
  calcula?» y «Descargar en Excel», las pestañas y una fila de filtros arriba de todo. Los
  filtros no van dentro de una tarjeta.
- `vistas/vista-resumen.ts`, `vista-temporadas.ts`, `vista-hilo.ts`, `vista-que-pedir.ts`.
- `como-se-calcula-modal.ts`: los 7 pasos del diseño. Sus ejemplos salen del hilo que más se vende
  hoy, con sus números reales (si no hay historia, los del paso que aplique).
- `ajustes-modal.ts`: los 4 campos («El proveedor tarda», «Colchón», «Cada pedido alcanza para»,
  «Kilos por contenedor (opcional)»). Mientras no se guarden, «10 semanas» lleva la cápsula ámbar
  «Por confirmar».
- `core/services/rotacion.service.ts`.

Las ventanas siguen `DESIGN.md`: no se cierran al tocar el fondo, `role="dialog"`,
`aria-modal="true"` y el foco con `foco-ventanas.service.ts`.

**Gráficas.** Respeta las reglas escritas en los comentarios de `shared/charts/`: solo la punta
del dato redondeada a 4 px, hueco de 2 px, leyenda cuando hay más de una serie, tooltip en cada
barra y «Ver como tabla».

- **Columnas comparadas** (nuevo `shared/charts/columnas-comparadas.ts`): por mes, el año anterior
  en `--viz-otros` y el año en curso en `--viz-series-1`. El mes en curso va en `--viz-series-2`
  con la leyenda «<Mes> <año>, va en curso (hasta el <día>)», y los meses que faltan, en contorno
  punteado `--viz-series-1` («Lo que se espera vender»). Arriba lleva las marcas «Temporada alta»
  y «Temporada baja» sobre sus meses, con fondo `--acento-tenue` en la alta. Debajo, los tres
  avisos del diseño.
- **Mapa de calor hilo × mes** (nuevo `shared/charts/mapa-calor-meses.ts`): celdas con el kg
  escrito, los 5 tramos de la sección 4, el mes más alto de cada hilo en negritas, el total del
  año y «Su temporada» a la derecha, y el renglón «Los 8 hilos» en t al final. Ojo: es una
  cuadrícula con `role="table"`, no un SVG.
- **Proyección semanal**: 27 columnas (hoy + 26 semanas) en `--viz-series-1`. Las semanas en que
  queda menos de 3 semanas de venta van en `--punto-aviso`. Lleva la cápsula verde «Llega el
  <fecha> · +<kg>» sobre la semana de llegada, las etiquetas de mes abajo y el selector «Si se
  pide hoy / Si no se pide».
- **Ranking** de la pestaña Resumen: tabla con barra horizontal de un solo color
  (`--viz-series-1`) en la celda de kilos.
- **Paquete contra cono**: una barra partida en `--viz-series-1` y `--viz-series-2` con su
  leyenda.

**Textos:** van tal cual del diseño, con sus cifras reales. Por ejemplo, «Había que pedirlo el 15
de octubre. Se acaba hacia el 14 de enero.» o «OPTIK 2/30 sobra: hay 5,100 kg y se venden unos 25
kg por semana. Al ritmo de hoy alcanza para más de 3 años; no hace falta pedir. Lo que no se ha
vendido en meses también sale en Hilo parado, en «Cómo va el negocio».»

**«Hacer pedido al proveedor»** se dibuja apagado, con «Todavía no existe en el sistema» abajo.
**«Ya viene en camino»** dice «No se sabe todavía». No construyas el pedido al proveedor ahora:
las tablas `ordenes_compra` y `orden_compra_detalle` existen, pero son otro trabajo.

---

## 8. Parte 2: cargar ventas de años anteriores

Para no esperar un año a ver la temporada.

- **Tabla `ventas_anteriores`:** `id`, `producto_id`, `almacen_id` (NULL = las dos tiendas),
  `anio`, `mes` (1–12), `kg` DECIMAL(12,3) mayor que 0, `usuario_id`, `creado_en`, con
  `UNIQUE(producto_id, almacen_id, anio, mes)`.
- **Archivo .xlsx**, leído con `utils/xlsx.js → leerHoja`. Columnas: Hilo (color), Calibre, Año,
  Mes (número o nombre), Kilos y Tienda (opcional).
- **Primero una vista previa** con los renglones que no se entienden (hilo que no existe, mes
  inválido, kilos vacíos); después se confirma.
- **Regla:** en un mes donde el sistema ya tiene ventas de ese hilo, mandan las del sistema y la
  vista previa avisa «Ya hay ventas del sistema en ese mes: se ignora».
- **Botón:** «Cargar ventas de años anteriores», en la ventana «¿Cómo se calcula?», con permiso
  `hacer:cargar_ventas_anteriores`.

---

## 9. Pruebas y revisión

- `cuentas.test.js`, con los ejemplos de la sección 4:
  - 6,799 ÷ 2,615 = 2.6 y 140 días;
  - 851 ÷ 517 = 1.65;
  - tendencia 1.12; 626 × 1.12 = 701;
  - 14 de enero de 2027 − 91 días = 15 de octubre de 2026;
  - los cuatro estados;
  - la temporada que cruza el año;
  - los cuatro niveles de historia.
- Las pruebas de los componentes nuevos (`.spec.ts`).
- Una E2E `scripts/e2e-rotacion.js` contra la base de **pruebas**, con las reglas de E2E de
  `CLAUDE.md`: lo que crea, marcado y limpiado. Nunca contra `hitex`.
- **En `hitex`, solo lectura:**
  - los kilos de 12 meses por hilo tienen que dar lo mismo que Reportes → Venta por color en el
    mismo rango, si no hay notas en espera entregadas otro mes;
  - la existencia de hoy tiene que dar lo mismo que Inventario.
- Mira la pantalla dibujada, en computadora y angosta, antes de darla por buena.

---

## 10. Al terminar

- Anota en `CLAUDE.md` las reglas nuevas: fecha de la venta, temporada al 1.3, niveles de
  historia, ajustes en `configuracion` y `ventas_anteriores`.
- Anota en `CAMBIOS.txt` lo que se hizo.
- Sigue las reglas de despliegue de `CLAUDE.md`.
