#!/bin/bash
# Initialize (or reset) the events database schema
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
python3 "$SCRIPT_DIR/db.py" init
