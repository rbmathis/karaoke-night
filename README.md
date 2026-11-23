# karaoke-night

Mobile-first karaoke webapp for shared YouTube queues, host playback, favorites/history in SQLite, and English/Japanese support.

## What it does

- Create a karaoke room and join it with a room code
- Search YouTube karaoke tracks and add them to a live shared queue
- Let the host reorder, remove, skip, and start songs
- Keep favorites, recent reactions, and playback history in SQLite
- Offer guest, host, and TV-focused views
- Run as a single container on a Synology NAS

## Tech stack

- Next.js 16 App Router + TypeScript + Tailwind CSS
- SQLite + `better-sqlite3`
- Drizzle schema definitions
- Server-Sent Events for live room updates
- YouTube Data API v3 + IFrame player

## Environment

Create a `.env.local` file for local development:

```bash
YOUTUBE_API_KEY=your_youtube_data_api_key
DB_FILE=./data/karaoke.db
ADMIN_PASSWORD=choose_a_strong_admin_password
```

`YOUTUBE_API_KEY` is required for live search. Without it, the app still loads and favorites/history still work, but search returns a clear configuration error.
`ADMIN_PASSWORD` enables the password-protected admin page at `/en/admin` (or `/ja/admin`) for room cleanup, participant removal, and room settings updates.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production build

```bash
npm run build
npm run start
```

Health check endpoint:

```bash
http://localhost:3000/api/health
```

## Docker

For Synology, the default root **`docker-compose.yml`** is the NAS-friendly file with the absolute bind mount already set:

```bash
docker compose -f docker-compose.yml up --build
```

For non-Synology or portable local use, use:

```bash
docker compose -f docker-compose.non-synology.yml up --build
```

Docker Compose reads `YOUTUBE_API_KEY` from `.env.local`.

Both Compose files store SQLite at `/data/karaoke.db` inside the container. The Synology file binds that to `/volume1/docker/karaoke-night/data`, while the non-Synology file binds it to `./data`.

## Synology NAS notes

### Least-privilege deployment

If you want a deployment user that can work only inside a single shared folder such as `docker` or `containers`, the safest DSM pattern is:

1. Create or choose a shared folder such as **`docker`**.
2. Create a non-admin DSM user such as **`deploy-bot`**.
3. Grant that user **Read/Write** access only to that shared folder and **No Access** everywhere else.
4. If you want SSH-based deployment, enable **Terminal** access for that user, but **do not** add it to the `administrators` group.
5. Put this project in a fixed path such as **`/volume1/docker/karaoke-night`**.
6. Create `.env.local` in that folder with your NAS-side secrets.
7. Install the root-owned deploy helper from `deploy/synology/karaoke-night-deploy.sh` to **`/usr/local/bin/karaoke-night-deploy`**.
8. Allow the deploy user to run only that single script via sudo using `deploy/synology/karaoke-night.sudoers.example`.

This is much safer than granting direct Docker access. On Synology, Container Manager / Docker control is effectively admin-level.

### Easiest day-to-day workflow: `deploy-to-synology.ps1`

Map the `docker` shared folder over SMB (the script defaults to `Z:\karaoke-night`; override with `$env:KARAOKE_NAS_ROOT`), then from the repository root run:

```powershell
.\deploy-to-synology.ps1
```

The script never touches Docker itself. It walks through the manual Container Manager steps and pauses at each checkpoint for `C` (continue) or `Q` (quit):

1. **Pre-checks.** It verifies that the NAS folder, `docker-compose.yml`, `.env.local` and `data/karaoke.db` exist, and that every build input is tracked in Git. Untracked files under `src` or `public` stop the run; uncommitted edits to tracked files are deployed. If the inputs match the last operator-confirmed release, it skips straight to cleanup.
2. **Stop.** Check that the running container mounts `/volume1/docker/karaoke-night/data` at `/data`, note some rooms, favorites and history, then stop the project in Container Manager.
3. **Backup.** It copies `karaoke.db` and any WAL/SHM/journal sidecars to `backups/pre-deploy-<timestamp>-<id>`, verifies the hashes, and runs a SQLite integrity check on a local temporary copy (`deploy/synology/verify-deployment-backup.mjs`). Nothing else happens if this fails.
4. **Stage.** It copies only the tracked build inputs to `deployment-releases/<id>`. It saves the current NAS compose file there as `previous-compose.yml`, then replaces the NAS `docker-compose.yml` with one whose build context is that release, tagged `karaoke-night:sha256-<input hash>`. The NAS `.env.local` is never overwritten.
5. **Deploy and verify.** In Container Manager, update the project from the new compose file, build with cache, recreate and start it. Confirm the image tag, `http://<nas-ip>:3000/api/health`, the logs and your data, then answer `C`. Answering `Q` leaves the release pending, and the next run takes a fresh backup.
6. **Cleanup.** Once a release is confirmed, it lists every NAS entry Docker doesn't need and asks before deleting any of them. This covers old source dumps, stray `.env*` copies (with a warning if they differ from the active one) and releases other than the current one and its rollback.

To roll back, stop the project, copy the release's `previous-compose.yml` back to `docker-compose.yml`, and rebuild. To restore data, stop the project and copy a whole `pre-deploy-*` set (database plus its sidecars) into `data`. Don't mix it with sidecars left over from the newer database.

### Recommended NAS layout

```text
/volume1/docker/karaoke-night/
  docker-compose.yml        # generated by deploy-to-synology.ps1
  .env.local                # NAS-side secrets, created by hand
  data/                     # live SQLite database
  backups/                  # pre-deploy database backups
  deployment-releases/      # staged build contexts + state.json
```

### One-time admin setup on the NAS (optional SSH helper)

As an administrator on the NAS, copy `deploy/synology/karaoke-night-deploy.sh` from this repository to the NAS and install it:

```sh
sudo install -o root -g root -m 750 \
  ./karaoke-night-deploy.sh \
  /usr/local/bin/karaoke-night-deploy
```

Then create a sudoers entry based on `deploy/synology/karaoke-night.sudoers.example`, replacing `deploy-bot` with your DSM username. The goal is to allow:

```sh
sudo /usr/local/bin/karaoke-night-deploy deploy
```

and nothing broader.

### Deploy user workflow

After the one-time admin setup, the non-admin deploy user can:

```sh
sudo /usr/local/bin/karaoke-night-deploy check
sudo /usr/local/bin/karaoke-night-deploy deploy
sudo /usr/local/bin/karaoke-night-deploy status
sudo /usr/local/bin/karaoke-night-deploy logs
```

The helper is intentionally constrained to `/volume1/docker/...` or `/volume1/containers/...` so it cannot be pointed at arbitrary filesystem locations.
It uses the root `docker-compose.yml` file so the helper and Container Manager project setup stay aligned.

### Container and reverse proxy notes

1. Add your YouTube API key in `.env.local` inside the NAS app folder.
2. Keep the `data` folder on the NAS volume so the SQLite file survives restarts.
3. Prefer an absolute host bind mount instead of `./data`, especially in Synology Container Manager. The included root `docker-compose.yml` already does this for `/volume1/docker/karaoke-night/data`.
4. If you use Synology Reverse Proxy, make sure WebSocket/SSE-friendly buffering is disabled for this app path.

### HTTPS reverse proxy (required for reliable YouTube embedding)

The container itself only serves plain HTTP on port 3000. If guests load the app directly at `http://<nas-ip>:3000`, YouTube's IFrame Player will often refuse to play videos in-app — even ones the search results mark as embeddable — and fall back to "watch on YouTube." This is a browser/YouTube security requirement around insecure/plain-HTTP origins, not a per-video restriction. Putting an HTTPS reverse proxy in front of the container fixes this.

No code changes are needed for this: the app already derives its embed `origin` from the browser's `window.location.origin`, so it automatically becomes `https://...` as soon as the app is accessed through the proxy's HTTPS URL.

**Option A — LAN-only (no public domain, quickest)**

1. In DSM, go to **Control Panel → Login Portal → Advanced → Reverse Proxy** and create a rule:
   - Source: `HTTPS`, your NAS hostname, a port such as `8443` (or your preferred port), enable **HSTS** if offered.
   - Destination: `HTTP`, `localhost`, port `3000`.
2. Edit the new rule's **Custom Header** tab and add the **WebSocket** header set (this also covers the Server-Sent Events endpoint used for live room updates). Confirm request/response buffering is off so SSE isn't held up.
3. DSM will use its default self-signed certificate unless you assign another one in **Control Panel → Security → Certificate**. A self-signed cert is fine here — guests will see a one-time browser warning to accept it, but the page still loads over real TLS, which is what YouTube's embed check needs.
4. Share the HTTPS URL (e.g. `https://<nas-ip>:8443`) instead of the old `http://<nas-ip>:3000` link/QR code for rooms.

**Option B — Public domain (no browser warning)**

1. Set up Synology **DDNS** (or your own domain pointed at the NAS) under **Control Panel → External Access → DDNS**.
2. Under **Control Panel → Security → Certificate → Add**, request a **Let's Encrypt** certificate for that hostname (requires ports 80/443 reachable from the internet during issuance).
3. Assign that certificate to the reverse proxy rule described above instead of the self-signed default.
4. Renewals are automatic; no further action needed.

Either option removes the plain-HTTP origin as a source of playback failures. If a video still fails after switching to HTTPS, that's the real "this video can't be embedded anywhere" case — use the in-app **Watch on YouTube** fallback (and the embeddable badge in search results) for those.

Example persistent mount:

```yaml
services:
  karaoke-night:
    user: "0:0"
    environment:
      DB_FILE: /data/karaoke.db
    volumes:
      - /volume1/containers/karaoke-night/data:/data
```

If your shared folder is named `docker`, the same idea would be:

```yaml
services:
  karaoke-night:
    user: "0:0"
    environment:
      DB_FILE: /data/karaoke.db
    volumes:
      - /volume1/docker/karaoke-night/data:/data
```

## Backup

The SQLite file is the main persistent asset. `deploy-to-synology.ps1` takes a verified offline backup into `backups/` before every deployment, but those copies live on the same NAS: keep additional backups of `data` off the NAS and test restores periodically.
