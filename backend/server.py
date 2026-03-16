#!/usr/bin/env python3
"""Flask API server for SafetyMindMap."""

import json

from flask import Flask, jsonify

import db

app = Flask(__name__)


@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.route("/api/tree")
def tree():
    conn = db.get_connection()
    try:
        db.init_schema(conn)
        tree = db.get_tree(conn)
        if tree is None:
            return jsonify({"error": "No nodes found"}), 404
        return jsonify(tree)
    finally:
        conn.close()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=True)
