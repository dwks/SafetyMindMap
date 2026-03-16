# SafetyMindMap — Project Handoff for Claude Code

## What is this?

SafetyMindMap is a mobile app (React Native / Expo) serving the AI safety community. It combines an interactive knowledge graph of the AI safety landscape with a career navigator that gives personalized guidance on fellowships, programs, and career paths.

The developer is a research manager at ERA who does technical AI safety work, allocates compute to researchers, and gives career/fellowship advice. This app productizes knowledge he already shares manually.

---

## Core features

### 1. AI Safety Explorer (mind map / knowledge graph)
An interactive, zoomable graph with clusters for:
- Technical research areas (alignment, interpretability, evals, governance)
- Career paths
- Fellowships and programs
- Organizations
- Conferences and events
- Funding and grants

Each node expands into richer detail — descriptions, links, deadlines, and reading lists.

### 2. Career Navigator
A guided flow layered on the graph: "I'm a ___ interested in ___" → recommended path through the graph with concrete next steps. Uses the developer's domain expertise in career advising.

### 3. Events & Programs feed
Live data from AISafety.com's Airtable database (see data pipeline below).

---

## Tech stack decisions

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Framework | React Native + Expo | Cross-platform, one codebase for iOS/Android |
| Build/deploy | EAS Build + EAS Submit | Handles signing, builds, store submission from CLI |
| Backend | Supabase | Postgres + auth + edge functions, easy React Native integration |
| Graph viz | TBD — spike needed | Options: react-native-skia, d3 to canvas, react-native-graph. Performance on mobile with 100+ nodes is the key risk |
| AI features | Claude API (optional) | For career advisor chat within the app |

---

## Data pipeline: AISafety.com events

We have a working Python script (`airtable_extract_v2.py`) that extracts structured event data from AISafety.com's publicly embedded Airtable view.

### How it works
1. **Playwright** loads the Airtable embed page (`https://airtable.com/embed/appF8XfZUGXtfi40E/shrLgl03tMK4q6cyc?viewControls=on`) just long enough to intercept the `readSharedViewData` XHR request
2. This captures a signed **accessPolicy** token (includes share ID, app ID, signature, and expiry date)
3. The actual view ID is `viwHl72bJxCb2SfrL` (different from the share ID `shrLgl03tMK4q6cyc`)
4. A plain **requests** call replays the endpoint with `shouldUseNestedResponseFormat: true` and explicitly asks for JSON (not msgpack)
5. The parser resolves Airtable's internal select option IDs to human-readable labels by recursively searching the response for choice definitions

### Key technical details
- The embed URL share ID (`shrLgl03tMK4q6cyc`) is NOT the same as the view ID (`viwHl72bJxCb2SfrL`) used in the API endpoint
- The `readSharedViewData` endpoint requires the `accessPolicy` query param with a signed token — you cannot call it with just a session cookie
- The access policy has an expiry date (currently `2026-04-09`), so the Playwright step needs to re-run periodically to get a fresh token
- Airtable may return msgpack binary if asked — always set `shouldUseNestedResponseFormat: true` WITHOUT `allowMsgpackOfResult` to get JSON
- `networkidle` wait strategy WILL timeout on Airtable — use `domcontentloaded` instead
- Select/multiSelect fields store values as arrays of internal IDs like `"seldpsiSJGMPZQGmp"` — the choice labels come from `typeOptions.choices` in the column definitions

### Data schema (8 columns, 64 records as of March 2026)

| Field | Airtable Type | Example |
|-------|--------------|---------|
| Name | text | "BlueDot Impact: Frontier AI Governance (Mar '26)" |
| Link | button | `{"label": "Website", "url": "https://..."}` |
| Start date | date | "2026-03-16T00:00:00.000Z" |
| End date | date | "2026-04-19T00:00:00.000Z" |
| Description | multilineText | Course description paragraph |
| Applications/registrations close | date | "2026-03-08T00:00:00.000Z" |
| Type | multiSelect | ["Course"], ["Fellowship"], ["Conference"], etc. |
| Location | multiSelect | Resolved labels TBD — same ID pattern as Type |

### Type categories (resolved from select option IDs)

| Type label | Count | Examples |
|------------|-------|---------|
| Fellowship | 23 | ILINA, Constellation, BASE, FIG, MATS |
| Conference | 12 | EAGxCDMX, SERI Symposium, TIAP |
| Bootcamp | 9 | ML4Good, AI Security Bootcamp |
| Course | 8 | BlueDot Impact courses |
| Workshop | 4 | CHAI Workshop, Seoul Alignment |
| Talk/Event | 3 | Demo Day, MATS Symposium |
| Hackathon | 2 | AI Control Hackathon |
| Meetup | 1 | Frankfurt AI Safety Meetup |
| Other | 2 | Protest, Internship |

### Production architecture for the data pipeline
```
Cron (daily/weekly)
  → Supabase Edge Function runs Playwright to capture fresh accessPolicy
  → Fetches readSharedViewData with requests
  → Parses + resolves select labels
  → Upserts into Supabase Postgres table
  → App reads from Supabase, never from Airtable directly
```

Note: The developer has reached out to the AISafety.com team requesting direct Airtable API access. If granted, replace the Playwright token-capture step with a simple authenticated API call using their key. The rest of the pipeline stays the same.

### Other AISafety.com data sources to integrate later
The site also has Airtable-backed databases for:
- **Field map** — people, organizations, and "products" in AI safety
- **Communities** — local groups, online forums
- **Self-study courses** — curricula and reading lists
- **Jobs** — AI safety job postings
- **Funding** — grants and funding opportunities

Same extraction approach should work for each.

---

## App store submission checklist

### Accounts needed
- Apple Developer Program: $99/year — enroll early, takes 1-2 days to verify
- Google Play Console: $25 one-time

### Apple App Store
- As of April 28, 2026: must build with iOS 26 SDK (Xcode 26). EAS Build handles this.
- Privacy policy URL required
- App Privacy labels must declare all data collection
- If using Claude API: must disclose AI/automation usage and get user consent
- Must not feel like a thin directory/catalog — the career navigator's interactive flow is important for approval
- Provide demo account if login is required
- Review takes 24-48 hours typically

### Google Play
- Must submit as .aab (Android App Bundle) — Expo default
- First submission must be manual (Google Play API limitation), then EAS Submit automates future ones
- Complete IARC content rating questionnaire
- Fill out Data Safety section
- Assets needed: 512x512 icon, 1024x500 feature graphic, 2+ screenshots

### EAS workflow
```bash
# Build
eas build --platform all --profile production

# Submit
eas submit --platform ios --latest
eas submit --platform android --latest
```

Can be automated via GitHub Actions — builds run on Expo's cloud (even iOS builds work from Ubuntu runners).

---

## Recommended development phases

1. **Data model + content** (Week 1-2) — Define the node schema for the knowledge graph. Seed 50-100 nodes across all categories. Design the Supabase schema.
2. **Scaffold** (Week 2-3) — Expo project, navigation, basic screens.
3. **Graph explorer** (Week 3-5) — Interactive node map with zoom/pan. This is the highest-risk feature — spike on graph rendering libraries early.
4. **Career navigator** (Week 5-7) — Guided flow + recommendations engine.
5. **Backend + data pipeline** (Week 7-9) — Supabase integration, Airtable sync, search.
6. **Polish + test** (Week 9-11) — Beta testers via TestFlight + Google internal track, bug fixes, UX.
7. **App store submission** (Week 11-13) — Store listings, screenshots, review process.

---

## Files included

- `airtable_extract_v2.py` — Working data extraction script. Run with `pip install requests playwright msgpack && playwright install chromium && python airtable_extract_v2.py`
- `aisafety_events.json` — Sample output with 64 parsed events, resolved select labels

---

## Open questions for the developer
- Graph visualization library choice — needs a spike comparing performance
- Whether to include Claude API for career chat (adds cost + AI disclosure requirements)
- Content curation strategy — who maintains the knowledge graph nodes beyond AISafety.com data?
- Monetization (if any) — free app? Donations?
- App name — "SafetyMindMap" (confirmed)
