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

# Fetch the latest version. package-lock.json can be rewritten by a local
# npm install: restore it so it never blocks the update.
UPDATED=0
if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  echo "• Mise à jour du code…"
  # Tools (npm, Next) rewrite some tracked files on their own: put them aside so the
  # update is never blocked. Nothing is lost: `git stash list` keeps them.
  git checkout -- package-lock.json tsconfig.json next-env.d.ts 2>/dev/null
  if ! git diff --quiet 2>/dev/null; then
    git stash push --quiet -m "nikka-launcher $(date +%F-%H%M)" && echo "  (modifications locales mises de côté : git stash list)"
  fi
  BEFORE="$(git rev-parse HEAD 2>/dev/null)"
  if git pull --ff-only --quiet; then
    [ "$BEFORE" != "$(git rev-parse HEAD)" ] && UPDATED=1 && echo "  ✓ nouvelle version récupérée"
  else
    echo ""
    echo "  ✗ MISE À JOUR IMPOSSIBLE (connexion ? accès GitHub ?). NIKKA démarre sur l'ancienne version."
    echo "    Détails : cd ~/NIKKA && git status && git pull"
    echo ""
  fi
  echo "  Version : $(git log -1 --format='%h · %cd' --date=format:'%d/%m %H:%M')"
fi

# Emblem as the Desktop shortcut's icon (silently skipped if it fails).
if [ -e "$HOME/Desktop/NIKKA.command" ] && [ -f public/nikka-icon.png ]; then
  osascript -l JavaScript -e "ObjC.import('AppKit'); \$.NSWorkspace.sharedWorkspace.setIconForFileOptions(\$.NSImage.alloc.initWithContentsOfFile('$PWD/public/nikka-icon.png'), '$HOME/Desktop/NIKKA.command', 0)" >/dev/null 2>&1 || true
fi

# Already running?
if curl -s -o /dev/null "$URL"; then
  if [ "$UPDATED" = 0 ]; then
    echo "NIKKA tourne déjà : ouverture de $URL"
    open "$URL/storyboard"
    exit 0
  fi
  # New version: the running server must restart (database migrations, new code).
  echo "• Redémarrage de NIKKA pour appliquer la mise à jour…"
  for pid in $(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null); do
    parent="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
    if [ -n "$parent" ] && ps -o command= -p "$parent" 2>/dev/null | grep -q "next"; then kill "$parent" 2>/dev/null; fi
    kill "$pid" 2>/dev/null
  done
  for _ in $(seq 1 15); do curl -s -o /dev/null -m 2 "$URL" || break; sleep 1; done
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
