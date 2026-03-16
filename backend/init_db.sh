#!/bin/bash
# Initialize the database schema and import the mind map seed data
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
python3 "$SCRIPT_DIR/db.py" init
python3 "$SCRIPT_DIR/import_mindmap.py"
