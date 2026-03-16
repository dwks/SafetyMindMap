#!/usr/bin/env python3
"""
Extract data from AISafety.com's publicly embedded Airtable shared view.

Approach:
  1. Load the embed page with Playwright just long enough to capture the
     accessPolicy token from the intercepted readSharedViewData request.
  2. Replay that request with plain requests (no msgpack) to get clean JSON.

Usage:
    pip install requests playwright msgpack
    playwright install chromium
    python airtable_extract_v2.py
"""

import json
import re
import sys
import time
from urllib.parse import urlencode, urlparse, parse_qs, unquote

APP_ID = "appF8XfZUGXtfi40E"
SHARE_ID = "shrLgl03tMK4q6cyc"
EMBED_URL = f"https://airtable.com/embed/{APP_ID}/{SHARE_ID}?viewControls=on"
OUTPUT_FILE = "aisafety_events.json"


def extract_access_policy():
    """
    Use Playwright to load the embed page and capture the accessPolicy
    from the readSharedViewData XHR request. We only need the URL params,
    not the response body.
    """
    from playwright.sync_api import sync_playwright

    print("[Step 1] Capturing access policy from embed page...")
    captured = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()

        def on_request(request):
            if "readSharedViewData" in request.url:
                captured["url"] = request.url
                captured["headers"] = request.headers
                print(f"  Captured request URL ({len(request.url)} chars)")

        page.on("request", on_request)

        # Use domcontentloaded — networkidle hangs on Airtable's
        # persistent connections (SSE, websockets, long-polling)
        try:
            page.goto(EMBED_URL, wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            print(f"  Navigation warning: {e}")

        # Wait a bit for the XHR to fire
        deadline = time.time() + 20
        while "url" not in captured and time.time() < deadline:
            time.sleep(0.5)

        # Also grab cookies from the session
        captured["cookies"] = {
            c["name"]: c["value"] for c in context.cookies()
        }

        browser.close()

    if "url" not in captured:
        print("  ❌ Could not capture the readSharedViewData request.")
        return None

    # Parse the captured URL to extract components
    parsed = urlparse(captured["url"])
    params = parse_qs(parsed.query)

    # Extract the view ID from the URL path
    # Path looks like: /v0.3/view/viwXXXXX/readSharedViewData
    view_id = parsed.path.split("/")[3]

    access_policy = params.get("accessPolicy", [None])[0]
    if access_policy:
        policy_data = json.loads(unquote(access_policy))
        print(f"  View ID: {view_id}")
        print(f"  Share ID: {policy_data.get('shareId')}")
        print(f"  Expires: {policy_data.get('expires')}")
    else:
        print("  ⚠️  No accessPolicy found in URL")

    return {
        "view_id": view_id,
        "access_policy": access_policy,
        "headers": captured.get("headers", {}),
        "cookies": captured.get("cookies", {}),
        "full_url": captured["url"],
    }


def fetch_data_with_requests(policy_info):
    """
    Replay the readSharedViewData request using plain requests,
    explicitly asking for JSON (not msgpack).
    """
    import requests

    print("\n[Step 2] Fetching data via requests...")

    view_id = policy_info["view_id"]
    access_policy = policy_info["access_policy"]

    # Build the URL — request JSON format (no msgpack)
    base_url = f"https://airtable.com/v0.3/view/{view_id}/readSharedViewData"
    params = {
        "stringifiedObjectParams": json.dumps({"shouldUseNestedResponseFormat": True}),
        "accessPolicy": access_policy,
    }

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": EMBED_URL,
        "Origin": "https://airtable.com",
        "x-airtable-application-id": APP_ID,
        "x-requested-with": "XMLHttpRequest",
        "x-airtable-inter-service-client": "webClient",
        "x-time-zone": "Europe/London",
        "x-user-locale": "en",
    }

    # Use cookies from the Playwright session
    session = requests.Session()
    for name, value in policy_info.get("cookies", {}).items():
        session.cookies.set(name, value, domain=".airtable.com")

    resp = session.get(base_url, params=params, headers=headers, timeout=30)
    print(f"  Status: {resp.status_code}")
    print(f"  Content-Type: {resp.headers.get('content-type', 'unknown')}")
    print(f"  Content-Length: {len(resp.content)} bytes")

    if resp.status_code != 200:
        print(f"  Response: {resp.text[:500]}")
        return None

    # Check if response is msgpack despite us not asking for it
    content_type = resp.headers.get("content-type", "")
    if "msgpack" in content_type or resp.content[0:1] in (b"\x84", b"\x85", b"\x86"):
        print("  Response is msgpack, decoding...")
        try:
            import msgpack
            data = msgpack.unpackb(resp.content, raw=False)
            return data
        except ImportError:
            print("  ⚠️  msgpack not installed. Install with: pip install msgpack")
            print("  Trying to decode as raw bytes...")
            return None
    else:
        return resp.json()


def fetch_data_with_playwright_direct(policy_info):
    """
    Fallback: use Playwright to make the request and get the response body
    directly, handling both JSON and msgpack responses.
    """
    from playwright.sync_api import sync_playwright

    print("\n[Step 2b] Fetching data directly via Playwright...")

    view_id = policy_info["view_id"]
    access_policy = policy_info["access_policy"]

    # Build URL requesting JSON only (no msgpack)
    params = {
        "stringifiedObjectParams": json.dumps({"shouldUseNestedResponseFormat": True}),
        "accessPolicy": access_policy,
    }
    url = f"https://airtable.com/v0.3/view/{view_id}/readSharedViewData?{urlencode(params)}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()

        # Set cookies from earlier session
        cookie_list = []
        for name, value in policy_info.get("cookies", {}).items():
            cookie_list.append({
                "name": name,
                "value": value,
                "domain": ".airtable.com",
                "path": "/",
            })
        if cookie_list:
            context.add_cookies(cookie_list)

        page = context.new_page()

        # Use route to intercept and get the raw response
        response_data = {}

        def handle_route(route):
            resp = route.fetch()
            body = resp.body()
            response_data["status"] = resp.status
            response_data["headers"] = resp.headers
            response_data["body"] = body
            route.fulfill(response=resp)

        page.route(f"**/v0.3/view/{view_id}/readSharedViewData**", handle_route)

        # Navigate to the embed to set up the session, then fetch
        try:
            api_response = page.request.get(
                url,
                headers={
                    "Accept": "application/json",
                    "Referer": EMBED_URL,
                    "x-airtable-application-id": APP_ID,
                    "x-requested-with": "XMLHttpRequest",
                },
            )
            print(f"  Status: {api_response.status}")

            body = api_response.body()
            print(f"  Body size: {len(body)} bytes")

            # Try JSON first
            try:
                data = json.loads(body)
                browser.close()
                return data
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass

            # Try msgpack
            try:
                import msgpack
                data = msgpack.unpackb(body, raw=False)
                browser.close()
                return data
            except ImportError:
                print("  Install msgpack: pip install msgpack")
            except Exception as e:
                print(f"  msgpack decode failed: {e}")

        except Exception as e:
            print(f"  Request failed: {e}")

        browser.close()
    return None


def parse_airtable_data(raw):
    """
    Parse Airtable's readSharedViewData response into clean records.
    """
    if not isinstance(raw, dict):
        return raw

    print("\n[Step 3] Parsing Airtable response...")
    print(f"  Top-level keys: {list(raw.keys())}")

    # Navigate to table/view data
    data = raw.get("data", raw)
    if isinstance(data, dict):
        print(f"  data keys: {list(data.keys())}")

    # Find columns
    columns = []
    for path in [
        lambda: data["table"]["columns"],
        lambda: data["tableDatas"][0]["columns"],
        lambda: data["columns"],
    ]:
        try:
            columns = path()
            break
        except (KeyError, IndexError, TypeError):
            continue

    if not columns:
        print("  ⚠️  Could not find columns. Dumping raw structure...")
        print(f"  {json.dumps(raw, indent=2, default=str)[:2000]}")
        return raw

    col_map = {}
    col_types = {}
    for col in columns:
        cid = col.get("id", "")
        cname = col.get("name", cid)
        ctype = col.get("type", (col.get("typeOptions") or {}).get("type", "unknown"))
        col_map[cid] = cname
        col_types[cid] = ctype

    print(f"  Found {len(col_map)} columns:")
    for cid, cname in col_map.items():
        print(f"    {cname} ({col_types.get(cid, '?')})")

    # Find rows
    rows = None
    for path in [
        lambda: data["table"]["rows"],
        lambda: data["tableDatas"][0]["rows"],
        lambda: data["rows"],
    ]:
        try:
            rows = path()
            break
        except (KeyError, IndexError, TypeError):
            continue

    if not rows:
        print("  ⚠️  Could not find rows.")
        return raw

    # Convert to clean records
    records = []
    for row in rows:
        record = {"_id": row.get("id", "")}
        cells = row.get("cellValuesByColumnId", row.get("fields", {}))
        for col_id, value in cells.items():
            col_name = col_map.get(col_id, col_id)
            record[col_name] = value
        records.append(record)

    print(f"  Parsed {len(records)} records")

    return {
        "columns": [
            {"name": col_map[cid], "type": col_types.get(cid, "unknown"), "id": cid}
            for cid in col_map
        ],
        "records": records,
    }


def main():
    print("=" * 60)
    print("AISafety.com Events - Airtable Extractor v2")
    print("=" * 60)
    print(f"Embed: {EMBED_URL}\n")

    # Step 1: Get access policy
    policy = extract_access_policy()
    if not policy:
        print("\n❌ Failed to capture access policy. Try increasing the timeout.")
        sys.exit(1)

    # Step 2: Fetch data
    data = fetch_data_with_requests(policy)

    if not data:
        print("  requests approach failed, trying Playwright direct fetch...")
        data = fetch_data_with_playwright_direct(policy)

    if not data:
        print("\n❌ Could not fetch data.")
        print("  The access policy was captured — you can also try manually:")
        print(f"  curl '{policy['full_url']}' -H 'Accept: application/json'")
        sys.exit(1)

    # Step 3: Parse
    parsed = parse_airtable_data(data)

    # Save
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(parsed, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n✅ Saved to {OUTPUT_FILE}")

    # Preview
    if isinstance(parsed, dict) and "records" in parsed:
        print(f"\n{'=' * 60}")
        print(f"Preview — first 3 of {len(parsed['records'])} records:")
        print("=" * 60)
        for rec in parsed["records"][:3]:
            # Show just the key fields
            preview = {k: v for k, v in rec.items() if v and k != "_id"}
            # Truncate long values
            for k, v in preview.items():
                if isinstance(v, str) and len(v) > 100:
                    preview[k] = v[:100] + "..."
                elif isinstance(v, list) and len(v) > 3:
                    preview[k] = v[:3] + ["..."]
            print(f"\n  {json.dumps(preview, indent=4, default=str)}")


if __name__ == "__main__":
    main()
