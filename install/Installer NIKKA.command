#!/bin/bash
# NIKKA — installer + launcher (macOS). Double-click it from anywhere.
# First run: downloads NIKKA into ~/NIKKA, puts a shortcut on the Desktop,
# then starts the app in mock mode (nothing is billed).
# Next runs: just updates and starts NIKKA.

main() {
REPO_URL="https://github.com/Post-code-arch/NIKKA.git"
BRANCH="claude/nikka-repository-a7d4mc"
DIR="$HOME/NIKKA"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi

fail() {
  echo ""
  echo "✗ $1"
  read -r -p "Appuie sur Entrée pour fermer…"
  exit 1
}

echo "▶ Installation de NIKKA"

# 1. Node.js
if ! command -v node >/dev/null 2>&1; then
  open "https://nodejs.org/fr/download" 2>/dev/null
  fail "Node.js n'est pas installé. La page de téléchargement vient de s'ouvrir : installe la version LTS, puis relance ce fichier."
fi
echo "• Node.js $(node -v) ✓"

# 2. Git (macOS proposes to install the developer tools if missing)
if ! git --version >/dev/null 2>&1; then
  xcode-select --install 2>/dev/null
  fail "Git n'est pas installé. Accepte l'installation des outils de développement qui vient de s'ouvrir, puis relance ce fichier."
fi

# 3. ffmpeg (needed for videos and the mock mode) — warn only
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "! ffmpeg est absent : les vidéos ne marcheront pas."
  if command -v brew >/dev/null 2>&1; then
    echo "• Installation de ffmpeg avec Homebrew…"
    brew install ffmpeg || echo "  (échec : installe-le plus tard avec « brew install ffmpeg »)"
  else
    echo "  Installe Homebrew (https://brew.sh) puis lance « brew install ffmpeg »."
  fi
fi

# 4. Code
if [ -d "$DIR/.git" ]; then
  echo "• NIKKA est déjà dans $DIR ✓"
elif [ -e "$DIR" ]; then
  fail "Le dossier $DIR existe mais ne contient pas NIKKA. Renomme-le, puis relance ce fichier."
else
  echo "• Téléchargement de NIKKA dans $DIR…"
  git clone --branch "$BRANCH" "$REPO_URL" "$DIR" \
    || git clone "$REPO_URL" "$DIR" \
    || fail "Téléchargement impossible. Vérifie ta connexion et ton accès GitHub au dépôt Post-code-arch/NIKKA."
fi

# 5. Local settings: mock mode by default, nothing is billed
if [ ! -f "$DIR/.env.local" ]; then
  printf '# Réglages locaux de NIKKA (jamais envoyés sur GitHub)\nNIKKA_MOCK_ATLAS=1\n# ATLASCLOUD_API_KEY=\n' > "$DIR/.env.local"
fi

# 6. Desktop shortcut
LAUNCHER="$DIR/NIKKA.command"
[ -f "$LAUNCHER" ] || (cd "$DIR" && git pull --ff-only --quiet)
[ -f "$LAUNCHER" ] || fail "Lanceur introuvable dans $DIR. Fais « cd ~/NIKKA && git pull » puis relance."
chmod +x "$LAUNCHER"
SHORTCUT="$HOME/Desktop/NIKKA.command"
if [ -d "$HOME/Desktop" ] && [ ! -e "$SHORTCUT" ]; then
  printf '#!/bin/bash\nexec "$HOME/NIKKA/NIKKA.command"\n' > "$SHORTCUT" && chmod +x "$SHORTCUT" \
    && echo "• Raccourci « NIKKA » ajouté sur le Bureau ✓"
fi

# 7. Start
echo "• Lancement…"
echo ""
exec "$LAUNCHER"
}

main "$@"
exit
