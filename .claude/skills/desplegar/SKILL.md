---
name: desplegar
description: Sube al servidor un cambio terminado de Hitex con todo su ritual (pruebas, migración en las dos bases con respaldo, despliegue, bitácora y memoria). Solo cuando el usuario lo pide con /desplegar.
disable-model-invocation: true
---

# Desplegar un cambio de Hitex

El usuario pidió el 2026-10-06 "todo lo que vayas haciendo lo vas subiendo": lo terminado y
probado se sube sin preguntar. Esta receta es el ritual completo, en orden. Contesta SIEMPRE en
español y explica al final con un ejemplo de tienda, sin nombres de código.

**Nunca:** hacer commit o push (solo cuando el usuario lo pida), correr E2E o sembrado contra
`hitex`, ni escribir en Trello (EN PAUSA desde el 2026-10-16 hasta que el usuario diga).

## 1. ¿Hay otra sesión trabajando?

El despliegue sube la carpeta de trabajo COMPLETA (no lo guardado en git). Revisa `ListAgents`:
si hay otra sesión de este proyecto, mándale un `SendMessage` ("voy a desplegar, ¿estás lista?")
y espera su "listo" antes de seguir.

## 2. Pruebas

1. Servidor: `cd backend && npm test`.
2. Pantallas: `cd frontend && npx ng test --watch=false --browsers=ChromeHeadless`
   (sin `--browsers` abre Chrome con ventana y, si queda detrás, la prueba de tablas
   desplazables se vence: no es una falla).
3. E2E de lo que tocó el cambio, contra la base de PRUEBAS (`desarrollo`):
   - levanta el servidor: `cd backend && PORT=3210 node src/server.js` (en segundo plano);
   - `E2E_ACEPTO_PRODUCCION=si BASE=http://localhost:3210/api/v1 node scripts/e2e-<nombre>.js`;
   - cada una dice al final si la base quedó como estaba. Siete no corren sin las listas de
     `muestras/` (ver CLAUDE.md).
4. Si cambió una pantalla, mírala: `ng build` de PRODUCCIÓN (el de development apunta a
   :3000) y la revisión en Chrome sin ventana, a 1280 y 390 px.

El candado `.claude/hooks/antes-de-desplegar.js` vuelve a correr 1 y 2 antes de `npm run deploy`
y no deja subir si fallan.

## 3. Migración (solo si el cambio trae una en `db/migrations/`)

Va en LAS DOS bases, `desarrollo` y `hitex`, y se audita contra `information_schema`, no contra
la bitácora.

1. Agrega su huella a `backend/scripts/estado-migraciones.js` y actualiza `db/schema_mysql.sql`.
2. Pruebas: `cd backend && node scripts/aplicar-migracion.js ../db/migrations/<archivo>.sql --si`
   (el `.env` local apunta a `desarrollo`).
3. Producción, con RESPALDO antes. El servidor y la llave son los de `deploy/deploy.sh`
   (`SSH_HOST`, `SSH_KEY`); con `MSYS_NO_PATHCONV=1` en Git Bash:
   - `scp` del archivo a `/tmp/`;
   - `mysqldump --single-transaction --routines --triggers hitex | gzip >
     /root/respaldos/hitex_antes_<tema>_<AAAAMMDD-HHMMSS>.sql.gz` y revisa que el respaldo
     termine en "Dump completed";
   - `mysql hitex < /tmp/<archivo>.sql`.
4. `node scripts/estado-migraciones.js --base desarrollo` y `--base hitex`: las dos "al día".

Primero la base y después el código: la migración agrega, el código viejo la ignora.

## 4. Subir

`MSYS_NO_PATHCONV=1 npm run deploy` (desde la raíz). Tiene que terminar en
"Despliegue AAAAMMDD-HHMMSS completado y verificado"; si `/health` no responde, regresa solo a lo
anterior. Anota el número del despliegue.

## 5. Dejarlo escrito

1. **CAMBIOS.txt**: una entrada nueva ARRIBA de la última —
   `AAAA-MM-DD (N) · <tema> (DESPLEGADO <número>)`, con LO QUE PIDIÓ EL USUARIO (sus palabras),
   LA DECISIÓN, LO QUE SE CAMBIÓ (base, servidor, pantalla), LA VERIFICACIÓN (cuántas pruebas
   y cuáles) y lo que falta— y reescribe el bloque "DÓNDE SE QUEDÓ" (fecha y "LO ÚLTIMO QUE SE
   TERMINÓ", con lo de antes en "Antes:").
2. **CLAUDE.md**: la regla nueva donde corresponda, si el cambio crea una.
3. **Memoria**: `estado-roadmap.md` ("lo último…") y su renglón en `MEMORY.md`.

Para escribir texto con acentos en esos archivos usa la herramienta Edit, o un script de Python
creado con Write: un heredoc de Bash con acentos o comillas invertidas se descompone.

## 6. Avisarle al usuario

En español, con un ejemplo con números de la tienda: qué cambió, cómo se prueba en la tienda
(pasos 1-2-3), qué falta que haga él y el número del despliegue. Si hubo migración, di que
hubo respaldo y que su información no cambió.
