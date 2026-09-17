# Believe Board — setup (about 15 minutes, once)

## 1. Supabase (sync + file storage)
1. Go to supabase.com → Start your project → sign in with GitHub or email.
2. New project → Name: `believe-board` → set a database password (save it somewhere) → Region: **Sydney** → Create. Wait ~2 min.
3. Left sidebar → **SQL Editor** → New query → paste everything in `setup.sql` → **Run**. It should say "Success".
4. Left sidebar → **Authentication** → **Sign In / Providers** → **Email** → turn **Confirm email OFF** → Save.
5. Left sidebar → **Project Settings** → **API** (may be called "Data API" / "API Keys"). Copy:
   - **Project URL** (https://xxxx.supabase.co)
   - **anon public** key (or "publishable" key). Never use the service_role / secret key.

## 2. GitHub Pages (hosting)
1. github.com → sign up / sign in.
2. **+** (top right) → New repository → Name: `believe-board` → **Public** → Create.
3. Click **uploading an existing file** → drag in EVERYTHING from this folder (all files) → Commit changes.
4. Open `config.js` in the repo → pencil ✏️ → paste your Project URL and anon key between the quotes → Commit changes.
5. **Settings** → **Pages** → Source: **Deploy from a branch** → Branch: `main` / `(root)` → Save.
6. Wait 1–2 min. Your app is at: `https://YOUR-GITHUB-USERNAME.github.io/believe-board/`

## 3. Install on each device
- **iPhone / iPad:** open the link in **Safari** (not the Claude or Chrome app) → Create account (first device) or Sign in → Share button → scroll down → **Add to Home Screen** → Add.
- **Mac:** Safari → open link → **File → Add to Dock**. Or Chrome → address bar install icon ⊕ → Install.

## 4. Bring your current data across (once)
On any device: Today tab → bottom → **Import backup** → pick `believe-board-backup.json`.

## Updating later
Replace files in the GitHub repo (keep your config.js). The app picks up the new version next time it opens online.
