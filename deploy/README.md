# Despliegue al VPS

Un comando, nada de copiar archivos a mano.

```bash
npm run deploy            # Angular + Express
npm run deploy:frontend   # solo Angular
npm run deploy:backend    # solo Express
npm run deploy:logs       # ver los logs del API
```

## Logs

`deploy/logs.sh` **solo LEE** el journal del servicio en el servidor; no arranca,
reinicia ni despliega nada. Sirve para ver por qué falla algo sin entrar por SSH.

```bash
bash deploy/logs.sh          # últimas 60 líneas
bash deploy/logs.sh 200      # últimas 200 líneas
bash deploy/logs.sh -e       # solo errores y arranques, sin el ruido de accesos HTTP
bash deploy/logs.sh -f       # seguir en vivo (Ctrl-C para salir)
```

Para `-f` conviene invocarlo **directo con `bash`**, no por `npm run`: npm añade
una capa de proceso que hace que `Ctrl-C` no siempre cierre la conexión. El modo
`-f` usa `ssh -tt` para forzar la pseudo-terminal; sin eso, al canalizar la
salida ssh se queda colgado y no lo cierra ni un timeout.

El servicio arranca solo con systemd (`enabled`), así que sobrevive reinicios.
Para operarlo a mano:

```bash
ssh -i ~/.ssh/hostinger_vps root@72.60.112.92 'systemctl status tienda-hilos-api'
ssh -i ~/.ssh/hostinger_vps root@72.60.112.92 'systemctl restart tienda-hilos-api'
```

Destino: **https://devtristan.cloud** (`72.60.112.92`).

## Qué hace

1. **Compila Angular en local** con `--configuration production`. El servidor no
   tiene ni necesita el toolchain de Angular: solo recibe los estáticos ya
   compilados y nginx los sirve.
2. **Empaqueta el backend desde el working tree**, no desde lo commiteado. Esto
   es a propósito: el código migrado al esquema nuevo (`lineas` en vez de
   `marcas`) vive como cambios sin commitear, y desplegar `HEAD` reintroduce el
   error 500 en `/api/v1/productos`. El script avisa cuántos archivos sin
   commitear va a subir.
3. **Sube los paquetes** por `scp` a `/opt/deploy/<fecha>/` (conserva los 5
   últimos y borra los viejos).
4. **Sincroniza con rsync del lado del servidor**, con `--delete` para que
   desaparezcan los archivos que ya no existen — importante en Angular, donde
   cada build genera chunks con hash nuevo. Excluye `.env` y `node_modules/`:
   nunca se sobreescriben.
5. **Reinstala dependencias solo si cambió `package-lock.json`**. Si no cambió,
   se salta el `npm ci` y el despliegue tarda segundos.
6. **Reinicia `tienda-hilos-api.service`** y espera hasta 30 s a que `/health`
   responda. Si no responde, hace **rollback automático** a la versión anterior,
   la reinicia y muestra el log. (Probado forzando el fallo: funciona.)
7. **Verifica desde internet**: `/health`, `/` y `/api/v1/productos`.

## Rollback

Antes de cada despliegue se guarda la versión previa con hardlinks (instantáneo,
casi sin disco) en `/var/www/tienda-hilos/{backend,frontend}.prev`.

El rollback del backend es automático si `/health` falla. Para volver atrás a
mano:

```bash
ssh -i ~/.ssh/hostinger_vps root@72.60.112.92 \
  'rsync -a --delete --exclude=.env --exclude=node_modules/ --exclude=uploads/ \
     /var/www/tienda-hilos/backend.prev/ /var/www/tienda-hilos/backend/ && \
   systemctl restart tienda-hilos-api'
```

**No quites el `--exclude=uploads/`:** ahí viven los comprobantes de pago, que
solo existen en el servidor. Sin esa exclusión, `--delete` dejaría la carpeta
como estaba en la versión anterior y borraría los comprobantes subidos después.

Para ensayar que el rollback sigue funcionando, sin desplegar código roto:

```bash
HEALTH_PORT=9999 bash deploy/deploy.sh backend
```

Apunta el health check a un puerto muerto, así que falla a propósito y restaura
código idéntico. Debe terminar en `↺ rollback OK`.

## Configuración

Todo se puede sobreescribir por variables de entorno, sin editar el script:

| Variable | Por defecto |
|---|---|
| `SSH_HOST` | `root@72.60.112.92` |
| `SSH_KEY` | `~/.ssh/hostinger_vps` |
| `REMOTE_DIR` | `/var/www/tienda-hilos` |
| `SERVICE` | `tienda-hilos-api` |
| `BASE_URL` | `https://devtristan.cloud` |

## Notas

- **El `.env` del servidor nunca se toca.** Tiene las credenciales reales de
  MariaDB y el `JWT_SECRET`. Si hay que cambiar una variable, se edita allá:
  `/var/www/tienda-hilos/backend/.env`, y luego `systemctl restart
  tienda-hilos-api`.
- **La base de datos no se toca nunca.** El despliegue solo mueve código.
- `/api/v1/productos` en rojo con `/health` en verde significa que el proceso
  vive pero la consulta falla: casi siempre es desajuste entre el código y el
  esquema. El script no hace rollback en ese caso porque volver atrás no lo
  arregla; revisa `npm run deploy:logs`.
- El script exige `frontend/node_modules`. Si falta: `npm --prefix frontend install`.
