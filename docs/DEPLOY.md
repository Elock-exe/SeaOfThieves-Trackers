# Deploying the tracker

Two pieces, two hosts:

| Piece | What it is | Where it goes |
|---|---|---|
| Site | plain HTML/CSS/JS, no build | Netlify or Vercel |
| API | Node server, no dependencies | Render or Railway |

The browser extension stays on each tester's machine and talks to the API.

---

## 1. Push the repository

`data/` and `.env` are git-ignored, so **no keys and no player stats are
committed**. Check before the first push:

```bash
git status --short
```

If `.env` or `data/` appear, stop — `.gitignore` is not being read.

## 2. Deploy the API

On [render.com](https://render.com): **New → Blueprint**, select the repo.
`render.yaml` describes the service; set three values in the dashboard:

| Variable | Value |
|---|---|
| `STEAM_API_KEY` | your Steam key |
| `OPENXBL_API_KEY` | your OpenXBL key |
| `SITE_ORIGIN` | the site's URL, once step 3 gives you one |
| `SUPABASE_URL` | your Supabase project URL (step 2b) |
| `SUPABASE_KEY` | the Supabase **service_role** key (step 2b) |

`SITE_ORIGIN` is what lets the site call the API. Without it every request
from the browser is refused by CORS, and the site shows no data.

Verify: `https://your-api.onrender.com/api/health` returns JSON.

### 2b. Add the database (do not skip this)

Render's free plan has an **ephemeral filesystem**: `data/` is deleted on
every redeploy and after each idle sleep. Without a database, every
account and every snapshot disappears and testers must start over.

A free Supabase project fixes it, and costs nothing:

1. Create a project at [supabase.com](https://supabase.com) (free tier).
2. **SQL Editor → New query**, paste [`docs/database.sql`](database.sql),
   Run. That creates two tables and their indexes.
3. **Project Settings → API**, copy:
   - the **Project URL** → Render env var `SUPABASE_URL`
   - the **service_role** key → Render env var `SUPABASE_KEY`
4. Redeploy.

The service key bypasses row-level security, which is why it is a server
env var and must **never** be put in `assets/js/config.js` or anywhere
the browser can read it. All authorisation happens in the API.

Confirm it took: the API logs its storage backend at boot.

```
storage:   supabase (xxxx.supabase.co)      ← good
storage:   local files in data/  — NOT persistent on free hosting
```

The second line, on a deployed instance, means the env vars are missing
and data will be lost. The server prints an explicit warning in that case.

## 3. Deploy the site

On [netlify.com](https://netlify.com): **Add new site → Import an existing
project**. `netlify.toml` sets the publish directory; there is no build
command.

Then point the site at the API — edit `assets/js/config.js`:

```js
window.SOT_API_BASE = 'https://your-api.onrender.com';
```

Commit and push. Go back to Render and set `SITE_ORIGIN` to the Netlify
URL, then redeploy the API.

> An HTTPS page **cannot** call `http://localhost`. Browsers block it as
> mixed content. Once the site is online it must talk to an HTTPS API —
> which is why `config.js` exists rather than the address being hardcoded.

## 4. Give the extension to testers

```bash
powershell Compress-Archive -Path extension\* -DestinationPath sot-extension.zip -Force
```

Each tester:

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select the unzipped `extension` folder
3. Open the extension, set **Tracker address** to your API URL, click Save
   — Chrome asks permission for that domain, which is expected
4. Set **Pirate name** if the page name is not picked up
5. Sign in at seaofthieves.com, open the profile page, click **Sync**

## Accounts, in one paragraph

The extension generates a random key on install and keeps it. The first
sync binds that key to a pirate name; later syncs for that name must
present the same key, so nobody can publish stats as someone else. Keys
are stored hashed, never in plaintext. Reading is public — that is what a
tracker is — but always by name: `/api/synced?handle=Pirate`.

## What is deliberately missing

- **No password recovery.** Lose the extension's storage and you lose
  write access to that pirate name. There is no email to reset from,
  because there is no email.
- **No rate limiting on sync.** A tester can spam snapshots. Fine for a
  small group, not for a public launch.
- **Cold starts.** A free service sleeps after 15 minutes idle and takes
  30–60s to wake. The extension waits up to a minute and says "waking
  up"; the first sync of the day is simply slow.
- **No moderation.** Any name can be claimed by whoever syncs first.
