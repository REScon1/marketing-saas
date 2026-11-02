#!/usr/bin/env bash
# Spustí lokální jednorázový Postgres cluster pro testy (port 54329, trust auth, jen localhost).
# Použití: apps/api/scripts/test-db.sh [start|stop|status]
# Výstup: řádek TEST_DATABASE_URL=..., který lze exportovat.
set -euo pipefail

PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PORT="${PG_PORT:-54329}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${PG_DIR:-$HERE/.pg}"
DATA="$DIR/data"
LOG="$DIR/postgres.log"
CMD="${1:-start}"

# initdb/postgres nesmí běžet jako root -> pod rootem použijeme uživatele postgres.
run() {
  if [ "$(id -u)" = "0" ]; then
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}

mkdir -p "$DIR"
if [ "$(id -u)" = "0" ]; then chown postgres: "$DIR"; fi

case "$CMD" in
  start)
    if [ ! -f "$DATA/PG_VERSION" ]; then
      run "$PG_BIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
    fi
    if ! run "$PG_BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      run "$PG_BIN/pg_ctl" -D "$DATA" -l "$LOG" -w \
        -o "-p $PORT -k /tmp -c listen_addresses=localhost -c fsync=off -c synchronous_commit=off -c full_page_writes=off" start >/dev/null
    fi
    # Databáze pro vývoj (seed/server) a pro testy.
    for db in marketing_saas marketing_saas_test; do
      if ! run "$PG_BIN/psql" -h /tmp -p "$PORT" -U postgres -tAc "select 1 from pg_database where datname='$db'" postgres | grep -q 1; then
        run "$PG_BIN/createdb" -h /tmp -p "$PORT" -U postgres "$db"
      fi
    done
    echo "DATABASE_URL=postgres://postgres@localhost:$PORT/marketing_saas"
    echo "TEST_DATABASE_URL=postgres://postgres@localhost:$PORT/marketing_saas_test"
    ;;
  stop)
    run "$PG_BIN/pg_ctl" -D "$DATA" -m fast stop
    ;;
  status)
    run "$PG_BIN/pg_ctl" -D "$DATA" status
    ;;
  *)
    echo "neznámý příkaz: $CMD" >&2; exit 2;;
esac
