#!/bin/bash
# Clear all data from the database (events + nodes)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
python3 "$SCRIPT_DIR/db.py" reset-all
