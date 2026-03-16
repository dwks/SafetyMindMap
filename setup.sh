#!/bin/bash
set -euo pipefail

# SafetyMindMap — one-command server setup
#
# Usage:
#   bash setup.sh              # Full setup: venv, deps, DB, Playwright, cron
#   bash setup.sh --no-cron    # Everything except cron job
#
# Prerequisites: Python 3.11+, pip, bash, cron (optional)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$SCRIPT_DIR/backend"
VENV="$SCRIPT_DIR/env"

NO_CRON=false
for arg in "$@"; do
  case "$arg" in
    --no-cron) NO_CRON=true ;;
  esac
done

echo "=== SafetyMindMap Setup ==="
echo "Project root: $SCRIPT_DIR"
echo ""

# 1. Create virtualenv if missing
if [ ! -d "$VENV" ]; then
  echo "[1/5] Creating Python virtual environment..."
  python3 -m venv "$VENV"
else
  echo "[1/5] Virtual environment already exists."
fi

# 2. Install Python dependencies
echo "[2/5] Installing Python dependencies..."
source "$VENV/bin/activate"
pip install --upgrade pip -q
pip install -r "$BACKEND/requirements.txt" -q
echo "  Installed: $(pip list --format=columns | grep -E 'playwright|pyyaml|requests' | tr '\n' ', ')"

# 3. Install Playwright browsers (needed for scraping)
echo "[3/5] Installing Playwright Chromium browser..."
playwright install chromium --with-deps 2>&1 | tail -3

# 4. Initialize database + import mind map
echo "[4/5] Initializing database and importing mind map..."
bash "$BACKEND/init_db.sh"

# 5. Run initial scrape
echo "[5/5] Running initial scrape of AISafety.com events..."
cd "$BACKEND"
python3 airtable2.py && echo "  Scrape complete." || echo "  Scrape failed (non-fatal). You can retry with: bash backend/cron_scrape.sh"
cd "$SCRIPT_DIR"

# 6. Optional: install cron job
if [ "$NO_CRON" = false ]; then
  echo ""
  echo "=== Cron Setup ==="
  CRON_CMD="0 6 * * * $BACKEND/cron_scrape.sh"
  if crontab -l 2>/dev/null | grep -qF "cron_scrape.sh"; then
    echo "  Cron job already exists, skipping."
  else
    echo "  Adding daily 6am scrape cron job..."
    (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
    echo "  Added: $CRON_CMD"
  fi
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Verify with:"
echo "  source env/bin/activate"
echo "  python3 backend/db.py tree           # Show mind map"
echo "  python3 backend/db.py dump           # Show scraped events"
echo ""
echo "Useful commands:"
echo "  bash backend/init_db.sh              # Re-init DB + re-import mind map"
echo "  bash backend/cron_scrape.sh          # Manual scrape"
echo "  bash backend/clear_db.sh             # Wipe all data"
echo "  python3 backend/import_mindmap.py    # Re-import mind map only"
