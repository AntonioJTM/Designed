---
name: verificar
description: Auditoría estricta de Hitex en SOLO LECTURA, apegada al modelo del proyecto (CLAUDE.md, DESIGN.md, PRODUCT.md): corre el verificador automático contra la base "hitex" y lanza 12 agentes en paralelo, uno por módulo (revisor-m01 a revisor-m12), que revisan regla por regla, texto por texto y de extremo a extremo (pantalla → servidor → SQL → pruebas). Con un módulo (/verificar caja), solo ese; /verificar tiendas corre el revisor de tiendas; /verificar rapido solo el script. No cambia nada ni propone deshacer lo que el usuario ya decidió.
disable-model-invocation: true
---

# /verificar · Auditoría estricta de Hitex, apegada al modelo del proyecto

El usuario pidió `/verificar`. Quiere saber qué está mal, qué se quedó en el pasado y qué no
cuadra, **sin que se toque nada** y **sin que se le proponga deshacer lo que ya decidió**. La
verdad del proyecto está en `CLAUDE.md` (reglas y decisiones), `DESIGN.md` (lo visual),
`PRODUCT.md` (la voz) y `CAMBIOS.txt` (lo más reciente). Esta skill, su guía y su mapa van
después: si se contradicen con `CLAUDE.md` o con el código, gana `CLAUDE.md` y lo que se
reporta es "la guía está vieja".

Archivos de la skill (los tres viven también, idénticos, en `.agents/skills/verificar/`):
- `SKILL.md` (este): el ritual del coordinador.
- `guia-agente.md`: qué revisa cada agente, cómo lee, las nueve miradas, lo decidido por el
  usuario y el formato de entrega.
- `mapa-modulos.md`: qué carpetas, reglas de `CLAUDE.md`, permisos, operaciones, pruebas y
  tablas le tocan a cada uno de los 12 módulos. `verificar-sistema.js` (sección 0) comprueba que
  todo lo que nombra exista y que nada del sistema se quede sin módulo.

## Reglas que no se rompen

1. **Solo lectura.** Ni tú ni los agentes modifican un archivo, escriben en una base, corren
   E2E, sembrados, `npm test`, `ng test` ni despliegan. Lo único que corre es
   `verificar-sistema.js` (lee código y hace `SELECT` en `hitex`) y `estado-migraciones.js`.
2. **Solo `hitex`.** Nada contra `desarrollo` (datos inventados) salvo que el usuario lo pida.
3. **Nunca un ✓ sin leer.** Un módulo que ningún agente revisó completo va como "SIN REVISAR",
   nunca como ✓.
4. **Nada inventado.** Cada hallazgo importante del reporte lo CONFIRMAS tú abriendo el
   `archivo:línea` que cita el agente. Lo que no confirmes va en "No se pudo confirmar".
5. **Lo decidido por el usuario no se "arregla".** Sección 5 de la guía. Si un agente lo propone,
   lo mueves a "Decidido por el usuario" y no a hallazgos.
6. **En español, con ejemplos con números de la tienda** (paquetes, kilos, pesos), sin nombres
   de código en la prosa salvo el `archivo:línea` del hallazgo.

## Qué pidió exactamente (los argumentos)

| Lo que escribió | Qué se hace |
|---|---|
| `/verificar` | Todo: script + los 12 agentes en paralelo + consolidación. |
| `/verificar 03`, `/verificar caja`, `/verificar inventario`, … | Script completo + SOLO el agente de ese módulo. Alias: 01 hoy, campana, avisos · 02 pos, punto de venta, ticket, whatsapp · 03 caja, cortes, gastos, turno · 04 ventas, pedidos, devoluciones, notas, transferencias · 05 clientes, credito, expediente, saldo a favor, lugares · 06 inventario, conos, kardex, ajuste, merma, minimos · 07 remesas, cargas, surtir inventario, proveedores, excel, plantilla · 08 traspasos, surtir sucursal, envios · 09 catalogo, productos, hilos, presentaciones, materiales, precios, listas · 10 tablero, negocio, rotacion, reportes, temporadas · 11 nomina, comisiones, vacaciones, horario · 12 administracion, almacenes, personal, usuarios, permisos, autorizaciones, configuracion, tiempo real, seguridad. |
| `/verificar tiendas` | Script + el agente `revisor-tiendas` sobre `git diff` y lo que el usuario señale. |
| `/verificar rapido` | Solo el paso 1 (script y migraciones), sin agentes. |
| `/verificar sin-bd` | Como `/verificar`, pero el script con `--sin-bd` (cuando no hay red al servidor). |

Si el argumento no se reconoce, pregunta antes de lanzar nada.

## Paso 0 · Prepararse (un minuto)

1. Lee `guia-agente.md` y `mapa-modulos.md` de esta carpeta (los vas a necesitar para
   consolidar y para armar el brief).
2. `git status -s` desde la raíz: lo que esté sin guardar también se audita, y se dice.
3. Si `ListAgents` muestra otra sesión de este proyecto, avísale que vas a auditar en solo
   lectura (no estorba, pero puede estar a medio cambio: se anota).
4. Fecha de hoy: la necesitan los agentes para calcular plazos (15 días, 60 días, semanas).

## Paso 1 · El verificador automático (desde `backend/`)

```bash
node scripts/verificar-sistema.js            # código + reglas de DESIGN.md + base hitex
node scripts/estado-migraciones.js --base hitex
```

- Si no conecta a la base (sin red o sin credenciales): vuelve a correr con `--sin-bd`, y el
  reporte lo dice en la primera línea ("la base no se revisó"). No es un ✓ de base.
- **Sección 0 del script ("La propia auditoría")**: si marca algo (un archivo del mapa que ya no
  existe, una carpeta nueva sin módulo, una E2E sin dueño, una regla de `CLAUDE.md` que ya no
  está con ese título), la auditoría SIGUE, pero el veredicto lo pone primero: "la guía de
  /verificar necesita mantenimiento". Corregir la guía es lo único que se ofrece arreglar en el
  momento, y solo si el usuario dice que sí.
- Guarda la salida completa: de ahí sacas, para cada agente, las líneas de SU módulo.
- `verificar-sistema.js` sale con 1 si hay un GRAVE; eso no detiene la auditoría.

## Paso 2 · Los agentes, en paralelo y con el mismo brief

Lanza los 12 (o el que toque) EN UN SOLO MENSAJE, con `subagent_type` = el nombre del agente
del mapa (`revisor-m01-hoy-campana` … `revisor-m12-administracion-autorizaciones`). El brief de
cada uno es este, con sus huecos llenos:

```
Audita SOLO el módulo NN (<nombre>) de Hitex. Hoy es <AAAA-MM-DD>.
Antes de leer código: tu archivo de agente, `.claude/skills/verificar/guia-agente.md` completa
y tu sección NN de `.claude/skills/verificar/mapa-modulos.md`; luego los bloques de CLAUDE.md
que esa sección lista, completos.
SOLO LECTURA: no modifiques nada, no corras pruebas, E2E ni scripts que escriban, no toques
ninguna base (hitex es la real).
Lo que dijo verificar-sistema.js de tu módulo: <sus líneas, o "0 hallazgos en tu módulo">.
Sección 0 del script (la guía): <sus líneas, o "en orden">.
Cambios sin guardar en git que tocan tu módulo: <git status -s filtrado, o "ninguno">.
Entrega EXACTAMENTE el formato de la sección 7 de la guía, en español, con archivo:línea reales,
ejemplos con números de tienda y sin propuestas que contradigan la sección 5 de la guía.
```

Mientras corren no inventes resultados: espera las notificaciones.

## Paso 3 · Si un agente falla

- Si regresa con error, vacío, o sin el formato (sin "Estado:", sin "Qué leí"): lo relanzas UNA
  vez con el mismo brief.
- Si vuelve a fallar: ese módulo va en el reporte como **SIN REVISAR**, con el motivo. Nunca ✓.
- Si un agente dice "No existen" sobre archivos que el mapa nombra: eso es un hallazgo menor
  contra `mapa-modulos.md` (guía desactualizada), no contra el sistema.

## Paso 4 · Consolidar (tu trabajo, no el de los agentes)

1. **Verificación cruzada.** Para CADA hallazgo importante: abre el `archivo:línea` citado y
   confirma que dice lo que el agente dice; si cita una regla, búscala en `CLAUDE.md`. Lo que
   no cuadre pasa a "No se pudo confirmar" con la razón. Un hallazgo sin `archivo:línea` no entra
   como importante.
2. **Filtro de decisiones.** Compáralo con la sección 5 de la guía y con "DECIDIDO POR EL
   USUARIO" de `CAMBIOS.txt`: lo que choque va a su propia sección, con la cita de la decisión.
3. **Deduplica** lo que dos módulos reportaron (el cruce caja/ventas/clientes es normal): un solo
   renglón con los dos módulos.
4. **Ordena** por gravedad: primero lo que descuadra dinero o mercancía, luego privacidad y
   permisos, luego candados, luego textos que engañan; al final lo menor.
5. **Pruebas que faltan**: junta las reglas sin prueba de todos los agentes en una lista corta.
6. **Propuestas**: máximo 5 de A (lógica, operatividad, CRM) y 5 de B (diseño conectado con la
   lógica, dentro de `DESIGN.md`), cada una ligada a un hallazgo o a una regla, y ninguna que
   contradiga la sección 5. No es una lista de deseos.

## Paso 5 · El reporte (en español sencillo)

1. **Veredicto en tres líneas**: el script (comprobaciones, hallazgos, graves), `hitex` (base
   revisada o no; migraciones al día o no) y los agentes (cuántos ✓, ✖, SIN REVISAR).
2. **Tabla de los 12 módulos**: número, nombre, estado, agente, archivos leídos (pantalla /
   servidor), hallazgos importantes / menores.
3. **Lo importante**, numerado, cada uno con `archivo:línea`, qué pasa, qué debería (la regla),
   cómo se comprobó, un ejemplo con números de tienda y qué pasa si se deja así.
4. **Menores**, en renglones cortos.
5. **Decidido por el usuario** (no se propone cambiar), con la cita.
6. **No se pudo confirmar**.
7. **Pruebas que faltan**.
8. **Propuestas** A y B.
9. **La guía de /verificar** (solo si la sección 0 marcó algo): qué hay que actualizar.
10. Cierre: "No se tocó ningún archivo ni dato en `hitex`. Dime cuáles hallazgos o propuestas
    quieres que aplique." Aplicar algo sigue el ritual de `/desplegar` (pruebas, migración en
    las dos bases con respaldo, bitácora), nunca desde esta skill.

## Mantener la skill (cuando cambia el sistema)

- Una pantalla, un módulo del servidor o una E2E nueva: su renglón en `mapa-modulos.md` (y el
  script lo exige). Un bloque nuevo de `CLAUDE.md`: a la sección de su módulo. Una decisión
  nueva del usuario: a la sección 5 de la guía y al "Decidido" de su módulo.
- Los tres archivos se copian idénticos a `.agents/skills/verificar/`; el script avisa si
  difieren.
