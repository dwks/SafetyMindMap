#!/bin/bash
# Clear all data from the events database (keeps schema)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
python3 "$SCRIPT_DIR/db.py" clear
