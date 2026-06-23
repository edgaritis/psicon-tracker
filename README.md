# PsiCon Content Tracker — PWA

A self-contained Progressive Web App for tracking your Facebook content plan: drafts, scheduled, published, formats (Image / Reels), destinations (FB Page / FB Group). Works fully offline once installed.

## What's in this folder

```
pwa/
├── index.html        ← entry point
├── app.js            ← main app (Preact + htm via CDN)
├── seed.json         ← initial 2,663 posts (titles + categories baked in)
├── manifest.json     ← PWA install metadata
├── sw.js             ← service worker (offline cache)
├── icon.svg          ← vector app icon
├── icon-192.png      ← raster icon (Android, Apple)
├── icon-512.png      ← raster icon (install banners, splash)
└── README.md         ← this file
```

## Deploying to GitHub Pages

1. **Create a public repo** (e.g. `psicon-tracker`).
2. Push the entire **contents of this folder** (not the `pwa/` directory itself) into the repo root. So your repo top level should have `index.html`, `app.js`, `seed.json`, etc.

   ```bash
   cd pwa/
   git init
   git remote add origin https://github.com/<your-username>/psicon-tracker.git
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git push -u origin main
   ```

3. In the repo on GitHub → **Settings → Pages** → **Source: Deploy from a branch** → branch `main` / folder `/ (root)` → **Save**.
4. After a minute or two your PWA is live at:
   `https://<your-username>.github.io/psicon-tracker/`

## Installing the PWA

### On your phone (Android / iOS)
1. Open the URL in Chrome (Android) or Safari (iOS).
2. **Android:** tap the "Install app" banner, or the menu (⋮) → **Install app / Add to Home screen**.
3. **iOS:** tap Share → **Add to Home Screen**.
4. Launch from your home screen. After the first load it works fully offline.

### On your desktop (Chrome / Edge)
1. Open the URL.
2. Look for the install icon (▾⊞) in the address bar → click → **Install**.
3. The app opens in its own window, with its own taskbar/dock icon.

## How data is stored

- Everything lives in your browser's **localStorage** for this domain.
- Data is **per-device + per-browser**. Your phone and laptop don't share state automatically — use the **Backup** button to export a JSON file and **Restore** to load it on another device.
- localStorage persists across app close, reboots, browser updates, and offline use.
- It is wiped if you: clear browser site data, use incognito, or (on iOS) uninstall the PWA.

## Migrating from the design tool

If you have a backup JSON from the original tracker:

1. Open the PWA.
2. Click **Restore** in the header → pick your `.json` backup → confirm.
3. All your posts, statuses, defaults, and saved views are loaded.

## Importing more .md files

Click **Import .md** in the header. Drop one or more `.md` / `.txt` files using the same block format (`::: type / title: … / :::`). The app parses them client-side and adds only the titles that aren't already in your tracker.

## Updating the deployed app

When you push new commits to `main`, GitHub rebuilds Pages within a minute. **Installed PWAs** will pick up the update on their next load (the service worker fetches in the background and activates on the next session).

If a user is stuck on an old version, they can clear the service worker via: DevTools → Application → Service Workers → Unregister, then reload.

## Customization

- **App icon**: replace `icon.svg`, `icon-192.png`, `icon-512.png`.
- **App name / colors**: edit `manifest.json`.
- **Categories or colors**: edit the `CATEGORIES` and `CAT_COLORS` constants at the top of `app.js`.

## License

Personal use — this is yours.
