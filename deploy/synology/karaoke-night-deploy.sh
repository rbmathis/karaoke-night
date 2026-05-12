#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/volume1/docker/karaoke-night}"
APP_NAME="karaoke-night"
COMPOSE_FILE="docker-compose.yml"

usage() {
  cat <<EOF
Usage: $0 <deploy|restart|status|logs|stop|down|check>

Commands:
  deploy   Build and start the app with Docker Compose
  restart  Restart the running container
  status   Show Compose service status
  logs     Tail recent container logs
  stop     Stop the service without removing it
  down     Stop and remove the service
  check    Validate the Compose configuration

Environment:
  APP_DIR  Override the fixed deployment path (must stay under /volume1/docker or /volume1/containers)
EOF
}

ensure_safe_app_dir() {
  case "$APP_DIR" in
    /volume1/docker/*) ;;
    /volume1/containers/*) ;;
    *)
      echo "APP_DIR must stay under /volume1/docker or /volume1/containers" >&2
      exit 1
      ;;
  esac

  if [ ! -d "$APP_DIR" ]; then
    echo "App directory does not exist: $APP_DIR" >&2
    exit 1
  fi

  if [ ! -f "$APP_DIR/$COMPOSE_FILE" ]; then
    echo "$COMPOSE_FILE not found in $APP_DIR" >&2
    exit 1
  fi
}

run_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$COMPOSE_FILE" "$@"
    return
  fi

  echo "Neither 'docker compose' nor 'docker-compose' is available." >&2
  exit 1
}

action="${1:-}"

if [ -z "$action" ]; then
  usage
  exit 1
fi

ensure_safe_app_dir
cd "$APP_DIR"

mkdir -p data

case "$action" in
  deploy)
    echo "Deploying $APP_NAME from $APP_DIR"
    run_compose up --build -d
    ;;
  restart)
    echo "Restarting $APP_NAME"
    run_compose restart
    ;;
  status)
    run_compose ps
    ;;
  logs)
    run_compose logs --tail 200 -f
    ;;
  stop)
    run_compose stop
    ;;
  down)
    run_compose down
    ;;
  check)
    run_compose config >/dev/null
    echo "Compose configuration is valid."
    ;;
  *)
    usage
    exit 1
    ;;
esac
