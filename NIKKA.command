#!/bin/bash
# NIKKA — double-click launcher (macOS).
# Updates the code, installs dependencies when needed, starts the app in
# mock mode (nothing is billed) and opens it in the browser.
# Close this Terminal window (or press Ctrl+C) to stop NIKKA.
#
# Everything runs inside main(): bash reads it fully before executing, so the
# `git pull` below can safely update this very file.

main() {
cd "$(dirname "$0")" || exit 1

PORT=3000
URL="http://localhost:$PORT"

# Finder-launched shells may miss Homebrew / nvm paths.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi

echo "▶ NIKKA"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js est introuvable. Installe-le depuis https://nodejs.org (version LTS), puis relance."
  read -r -p "Appuie sur Entrée pour fermer…"
  exit 1
fi

# Already running? Just open the browser.
if curl -s -o /dev/null "$URL"; then
  echo "NIKKA tourne déjà : ouverture de $URL"
  open "$URL"
  exit 0
fi

# Fetch the latest version (skipped if offline or local changes block it).
if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  echo "• Mise à jour du code…"
  git pull --ff-only --quiet || echo "  (mise à jour ignorée)"
fi

# Install dependencies only when package-lock.json changed.
LOCK_HASH="$(shasum package-lock.json | cut -d' ' -f1)"
if [ ! -d node_modules ] || [ "$(cat node_modules/.nikka-lock 2>/dev/null)" != "$LOCK_HASH" ]; then
  echo "• Installation des dépendances (une minute la première fois)…"
  npm install --no-audit --no-fund || { read -r -p "✗ npm install a échoué. Entrée pour fermer…"; exit 1; }
  echo "$LOCK_HASH" > node_modules/.nikka-lock
fi

# Mock mode by default: no Atlas call, nothing billed.
# To go live, put NIKKA_MOCK_ATLAS=0 in .env.local (that file then decides).
if grep -q '^NIKKA_MOCK_ATLAS=' .env.local 2>/dev/null; then
  MOCK="$(grep '^NIKKA_MOCK_ATLAS=' .env.local | tail -1 | cut -d= -f2)"
else
  export NIKKA_MOCK_ATLAS=1
  MOCK=1
fi
echo "• Démarrage (mode mock : $([ "$MOCK" = 1 ] && echo "oui, rien n'est facturé" || echo "NON, les générations sont facturées"))…"

LOG="$(mktemp "${TMPDIR:-/tmp}/nikka.XXXXXX")"
node node_modules/next/dist/bin/next dev -p "$PORT" 2>&1 | tee "$LOG" &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT INT TERM HUP

for _ in $(seq 1 60); do
  # Next refuses a second dev server for the same folder: open the existing one.
  if grep -q "Another next dev server is already running" "$LOG"; then
    EXISTING="$(grep -Eo 'http://localhost:[0-9]+' "$LOG" | tail -1)"
    echo "NIKKA tourne déjà : ouverture de $EXISTING"
    open "${EXISTING:-$URL}/storyboard"
    return 0
  fi
  if curl -s -o /dev/null "$URL"; then
    open "$URL/storyboard"
    echo ""
    echo "✓ NIKKA est ouvert dans ton navigateur : $URL"
    echo "  Ferme cette fenêtre pour arrêter NIKKA."
    break
  fi
  sleep 1
done

wait $SERVER_PID
}

main "$@"
exit
