# Installation Guide

This guide gets you from "nothing installed" to "AIRelay running, dashboard open in a browser." It assumes **zero prior experience** with Docker, Node.js, or the command line.

If you already know your way around — the [README quickstart](README.md#quickstart) is shorter.

---

## Pick your path

| Path | Pick if you… | Difficulty |
|---|---|---|
| **A. Windows + Docker Desktop** | …are on Windows and want the easy button | ★ |
| **B. macOS + Docker Desktop** | …are on macOS and want the easy button | ★ |
| **C. Linux + Docker Engine** | …are on a Linux server / homelab box | ★★ |
| **D. Local Node.js (no Docker)** | …want fastest dev iteration or can't run Docker | ★★ |

All four paths end in the same place: the dashboard at `http://localhost:3000` (or your chosen hostname).

---

## A. Windows + Docker Desktop

### A1. Install prerequisites

1. **Install Docker Desktop**
   Download from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) and run the installer. Accept defaults.
   When it finishes, **restart your computer** (Docker Desktop installs a Windows feature called WSL 2 that needs a reboot).

2. **Open Docker Desktop once.** It will ask you to accept the terms — click through. You'll see a green "Engine running" indicator at the bottom-left when it's ready. Leave it running.

3. **Install Git for Windows**
   Download from [git-scm.com/download/win](https://git-scm.com/download/win) and run the installer. Accept defaults. This gives you a `Git Bash` terminal.

### A2. Get the code

Open **Git Bash** (Start menu → "Git Bash") and run:

```bash
cd ~
git clone https://github.com/<your-org>/airelay.git
cd airelay
```

> **What this does:** downloads the project into `C:\Users\<you>\airelay` and steps into that folder.

### A3. Configure

```bash
cp .env.example .env
```

You now have a file called `.env` in the project. Open it in any text editor (Notepad works) and find the line:

```
UPSTREAM_URL=
```

Set it to your provider's API host. Examples:

```
UPSTREAM_URL=https://api.anthropic.com
# or
UPSTREAM_URL=https://api.openai.com/v1
```

Save the file. **Don't put your API key here** — the proxy doesn't need it. Your application code will send the key on each request.

> Don't know what to put? Skip this step. The dashboard has a Setup tab that generates `.env` for you (see step A6).

### A4. Start it

```bash
docker compose up --build
```

The first run takes ~1 minute (Docker downloads `node:22-alpine` and builds the image). When you see lines like `server listening on 0.0.0.0:3000`, it's running. Leave that terminal window open.

### A5. Open the dashboard

In your browser: **`http://localhost:3000`**

> **Note:** `localhost` works for local Node.js dev only. For Docker, use your machine's IP or a DNS alias — see [CONFIGURATION.md](CONFIGURATION.md).

You should see a dark dashboard with "Logs" and "Metrics" tabs.

### A6. (If you skipped A3) configure via the Setup tab

If `UPSTREAM_URL` is empty, the dashboard shows a **Setup** tab. Pick your provider, copy the generated `.env` block into the project's `.env` file, then in the terminal stop the proxy with `Ctrl+C` and run `docker compose up --build` again.

### A7. Verify it actually proxies

Open another Git Bash terminal and run (replace `$KEY` with your real key):

```bash
curl -s http://localhost:3000/proxy/v1/messages \
  -H "x-api-key: $KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":64,"messages":[{"role":"user","content":"hi"}]}'
```

You should see a JSON response from the provider, **and** a new row appear in the dashboard's Metrics tab.

### Stop & start later

```bash
# Stop
docker compose down

# Start again
docker compose up
```

---

## B. macOS + Docker Desktop

### B1. Install prerequisites

1. **Install Docker Desktop** from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/). Open it once — it'll ask for permissions; accept.
2. **Git** is already installed on macOS. If asked, allow Xcode Command Line Tools to install the first time you run `git`.

### B2. Get the code

Open **Terminal** (⌘+Space → "Terminal") and run:

```bash
cd ~
git clone https://github.com/<your-org>/airelay.git
cd airelay
```

### B3. Configure

```bash
cp .env.example .env
open -e .env
```

Set `UPSTREAM_URL` to your provider's API host (see [A3](#a3-configure) for examples). Save and close TextEdit.

### B4. Start it

```bash
docker compose up --build
```

### B5. Open the dashboard

`http://localhost:3000`

> **Note:** `localhost` works for local Node.js dev only. For Docker, use your machine's IP or a DNS alias — see [CONFIGURATION.md](CONFIGURATION.md).

### B6. Verify

Same `curl` command as [A7](#a7-verify-it-actually-proxies).

---

## C. Linux + Docker Engine

For headless servers / homelab boxes (Ubuntu, Debian, Fedora, Arch).

### C1. Install Docker Engine

Follow the official guide for your distro: [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Quick path on Ubuntu/Debian:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker run hello-world   # smoke test
```

### C2. Get the code

```bash
sudo apt-get install -y git    # or: dnf, pacman, etc.
cd ~
git clone https://github.com/<your-org>/airelay.git
cd airelay
```

### C3. Configure

```bash
cp .env.example .env
nano .env    # or vim, or your editor of choice
```

Set `UPSTREAM_URL`. Save.

### C4. Start it (foreground)

```bash
docker compose up --build
```

### C4-alt. Run as a background service

```bash
docker compose up -d --build
docker compose logs -f         # tail logs
docker compose ps              # check status
```

### C5. Reach it

- From the same machine: `http://localhost:3000`
- From other machines on the LAN: add a hosts-file entry on each client (see [CONFIGURATION.md → DNS](CONFIGURATION.md#dns-and-hostnames)) **or** install Tailscale on the host.

> **Note:** `localhost` works for local Node.js dev only. For Docker, use your machine's IP or a DNS alias — see [CONFIGURATION.md](CONFIGURATION.md).

### C6. Make it survive a reboot

`docker-compose.yml` already declares `restart: unless-stopped`, so once started with `-d`, the container comes back on host reboot. No systemd unit needed.

---

## D. Local Node.js (no Docker)

Fastest iteration if you're hacking on the code itself.

### D1. Install Node.js 22+

| OS | Install command |
|---|---|
| Windows | Download from [nodejs.org](https://nodejs.org/) — pick the **22.x LTS** installer. |
| macOS | `brew install node@22` (install [Homebrew](https://brew.sh/) first if needed) |
| Linux | Use [nvm](https://github.com/nvm-sh/nvm): `nvm install 22 && nvm use 22` |

Verify:

```bash
node --version    # should print v22.x.x or higher
```

### D2. Get the code

```bash
git clone https://github.com/<your-org>/airelay.git
cd airelay
```

### D3. Configure

```bash
cp .env.example .env
# edit .env in your editor — set UPSTREAM_URL
```

### D4. Install + run

```bash
npm install
npm run dev
```

`npm run dev` uses `node --watch` — saving any source file restarts the server automatically.

### D5. Open the dashboard

`http://localhost:3000`

### D6. Run tests

```bash
npm test
```

All 182 tests should pass.

---

## After install — what's next?

- **Configure DNS / Tailscale / hosts file** so the proxy is reachable by name from the machines that will call it → [CONFIGURATION.md → DNS](CONFIGURATION.md#dns-and-hostnames).
- **Wire your application's SDK** at the proxy → [CONFIGURATION.md → SDK setup](CONFIGURATION.md#wiring-your-sdk).
- **Tune the env vars** for your traffic level → [CONFIGURATION.md → Environment variables](CONFIGURATION.md#environment-variables).

---

## Troubleshooting

### "docker: command not found" (Windows / macOS)

Docker Desktop is installed but not running. Open it from the Start menu / Applications and wait for the engine to start (green dot at the bottom).

### "permission denied" on `docker compose up` (Linux)

You're not in the `docker` group yet. Run:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

Then retry. (You might need to log out and back in.)

### Port 3000 already in use

Something else is on port 3000. Either stop that thing, or change the proxy's port:

1. Edit `.env`: set `PORT=3001` (or any free port).
2. Edit `docker-compose.yml`: change `"3000:3000"` to `"3001:3001"`.
3. Restart: `docker compose down && docker compose up --build`.

### "UPSTREAM_URL not set" — proxy returns 503

You haven't told the proxy where to forward traffic. Set `UPSTREAM_URL` in `.env`, restart. See [CONFIGURATION.md → Provider recipes](CONFIGURATION.md#provider-recipes).

### Setup tab won't disappear after I configure

The Setup tab hides when `/health` reports `proxy.enabled = true`. Refresh the page (`Ctrl+R` / `⌘+R`) — the tab visibility is rechecked on every page load and every 10 s thereafter.

### Tests fail with `Cannot find module '@rollup/rollup-…'`

Native binary mismatch (e.g. you copied `node_modules` from a different OS). Fix:

```bash
rm -rf node_modules package-lock.json
npm install
```

### Dashboard loads but log/metric streams say "Reconnecting…"

Either the browser is blocking SSE (rare) or a proxy/VPN in front is buffering. Check DevTools → Network → look for `stream` requests; they should be `200` with type `eventsource` and stay open.

### I'm behind a corporate proxy with a self-signed cert

Set `PROXY_INSECURE_TLS=true` in `.env`. **Do not do this in production** — the upstream's TLS cert is no longer verified.

---

## Updating to a new version

```bash
cd airelay
git pull
docker compose up --build      # Docker
# or
npm install && npm run dev     # Local Node
```

---

## Uninstalling

```bash
docker compose down -v   # stops the container and deletes the log volume
cd ..
rm -rf airelay       # removes the source tree
```

Docker Desktop / Node.js can be uninstalled separately via your OS's normal app uninstall flow.
