#!/usr/bin/env python3
"""
SQLite database module for SafetyMindMap events and mind map nodes.

Usage as module:
    import db
    conn = db.get_connection()
    db.init_schema(conn)
    db.upsert_events(conn, records)

Usage as CLI:
    python3 db.py init                              # Create/reset schema
    python3 db.py clear                             # Delete all event data
    python3 db.py reset-all                         # Clear everything (events + nodes)
    python3 db.py query-type Conference             # Query events by type
    python3 db.py dump                              # Dump all events as JSON
    python3 db.py tree                              # Dump full mind map tree as JSON
    python3 db.py tree --id <node-id>               # Dump subtree rooted at node
"""

import json
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent / "events.db"


def get_connection(db_path=None):
    """Return a connection with WAL mode and foreign keys enabled."""
    path = db_path or DB_PATH
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_schema(conn):
    """Create tables if they don't exist."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            link_label TEXT,
            link_url TEXT,
            start_date TEXT,
            end_date TEXT,
            description TEXT,
            applications_close TEXT,
            scraped_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS event_types (
            event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            type_value TEXT NOT NULL,
            PRIMARY KEY (event_id, type_value)
        );

        CREATE TABLE IF NOT EXISTS event_locations (
            event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            location_value TEXT NOT NULL,
            PRIMARY KEY (event_id, location_value)
        );

        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
            sort_order INTEGER DEFAULT 0,
            title TEXT NOT NULL,
            subtitle TEXT,
            description TEXT,
            url TEXT,
            icon TEXT,
            color TEXT,
            default_expanded BOOLEAN DEFAULT 0,
            subtree_source TEXT,
            subtree_filter TEXT,
            subtree_group_by TEXT
        );

        CREATE TABLE IF NOT EXISTS node_links (
            from_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            to_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            relation TEXT DEFAULT 'related',
            PRIMARY KEY (from_id, to_id)
        );
    """)
    conn.commit()


def upsert_events(conn, records):
    """Insert or replace events from parsed Airtable records."""
    for rec in records:
        event_id = rec.get("_id", "")
        if not event_id:
            continue

        # Flatten Link object
        link = rec.get("Link") or {}
        link_label = link.get("label") if isinstance(link, dict) else None
        link_url = link.get("url") if isinstance(link, dict) else None

        conn.execute(
            """INSERT OR REPLACE INTO events
               (id, name, link_label, link_url, start_date, end_date,
                description, applications_close, scraped_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
            (
                event_id,
                rec.get("Name", ""),
                link_label,
                link_url,
                rec.get("Start date"),
                rec.get("End date"),
                rec.get("Description"),
                rec.get("Applications/registrations close"),
            ),
        )

        # Replace junction rows
        conn.execute("DELETE FROM event_types WHERE event_id = ?", (event_id,))
        for t in (rec.get("Type") or []):
            conn.execute(
                "INSERT INTO event_types (event_id, type_value) VALUES (?, ?)",
                (event_id, t),
            )

        conn.execute("DELETE FROM event_locations WHERE event_id = ?", (event_id,))
        for loc in (rec.get("Location") or []):
            conn.execute(
                "INSERT INTO event_locations (event_id, location_value) VALUES (?, ?)",
                (event_id, loc),
            )

    conn.commit()
    print(f"  Upserted {len(records)} events into SQLite")


def clear_all(conn):
    """Delete all data from event tables."""
    conn.execute("DELETE FROM event_types")
    conn.execute("DELETE FROM event_locations")
    conn.execute("DELETE FROM events")
    conn.commit()
    print("Cleared all data from events database.")


def clear_nodes(conn):
    """Delete all nodes and node_links."""
    conn.execute("DELETE FROM node_links")
    conn.execute("DELETE FROM nodes")
    conn.commit()
    print("Cleared all nodes from database.")


def reset_all(conn):
    """Clear everything — events and nodes."""
    clear_all(conn)
    clear_nodes(conn)


def query_by_type(conn, type_value):
    """Query events matching a given type, return as list of dicts."""
    rows = conn.execute(
        """SELECT e.name, e.start_date, e.end_date,
                  e.applications_close, e.link_url
           FROM events e
           JOIN event_types t ON e.id = t.event_id
           WHERE t.type_value = ?
           ORDER BY e.start_date""",
        (type_value,),
    ).fetchall()
    return [dict(r) for r in rows]


def dump_all(conn):
    """Dump all events with their types and locations."""
    rows = conn.execute("SELECT * FROM events ORDER BY start_date").fetchall()
    results = []
    for r in rows:
        event = dict(r)
        types = conn.execute(
            "SELECT type_value FROM event_types WHERE event_id = ?", (r["id"],)
        ).fetchall()
        locations = conn.execute(
            "SELECT location_value FROM event_locations WHERE event_id = ?", (r["id"],)
        ).fetchall()
        event["types"] = [t["type_value"] for t in types]
        event["locations"] = [l["location_value"] for l in locations]
        results.append(event)
    return results


def get_subtree_events(conn, filter_json, group_by):
    """Query events table, group by month, return tree-shaped children list."""
    filter_dict = json.loads(filter_json) if isinstance(filter_json, str) else filter_json
    type_value = filter_dict.get("type")
    if not type_value:
        return []

    rows = conn.execute(
        """SELECT e.id, e.name, e.start_date, e.end_date,
                  e.link_url, e.description
           FROM events e
           JOIN event_types t ON e.id = t.event_id
           WHERE t.type_value = ?
           ORDER BY e.start_date""",
        (type_value,),
    ).fetchall()

    # Group by month (YYYY-MM)
    months = {}
    for r in rows:
        date = r["start_date"] or "Unknown"
        month_key = date[:7] if len(date) >= 7 else date
        months.setdefault(month_key, [])
        months[month_key].append({
            "title": r["name"],
            "url": r["link_url"],
            "description": r["description"],
        })

    children = []
    for month_key in sorted(months.keys()):
        children.append({
            "title": month_key,
            "children": months[month_key],
        })
    return children


def get_tree(conn, root_id=None):
    """Return nested dict of the mind map tree.

    If root_id is given, return the subtree rooted at that node.
    Auto-generates children for nodes with subtree_source set.
    """
    if root_id:
        root_row = conn.execute("SELECT * FROM nodes WHERE id = ?", (root_id,)).fetchone()
        if not root_row:
            return None
    else:
        root_row = conn.execute(
            "SELECT * FROM nodes WHERE parent_id IS NULL ORDER BY sort_order LIMIT 1"
        ).fetchone()
        if not root_row:
            return None

    def build_node(row):
        node = {
            "id": row["id"],
            "title": row["title"],
        }
        for field in ("subtitle", "description", "url", "icon", "color"):
            if row[field]:
                node[field] = row[field]
        if row["default_expanded"]:
            node["default_expanded"] = True

        # Auto-generated subtree from events
        if row["subtree_source"] == "events" and row["subtree_filter"]:
            node["children"] = get_subtree_events(
                conn, row["subtree_filter"], row["subtree_group_by"]
            )
        else:
            child_rows = conn.execute(
                "SELECT * FROM nodes WHERE parent_id = ? ORDER BY sort_order",
                (row["id"],),
            ).fetchall()
            if child_rows:
                node["children"] = [build_node(c) for c in child_rows]

        return node

    return build_node(root_row)


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 db.py init|clear|reset-all|query-type <type>|dump|tree [--id <node-id>]")
        sys.exit(1)

    cmd = sys.argv[1]
    conn = get_connection()

    if cmd == "init":
        init_schema(conn)
        print(f"Database initialized at {DB_PATH}")
    elif cmd == "clear":
        clear_all(conn)
    elif cmd == "reset-all":
        init_schema(conn)
        reset_all(conn)
    elif cmd == "query-type":
        if len(sys.argv) < 3:
            print("Usage: python3 db.py query-type <type>")
            sys.exit(1)
        init_schema(conn)
        results = query_by_type(conn, sys.argv[2])
        print(json.dumps(results, indent=2, default=str))
    elif cmd == "dump":
        init_schema(conn)
        results = dump_all(conn)
        print(json.dumps(results, indent=2, default=str))
    elif cmd == "tree":
        init_schema(conn)
        root_id = None
        if "--id" in sys.argv:
            idx = sys.argv.index("--id")
            if idx + 1 < len(sys.argv):
                root_id = sys.argv[idx + 1]
        tree = get_tree(conn, root_id)
        if tree:
            print(json.dumps(tree, indent=2, default=str))
        else:
            print("No nodes found.")
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)

    conn.close()


if __name__ == "__main__":
    main()
