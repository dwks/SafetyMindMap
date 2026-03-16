#!/bin/bash
# Cron wrapper: activate venv and run the Airtable scraper
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
source "$PROJECT_ROOT/env/bin/activate"
cd "$SCRIPT_DIR"
python3 airtable2.py >> "$SCRIPT_DIR/scrape.log" 2>&1
