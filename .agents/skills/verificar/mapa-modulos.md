# Mapa de los 12 módulos de Hitex

Lo leen `/verificar` (la skill), los 12 agentes `revisor-mNN` y `backend/scripts/verificar-sistema.js`
(sección 0, "La propia auditoría"). Es la ÚNICA lista de qué carpetas, reglas, permisos,
operaciones, pruebas y tablas le tocan a cada módulo. El script comprueba que TODO lo que se
nombra aquí exista (en el disco, en `CLAUDE.md`, en `permisos/catalogo.js`, en
`autorizaciones/operaciones.js` y en `db/`) y que ninguna carpeta de `backend/src/modules/`, de
`frontend/src/app/features/admin/` ni ninguna `backend/scripts/e2e-*.js` se quede sin módulo. Si
agregas un módulo del servidor, una pantalla o una E2E, agrégala aquí o el verificador lo marca.

Formato (lo lee el script): cada módulo empieza con `## NN · Nombre`; cada dato es una viñeta
`- Etiqueta:` con sus elementos entre comillas invertidas (rutas con `*` o `**`, claves, nombres)
o entre «» (el INICIO del título en negritas de `CLAUDE.md`, tal cual). Una viñeta puede seguir
en renglones con sangría de dos espacios. Etiquetas: `Agente`, `Pantalla`, `Servidor`, `Comparte`
(archivos de otro módulo que este también lee), `Reglas de CLAUDE.md`, `Funciones y códigos`
(para buscar en los modelos grandes; tienen que existir en el código), `Permisos`, `Operaciones`
(de autorización), `E2E`, `Pruebas unitarias`, `Tablas`, `Decidido por el usuario` (texto libre).

Transversal a todos: `CLAUDE.md`, `DESIGN.md`, `PRODUCT.md`, `CAMBIOS.txt`,
`frontend/src/styles.scss`, `backend/src/middlewares/*`, `backend/src/modules/permisos/service.js`,
`backend/src/modules/tiempo-real/*`, `backend/src/utils/fechas.js`.

## 01 · Hoy y Campana de avisos
- Agente: `revisor-m01-hoy-campana`
- Pantalla: `frontend/src/app/features/admin/hoy/*`, `frontend/src/app/features/admin/admin-layout.html`,
  `frontend/src/app/features/admin/admin-layout.ts`, `frontend/src/app/features/admin/admin-layout.scss`,
  `frontend/src/app/features/admin/admin-avisos.scss`, `frontend/src/app/features/admin/admin-cuenta.scss`,
  `frontend/src/app/core/avisos.ts`, `frontend/src/app/core/services/notificaciones.service.ts`
- Servidor: `backend/src/modules/hoy/*`, `backend/src/modules/notificaciones/*`
- Comparte: `backend/src/modules/analisis/model.js`, `backend/src/modules/clientes/model.js`,
  `backend/src/modules/whatsapp/conexion.js`, `backend/src/modules/caja/model.js`,
  `frontend/src/app/core/navegacion.ts`, `frontend/src/app/core/services/tiempo-real.service.ts`
- Reglas de CLAUDE.md: «Hoy», «Las notificaciones van en la barra», «A dónde lleva cada aviso sale de UN lugar»,
  «La campana no manda a nadie a una pantalla que no puede abrir», «Un turno de caja abierto de 2 días o más sin su corte se avisa»,
  «Un cliente registrado desde la caja nace SIN crédito», «Sin mínimo capturado no hay alerta de stock»,
  «Un hilo SIN PRECIO no se vende», «Si se DESCONECTA, la campana lo dice», «"Dejaron de venir"»,
  «Cobranza», «A CUÁNTOS DÍAS ES CADA NOTA A CRÉDITO (2026-10-20)», «EL SISTEMA EN TIEMPO REAL»,
  «El menú lateral no tiene barra de desplazamiento», «Los estilos del panel de avisos viven en»,
  «Lo que suma todas las tiendas lo ve solo quien las ve todas»
- Funciones y códigos: `DIAS_SIN_ABONAR`, `DIAS_SIN_VENIR`, `DIAS_CLIENTE_NUEVO`, `DIAS_TURNO_ABIERTO`,
  `DESTINO_AVISO`, `turnos_abiertos`, `nuevos_sin_credito`, `clientesEnfriados`, `avisoCampana`,
  `revisarMenu`, `llegarAPantalla`, `alCambiarSesion`, `rutaDeInicio`, `diasSinAbonarDeTodos`
- Permisos: `ver:hoy`, `ver:caja`, `ver:config`, `ver:catalogo`, `ver:autorizaciones`
- Operaciones: ninguna propia
- E2E: `e2e-tiendas.js`
- Pruebas unitarias: `frontend/src/app/core/avisos.spec.ts`, `frontend/src/app/features/admin/admin-layout.spec.ts`,
  `frontend/src/app/core/navegacion.spec.ts`
- Tablas: `pedidos`, `sesiones_caja`, `inventario`, `producto_variantes`, `clientes`, `credito_movimientos`,
  `traspasos`, `autorizaciones`
- Decidido por el usuario: un aviso de clientes cuenta UNO por tema, no uno por cliente; no hay
  tabla de notificaciones ni "marcar como leída"; la cobranza y "dejaron de venir" solo le llegan a
  quien ve todas las tiendas.

## 02 · Punto de venta (POS), Tickets y WhatsApp
- Agente: `revisor-m02-pos-tickets`
- Pantalla: `frontend/src/app/features/admin/pos/*`, `frontend/src/app/shared/ticket/*`,
  `frontend/src/app/core/services/ticket.service.ts`, `frontend/src/app/core/services/whatsapp.service.ts`,
  `frontend/src/app/core/clave-unica.ts`, `frontend/src/app/shared/lotes.ts`, `frontend/src/app/shared/paquete-aqui.ts`,
  `frontend/src/app/shared/plazo-credito.ts`, `frontend/src/app/shared/vendedor.ts`,
  `frontend/src/app/shared/cuenta-deposito.ts`, `frontend/src/app/shared/conos.ts`,
  `frontend/src/app/features/admin/configuracion/whatsapp-tienda.ts`, `frontend/src/app/core/models/tickets.models.ts`,
  `frontend/src/app/core/models/ventas.models.ts`, `frontend/src/app/core/services/ventas.service.ts`
- Servidor: `backend/src/modules/pedidos/routes.js`, `backend/src/modules/pedidos/controller.js`,
  `backend/src/modules/pedidos/service.js`, `backend/src/modules/pedidos/model.js`, `backend/src/modules/pedidos/vendedores.js`,
  `backend/src/modules/pedidos/tickets.js`, `backend/src/modules/variantes/*`, `backend/src/modules/whatsapp/*`,
  `backend/src/utils/query.js`
- Comparte: `backend/src/middlewares/una-vez.js`, `backend/src/modules/clientes/model.js`,
  `backend/src/modules/clientes/saldo-favor.js`, `backend/src/modules/clientes/tickets.js`,
  `frontend/src/app/features/admin/clientes/anticipo-modal.ts`, `frontend/src/app/features/admin/clientes/abono-modal.ts`,
  `frontend/src/app/features/admin/clientes/cliente-form-modal.ts`, `frontend/public/hitex-ticket.png`
- Reglas de CLAUDE.md: «Se cobra por el peso del bulto, no por el nominal.», «Conos y venta por kilo en la caja: se PESAN»,
  «Los paquetes de una venta van POR LOTE», «El pedido guarda de qué bultos salió.», «Un bulto se consume UNA vez.»,
  «EN LA CAJA SOLO SE VENDEN LOS PAQUETES DE ESA TIENDA», «El apartado de un CLIENTE sí se respeta»,
  «El TICKET impreso es uno solo», «CADA DEVOLUCIÓN TIENE SU TICKET», «PAGADO CON SALDO A FAVOR»,
  «TODO TICKET SE MANDA POR WHATSAPP, EN PDF», «Y SI EL WHATSAPP DE LA TIENDA ESTÁ ENLAZADO, SE MANDA DIRECTO»,
  «El número que se escribe ahí se GUARDA en el expediente», «UN ENTER», «TICKETS DE ABONO Y DE ANTICIPO»,
  «El ENCABEZADO lleva el logo en negro y los DATOS FISCALES», «El pago en efectivo se asienta por lo COBRADO, no por el billete.»,
  «El billete SÍ se guarda, aparte y solo informativo», «UNA VENTA SE REGISTRA UNA SOLA VEZ», «El total lo calcula»,
  «"TOTAL A COBRAR" (2026-10-13)», «NOTA PENDIENTE DE PAGO (2026-10-13)», «COBRAR PARTE Y PARTE»,
  «LA CAJA Y EL CLIENTE (2026-10-16)», «EL VENDEDOR DE LA NOTA (2026-10-23)», «Vender a crédito:»,
  «A CUÁNTOS DÍAS ES CADA NOTA A CRÉDITO (2026-10-20)», «ANTICIPOS: dinero a cuenta, SIN NOTA (2026-10-14)»,
  «Un cliente registrado desde la caja nace SIN crédito», «Un hilo SIN PRECIO no se vende», «Al confirmar una venta»,
  «EN EL PUNTO DE VENTA EL CURSOR VIVE EN EL LECTOR», «Lo que no se pudo agregar se avisa JUNTO AL LECTOR»,
  «El punto de venta tiene su propia rejilla», «El hilo se nombra con su CALIBRE en todas partes»,
  «Un hilo se busca por PALABRAS», «Caja es su propia pantalla»
- Funciones y códigos: `_cotizar`, `crearPedido`, `clave_cobro`, `_exigirPaqueteAqui`, `_exigirConosContados`,
  `FALTAN_CONOS`, `SIN_PRECIO`, `BULTOS_EXCEDEN_CANTIDAD`, `PAQUETE_EN_OTRA_SUCURSAL`, `PAQUETE_EN_CAMINO`,
  `BULTO_NO_DISPONIBLE`, `PAGO_EXCEDE_TOTAL`, `METODO_PAGO_INVALIDO`, `VENDEDOR_INVALIDO`, `SQL_VENDEDOR`,
  `CREDITO_ATRASADO`, `fiar_con_atraso`, `_apartadoEnAlmacen`, `enfocarLector`, `alTeclear`, `avisoLector`,
  `pareceCodigo`, `cintillo`, `cargarVendedores`, `cobrando`, `quitarBulto`, `porLote`, `armarTicket`,
  `armarTicketDevolucion`, `armarTicketAbono`, `armarTicketAnticipo`, `armarTicketPagoNota`, `armarPrueba`,
  `llevaTicket`, `prepararHoja`, `sinRotulo`, `PAPELES`, `ticket_papel_mm`, `imprimirDevolucion`,
  `PaqueteWhatsapp`, `porPalabras`, `nuevaClave`, `conClave`, `caja_sel`
- Permisos: `ver:pos`, `hacer:fiar`, `hacer:fiar_atrasado`, `pedir:fiar_atrasado`, `ver:config`
- Operaciones: `fiar_atrasado`
- E2E: `e2e-venta-conos.js`, `e2e-paquete-de-otra-tienda.js`, `e2e-vendedor.js`, `e2e-bultos-estado.js`,
  `e2e-trazabilidad.js`, `e2e-notas-pendientes.js`, `e2e-clientes-credito.js`
- Pruebas unitarias: `frontend/src/app/features/admin/pos/pos.spec.ts`, `frontend/src/app/features/admin/pos/pesar-modal.spec.ts`,
  `frontend/src/app/shared/ticket/ticket.spec.ts`, `frontend/src/app/shared/ticket/ticket-pdf.spec.ts`,
  `frontend/src/app/shared/ticket/whatsapp-ticket.spec.ts`, `frontend/src/app/shared/ticket/whatsapp.spec.ts`,
  `frontend/src/app/shared/ticket/ticket-del-aviso.spec.ts`, `frontend/src/app/shared/lotes.spec.ts`,
  `frontend/src/app/shared/paquete-aqui.spec.ts`, `frontend/src/app/core/services/ticket.service.spec.ts`,
  `backend/src/modules/whatsapp/numero.test.js`
- Tablas: `pedidos`, `pedido_detalle`, `pedido_detalle_bultos`, `pagos`, `metodos_pago`, `variante_codigos`,
  `operaciones_unicas`, `configuracion`
- Decidido por el usuario: el vendedor se elige solo al cobrar, la lista trae a todo el personal de la
  tienda y no pide permiso; el ticket de 80 mm mide 60 mm, pegado a la izquierda; WhatsApp por QR
  (no oficial); "Su saldo a favor hoy" siempre; las formas de pago son solo efectivo y transferencia.

## 03 · Caja, Gastos y Cortes de turno
- Agente: `revisor-m03-caja-cortes`
- Pantalla: `frontend/src/app/features/admin/caja/*`, `frontend/src/app/shared/turnos-de-la-nota.ts`,
  `frontend/src/app/features/admin/clientes/turnos-caja.ts`
- Servidor: `backend/src/modules/caja/*`
- Comparte: `backend/src/modules/pedidos/model.js`, `backend/src/modules/clientes/model.js`,
  `backend/src/modules/clientes/saldo-favor.js`, `backend/src/modules/autorizaciones/operaciones.js`,
  `backend/src/middlewares/una-vez.js`, `backend/src/utils/archivos.js`
- Reglas de CLAUDE.md: «Retiros e ingresos de efectivo», «GASTOS DE LA CAJA (2026-10-20)»,
  «Cancelar una venta de mostrador saca el efectivo de la caja.», «Si en el cajón no hay todo el efectivo, lo que NO hay queda A FAVOR del cliente»,
  «El pago en efectivo se asienta por lo COBRADO, no por el billete.», «Un abono en EFECTIVO entra a la caja.»,
  «Al cajón entra solo el ANTICIPO», «Lo fiado NO entra al cajón.», «Caja es su propia pantalla»,
  «UNA VENTA SE REGISTRA UNA SOLA VEZ», «Y LO MISMO TODA OPERACIÓN DE DINERO»,
  «Un turno de caja abierto de 2 días o más sin su corte se avisa», «TODO va en la HORA DE LA TIENDA»,
  «Tienda = almacén con mostrador.», «Y PREGUNTA QUÉ PASA CON LO QUE PAGÓ»
- Funciones y códigos: `SIGNO_CAJA`, `abrirSesion`, `efectivoEnCajon`, `EFECTIVO_INSUFICIENTE`, `CAJA_CERRADA`,
  `FALTA_SESION_CAJA`, `TURNO_CERRADO`, `seAutoriza`, `seAutorizaCon`, `GASTO_SE_AUTORIZA`, `TIPO_GASTO_INACTIVO`,
  `claseIngreso`, `abriendo`, `caja_sel`, `_efectivoDelPedido`, `_sesionParaDevolucion`, `a_favor_sin_efectivo`,
  `almacenDeCaja`, `almacenDeTurno`
- Permisos: `ver:caja`, `ver:almacenes`, `hacer:mover_efectivo`, `pedir:mover_efectivo`, `hacer:registrar_gasto`,
  `hacer:gasto_sobre_limite`, `pedir:gasto_sobre_limite`, `hacer:tipos_gasto`, `pedir:tipos_gasto`
- Operaciones: `mover_efectivo`, `gasto_sobre_limite`, `tipo_gasto`
- E2E: `e2e-cancelacion-caja.js`, `e2e-apartados.js`
- Pruebas unitarias: `frontend/src/app/features/admin/caja/caja.spec.ts`, `frontend/src/app/features/admin/caja/gasto-modal.spec.ts`,
  `frontend/src/app/shared/turnos-de-la-nota.spec.ts`
- Tablas: `cajas`, `sesiones_caja`, `movimientos_caja`, `tipos_gasto`, `gastos`, `pagos`
- Decidido por el usuario: un tipo de gasto sin tope se autoriza siempre; los límites y el tipo
  «pruebas» los pone él; el corte de los dos turnos abiertos lo decide él; el retiro exige motivo.

## 04 · Ventas, Devoluciones, Notas en espera, Notas pendientes y Transferencias
- Agente: `revisor-m04-ventas-transferencias`
- Pantalla: `frontend/src/app/features/admin/pedidos/*`, `frontend/src/app/features/admin/encargos/*`,
  `frontend/src/app/features/admin/notas-pendientes/*`, `frontend/src/app/features/admin/transferencias/*`,
  `frontend/src/app/features/admin/autorizaciones/devolucion-solicitud.ts`, `frontend/src/app/features/admin/autorizaciones/devolucion-solicitud.html`,
  `frontend/src/app/shared/folio.pipe.ts`, `frontend/src/app/shared/turnos-de-la-nota.ts`,
  `frontend/src/app/shared/cuenta-deposito.ts`, `frontend/src/app/core/services/ventas.service.ts`,
  `frontend/src/app/core/services/transferencias.service.ts`, `frontend/src/app/core/models/ventas.models.ts`,
  `frontend/src/app/core/models/transferencias.models.ts`
- Servidor: `backend/src/modules/pedidos/*`, `backend/src/modules/transferencias/*`, `backend/src/utils/archivos.js`
- Comparte: `backend/src/modules/clientes/model.js`, `backend/src/modules/clientes/saldo-favor.js`,
  `backend/src/modules/caja/model.js`, `backend/src/modules/inventario/model.js`,
  `backend/src/modules/autorizaciones/operaciones.js`, `backend/src/modules/configuracion/cuentas.js`,
  `backend/src/modules/configuracion/service.js`
- Reglas de CLAUDE.md: «Venta unificada.», «Cancelar o devolver repone el inventario.», «Reactivar saca lo que REGRESÓ, no lo vendido»,
  «Cancelar una venta de mostrador saca el efectivo de la caja.», «TRANSFERENCIAS (2026-10-20)»,
  «Lo de una venta CANCELADA y REGRESADA no suma», «CANCELAR regresa TODO tal cual se vendió»,
  «Y PREGUNTA QUÉ PASA CON LO QUE PAGÓ», «SOLO EL DINERO SE REGRESA», «La mercancía puede regresar en OTRA presentación»,
  «El checkout en línea NO cobra.», «Dar por pagado un pedido en línea cobra su pago.», «Al cliente NUNCA se le cree el dinero.»,
  «La entrega vive en», «El comprobante del depósito lo sube el PERSONAL, y da el pedido por pagado.»,
  «La captura se pega a un pago, y NUNCA crea uno de más.», «El detalle del pedido dice QUÉ hilo se vendió, no solo el color.»,
  «Cancelar una venta a crédito quita la deuda, sin borrar el rastro.», «APARTADOS Y FIAR SE QUITARON DEL PUNTO DE VENTA (2026-10-13)»,
  «Apartado = venta que todavía no se entrega.», «PEDIDOS de clientes (encargos) y VENTAS (2026-10-06).»,
  «EN ESPERA y se MODIFICA», «Desde el 2026-10-13 se llaman NOTAS EN ESPERA y ya no hay chofer»,
  «NOTA PENDIENTE DE PAGO (2026-10-13)», «Se paga con su SALDO A FAVOR», ««Registrar su pago» con hasta DOS formas»,
  «Pasar a crédito», «DEVOLUCIONES CON SALDO A FAVOR (2026-10-13)», «Si la venta que regresa TODAVÍA SE DEBE»,
  «La ventana dice ANTES → DESPUÉS en vivo», «Ventas = las NOTAS DE VENTA», «En las listas va el folio CORTO»,
  «El nombre puede depender de lo que toca», «Qué REGRESA en una devolución», «Lo FIADO se da por PAGADO solo, al abonar»,
  «ABONO A NOTAS (2026-10-19)», «Los paquetes de una venta van POR LOTE»
- Funciones y códigos: `cambiarEstado`, `_validarCaminoApartado`, `_devolverDiferencia`, `pasarSobranteAFavor`,
  `rastrearPagos`, `libreSiSeCancela`, `abonado_libre`, `abonado_se_regresa`, `cuenta_regreso`, `situacionDe`,
  `SITUACIONES`, `VENTA_CON_SALDO_FAVOR`, `VENTA_CON_DEVOLUCIONES`, `DEVUELTO_EN_OTRA_PRESENTACION`,
  `VENTA_A_CREDITO_USA_ABONOS`, `NOTA_PENDIENTE_USA_ABONOS`, `APARTADO_USA_ABONOS`, `PEDIDO_YA_PAGADO`,
  `depositoComoAbono`, `capturaSoloPrueba`, `aceptaComprobante`, `_notaPorCobrar`, `pagarNotaPendiente`,
  `NOTA_PENDIENTE_SIN_PAGAR`, `NOTA_YA_PAGADA`, `PEDIDO_EN_ESPERA`, `PEDIDO_SE_ENTREGA`, `NO_SE_MODIFICA`,
  `PEDIDO_VACIO`, `_precioDeVariante`, `PAGO_INSUFICIENTE`, `SALDO_FAVOR_EXCEDE`, `SALDO_FAVOR_SOLO_NOTAS`,
  `NADA_POR_COBRAR`, `FormaPago`, `descontarDeVenta`, `debeDeVenta`, `descontado_de_esta`, `A_FAVOR_SQL`,
  `importe_cancelado`, `CUENTA_INVALIDA`, `CUENTA_CON_TRANSFERENCIAS`, `detalleDeDevolucion`, `queSeCancela`,
  `etiquetaEstado`, `preguntaDinero`, `almacenDePedido`, `REACTIVAR_COMO_PEDIDO`, `PEDIDO_YA_ENTREGADO`
- Permisos: `ver:pedidos`, `ver:encargos`, `ver:notas_pendientes`, `ver:transferencias`, `hacer:cancelar_venta`,
  `pedir:cancelar_venta`, `hacer:fiar`, `hacer:revisar_transferencias`
- Operaciones: `cancelar_venta`, `devolucion`
- E2E: `e2e-cancelacion.js`, `e2e-cancelar-lo-abonado.js`, `e2e-devoluciones.js`, `e2e-devolucion-presentacion.js`,
  `e2e-notas-pendientes.js`, `e2e-pago-nota-formas.js`, `e2e-pedidos-encargo.js`, `e2e-nombre-cancelacion.js`,
  `e2e-transferencias-canceladas.js`, `e2e-comprobante-pago.js`, `e2e-apartados.js`, `e2e-checkout-online.js`
- Pruebas unitarias: `frontend/src/app/features/admin/pedidos/pedidos-list.spec.ts`, `frontend/src/app/features/admin/pedidos/pedido-detalle.spec.ts`,
  `frontend/src/app/features/admin/pedidos/devolucion-modal.spec.ts`, `frontend/src/app/features/admin/encargos/encargos.spec.ts`,
  `frontend/src/app/features/admin/encargos/modificar-modal.spec.ts`, `frontend/src/app/features/admin/notas-pendientes/notas-pendientes.spec.ts`,
  `frontend/src/app/features/admin/transferencias/transferencias.spec.ts`, `frontend/src/app/features/admin/autorizaciones/devolucion-solicitud.spec.ts`,
  `frontend/src/app/shared/cuenta-deposito.spec.ts`, `backend/src/modules/clientes/origen-de-lo-pagado.test.js`
- Tablas: `pedidos`, `pedido_detalle`, `pedido_detalle_bultos`, `pagos`, `devoluciones`, `devolucion_detalle`,
  `devolucion_bultos`, `transferencias`, `cuentas_bancarias`, `saldo_favor_movimientos`, `credito_movimientos`,
  `envios`, `direcciones`, `v_apartados`
- Decidido por el usuario: Ventas con sus columnas fijas; cancelar regresa todo y pregunta por el
  dinero cada vez; lo condonado se va con la venta; solo el dinero se regresa; la tienda en línea
  apagada (comentada); "Devuelto" ya no se ofrece pero el servidor lo acepta.

## 05 · Clientes, Expediente, Crédito, Saldo a favor y Lugares de entrega
- Agente: `revisor-m05-clientes-credito`
- Pantalla: `frontend/src/app/features/admin/clientes/**`, `frontend/src/app/core/services/clientes.service.ts`,
  `frontend/src/app/core/models/clientes.models.ts`
- Servidor: `backend/src/modules/clientes/*`, `backend/src/modules/direcciones/*`
- Comparte: `backend/src/modules/analisis/model.js`, `backend/src/modules/notificaciones/model.js`,
  `backend/src/modules/pedidos/model.js`, `backend/src/modules/caja/model.js`,
  `backend/src/modules/autorizaciones/operaciones.js`, `frontend/src/app/shared/ticket/ticket-del-aviso.ts`
- Reglas de CLAUDE.md: «El cliente es un EXPEDIENTE, no solo una cuenta.», «El NÚMERO DE CLIENTE lo da el sistema y no se modifica»,
  «LUGAR DE ENTREGA», «Se busca por el nombre, el NÚMERO y el teléfono.», «Qué colores compra más se agrupa por»,
  «El crédito es un LIBRO de movimientos, no un saldo.», «A CUÁNTOS DÍAS ES CADA NOTA A CRÉDITO (2026-10-20)»,
  «Vender a crédito:», «Cancelar una venta a crédito quita la deuda, sin borrar el rastro.», «ABONO A NOTAS (2026-10-19)»,
  «Lo FIADO se da por PAGADO solo, al abonar», «A mano no se marca pagada una fiada que se debe», «UN SOLO "A FAVOR"»,
  «Un abono en EFECTIVO entra a la caja.», «DEVOLUCIONES CON SALDO A FAVOR (2026-10-13)», «Se AJUSTA a mano»,
  «ANTICIPOS: dinero a cuenta, SIN NOTA (2026-10-14)», «TICKETS DE ABONO Y DE ANTICIPO», «Clientes → TODOS LOS CLIENTES»,
  «Clientes → DÓNDE ENTREGO», «Clientes, además, son SEIS miradas», «Cuánto debe trae también las NOTAS PENDIENTES DE PAGO»,
  «"Crédito por cobrar este mes" en lugar de "Crédito usado"», «La frecuencia dice también cuánto se llevan»,
  «"Dejaron de venir"», «LA CAJA Y EL CLIENTE (2026-10-16)», «Un cliente registrado desde la caja nace SIN crédito»,
  «El CLIENTE es compartido», «Decidido por el usuario el 2026-10-16:», «Cobranza», «SOLO EL DINERO SE REGRESA»
- Funciones y códigos: `asignarCodigo`, `repartirAbonos`, `aplicarAbonos`, `liquidarVentasACredito`, `vencimientoDe`,
  `deudaMasVieja`, `atrasoDe`, `diasSinAbonarDeTodos`, `porCobrarHasta`, `finDeMes`, `notasPorPagar`, `_partesANotas`,
  `cargarVentaACredito`, `ajustarCreditoPorPedido`, `ajusteDeCancelacion`, `rastrearPagos`, `CREDITO_INSUFICIENTE`,
  `SIN_CREDITO`, `FALTA_CLIENTE`, `ABONO_EXCEDE_DEUDA`, `ABONO_EXCEDE_NOTA`, `NOTA_REPETIDA`, `NOTA_NO_ENCONTRADA`,
  `VENTA_FIADA_SIN_PAGAR`, `VENTA_FIADA_PAGADA`, `REACTIVAR_DESTAPA_NOTAS`, `recibirAnticipo`, `ajustarSaldo`,
  `pagarConSaldo`, `usadoEnVenta`, `deudaTotal`, `SALDO_FAVOR_INSUFICIENTE`, `ANTICIPO_VACIO`, `LUGAR_REPETIDO`,
  `LUGAR_INVALIDO`, `ritmos`, `clientesEnfriados`, `por_cobrar_mes`, `_deOtraTienda`, `otra_tienda`, `ESTADOS_MX`,
  `habitos`, `lo-que-lleva`, `tiendasDelAbono`, `DIAS_SIN_VENIR`
- Permisos: `ver:clientes`, `hacer:corregir_deuda`, `pedir:corregir_deuda`, `hacer:dar_credito`, `pedir:dar_credito`,
  `hacer:fiar`, `hacer:fiar_atrasado`
- Operaciones: `corregir_deuda`, `ajustar_saldo_favor`, `dar_credito`, `credito_alta`
- E2E: `e2e-clientes-credito.js`, `e2e-devoluciones.js`, `e2e-cancelar-lo-abonado.js`, `e2e-tiendas.js`
- Pruebas unitarias: `frontend/src/app/features/admin/clientes/clientes.spec.ts`, `frontend/src/app/features/admin/clientes/cliente-expediente.spec.ts`,
  `frontend/src/app/features/admin/clientes/cliente-form-modal.spec.ts`, `frontend/src/app/features/admin/clientes/abono-modal.spec.ts`,
  `frontend/src/app/features/admin/clientes/anticipo-modal.spec.ts`, `frontend/src/app/features/admin/clientes/expediente/ajuste-favor-modal.spec.ts`,
  `frontend/src/app/features/admin/clientes/vistas/vista-dejaron.spec.ts`, `backend/src/modules/clientes/a-favor.test.js`,
  `backend/src/modules/clientes/abono-a-notas.test.js`, `backend/src/modules/clientes/dias-sin-abonar.test.js`,
  `backend/src/modules/clientes/origen-de-lo-pagado.test.js`
- Tablas: `clientes`, `lugares_entrega`, `credito_movimientos`, `saldo_favor_movimientos`, `direcciones`, `tipos_cliente`,
  `v_clientes_saldo`
- Decidido por el usuario: abonos por transferencia y ajustes de otra tienda completos en el
  expediente; el saldo a favor paga notas de cualquier tienda; la gerente edita; la tarjeta
  "Cuánto de su crédito han usado" se queda; apodo y cumpleaños no se capturan; el número lo da el
  sistema; el cargador masivo se descartó; anticipo y abono por transferencia sin autorización.

## 06 · Inventario, Detalle por hilo, Conos, Ajuste y merma, Mínimos y Kardex
- Agente: `revisor-m06-inventario-conos`
- Pantalla: `frontend/src/app/features/admin/inventario/*`, `frontend/src/app/shared/conos.ts`,
  `frontend/src/app/shared/cantidad.pipe.ts`, `frontend/src/app/shared/charts/stacked-bars.ts`,
  `frontend/src/app/core/services/inventario.service.ts`, `frontend/src/app/core/models/inventario.models.ts`
- Servidor: `backend/src/modules/inventario/routes.js`, `backend/src/modules/inventario/controller.js`,
  `backend/src/modules/inventario/service.js`, `backend/src/modules/inventario/model.js`,
  `backend/src/modules/inventario/hilo.js`, `backend/src/modules/inventario/peso-cono.js`,
  `backend/scripts/recalcular-peso-conos.js`
- Comparte: `backend/src/modules/almacenes/model.js`, `backend/src/modules/variantes/model.js`,
  `backend/src/modules/autorizaciones/operaciones.js`, `backend/src/modules/configuracion/model.js`
- Reglas de CLAUDE.md: «Producto ≠ variante.», «Tienda = almacén con mostrador.», «Cada canal descuenta de su almacén.»,
  «Inventario con bitácora.», «Un bulto se consume UNA vez.», «EXCEPCIÓN: para BAJAR CONOS el paquete tiene que estar en esa tienda»,
  «Bajar conos a mostrador = escanear el paquete.», «SOLO EN TIENDAS y donde está el paquete»,
  «El DESTARE lo captura la tienda, DEL PAQUETE COMPLETO», «EL PESO DE UN CONO SALE DE SUS BAJADAS»,
  «SOLO SE BAJA CON EL CÓDIGO DEL PAQUETE», «El desarme respeta lo que rinde el bulto.»,
  «El movimiento manual solo sirve para AJUSTE y MERMA.», «Un solo camino para mover mercancía entre almacenes: el traspaso.»,
  «Paquete → conos, TODO por kilo.», «Todo se vende por peso, SIN excepciones.», «Un solo peso, y vive en la variante.»,
  «Inventario contesta tres preguntas, en ese orden.», «Tocar un hilo en Inventario abre su DETALLE»,
  «En inventario, el hilo se identifica con COLOR + CALIBRE», «Un número en pantalla lleva su unidad, y una barra dice contra qué se mide.»,
  «Sin mínimo capturado no hay alerta de stock.», «El mínimo se captura en Inventario», «Y PARA VARIOS HILOS DE UNA VEZ»,
  «El kardex habla de documentos, no de tipos.», «Cantidades sin ceros de relleno.», «`v_movimiento_hilo` mira solo las salidas por VENTA»,
  «El apartado DEL TRASPASO es BLANDO.», «El apartado de un CLIENTE sí se respeta», «TODO va en la HORA DE LA TIENDA»
- Funciones y códigos: `registrarMovimiento`, `COND_ALERTA`, `STOCK_INSUFICIENTE`, `SOLO_EN_TIENDA`, `DESARME_EN_OTRO_ALMACEN`,
  `PAQUETE_SIN_PESO`, `PAQUETE_EN_OTRA_SUCURSAL`, `PAQUETE_EN_CAMINO`, `destare_kg`, `destare_por_cono_kg`,
  `DESTARE_MUY_ALTO`, `DESTARE_TOPE_INVALIDO`, `desarme_destare_max_kg`, `kg_enconados`, `pesoPorPaquete`,
  `equivalencia-paquetes`, `kg_apartado`, `kg_libre`, `detalleHilo`, `bultosDeLote`, `listarMovimientos`,
  `_describir`, `textoConos`, `idTiendaLinea`, `misAlmacenes`, `stock_minimo`, `cantidad_reservada`,
  `anotarAlmacen`, `almacenesDeTraspaso`
- Permisos: `ver:inventario`, `ver:kardex`, `hacer:ajuste_merma`, `pedir:ajuste_merma`, `hacer:bajar_conos`, `hacer:ver_costos`
- Operaciones: `ajuste_merma`
- E2E: `e2e-detalle-hilo.js`, `e2e-bajar-a-mostrador.js`, `e2e-venta-conos.js`, `e2e-trazabilidad.js`, `e2e-bultos-estado.js`
- Pruebas unitarias: `frontend/src/app/features/admin/inventario/inventario.spec.ts`, `frontend/src/app/features/admin/inventario/hilo-modal.spec.ts`,
  `frontend/src/app/features/admin/inventario/desarme-modal.spec.ts`, `frontend/src/app/features/admin/inventario/movimiento-modal.spec.ts`,
  `frontend/src/app/features/admin/inventario/minimo-modal.spec.ts`, `frontend/src/app/features/admin/inventario/minimos-modal.spec.ts`,
  `frontend/src/app/features/admin/inventario/kardex.spec.ts`, `frontend/src/app/features/admin/inventario/cuando.pipe.spec.ts`,
  `frontend/src/app/shared/conos.spec.ts`, `frontend/src/app/shared/charts/stacked-bars.spec.ts`,
  `backend/src/modules/inventario/peso-cono.test.js`, `frontend/src/app/core/services/inventario.service.spec.ts`
- Tablas: `inventario`, `movimientos_inventario`, `variante_conversiones`, `variante_codigos`, `almacenes`,
  `producto_variantes`, `v_alertas_stock`, `v_stock_disponible`, `v_movimiento_hilo`
- Decidido por el usuario: Bajar conos vive en Inventario, siempre visible, solo con código, el
  modal no se cierra al confirmar; el destare es del paquete completo y su tope lo pone la tienda;
  el ajuste sobreescribe y la merma resta; el apartado del traspaso no se mete en la venta sin
  decidirlo con él.

## 07 · Surtir inventario (cargas .xlsx), Lista completa del proveedor, Plantillas y Proveedores
- Agente: `revisor-m07-surtir-inventario`
- Pantalla: `frontend/src/app/features/admin/remesas/*`, `frontend/src/app/features/admin/autorizaciones/carga-solicitud.ts`,
  `frontend/src/app/features/admin/autorizaciones/carga-solicitud.html`, `frontend/src/app/features/admin/autorizaciones/carga-solicitud.scss`,
  `frontend/src/app/shared/remesa-archivo.ts`, `frontend/src/app/shared/boton-plantilla.ts`, `frontend/src/app/shared/descargar.ts`
- Servidor: `backend/src/modules/remesas/*`, `backend/src/modules/proveedores/*`, `backend/src/utils/xlsx.js`,
  `backend/src/utils/xlsx-escritor.js`, `backend/src/utils/pdf.js`, `backend/src/utils/cargado.js`
- Comparte: `backend/src/modules/variantes/service.js`, `backend/src/modules/productos/model.js`,
  `backend/src/modules/autorizaciones/operaciones.js`, `frontend/src/app/features/admin/productos/producto-presentaciones.ts`,
  `frontend/src/app/features/admin/productos/entradas-modal.ts`, `muestras/*`
- Reglas de CLAUDE.md: «Remesa → bultos.», «Es el vaciado masivo del catálogo.», «La LISTA COMPLETA del proveedor: varios hilos en un archivo»,
  «Cada COLOR + CALIBRE es un hilo, y la LÍNEA NO separa hilos», «El costo por kilo va POR HILO y solo para administración y contabilidad»,
  «Antes de confirmar se revisa CADA PAQUETE», «La carga dice lo que está haciendo.», «Los bultos se insertan de 100 en 100»,
  ««Descargar plantilla»», «Un hilo SIN PRECIO no se vende», «Cada carga tiene su reporte en PDF»,
  «SURTIR INVENTARIO: los datos de la carga (2026-10-06).», «Poner o corregir el costo DESPUÉS rehace el promedio»,
  «El COSTO se captura en la remesa y se promedia.», «EL COSTO, SOLO ADMINISTRACIÓN Y CONTABILIDAD (2026-10-06).»,
  «El nombre del archivo de la remesa se COTEJA con el hilo elegido.», «Si algo tarda más de unos segundos, la pantalla lo dice»,
  «Qué se va a CARGAR (2026-10-21», «Donde se elige un hilo, la opción lleva COLOR + CALIBRE + material + línea.»,
  «Fase 2 (2026-10-19):», «El BULTO CAPTURADO A MANO es una ENTRADA»
- Funciones y códigos: `TANDA_BULTOS`, `recalcularCosto`, `NO_ES_PAQUETE`, `CALIBRE_NO_DEL_MATERIAL`, `leerLibro`, `empatar`,
  `tienePrecio`, `analizar`, `lotesConPaquetes`, `_porLote`, `detalleDeCarga`, `PROVEEDOR_REPETIDO`, `progreso`,
  `X-Accel-Buffering`, `partialText`, `cargarLista`, `remesa_modo`, `toda_la_lista`, `sin_precio`, `primera_carga`,
  `motivosCarga`, `almacenesDeCargas`, `fecha_ingreso`, `requirePermisoAlguno`
- Permisos: `ver:remesa`, `hacer:cargar_inventario`, `pedir:cargar_inventario`, `hacer:ver_costos`, `ver:catalogo`, `ver:inventario`
- Operaciones: `cargar_inventario`, `bulto_a_mano`
- E2E: `e2e-remesas.js`, `e2e-carga-lista.js`, `e2e-carga-por-producto.js`, `e2e-surtir-inventario.js`, `e2e-costo-margen.js`
- Pruebas unitarias: `frontend/src/app/features/admin/remesas/remesas.spec.ts`, `frontend/src/app/features/admin/remesas/carga-lista.spec.ts`,
  `frontend/src/app/features/admin/remesas/datos-carga-modal.spec.ts`, `frontend/src/app/shared/remesa-archivo.spec.ts`,
  `frontend/src/app/shared/boton-plantilla.spec.ts`, `frontend/src/app/features/admin/autorizaciones/carga-solicitud.spec.ts`,
  `backend/src/modules/remesas/plantillas.test.js`, `backend/src/utils/cargado.test.js`
- Tablas: `remesas`, `variante_codigos`, `proveedores`, `inventario`, `movimientos_inventario`, `producto_variantes`,
  `productos`, `ordenes_compra`, `orden_compra_detalle`
- Decidido por el usuario: los nombres de hilo se corrigen en el Excel; la línea no separa hilos;
  varios lotes suman al mismo saldo; un bulto que rinde menos no se avisa; el modo de carga se
  recuerda; el pedido al proveedor (compras) todavía no existe.

## 08 · Surtir sucursal (traspasos con escaneo)
- Agente: `revisor-m08-traspasos`
- Pantalla: `frontend/src/app/features/admin/traspasos/*`, `frontend/src/app/core/services/inventario.service.ts`
- Servidor: `backend/src/modules/inventario/model.js`, `backend/src/modules/inventario/traspaso-pdf.js`,
  `backend/src/modules/inventario/routes.js`, `backend/src/modules/inventario/controller.js`,
  `backend/src/modules/inventario/service.js`
- Comparte: `backend/src/modules/almacenes/model.js`, `backend/src/modules/autorizaciones/operaciones.js`,
  `backend/src/modules/notificaciones/model.js`, `backend/src/modules/variantes/model.js`, `backend/src/utils/pdf.js`
- Reglas de CLAUDE.md: «Un solo camino para mover mercancía entre almacenes: el traspaso.»,
  «El traspaso tiene TRES pasos: solicitado → en tránsito → recibido.», «Se pide en PAQUETES»,
  «Al SURTIR se ESCANEAN los paquetes que suben a la camioneta, y SIN ESCANEAR NO SE ENVÍA», «SE MANDA LO QUE HAY»,
  «NUNCA salen MÁS de los pedidos», «PAQUETE ENCONTRADO EN OTRO ALMACÉN», «SE PUEDE SURTIR A MEDIAS»,
  «Cada hilo de Pendientes lleva su BARRA», «Y SUS PDF», «SE MARCAN CUÁLES NO LLEGARON», «El apartado DEL TRASPASO es BLANDO.»,
  «El apartado de un CLIENTE sí se respeta», «Solo PAQUETES.», «Matriz → sucursales, por PAQUETES.», «SURTIR A CIEGAS»,
  «Fase 2 (2026-10-19):», «Un bulto se consume UNA vez.», «Pantalla (2026-10-20, ronda 2):»
- Funciones y códigos: `SIN_ESCANEAR`, `MAS_DE_LO_PEDIDO`, `_exigirNoMasDeLoPedido`, `BULTO_REPETIDO`, `CODIGO_DESCONOCIDO`,
  `CODIGO_NO_ES_PAQUETE`, `BULTO_NO_ES_DEL_TRASPASO`, `BULTO_SIN_PESO`, `PAQUETE_EN_OTRO_ALMACEN`, `_traerAlOrigen`,
  `guardarEscaneos`, `RECIBE_MAS_DE_LO_ENVIADO`, `DI_CUALES_FALTARON`, `BULTO_NO_ES_DEL_ENVIO`, `TRASPASO_SIN_ENVIAR`,
  `TRASPASO_SIN_RECIBIR`, `NO_SE_TRASPASAN_CONOS`, `pesoPorPaquete`, `peso_estimado`, `no_salio`, `envio_notas`,
  `paquetes_solicitados`, `cantidad_reservada`, `avanceLinea`, `surte`, `saldo_origen`, `encontrados`, `faltan`,
  `enviados`, `guardados`, `_apartadoEnAlmacen`, `almacenesDeTraspaso`, `esMatriz`
- Permisos: `ver:surtir`, `hacer:enviar_traspaso`, `hacer:recibir_traspaso`, `hacer:surtir_sucursal`, `pedir:surtir_sucursal`
- Operaciones: `surtir_sucursal`
- E2E: `e2e-traspaso-estados.js`, `e2e-traspaso-paquetes.js`, `e2e-surtir-a-medias.js`, `e2e-paquete-de-otra-tienda.js`, `e2e-tiendas.js`
- Pruebas unitarias: `frontend/src/app/features/admin/traspasos/traspasos.spec.ts`, `frontend/src/app/features/admin/traspasos/envio-modal.spec.ts`
- Tablas: `traspasos`, `traspaso_detalle`, `traspaso_bultos`, `inventario`, `movimientos_inventario`, `variante_codigos`,
  `almacenes`, `autorizaciones`
- Decidido por el usuario: se pide en paquetes con el promedio real; se manda lo que hay (no se
  cancela y se vuelve a pedir); sin escanear no sale; nunca más de lo pedido; los faltantes se
  marcan sin volver a escanear; el apartado del traspaso es blando; a ciegas solo a la Matriz.

## 09 · Catálogo: Hilos, Presentaciones, Materiales, Listas de precio y Opciones
- Agente: `revisor-m09-catalogo-precios`
- Pantalla: `frontend/src/app/features/admin/productos/*`, `frontend/src/app/features/admin/categorias/*`,
  `frontend/src/app/features/admin/tipos-cliente/*`, `frontend/src/app/core/services/catalogo.service.ts`,
  `frontend/src/app/core/models/catalogo.models.ts`
- Servidor: `backend/src/modules/productos/*`, `backend/src/modules/variantes/*`, `backend/src/modules/categorias/*`,
  `backend/src/modules/tipos-cliente/*`, `backend/src/modules/opciones/*`, `backend/src/modules/imagenes/*`,
  `backend/src/utils/cargado.js`
- Comparte: `backend/src/modules/remesas/service.js`, `backend/src/modules/remesas/reportes.js`,
  `backend/src/modules/autorizaciones/operaciones.js`, `frontend/src/app/shared/remesa-archivo.ts`,
  `frontend/src/app/shared/boton-plantilla.ts`
- Reglas de CLAUDE.md: «Producto ≠ variante.», «Un hilo SIN PRECIO no se vende», «Precio de lista en el producto.»,
  «El COLOR es el producto.», «Un producto = UNA presentación (paquete), creada SOLA.», «Sin precio por kilo la presentación no se puede crear»,
  «Precio público y peso se cambian con», «Un producto solo se elimina si NO tiene nada cargado», «Y una PRESENTACIÓN NUNCA se elimina»,
  «El formulario de producto NO captura presentaciones.», «"Se vende por" va FIJO en», «El impuesto está OCULTO»,
  «Precio por tipo de cliente.», «Banderas del producto.», «Paquete → conos, TODO por kilo.», «El cono NO se vende por pieza»,
  «Material, línea y calibre.», «Un color en dos calibres son DOS productos», «Los materiales van por NOMBRE.», «Categorías planas.»,
  «Sin slugs.», «Un solo peso, y vive en la variante.», «El BULTO CAPTURADO A MANO es una ENTRADA»,
  «"Un bulto que metió kilos se los lleva al quitarlo"», «Donde se elige un hilo, la opción lleva COLOR + CALIBRE + material + línea.»,
  «El hilo se nombra con su CALIBRE en todas partes», «La tienda en línea está APAGADA (2026-10)»,
  «Lo que suma todas las tiendas lo ve solo quien las ve todas», «Cada carga tiene su reporte en PDF»,
  «El COSTO no sale en las rutas públicas», «Un hilo se busca por PALABRAS»
- Funciones y códigos: `skuDesdeNombre`, `_exigirPrecio`, `presentacion_pendiente`, `eliminarSiVacio`, `PRODUCTO_CON_MOVIMIENTOS`,
  `PRESENTACION_NO_SE_ELIMINA`, `varianteActiva`, `agregarBultoConEntrada`, `_almacenDelBulto`, `FALTA_PESO`, `FALTA_ALMACEN`,
  `con_entrada`, `avisoBulto`, `_bultosDeSusTiendas`, `es_publico`, `modo_precio`, `origen_variante_id`, `piezas_por_origen`,
  `calibres`, `getRawValue`, `Capturar otro color`, `motivosCarga`, `multipresentacion`, `por_lotes`, `precio_oferta`,
  `unidad_venta`, `sinCostosSiNoVe`
- Permisos: `ver:catalogo`, `ver:almacenes`, `hacer:cambiar_precios`, `pedir:cambiar_precios`, `hacer:cargar_inventario`,
  `pedir:cargar_inventario`, `hacer:ver_costos`
- Operaciones: `cambiar_precio`, `precio_lista`, `bulto_a_mano`
- E2E: `e2e-edicion-catalogo.js`, `e2e-precios-lista.js`, `e2e-bulto-a-mano.js`, `e2e-carga-por-producto.js`
- Pruebas unitarias: `frontend/src/app/features/admin/productos/producto-form-modal.spec.ts`, `frontend/src/app/features/admin/productos/entradas-modal.spec.ts`,
  `frontend/src/app/features/admin/categorias/material-form-modal.spec.ts`, `frontend/src/app/features/admin/tipos-cliente/tipo-cliente-form-modal.spec.ts`,
  `frontend/src/app/shared/remesa-archivo.spec.ts`
- Tablas: `productos`, `producto_variantes`, `variante_codigos`, `variante_precios`, `categorias`, `lineas`, `unidades_medida`,
  `impuestos`, `tipos_cliente`, `producto_imagenes`
- Decidido por el usuario: la presentación nunca se elimina y «Precio y peso» se queda; el calibre
  vive en el producto; "Se vende por" fijo en kg; el impuesto oculto; los materiales sin "Orden";
  las listas de precio reales no están definidas; la tarjeta "Imágenes" comentada.

## 10 · Cómo va el negocio, Rotación de inventario y Reportes
- Agente: `revisor-m10-tablero-rotacion-reportes`
- Pantalla: `frontend/src/app/features/admin/tablero/*`, `frontend/src/app/features/admin/rotacion/**`,
  `frontend/src/app/features/admin/reportes/*`, `frontend/src/app/shared/charts/*`,
  `frontend/src/app/core/services/analisis.service.ts`, `frontend/src/app/core/services/reportes.service.ts`,
  `frontend/src/app/core/services/rotacion.service.ts`, `frontend/src/app/core/models/analisis.models.ts`,
  `frontend/src/app/core/models/reportes.models.ts`, `frontend/src/app/core/models/rotacion.models.ts`
- Servidor: `backend/src/modules/analisis/*`, `backend/src/modules/rotacion/*`, `backend/src/modules/reportes/*`,
  `backend/src/utils/fechas.js`
- Comparte: `backend/src/modules/clientes/model.js`, `backend/src/modules/remesas/lista.js`,
  `backend/src/modules/configuracion/model.js`, `Documentos/rotacion-inventario/INSTRUCCIONES.md`
- Reglas de CLAUDE.md: «El tablero contesta cuatro preguntas», «Cobranza», «Clientes enfriados», «Hilo muerto», «Margen»,
  «Las cifras se suman sobre TODO, la lista se recorta.», «`v_movimiento_hilo` mira solo las salidas por VENTA»,
  «Reportes → "Venta por color"», «ROTACIÓN DE INVENTARIO», «Rotación», «Temporada», «Pronóstico», «Qué pedir», «Los tiempos»,
  «Historia», «VENTAS DE AÑOS ANTERIORES», «Un almacén sin mostrador», «Nunca saques temporadas de», «El costo se CONGELA en la venta.»,
  «Lo que regresa NO PAGA COMISIÓN NI CUENTA COMO VENDIDO», «Lo que suma todas las tiendas lo ve solo quien las ve todas»,
  «Una gráfica se MIRA antes de darla por buena.», «`shared/charts/barras.ts` pone el cero EN SU SITIO.»,
  «Gráficas: la paleta está validada, no la cambies a ojo.», «Una gráfica SVG no va en media tarjeta.»,
  «Los colores de las gráficas viven en la hoja, no en el código», «Una gráfica SVG lleva», «Cada pantalla pide solo lo de su permiso»,
  «"Crédito por cobrar este mes" en lugar de "Crédito usado"»
- Funciones y códigos: `hiloMuerto`, `cartera`, `clientesEnfriados`, `conCosto`, `valorado_a`, `num_hilos`, `nunca_vendidos`,
  `dias_parado`, `veces_su_ritmo`, `armarVentaPorColor`, `KG_NETO`, `UMBRAL_TEMPORADA`, `meses_cubre`,
  `rotacion_semanas_proveedor`, `CLAVE_DE_ROTACION`, `ARCHIVO_CON_ERRORES`, `historia`, `OCULTAS`, `costo_envio`,
  `tintaSobre`, `RAMPA_AZUL`, `colorReal`, `resumenGrafica`, `descripcion`, `por_cobrar_mes`, `diasSinAbonarDeTodos`
- Permisos: `ver:negocio`, `ver:reportes`, `ver:rotacion`, `hacer:ajustes_rotacion`, `hacer:cargar_ventas_anteriores`, `hacer:ver_costos`
- Operaciones: ninguna propia
- E2E: `e2e-reporte-color.js`, `e2e-rotacion.js`, `e2e-costo-margen.js`
- Pruebas unitarias: `frontend/src/app/features/admin/tablero/tablero.spec.ts`, `frontend/src/app/features/admin/rotacion/ajustes-modal.spec.ts`,
  `frontend/src/app/features/admin/rotacion/como-se-calcula-modal.spec.ts`, `frontend/src/app/features/admin/rotacion/rotacion-ui.spec.ts`,
  `frontend/src/app/features/admin/rotacion/ventas-anteriores-modal.spec.ts`, `frontend/src/app/features/admin/rotacion/vistas/vista-hilo.spec.ts`,
  `frontend/src/app/features/admin/rotacion/vistas/vista-que-pedir.spec.ts`, `frontend/src/app/features/admin/reportes/reportes.spec.ts`,
  `frontend/src/app/features/admin/reportes/periodos.spec.ts`, `frontend/src/app/shared/charts/barras.spec.ts`,
  `frontend/src/app/shared/charts/barras-cero.spec.ts`, `frontend/src/app/shared/charts/columnas.spec.ts`,
  `frontend/src/app/shared/charts/composicion.spec.ts`, `frontend/src/app/shared/charts/contraste.spec.ts`,
  `frontend/src/app/shared/charts/resumen.spec.ts`, `backend/src/modules/reportes/venta-color.test.js`,
  `backend/src/modules/rotacion/cuentas.test.js`
- Tablas: `ventas_anteriores`, `configuracion`, `pedidos`, `pedido_detalle`, `movimientos_inventario`, `inventario`,
  `v_mas_vendidos`, `v_alertas_stock`, `v_movimiento_hilo`, `v_apartados`, `v_clientes_saldo`
- Decidido por el usuario: "Ventas" cuenta cada venta completa y "Hilo parado" no cambia con
  devoluciones; Venta por color sin la columna Importe; los enfriados viven en Clientes; hilo
  parado a precio de venta para quien no ve costos; los tiempos de Rotación los pone él; el
  margen resta lo que el cliente regresó (2026-10-26).

## 11 · Nómina semanal, Horarios, Vacaciones, Comisiones y Recibos PDF
- Agente: `revisor-m11-nomina-comisiones`
- Pantalla: `frontend/src/app/features/admin/nomina/*`, `frontend/src/app/core/services/nomina.service.ts`,
  `frontend/src/app/core/models/nomina.models.ts`
- Servidor: `backend/src/modules/nomina/*`, `backend/src/utils/letras.js`, `backend/src/utils/pdf.js`
- Comparte: `backend/src/modules/clientes/model.js`, `backend/src/modules/pedidos/model.js`,
  `backend/src/modules/autorizaciones/operaciones.js`, `backend/src/modules/whatsapp/conexion.js`,
  `backend/src/modules/usuarios/model.js`
- Reglas de CLAUDE.md: «Nómina semanal.», «Por días, horario, horas extra y vacaciones (2026-10-06, decisiones del usuario):»,
  «El ENVÍO no cuenta para la comisión», «LA COMISIÓN SE PAGA CUANDO LA VENTA SE LIQUIDA», «Ni lo CONDONADO»,
  «Ni la venta que se CANCELA después de pagarse», «NO SE PAGA UNA NÓMINA QUE YA NO CUADRA», «El reporte de comisiones»,
  «El PDF de la nómina», «Lo que regresa NO PAGA COMISIÓN NI CUENTA COMO VENDIDO», «La COMISIÓN es del vendedor»,
  «Fase 3 (2026-10-19), la NÓMINA:», «El CARGADOR trabaja en la tienda pero NO ENTRA AL SISTEMA», «Nómina:»,
  «Lo que suma todas las tiendas lo ve solo quien las ve todas», «SOLO EL DINERO SE REGRESA»
- Funciones y códigos: `comida_min`, `dias_trabajados`, `pago_vacaciones`, `ventasSinPagarComision`, `_calcular`,
  `cancelacionesPorDescontar`, `condonado`, `devueltaCompleta`, `DESDE`, `porRecalcular`, `por_recalcular`, `exigirAlDia`,
  `NOMINA_POR_RECALCULAR`, `NOMINA_CANCELADA`, `SIN_RECIBOS`, `ES_TU_NOMINA`, `noEsSuya`, `_conRecibos`, `ventas_netas`,
  `porcentaje_comision`, `nomina_comisiones`, `entra_al_sistema`, `SQL_VENDEDOR`, `repartirAbonos`, `rastrearPagos`,
  `mis-vacaciones`, `horas-extra`
- Permisos: `ver:nomina`, `hacer:pagar_nomina`, `pedir:pagar_nomina`, `hacer:autorizar_vacaciones`, `pedir:vacaciones`
- Operaciones: `pagar_nomina`, `vacaciones`
- E2E: `e2e-nomina-jornada.js`, `e2e-nomina-pdf.js`, `e2e-nomina-al-dia.js`, `e2e-cargador.js`, `e2e-vendedor.js`
- Pruebas unitarias: `frontend/src/app/features/admin/nomina/nomina.spec.ts`, `frontend/src/app/features/admin/nomina/jornada.spec.ts`,
  `frontend/src/app/features/admin/nomina/semana.spec.ts`, `frontend/src/app/features/admin/nomina/comisiones-semana.spec.ts`,
  `frontend/src/app/features/admin/nomina/mis-vacaciones-modal.spec.ts`, `frontend/src/app/features/admin/nomina/vacaciones-modal.spec.ts`,
  `backend/src/modules/nomina/jornada.test.js`, `backend/src/utils/letras.test.js`
- Tablas: `nomina_empleados`, `nomina_horarios`, `nomina_vacaciones`, `nomina_periodos`, `nomina_recibos`,
  `nomina_recibo_conceptos`, `nomina_comisiones`, `v_ventas_por_empleado`, `usuarios`, `roles`
- Decidido por el usuario: vacaciones sin prima; horas extra siempre al doble; llegar tarde no
  resta; la comisión completa al liquidarse (no por abono); el envío no cuenta; lo condonado no
  paga; la cancelada después de pagarse se descuenta; una nómina que cambió no se paga; nadie toca
  su propia nómina salvo el administrador; «dev» fuera de la nómina; lo demás (calcular, bonos,
  sueldos de otros, cancelar) va directo.

## 12 · Administración: Almacenes, Personal, Permisos, Autorizaciones, Configuración, Tiempo real, Seguridad y Despliegue
- Agente: `revisor-m12-administracion-autorizaciones`
- Pantalla: `frontend/src/app/features/admin/almacenes/*`, `frontend/src/app/features/admin/usuarios/*`,
  `frontend/src/app/features/admin/permisos/*`, `frontend/src/app/features/admin/autorizaciones/autorizaciones.html`,
  `frontend/src/app/features/admin/autorizaciones/autorizaciones.ts`, `frontend/src/app/features/admin/autorizaciones/autorizaciones.scss`,
  `frontend/src/app/features/admin/configuracion/configuracion.html`, `frontend/src/app/features/admin/configuracion/configuracion.ts`,
  `frontend/src/app/features/admin/configuracion/cuenta-bancaria-modal.html`, `frontend/src/app/features/admin/configuracion/cuenta-bancaria-modal.ts`,
  `frontend/src/app/features/admin/sin-acceso/*`, `frontend/src/app/features/admin/admin.routes.ts`,
  `frontend/src/app/features/auth/*`, `frontend/src/app/app.ts`, `frontend/src/app/app.config.ts`, `frontend/src/app/app.routes.ts`,
  `frontend/src/app/core/navegacion.ts`, `frontend/src/app/core/titulos.ts`, `frontend/src/app/core/costos.ts`,
  `frontend/src/app/core/clave-unica.ts`, `frontend/src/app/core/guards/*`, `frontend/src/app/core/interceptors/*`,
  `frontend/src/app/core/services/auth.service.ts`, `frontend/src/app/core/services/token.service.ts`,
  `frontend/src/app/core/services/autorizaciones.service.ts`, `frontend/src/app/core/services/autorizacion-dialogo.service.ts`,
  `frontend/src/app/core/services/usuarios.service.ts`, `frontend/src/app/core/services/tiempo-real.service.ts`,
  `frontend/src/app/core/services/confirmacion.service.ts`, `frontend/src/app/core/services/foco-ventanas.service.ts`,
  `frontend/src/app/core/services/tablas-desplazables.service.ts`, `frontend/src/app/shared/autorizacion/*`,
  `frontend/src/app/shared/confirmacion/*`, `frontend/src/app/shared/dinero.pipe.ts`, `frontend/src/app/shared/fecha.pipe.ts`,
  `frontend/src/styles.scss`, `frontend/src/index.html`, `frontend/angular.json`
- Servidor: `backend/src/modules/almacenes/*`, `backend/src/modules/usuarios/*`, `backend/src/modules/permisos/*`,
  `backend/src/modules/autorizaciones/*`, `backend/src/modules/configuracion/*`, `backend/src/modules/tiempo-real/*`,
  `backend/src/middlewares/*`, `backend/src/config/*`, `backend/src/app.js`, `backend/src/server.js`,
  `backend/src/utils/jwt.js`, `backend/src/utils/password.js`, `backend/src/utils/archivos.js`, `backend/src/utils/fechas.js`,
  `backend/scripts/_produccion.js`, `backend/scripts/_no-en-produccion.js`, `backend/scripts/estado-migraciones.js`,
  `backend/scripts/aplicar-migracion.js`, `backend/scripts/verificar-sistema.js`, `db/schema_mysql.sql`, `db/migrations/*`,
  `deploy/*`, `.gitignore`, `.claude/settings.json`, `.claude/hooks/antes-de-desplegar.js`
- Comparte: `frontend/src/app/features/tienda/*`, `backend/src/modules/direcciones/*`, `backend/src/modules/imagenes/*`
- Reglas de CLAUDE.md: «CADA QUIEN, SUS TIENDAS (2026-10-15)», «Lo que suma todas las tiendas lo ve solo quien las ve todas», «Y SE DICE»,
  «El COSTO se quita en UN lugar», «Tienda = almacén con mostrador.», «Cada canal descuenta de su almacén.»,
  «Matriz → sucursales, por PAQUETES.», «UNA VENTA SE REGISTRA UNA SOLA VEZ», «Y LO MISMO TODA OPERACIÓN DE DINERO»,
  «EL SISTEMA EN TIEMPO REAL», «Cada aviso le llega solo a quien ve esa tienda», «La configuración de la tienda es una tabla clave/valor»,
  «Las CUENTAS DE BANCO para transferencias NO son claves», «TODO va en la HORA DE LA TIENDA», «"Pregúntame" (el asistente con IA) YA NO EXISTE»,
  «AUTORIZACIONES (2026-10-19, fase 1)», «El nombre puede depender de lo que toca», «Fase 2 (2026-10-19):»,
  «Decidido por el usuario (2026-10-19):», «Pantalla (2026-10-20, ronda 4):», «Pantalla (2026-10-20, ronda 2):»,
  «Fase 3 (2026-10-19), la NÓMINA:», «Permisos por PUESTO (2026-10).», «Solo un administrador da —o toca— el puesto de administrador»,
  «Una persona puede tener VARIOS puestos», «El CARGADOR trabaja en la tienda pero NO ENTRA AL SISTEMA», «Cada pantalla pide solo lo de su permiso»,
  «El COSTO no sale en las rutas públicas», «EL COSTO, SOLO ADMINISTRACIÓN Y CONTABILIDAD (2026-10-06).», «La tienda en línea está APAGADA (2026-10)»,
  «El menú es UNO», «La página va a TODO lo ancho», «El sistema de diseño está en», «Accesibilidad y celular», «El LOGO de Hitex»,
  «Nombres genéricos en», «La pantalla es para MIRAR; las acciones son modales.», «La contraseña lleva su OJITO», «Nada de»,
  «Nunca uses», «El dinero va con el pipe», «Herramientas de Claude Code (2026-10-16).», «DOS SISTEMAS Y DOS BASES EN EL SERVIDOR (2026-10-05).»,
  «Ninguna E2E ni el sembrado corren contra», «Una migración nueva se aplica en LAS DOS bases», «Comprobar las migraciones antes de dar una por aplicada.»,
  «Las E2E corren contra la base de PRUEBAS», «La base de PRUEBAS», «Cambiar la contraseña de root de MySQL del servidor», «Cerrar el puerto 3306 del servidor.»
- Funciones y códigos: `almacenesDe`, `veTodasLasTiendas`, `exigirAlmacen`, `exigirTurno`, `filtroAlmacen`, `sinCostosEnRespuesta`,
  `sinCostosSiNoVe`, `exigirVerCostos`, `quitarCostos`, `authOpcional`, `puestosDe`, `esAdmin`, `requirePermiso`,
  `requirePermisoAlguno`, `requireTodasLasTiendas`, `requireRol`, `SOLO_TODAS_LAS_TIENDAS`, `PARTE_DE_TODAS`, `soloConTodas`,
  `notaTiendas`, `no_las_ven`, `SOLO_SUS_TIENDAS`, `FALTA_TIENDA`, `OTRA_TIENDA`, `SOLO_ADMINISTRADOR`, `PUESTO_SIN_ACCESO`,
  `FALTA_CORREO`, `FALTA_CONTRASENA`, `CORREO_NO_SE_CAMBIA`, `SE_LLEVA_COSTO`, `enOtraTienda`, `AppError`, `unaVez`,
  `X-Clave-Unica`, `X-Repetida`, `YA_SE_ESTA_REGISTRANDO`, `CLAVE_REPETIDA`, `operaciones_unicas`, `autorizable`,
  `NECESITA_AUTORIZACION`, `X-Pedir-Autorizacion`, `X-Autoriza`, `X-Autorizacion`, `X-Autorizacion-Pedida`, `AUTORIZACION_PEDIDA`,
  `autorizacionPedida`, `puedeOPide`, `claveDe`, `alPedir`, `completar`, `alResolver`, `sinConsulta`, `siempreSePide`,
  `noASiMismo`, `soloEnElMomento`, `conTienda`, `ya_estaba`, `ultimo_error`, `TIPO_OPERACION`, `partirResumen`, `tiposDeRuta`,
  `tiposPara`, `anotarAlmacen`, `anotarCompartido`, `cerrarTodas`, `auditTime`, `clabeValida`, `OCULTAS`, `time_zone`,
  `DB_TIMEZONE`, `hoyLocal`, `dateStrings`, `esProduccion`, `BASES_PRODUCCION`, `nombreDe`, `rutaDeInicio`, `permisoGuard`,
  `inicioGuard`, `todasLasTiendas`, `TitleStrategy`, `ConfirmacionService`, `enfocarCancelar`, `esMatriz`, `nombresDe`,
  `es_tienda_linea`, `es_matriz`, `es_punto_venta`, `todas_las_tiendas`
- Permisos: `ver:almacenes`, `ver:personal`, `ver:config`, `ver:autorizaciones`, `hacer:ver_costos`
- Operaciones: `mover_efectivo`, `gasto_sobre_limite`, `tipo_gasto`, `cancelar_venta`, `devolucion`, `corregir_deuda`,
  `ajustar_saldo_favor`, `cambiar_precio`, `precio_lista`, `ajuste_merma`, `fiar_atrasado`, `dar_credito`, `credito_alta`,
  `cargar_inventario`, `bulto_a_mano`, `surtir_sucursal`, `pagar_nomina`, `vacaciones`
- E2E: `e2e-permisos.js`, `e2e-tiendas.js`, `e2e-varios-puestos.js`, `e2e-cargador.js`, `e2e-cuentas-bancarias.js`, `e2e-nombre-cancelacion.js`
- Pruebas unitarias: `frontend/src/app/features/admin/almacenes/almacen-form-modal.spec.ts`, `frontend/src/app/features/admin/usuarios/usuarios.spec.ts`,
  `frontend/src/app/features/admin/usuarios/usuario-form-modal.spec.ts`, `frontend/src/app/features/admin/permisos/permisos.spec.ts`,
  `frontend/src/app/features/admin/autorizaciones/autorizaciones.spec.ts`, `frontend/src/app/features/admin/configuracion/configuracion.spec.ts`,
  `frontend/src/app/features/admin/configuracion/whatsapp-tienda.spec.ts`, `frontend/src/app/features/auth/login.spec.ts`,
  `frontend/src/app/app.spec.ts`, `frontend/src/app/core/services/auth.service.spec.ts`,
  `frontend/src/app/core/interceptors/autorizacion.interceptor.spec.ts`, `frontend/src/app/shared/autorizacion/autorizacion-dialogo.spec.ts`,
  `frontend/src/app/shared/confirmacion/confirmacion.spec.ts`, `frontend/src/app/core/services/foco-ventanas.service.spec.ts`,
  `frontend/src/app/core/services/tablas-desplazables.service.spec.ts`, `frontend/src/app/core/services/tiempo-real.service.spec.ts`,
  `frontend/src/app/core/titulos.spec.ts`, `frontend/src/app/core/navegacion.spec.ts`, `backend/src/modules/permisos/catalogo.test.js`,
  `backend/src/modules/configuracion/cuentas.test.js`, `backend/src/modules/tiempo-real/almacenes.test.js`,
  `backend/src/modules/tiempo-real/contexto.test.js`, `backend/src/modules/tiempo-real/routes.test.js`,
  `backend/src/modules/tiempo-real/tipos.test.js`
- Tablas: `almacenes`, `cajas`, `usuarios`, `roles`, `permisos`, `rol_permisos`, `usuario_roles`, `usuario_almacenes`,
  `autorizaciones`, `configuracion`, `cuentas_bancarias`, `operaciones_unicas`, `auditoria`
- Decidido por el usuario: contraseñas en Personal, avisar a quien pidió (si no es vacaciones),
  seguridad del servidor y Trello están POSPUESTOS (no volver a ofrecer); anticipo y abono por
  transferencia sin autorización; la contadora con todas las tiendas lo decide él; la tienda en línea
  comentada, no borrada; el Cargador no entra al sistema y sí sale en Nómina.
