# PerForm fork notes

This repository is **PerForm** (`github.com/WostPT/PerForm`), Miguel's personal fork of openGym
(`github.com/DuarteSantos8/openGym`, the `upstream` remote). The root `CLAUDE.md` is upstream's and
describes the codebase; this file covers what differs in the fork.

- Goal: one app crossing training, nutrition and rest (sleep), with Health Connect data from a
  Fitbit Versa 4, an AI coach with the full picture, and later a BLE rep-counter band
  (Seeed XIAO nRF52840 Sense). Strength training is the core; other sports are optional modules.
- Runs on Miguel's homelab (Ubuntu Server laptop `homelab`, user `wost`, Docker) next to other
  apps that must not be touched: web on `127.0.0.1:8091`, data in `/data/perform`, Tailscale Serve
  on HTTPS port 8443 (443, 8080 and 8090 belong to other services). Server files in
  `deploy/homelab/`; deploy with `ssh homelab '~/perform/deploy/homelab/update.sh'`. The Android
  app (Galaxy A57) pairs with that server. Setup: `docs/PERFORM_SETUP.md`.
- Miguel describes and reacts and does not write code; he is learning Linux. Explain each server
  step before running it. He runs anything needing sudo himself; never handle his passwords.
- **Stay mergeable with upstream.** Put PerForm features in new files where possible
  (`frontend/src/lib/perform-*.js`, new views, new API route files) and keep edits to upstream
  files small. Keep plain JavaScript and upstream's conventions (pure helpers in `src/lib` with a
  test beside them). Upstream's dependency-light rule is relaxed only when a feature needs it.
- Branding differs only where users see it: app name "PerForm", Android `applicationId`
  `pt.wostpt.perform` (the Java namespace stays `ch.duartesantos.opengym` on purpose), the update
  check pointing at this fork's releases.
- CI: the Android APK is built by `.github/workflows/android.yml` (upstream builds it on GitLab).
  CLA and Pages workflows only run on upstream.
