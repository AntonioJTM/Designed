#!/usr/bin/env bash
# Ver los logs del API en el servidor sin entrar por SSH a mano.
#   ./deploy/logs.sh          # últimas 60 líneas
#   ./deploy/logs.sh -f       # seguir en vivo (Ctrl-C para salir)
#   ./deploy/logs.sh 200      # últimas 200 líneas
set -euo pipefail
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

SSH_HOST="${SSH_HOST:-root@72.60.112.92}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/hostinger_vps}"
SERVICE="${SERVICE:-tienda-hilos-api}"

ARG="${1:-60}"
if [ "$ARG" = "-f" ]; then
  ssh -t -i "$SSH_KEY" "$SSH_HOST" "journalctl -u $SERVICE -f -n 40"
else
  ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" "journalctl -u $SERVICE -n $ARG --no-pager"
fi
