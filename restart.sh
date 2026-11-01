#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "Hata: npm bulunamadı." >&2
  exit 1
fi

if ! command -v ps >/dev/null 2>&1; then
  echo "Hata: çalışan Vite sürecini bulmak için ps komutu gerekli." >&2
  exit 1
fi

mapfile -t RUNNING_PIDS < <(
  ps -eo pid=,args= |
    awk -v project="$PROJECT_DIR" -v script_pid="$$" \
      'index($0, project) && index($0, "vite") && $1 != script_pid && $0 !~ /awk/ { print $1 }' |
    sort -u
)

if ((${#RUNNING_PIDS[@]})); then
  echo "Bu projeye ait çalışan Vite süreci durduruluyor..."
  for pid in "${RUNNING_PIDS[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done

  for _ in {1..10}; do
    still_running=()
    for pid in "${RUNNING_PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        still_running+=("$pid")
      fi
    done
    ((${#still_running[@]} == 0)) && break
    sleep 1
  done

  for pid in "${RUNNING_PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null &&
      ps -p "$pid" -o args= | grep -F -- "$PROJECT_DIR" | grep -F 'vite' >/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
fi

echo "Uygulama derleniyor..."
npm run build

LOG_FILE="$PROJECT_DIR/dev.log"
nohup npm run dev -- --host 127.0.0.1 --strictPort >"$LOG_FILE" 2>&1 </dev/null &
SERVER_PID=$!

for _ in {1..30}; do
  if curl --silent --fail http://127.0.0.1:5173/ >/dev/null; then
    echo "Uygulama yeniden başlatıldı: http://127.0.0.1:5173/"
    echo "Geliştirme sunucusu PID: $SERVER_PID"
    echo "Log dosyası: $LOG_FILE"
    exit 0
  fi

  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Hata: geliştirme sunucusu başlatılamadı. Log:" >&2
    cat "$LOG_FILE" >&2
    exit 1
  fi

  sleep 1
done

echo "Hata: sunucu 30 saniye içinde hazır olmadı. Log:" >&2
cat "$LOG_FILE" >&2
kill "$SERVER_PID" 2>/dev/null || true
exit 1
