# Ledger

Event + personal finance tracker. Plain HTML/CSS/JS — no build step, no dependencies, no server. Data stays in your browser (`localStorage`) only.

## Run locally
Just open `index.html` in a browser. Everything works offline immediately.

## Put it on GitHub Pages
1. Create a new repo on GitHub, e.g. `ledger`.
2. Upload all files in this folder (`index.html`, `style.css`, `app.js`, `manifest.json`, `service-worker.js`, `icon.svg`, `vendor/xlsx.full.min.js`) to the repo root — keep the `vendor` folder structure intact.
3. Repo → **Settings → Pages** → Source: `Deploy from a branch` → Branch: `main` / `root` → Save.
4. Your app will be live at `https://<your-username>.github.io/ledger/` in a minute or two.

## Install it like an app
On your phone, open the live link in Chrome (Android) or Safari (iOS):
- **Android/Chrome:** menu → "Add to Home screen" / "Install app"
- **iOS/Safari:** Share → "Add to Home Screen"

It installs like a real app icon, opens full-screen, and works fully offline after the first load (a service worker caches all files).

## Notes
- All data is local to the browser it's used in — nothing is sent anywhere. If you switch phones/browsers, data doesn't carry over automatically (it's not synced).
- Dark/light toggle and currency (₹/$) are remembered.
- Events are sorted newest-first automatically by date.
- **Manpower / commission** events: add a row per name/group with a headcount and rate — e.g. "Rahul & team, count 2, client pays each ₹700, you pay each ₹650" gives ₹100 margin per person, ₹200 total, calculated automatically.
- **Monthly breakdown** — calendar icon in header, hidden by default. Shows events net / personal spend / combined net per month.
- **Excel export** — download icon in header. Exports everything (Events, Event Workers, Personal Expenses, Monthly Summary) into one `.xlsx` file, sorted chronologically. Works fully offline (the xlsx library is bundled locally in `vendor/`, no external calls).
