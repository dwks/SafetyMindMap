# SafetyMindMap

Interactive mind map of the AI Safety ecosystem — career paths, research areas, organizations, events, and funding.

## Quick Start

```bash
git clone <repo-url> safetymindmap
cd safetymindmap
bash setup.sh
```

This creates a Python venv, installs all dependencies (including Playwright's Chromium), initializes the database, imports the mind map, runs an initial scrape of AISafety.com events, and sets up a daily cron job.

Use `bash setup.sh --no-cron` to skip cron setup.

## Backend

The backend is a Flask API backed by SQLite. The database is fully recreatable from the YAML seed file + scraped event data.

### Run the server

```bash
source env/bin/activate
python3 backend/app.py
```

### Useful commands

```bash
# Re-initialize DB schema + re-import mind map
bash backend/init_db.sh

# Re-import mind map only (after editing mindmap.yaml)
python3 backend/import_mindmap.py

# Manual scrape
bash backend/cron_scrape.sh

# Inspect data
python3 backend/db.py tree                              # Full mind map as JSON
python3 backend/db.py tree --id ai-safety/organizations # Subtree
python3 backend/db.py dump                              # All scraped events

# Wipe everything
bash backend/clear_db.sh
```

### Editing the mind map

Edit `backend/mindmap.yaml` and re-import:

```bash
python3 backend/import_mindmap.py
```

Nodes with `subtree: events` auto-generate children from scraped data, grouped by month.

## Mobile App

The mobile app is built with Expo (React Native).

### Prerequisites

- Node.js 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/) (`npm install -g expo-cli`)
- For iOS: Xcode (macOS only)
- For Android: Android Studio, or the Expo Go app on a physical device

### Run the app

```bash
cd mobile
npm install
npx expo start
```

Then press:
- `i` — open in iOS Simulator
- `a` — open in Android Emulator
- Scan the QR code with Expo Go on a physical device

### Build for production

```bash
cd mobile
npx expo build:ios
npx expo build:android
```

## Project Structure

```
backend/
  mindmap.yaml        # Hand-curated mind map tree (source of truth)
  import_mindmap.py   # YAML → SQLite importer
  db.py               # Database schema, queries, CLI
  airtable2.py        # AISafety.com event scraper
  init_db.sh          # Init schema + import mind map
  clear_db.sh         # Wipe all data
  cron_scrape.sh      # Cron wrapper for scraping
mobile/               # Expo/React Native app
setup.sh              # One-command server setup
```
