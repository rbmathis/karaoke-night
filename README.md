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

### Easiest day-to-day workflow

If the hardest part for you is just getting code onto the NAS, the simplest flow is usually:

1. Create a non-admin DSM user with access only to the shared folder that holds this project.
2. Map that shared folder to your local machine over SMB.
3. Copy or sync this repo into the mapped folder from your PC.
4. Do the actual container restart/build as a separate manual step on the NAS.

That keeps file transfer and container control separate, which is easier to reason about and safer than giving full admin SSH access to the machine that is doing the copy.

To make that copy step easier from Windows, use:

```powershell
.\deploy\synology\sync-to-share.ps1 -TargetPath "Z:\karaoke-night"
```

This copies the repo to the mapped NAS folder while skipping local-only and bulky artifacts such as:

- `.git`
- `.next`
- `node_modules`
- `data`
- `.env.local`
- SQLite database files

The sync helper also creates an empty `data` folder in the target path so the NAS-side bind mount exists before the container starts.

For Synology Container Manager project creation, use the root **`docker-compose.yml`** file. It already has the absolute bind mount path set for **`/volume1/docker/karaoke-night/data`**.

If you want a dry run first:

```powershell
.\deploy\synology\sync-to-share.ps1 -TargetPath "Z:\karaoke-night" -ListOnly
```

If you want the share to be mirrored exactly, including deletions on the NAS copy:

```powershell
.\deploy\synology\sync-to-share.ps1 -TargetPath "Z:\karaoke-night" -Mirror
```

Use `-Mirror` carefully if you keep NAS-only files in that folder.

### Recommended NAS layout

```text
/volume1/docker/karaoke-night/
  docker-compose.yml
  docker-compose.non-synology.yml
  Dockerfile
  .env.local
  data/
```

### One-time admin setup on the NAS

Copy the repo to the fixed app path, then as an administrator on the NAS:

```sh
sudo install -o root -g root -m 750 \
  /volume1/docker/karaoke-night/deploy/synology/karaoke-night-deploy.sh \
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

The SQLite file is the main persistent asset. Back up the `data` folder regularly.
