# PerForm setup on the homelab

PerForm is a fork of [openGym](https://github.com/DuarteSantos8/openGym). It runs on Miguel's
homelab (Ubuntu Server, Docker) next to the apps already there, without touching them, and is
reached from the PC and the phone over [Tailscale](https://tailscale.com) with real HTTPS.
The upstream guides ([SELF_HOSTING.md](SELF_HOSTING.md), [MOBILE.md](MOBILE.md)) still apply for
anything not covered here.

## How it sits on the server

| What | Where |
|---|---|
| Code | `~/perform` (a clone of this repository; it is public, so no deploy key is needed) |
| Data | `/data/perform/dados` (profiles, workouts, passkeys, session secret) |
| Backups | `/data/perform/copias`, every day at 22:30, the newest 14 kept, synced to Google Drive `Copias PerForm` |
| Containers | stack `perform`: `api` and `web`, the web port only on `127.0.0.1:8091` |
| Address | Tailscale Serve, HTTPS port **8443** → `https://homelab.<tailnet>.ts.net:8443`, tailnet only, never Funnel |

Port 443 of the same name (the other app), 8080 (Pi-hole) and 8090 stay as they are.

Server specifics live in `deploy/homelab/`: `compose.homelab.yml` (data folders, uid 1000),
`env.homelab` (the `.env` template), `install-system.sh`, `update.sh`, `backup.sh` and the backup timer.

## First install

From the PC (PowerShell), on the server:

1. **Get the code** (no sudo):
   ```bash
   ssh homelab 'git clone https://github.com/WostPT/PerForm.git ~/perform'
   ```
2. **Prepare the system** (once, needs sudo, so Miguel runs it and types the password). It creates
   `/data/perform`, writes `~/perform/.env` with the server's Tailscale name, starts the backup timer
   and adds the Tailscale Serve entry on port 8443:
   ```powershell
   & 'C:\Program Files\Git\usr\bin\ssh.exe' -t homelab "sudo /home/wost/perform/deploy/homelab/install-system.sh"
   ```
   At the end it prints `tailscale serve status`: `/` on 443 must still point at `127.0.0.1:8090`.
3. **Build and start**:
   ```bash
   ssh homelab '~/perform/deploy/homelab/update.sh'
   ```
4. Open `https://homelab.<tailnet>.ts.net:8443` on the PC, **create your profile** (the first one
   becomes the admin), and add a passkey and a password under Settings → Account. In Chrome or Edge
   you can install it as a desktop app from the address bar.

## Updating

After a change is merged on GitHub:

```bash
ssh homelab '~/perform/deploy/homelab/update.sh'
```

It pulls, rebuilds, restarts and waits until `/api/health` answers. A new upstream openGym release
is brought in on a branch and merged through a pull request (`git fetch upstream && git merge
upstream/main`, with `upstream` = `https://github.com/DuarteSantos8/openGym.git`).

## The Android app (Galaxy A57)

The **Android** GitHub Action builds the APK on every push to `main`. Download it from the latest
run under **Actions → Android → Artifacts** (a zip with the `.apk` inside).

**Signing key, once.** So that each new APK installs over the last, the Action signs with your own
key. Create it (on any machine with Java, or with Docker on the server):

```bash
ssh homelab 'mkdir -p ~/perform-chave && docker run --rm -it -v ~/perform-chave:/k eclipse-temurin:21 \
  keytool -genkeypair -v -keystore /k/perform.jks -alias perform -keyalg RSA -keysize 4096 -validity 10000'
ssh homelab 'base64 -w0 ~/perform-chave/perform.jks'
```

Then on GitHub, **WostPT/PerForm → Settings → Secrets and variables → Actions → New repository
secret**, add:

| Name | Value |
|---|---|
| `ANDROID_KEYSTORE_B64` | the long text the second command printed |
| `ANDROID_KEYSTORE_PASSWORD` | the password you chose |
| `ANDROID_KEY_ALIAS` | `perform` |

Keep `perform.jks` and its password safe (and off the repository): without them an update means
uninstalling the app. Until the secrets exist, the Action builds a debug APK ("PerFormTest"), which
installs but may need an uninstall before each update.

**Pair the phone with the server:**

1. Install the Tailscale app on the phone, signed in to the same account, and keep it on.
2. Install the APK (allow installs from the browser or Files when the phone asks).
3. On the PC, signed in: **Settings → Account → Pair the mobile app** shows a one-time code.
4. In the phone app's first screen choose to connect to your server, enter
   `https://homelab.<tailnet>.ts.net:8443` and the code.

**Releases.** To publish one (what the in-app update check looks for): bump `version` in
`frontend/package.json`, merge to `main`, then tag it `v<version>` and push the tag.

## AI coach (optional)

Two ways to pay for it. Switching between them later keeps the Coach's history, which lives on
the server per profile. Details in [AI_COACH.md](AI_COACH.md).

**On a Claude subscription (Pro/Max), no extra bill.** Runs come out of the subscription's usage
limits. It needs the api image with Claude in it, running as root so it can start Claude as a
locked-down user (`deploy/homelab/compose.coach.yml`):

1. On the server: `~/perform/deploy/homelab/coach-pro.sh on` (rebuilds; the first time takes a few
   minutes).
2. On the PC, where Claude Code is signed in: `claude setup-token`, and copy the token it prints.
3. As the admin: **Settings → Account → Admin dashboard → AI Coach**, pick **Claude (Anthropic)**,
   **Add CLI token**, paste it, then **Test the Coach** and switch the card on.

The nightly backup still works with the api as root: `backup.sh` writes the archive from a
throwaway container when it cannot read the files itself.

**With an Anthropic API key, pay per use.** Pick **Anthropic API** on the same card and paste a key
from [console.anthropic.com](https://console.anthropic.com), with a monthly spend limit set there.
Then `~/perform/deploy/homelab/coach-pro.sh off` puts the plain image back.

## Checking on it

```bash
ssh homelab 'cd ~/perform && docker compose ps && docker compose logs --tail 50'
ssh homelab 'systemctl list-timers perform-backup.timer; ls -lh /data/perform/copias'
```
