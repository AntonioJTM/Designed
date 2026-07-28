#!/usr/bin/env bash
# =============================================================================
#  Despliegue de la tienda de hilos al VPS.  Un solo comando, nada manual.
#
#    ./deploy/deploy.sh              # frontend + backend
#    ./deploy/deploy.sh frontend     # solo Angular
#    ./deploy/deploy.sh backend      # solo Express
#
#  Qué hace, en orden:
#    1. Compila Angular en LOCAL (el servidor no necesita el toolchain).
#    2. Empaqueta el working tree del backend (no lo commiteado: el código
#       migrado al esquema nuevo vive sin commitear).
#    3. Sube los paquetes por scp a un directorio temporal del servidor.
#    4. Sincroniza con rsync del lado del servidor, borrando archivos que ya
#       no existen, pero SIN tocar .env ni node_modules.
#    5. Reinstala dependencias solo si cambió package-lock.json.
#    6. Reinicia el servicio y verifica /health.  Si no responde, ROLLBACK.
#
#  Requisitos en local: node/npm, tar, ssh, scp (todo ya presente en Git Bash).
#  Requisitos en el servidor: ninguno nuevo (usa node, npm, tar, rsync).
# =============================================================================
set -euo pipefail

# Git Bash convierte rutas tipo /var/www en C:/Program Files/Git/var/www.
# Con esto las deja en paz al pasarlas por ssh/scp.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

# --- Configuración (se puede sobreescribir por variables de entorno) ---------
SSH_HOST="${SSH_HOST:-root@72.60.112.92}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/hostinger_vps}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/tienda-hilos}"
SERVICE="${SERVICE:-tienda-hilos-api}"
BASE_URL="${BASE_URL:-https://devtristan.cloud}"

TARGET="${1:-all}"

# --- Utilidades -------------------------------------------------------------
rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
azul()  { printf '\033[36m%s\033[0m\n' "$*"; }
paso()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
morir() { rojo "✗ $*"; exit 1; }

ssh_run() { ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=15 "$SSH_HOST" "$@"; }

case "$TARGET" in
  all|frontend|backend) ;;
  *) morir "Objetivo inválido: '$TARGET'. Usa: all | frontend | backend" ;;
esac

# Raíz del repo, sin importar desde dónde se invoque el script.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[ -d frontend ] && [ -d backend ] || morir "No encuentro frontend/ y backend/ en $ROOT"
[ -f "$SSH_KEY" ] || morir "No existe la llave SSH: $SSH_KEY"

STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

azul "Despliegue $STAMP → $SSH_HOST  (objetivo: $TARGET)"

# --- 0. Conectividad --------------------------------------------------------
paso "Comprobando acceso SSH"
ssh_run "echo ok >/dev/null" || morir "No hay acceso SSH con $SSH_KEY"
ssh_run "test -d '$REMOTE_DIR'" || morir "No existe $REMOTE_DIR en el servidor"
verde "  SSH OK"

# --- 1. Compilar y empaquetar Angular --------------------------------------
if [ "$TARGET" = all ] || [ "$TARGET" = frontend ]; then
  paso "Compilando Angular (producción)"
  [ -d frontend/node_modules ] || morir "Falta frontend/node_modules. Corre: npm --prefix frontend install"
  # --configuration production explícito: no dependemos de defaultConfiguration
  # del angular.json. Esto usa environment.ts (apiUrl '/api/v1', relativo).
  ( cd frontend && npx ng build --configuration production )

  DIST="frontend/dist/frontend/browser"
  [ -f "$DIST/index.html" ] || morir "El build no dejó index.html en $DIST"
  MAPS=$(find "$DIST" -name '*.map' | wc -l | tr -d ' ')
  [ "$MAPS" = "0" ] || rojo "  Aviso: el build trae $MAPS source maps (exponen el código fuente)"

  tar czf "$TMP/frontend.tar.gz" -C "$DIST" .
  verde "  Empaquetado: $(du -h "$TMP/frontend.tar.gz" | cut -f1) · $(find "$DIST" -type f | wc -l | tr -d ' ') archivos"
fi

# --- 2. Empaquetar backend (working tree) ----------------------------------
if [ "$TARGET" = all ] || [ "$TARGET" = backend ]; then
  paso "Empaquetando backend"
  # Se excluye .env a propósito: el del servidor tiene las credenciales reales
  # y NO debe sobreescribirse desde local.
  tar czf "$TMP/backend.tar.gz" -C backend \
      --exclude=node_modules --exclude=.env --exclude=.git --exclude='*.log' .
  verde "  Empaquetado: $(du -h "$TMP/backend.tar.gz" | cut -f1)"

  # Aviso útil: si hay cambios sin commitear, se despliegan (es lo que queremos),
  # pero conviene saberlo.
  if command -v git >/dev/null && git rev-parse --git-dir >/dev/null 2>&1; then
    SUCIOS=$(git status --porcelain backend | wc -l | tr -d ' ')
    [ "$SUCIOS" = "0" ] || azul "  Nota: se despliegan $SUCIOS archivo(s) del backend sin commitear"
  fi
fi

# --- 3. Subir ---------------------------------------------------------------
paso "Subiendo al servidor"
REMOTE_TMP="/opt/deploy/$STAMP"
ssh_run "mkdir -p '$REMOTE_TMP'"
for f in "$TMP"/*.tar.gz; do
  [ -e "$f" ] || continue
  scp -q -i "$SSH_KEY" -o BatchMode=yes "$f" "$SSH_HOST:$REMOTE_TMP/"
  verde "  ↑ $(basename "$f")"
done

# --- 4. Aplicar en el servidor ---------------------------------------------
paso "Aplicando cambios en el servidor"
# HEALTH_PORT existe para poder ENSAYAR el rollback: apuntándolo a un puerto
# muerto (HEALTH_PORT=9999) el health check falla a propósito y se ve si la
# restauración funciona, sin desplegar código roto de verdad.
ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" \
    REMOTE_TMP="$REMOTE_TMP" REMOTE_DIR="$REMOTE_DIR" SERVICE="$SERVICE" TARGET="$TARGET" \
    HEALTH_PORT="${HEALTH_PORT:-3000}" \
    'bash -s' <<'REMOTO'
set -euo pipefail
cd "$REMOTE_TMP"

# ---------- Frontend ----------
if [ -f frontend.tar.gz ]; then
  echo "  · frontend: extrayendo"
  # --warning=no-timestamp: el reloj del equipo local suele ir unos segundos
  # adelantado y tar llena la salida de avisos inofensivos.
  rm -rf fe && mkdir fe && tar xzf frontend.tar.gz -C fe --warning=no-timestamp
  [ -f fe/index.html ] || { echo "  ✗ el paquete no trae index.html"; exit 1; }

  # Respaldo con hardlinks: instantáneo y casi sin disco.
  rm -rf "$REMOTE_DIR/frontend.prev"
  cp -al "$REMOTE_DIR/frontend" "$REMOTE_DIR/frontend.prev" 2>/dev/null || true

  # --delete quita los chunks con hash del build anterior.
  rsync -a --delete fe/ "$REMOTE_DIR/frontend/"
  find "$REMOTE_DIR/frontend" -type d -exec chmod 755 {} +
  find "$REMOTE_DIR/frontend" -type f -exec chmod 644 {} +
  echo "  · frontend: $(find "$REMOTE_DIR/frontend" -type f | wc -l) archivos publicados"
fi

# ---------- Backend ----------
if [ -f backend.tar.gz ]; then
  echo "  · backend: extrayendo"
  rm -rf be && mkdir be && tar xzf backend.tar.gz -C be --warning=no-timestamp
  [ -f be/package.json ] || { echo "  ✗ el paquete no trae package.json"; exit 1; }

  rm -rf "$REMOTE_DIR/backend.prev"
  cp -al "$REMOTE_DIR/backend" "$REMOTE_DIR/backend.prev" 2>/dev/null || true

  LOCK_ANTES=""
  [ -f "$REMOTE_DIR/backend/package-lock.json" ] && \
    LOCK_ANTES=$(md5sum < "$REMOTE_DIR/backend/package-lock.json")

  # .env y node_modules se quedan como están; el resto se espeja tal cual.
  rsync -a --delete --exclude='.env' --exclude='node_modules/' \
        be/ "$REMOTE_DIR/backend/"

  LOCK_AHORA=$(md5sum < "$REMOTE_DIR/backend/package-lock.json")
  if [ "$LOCK_ANTES" != "$LOCK_AHORA" ] || [ ! -d "$REMOTE_DIR/backend/node_modules" ]; then
    echo "  · backend: package-lock cambió → npm ci"
    ( cd "$REMOTE_DIR/backend" && npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 )
  else
    echo "  · backend: dependencias sin cambios, se omite npm ci"
  fi

  [ -f "$REMOTE_DIR/backend/.env" ] || echo "  ⚠ OJO: no hay .env en el servidor"

  echo "  · backend: reiniciando $SERVICE"
  systemctl restart "$SERVICE"

  # Espera activa a que /health responda (hasta 30 s).
  OK=no
  for i in $(seq 1 15); do
    sleep 2
    if curl -fsS --max-time 3 "http://127.0.0.1:${HEALTH_PORT}/health" >/dev/null 2>&1; then OK=si; break; fi
  done

  if [ "$OK" != si ]; then
    echo "  ✗ /health no respondió. Haciendo ROLLBACK…"
    rsync -a --delete --exclude='.env' --exclude='node_modules/' \
          "$REMOTE_DIR/backend.prev/" "$REMOTE_DIR/backend/"
    systemctl restart "$SERVICE"
    sleep 5
    curl -fsS --max-time 3 http://127.0.0.1:3000/health >/dev/null 2>&1 \
      && echo "  ↺ rollback OK: la versión anterior está corriendo" \
      || echo "  ✗✗ rollback tampoco levanta. Revisa: journalctl -u $SERVICE -n 50"
    echo "  --- últimas líneas del log ---"
    journalctl -u "$SERVICE" -n 15 --no-pager | tail -15
    exit 1
  fi
  echo "  · backend: arriba"
fi

# Conserva solo los 5 paquetes de despliegue más recientes.
ls -1dt /opt/deploy/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf
REMOTO

# --- 5. Verificación desde internet ---------------------------------------
paso "Verificando desde internet"
# Nada de -o /dev/null: con MSYS_NO_PATHCONV=1 Git Bash deja la ruta literal y
# el curl de Windows no puede escribir ahí, sale con error y ensucia el código.
code() { curl -s -o "$TMP/resp" -w '%{http_code}' --max-time 15 "$1" 2>/dev/null || true; }

H=$(code "$BASE_URL/health")
[ "$H" = 200 ] && verde "  /health → 200" || rojo "  /health → $H"

I=$(code "$BASE_URL/")
[ "$I" = 200 ] && verde "  /       → 200 (SPA)" || rojo "  /       → $I"

# Prueba de humo que SÍ toca la base de datos.
P=$(code "$BASE_URL/api/v1/productos")
if [ "$P" = 200 ]; then
  verde "  /api/v1/productos → 200 (base de datos OK)"
else
  rojo  "  /api/v1/productos → $P"
  rojo  "  El proceso vive pero la consulta falla (suele ser desajuste código/esquema)."
  rojo  "  Revisa:  ssh -i $SSH_KEY $SSH_HOST 'journalctl -u $SERVICE -n 40 --no-pager'"
fi

echo
if [ "$H" = 200 ] && [ "$I" = 200 ] && [ "$P" = 200 ]; then
  verde "✓ Despliegue $STAMP completado y verificado"
else
  rojo "⚠ Despliegue $STAMP aplicado, pero hay verificaciones en rojo (ver arriba)"
  exit 1
fi
