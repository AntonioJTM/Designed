#!/usr/bin/env bash
# Ver los logs del API en el servidor sin entrar por SSH a mano.
# NO arranca ni reinicia nada: solo LEE el journal del servicio.
#
#   bash deploy/logs.sh          # últimas 60 líneas y sale
#   bash deploy/logs.sh 200      # últimas 200 líneas y sale
#   bash deploy/logs.sh -f       # seguir en vivo (Ctrl-C para salir)
#   bash deploy/logs.sh -e       # solo errores, sin el ruido de accesos HTTP
set -euo pipefail
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

SSH_HOST="${SSH_HOST:-root@72.60.112.92}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/hostinger_vps}"
SERVICE="${SERVICE:-tienda-hilos-api}"

ARG="${1:-60}"

case "$ARG" in
  -f)
    # -tt fuerza la asignación de pseudo-terminal aunque no haya TTY local
    # (p.ej. al invocarlo por `npm run` o con la salida canalizada). Sin esto
    # ssh se queda colgado y ni Ctrl-C ni un timeout lo cierran bien.
    echo "Siguiendo $SERVICE en vivo. Ctrl-C para salir."
    exec ssh -tt -i "$SSH_KEY" "$SSH_HOST" "journalctl -u $SERVICE -f -n 40 --no-pager"
    ;;
  -e)
    # Filtra los accesos HTTP de morgan y deja lo que importa.
    # El `|| true` evita que grep sin coincidencias mate el script, y el mensaje
    # explícito distingue "no hay errores" de "el comando falló".
    exec ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" \
      "journalctl -u $SERVICE -n 400 --no-pager \
         | grep -viE '\"(GET|POST|PATCH|PUT|DELETE) ' | tail -40 \
         | grep . || echo '(sin errores ni arranques en las ultimas 400 lineas)'"
    ;;
  ''|*[!0-9]*)
    echo "Uso: bash deploy/logs.sh [N | -f | -e]" >&2
    exit 1
    ;;
  *)
    exec ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" \
      "journalctl -u $SERVICE -n $ARG --no-pager"
    ;;
esac
