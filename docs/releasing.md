---
title: Releasing
description: How to cut a new release of genie-openclaw
summary: "Version bump, pre-flight checks, tagging, what the three release workflows do, and how to upgrade genie servers"
read_when:
  - Cutting a new release
  - Understanding what happens when a tag is pushed
  - Upgrading genie servers to a new version
---

# Releasing

A release publishes three artifacts simultaneously via GitHub Actions:

| Artifact      | Trigger                         | Destination                              |
| ------------- | ------------------------------- | ---------------------------------------- |
| npm package   | Tag push `v*`                   | `@bitplanet/genie-openclaw` on npmjs.com |
| Tarball       | Tag push `v*`                   | GitHub Release asset (`.tgz`)            |
| Docker images | Tag push `v*` or push to `main` | `ghcr.io/bitplanet-l1/genie-openclaw`    |

---

## Version Format

Versions follow a **date-based scheme**: `YYYY.M.DD`

Examples: `2026.5.12`, `2026.4.1`

Do not use semver for this package. If you cut two releases on the same day, append a patch counter: `2026.5.12-1`, `2026.5.12-2`.

---

## Pre-Flight Checks

Run these before touching the version:

```bash
# Full lint + type check + format check + boundary lints
pnpm check

# Fast unit tests (~30s)
pnpm test:fast

# Validate tarball contents and plugin version sync
pnpm run release:check
```

`release:check` does a dry-run `npm pack` and verifies:

- Required files are present: `dist/index.js`, `dist/entry.js`, `dist/plugin-sdk/index.js`, `dist/build-info.json`
- All extension packages under `extensions/` are on the same version as the root `package.json`
- The `appcast.xml` build metadata is valid

Fix any failures before proceeding.

---

## Bump the Version

1. **Edit `package.json`** — change the `version` field to `YYYY.M.DD`:

   ```json
   "version": "2026.5.12"
   ```

   Do not use `npm version` — it applies semver logic and produces the wrong format.

2. **Sync extension packages:**

   ```bash
   pnpm run plugins:sync
   ```

   This updates every `extensions/*/package.json` to the same version. If you skip this, `release:check` will fail.

3. **Re-run release:check** to confirm everything lines up:

   ```bash
   pnpm run release:check
   ```

---

## Tag and Push

```bash
# Stage and commit the version bump
git add package.json packages/ extensions/
git commit -m "chore(release): bump version to 2026.5.12"

# Create the tag (must match "v" + the version string exactly)
git tag v2026.5.12

# Push commit and tag
git push origin main
git push origin v2026.5.12
```

Both pushes are needed. Pushing `main` triggers a Docker `:main` build. Pushing the tag triggers npm publish, tarball release, and a versioned Docker build — these are separate workflow runs.

---

## What the Workflows Do

### `npm-publish.yml`

Runs on tag push `v*`. Builds the project (`pnpm build`) then runs `npm publish --provenance --access public`. Uses OIDC (OpenID Connect) for authentication — **no NPM_TOKEN secret is needed**. Requires Node 24 specifically (npm 11 ships with Node 24 and is required for the OIDC registry handshake; npm 10 silently falls back to an anonymous PUT and fails with 404).

### `tarball-release.yml`

Runs on tag push `v*`. Builds the project, runs `npm pack` to create a `.tgz` tarball, then creates a GitHub Release at the tag with the tarball attached as an asset. Release notes are auto-generated from commits since the previous tag. Pre-release logic: if the tag contains `beta` or `alpha`, the release is marked as pre-release.

### `docker-release.yml`

Runs on tag push `v*` **and** on pushes to `main` (excluding docs-only changes). Builds separate `linux/amd64` and `linux/arm64` images on dedicated Blacksmith runners in parallel, then creates a multi-platform manifest. Images are pushed to `ghcr.io/bitplanet-l1/genie-openclaw`.

Image tags:

- Push to `main` → `:main-amd64`, `:main-arm64`, `:main`
- Tag `v2026.5.12` → `:2026.5.12-amd64`, `:2026.5.12-arm64`, `:2026.5.12`, `:latest`

`:latest` is only applied for full `MAJOR.MINOR.PATCH` versions (no pre-release suffix).

---

## Verify the Release

```bash
# npm — may take 2–3 minutes for CDN propagation
npm info @bitplanet/genie-openclaw version

# GitHub Release
gh release view v2026.5.12 --repo Bitplanet-L1/genie-openclaw

# Docker
docker pull ghcr.io/bitplanet-l1/genie-openclaw:2026.5.12
docker run --rm ghcr.io/bitplanet-l1/genie-openclaw:2026.5.12 openclaw --version
```

---

## Upgrading Genie Servers

Genie servers (Lightsail instances) install from the GitHub Release tarball, not from npm. Use `scripts/genie-upgrade.sh`:

```bash
# SSH into the server
ssh <genie-server>

# Upgrade to latest release (auto-detects newest tag)
bash /path/to/genie-upgrade.sh

# Or pin to a specific version
bash /path/to/genie-upgrade.sh v2026.5.12
```

The script:

1. Checks Node >= 22
2. Uses `gh release download` to fetch the `.tgz` from the GitHub Release
3. Runs `npm install -g <tarball>` to replace the global openclaw install
4. Detects if the gateway is running (systemd or bare process) and restarts it automatically

**After upgrade, verify:**

```bash
openclaw --version
systemctl --user status openclaw-gateway
tail -f /tmp/openclaw-gateway.log
```

If the gateway fails to start after an upgrade, check:

- `journalctl --user -u openclaw-gateway -n 50` for the error
- New required config keys: run `openclaw config list` and compare to the CHANGELOG
- Node version: `node -v` must be >= 22

---

## Rollback

If a release is broken, install the previous version on the genie server:

```bash
bash /path/to/genie-upgrade.sh v2026.5.1   # last known-good tag
```

The tarball for every past release remains on GitHub Releases indefinitely. The script always pulls the exact requested tag, never resolves "latest".

---

## Common Failures

| Failure                                         | Cause                              | Fix                                                                       |
| ----------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| `release:check` fails: missing dist files       | Build output incomplete            | Run `pnpm build` locally; check `tsdown.config.ts`                        |
| `release:check` fails: plugin version mismatch  | Forgot `plugins:sync`              | Run `pnpm run plugins:sync` then re-check                                 |
| npm publish 404                                 | Wrong Node version in workflow     | Ensure `node-version: 24` in `npm-publish.yml` (npm 11 required for OIDC) |
| Docker build fails on arm64                     | Blacksmith runner unavailable      | Re-run the failed job from GitHub Actions                                 |
| Genie server: gateway won't start after upgrade | Missing config key or Node too old | Check `journalctl`, read CHANGELOG for new required fields                |
