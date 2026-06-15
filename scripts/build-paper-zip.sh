#!/usr/bin/env bash
set -euo pipefail

ZIP_NAME="ontosphere-iswc2026-paper.zip"
PAPER_DIR="dist/paper"
TMPDIR=""

cleanup() {
  if [ -n "$TMPDIR" ]; then
    rm -rf "$TMPDIR"
  fi
}
trap cleanup EXIT

# --- Build -----------------------------------------------------------
echo "Building project..."
npm run build --silent

if [ ! -f "$PAPER_DIR/index.html" ]; then
  echo "ERROR: $PAPER_DIR/index.html not found after build." >&2
  exit 1
fi

# --- Verify no external resource loads -------------------------------
# Check <link> tags (ignore canonical/meta), <script src=>, and <img src=>
# that reference external URLs (http/https).
EXTERNAL=$(grep -oP '<(link|script|img)\b[^>]*(src|href)="https?://[^"]*"' \
  "$PAPER_DIR/index.html" \
  | grep -v 'rel="canonical"' \
  || true)

if [ -n "$EXTERNAL" ]; then
  echo ""
  echo "WARNING: External resource references found:"
  echo "$EXTERNAL"
  echo ""
  echo "The ZIP should be self-contained. Consider embedding these resources."
  echo "Proceeding anyway..."
  echo ""
fi

# --- Package ---------------------------------------------------------
TMPDIR=$(mktemp -d)
cp -r "$PAPER_DIR/." "$TMPDIR/"

# Remove .gitkeep files (not needed in submission)
find "$TMPDIR" -name '.gitkeep' -delete

# Create ZIP from temp directory
rm -f "$ZIP_NAME"
(cd "$TMPDIR" && zip -r - .) > "$ZIP_NAME"

# --- Report ----------------------------------------------------------
SIZE=$(du -h "$ZIP_NAME" | cut -f1)
echo ""
echo "Created $ZIP_NAME ($SIZE)"
echo ""
echo "Contents:"
unzip -l "$ZIP_NAME"
echo ""
echo "Before submitting:"
echo "  1. Unzip and open index.html in a browser from the filesystem"
echo "  2. Verify it renders correctly (fonts, layout, links)"
echo "  3. Print to PDF and check page breaks"
