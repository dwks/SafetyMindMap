#!/usr/bin/env python3
"""
Import the hand-curated mind map from mindmap.yaml into the nodes table.

Usage:
    python3 import_mindmap.py              # Import from default mindmap.yaml
    python3 import_mindmap.py path/to.yaml # Import from a specific file
"""

import json
import re
import sys
from pathlib import Path

import yaml

import db


def slugify(text):
    """Convert text to a URL-friendly slug."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def walk_tree(node, parent_id=None, path_prefix="", sort_order=0):
    """Recursively walk the YAML tree, yielding (row_dict) for each node."""
    title = node["title"]
    slug = slugify(title)
    node_id = f"{path_prefix}/{slug}" if path_prefix else slug

    row = {
        "id": node_id,
        "parent_id": parent_id,
        "sort_order": sort_order,
        "title": title,
        "subtitle": node.get("subtitle"),
        "description": (node.get("description") or "").strip() or None,
        "url": node.get("url"),
        "icon": node.get("icon"),
        "color": node.get("color"),
        "default_expanded": 1 if node.get("default_expanded") else 0,
        "subtree_source": node.get("subtree"),
        "subtree_filter": json.dumps(node["filter"]) if node.get("filter") else None,
        "subtree_group_by": node.get("group_by"),
    }
    yield row

    for i, child in enumerate(node.get("children") or []):
        yield from walk_tree(child, parent_id=node_id, path_prefix=node_id, sort_order=i)


def import_mindmap(conn, yaml_path):
    """Parse YAML and write all nodes to the database."""
    with open(yaml_path) as f:
        tree = yaml.safe_load(f)

    # Full replace: delete existing nodes first
    db.clear_nodes(conn)

    rows = list(walk_tree(tree))

    for row in rows:
        conn.execute(
            """INSERT OR REPLACE INTO nodes
               (id, parent_id, sort_order, title, subtitle, description,
                url, icon, color, default_expanded,
                subtree_source, subtree_filter, subtree_group_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                row["id"], row["parent_id"], row["sort_order"],
                row["title"], row["subtitle"], row["description"],
                row["url"], row["icon"], row["color"], row["default_expanded"],
                row["subtree_source"], row["subtree_filter"], row["subtree_group_by"],
            ),
        )

    conn.commit()
    print(f"Imported {len(rows)} nodes from {yaml_path}")
    return len(rows)


def main():
    yaml_path = Path(__file__).parent / "mindmap.yaml"
    if len(sys.argv) > 1:
        yaml_path = Path(sys.argv[1])

    if not yaml_path.exists():
        print(f"Error: {yaml_path} not found")
        sys.exit(1)

    conn = db.get_connection()
    db.init_schema(conn)
    import_mindmap(conn, yaml_path)
    conn.close()


if __name__ == "__main__":
    main()
