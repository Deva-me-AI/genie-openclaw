# Upstream sync playbook (genie-openclaw fork)

How to rebase this fork (`@bitplanet/genie-openclaw`) onto a newer upstream
`openclaw/openclaw` release while keeping a clean, linear, low-conflict history.

## Principles

- **Rebase, never merge.** Replay the fork delta onto the upstream tag. Do not
  merge `main` (or upstream) into the upgrade branch: merge-of-merges history
  makes the next rebase conflict-prone.
- **Target a stable tag**, not `main`/alpha/beta. Pick the newest `vYYYY.M.D`
  (no prerelease suffix).
- **Keep the fork delta thin and linear.** It is currently 3 logical commits on
  top of the upstream tag (see "Fork delta inventory"). Keep it that way so the
  next rebase is a short replay.

## Procedure

```bash
# 1. Fetch the chosen upstream stable tag
git remote add upstream https://github.com/openclaw/openclaw.git   # once
git fetch upstream tag vYYYY.M.D

# 2. Replay the fork delta onto the new tag (linear history, no merges)
#    OLD_TAG = the tag the current fork branch sits on.
git rebase --onto "vYYYY.M.D^{commit}" "OLD_TAG^{commit}" upgrade/<current>
#    (Resolve conflicts; see "Known restructure points".)

# 3. Install + build + typecheck (monorepo; CI=true allows the modules purge)
CI=true pnpm install
CI=true pnpm build
CI=true pnpm tsgo
```

## Fork delta inventory (must survive every rebase)

1. **Identity + core-package-name guards.** `package.json` (name
   `@bitplanet/genie-openclaw`, repo `Deva-me-AI/genie-openclaw`,
   `publishConfig.access=public`) and every guard that compares a resolved
   package.json name against `"openclaw"` must ALSO accept
   `"@bitplanet/genie-openclaw"`. Known sites:
   `src/infra/openclaw-root.ts`, `src/version.ts`, `src/infra/update-runner.ts`,
   `src/cli/update-cli/shared.ts`, `src/daemon/service-layout.ts`,
   `src/infra/control-ui-assets.ts`, `src/plugins/plugin-sdk-native-resolver.ts`,
   `src/infra/npm-managed-root.ts`. **Upstream keeps ADDING new such guards** —
   after each rebase, re-grep and fix new ones (see checklist). Keep `"openclaw"`
   too (additive) so upstream tests + upstream-named installs still resolve.
2. **`customInstructions` web-UI feature.** Follow `main`'s wiring exactly:
   chat.send param -> MsgContext -> run params -> embedded attempt
   (`agent-runner-execution` path) -> `buildEmbeddedSystemPrompt` ->
   `## User Rules`. It binds to the initiating message; do NOT wire it into the
   async followup-runner path.
3. **Channel-pairing gateway RPC.** `channels.pairing.list/approve` server
   methods + `packages/gateway-protocol` schemas/validators. Use
   `context.getRuntimeConfig()`, never ambient `loadConfig()` (deprecated-config
   guardrail).
4. **`update-check` package param** (notifier checks `@bitplanet/genie-openclaw`).
5. **CI/packaging**: `npm-publish.yml` (OIDC trusted publisher; see below),
   `npm-shrinkwrap.json`, `scripts/genie-upgrade.sh`, identity-bearing workflows.

## Known restructure points (where conflicts land)

- `src/gateway/protocol/` was extracted to `packages/gateway-protocol/`.
- `src/agents/pi-embedded-runner/` was consolidated into
  `src/agents/embedded-agent-runner/`.
- Re-home fork patches to the new locations during the rebase.

## Identity-guard checklist (run after every rebase)

```bash
# Find package-name guards upstream may have added that the fork must widen:
grep -rn '"openclaw"' src packages --include='*.ts' \
  | grep -viE '\.test\.|test-support|harness' \
  | grep -iE 'CORE_PACKAGE|=== "openclaw"|!== "openclaw"|name === DEFAULT_PACKAGE_NAME'
# For each that compares the CORE package's own package.json name, add
# "@bitplanet/genie-openclaw" to the accepted set. Leave CLI-command / provider /
# runtime / plugin-peer-dep / format uses of "openclaw" unchanged.
```

## Verification gate

- `CI=true pnpm build` and `CI=true pnpm tsgo` green.
- Fork-critical tests: `src/infra/openclaw-root.test.ts`, `src/version.test.ts`,
  `src/infra/system-presence.version.test.ts`,
  `src/gateway/server-methods/channels.pairing.test.ts`,
  `src/agents/system-prompt.test.ts`.
- Full-suite triage method: failures are common from suite-ordering pollution and
  host-sensitive exec tests. To tell ours from pre-existing, run a failing file
  **isolated** AND on the **pristine upstream tag**; only failures that pass on
  pristine-isolated but fail on ours are ours to fix.

## Publish + ship

- **Stable release tags collide with the upstream tag — recreate at the fork tip
  before pushing.** Step 1 of the Procedure runs `git fetch upstream tag vYYYY.M.D`,
  which creates a LOCAL annotated tag `vYYYY.M.D` (tagger "Peter Steinberger",
  `package.json` name `openclaw`) on the upstream base commit — an ancestor of the
  fork tip. Creating the fork's release tag of the same name then fails with
  `fatal: tag 'vYYYY.M.D' already exists`. Do NOT force-push that tag: the publish
  workflow would build the upstream tree (name `openclaw`, no fork delta). Replace it:

  ```bash
  git tag -d vYYYY.M.D                                   # re-fetchable from upstream
  git tag -a vYYYY.M.D <fork-tip-sha> -m "genie-openclaw vYYYY.M.D — rebase onto upstream stable vYYYY.M.D"
  git rev-parse vYYYY.M.D^{commit}                       # MUST equal the fork tip
  git show vYYYY.M.D:package.json | grep '"name"'        # MUST be @bitplanet/genie-openclaw
  git push origin vYYYY.M.D
  ```

  Only stable tags collide; `-beta.N` tags do not (upstream has no such suffix). The
  published npm version comes from `package.json`, not the tag; the tag name only
  routes the dist-tag (`-` in name -> `beta`, else -> `latest`).

- npm publish runs on `git push` of a `v*` tag via `.github/workflows/npm-publish.yml`
  (OIDC trusted publisher must point at `Deva-me-AI/genie-openclaw`). Prerelease
  tags (`-beta.N`) route to the `beta` dist-tag; stable tags to `latest`.
- Servers install/upgrade from npm (`@bitplanet/genie-openclaw`). If keeping the
  tarball path, ensure a tarball builder exists; otherwise repoint
  `scripts/genie-upgrade.sh` to `npm i -g`. Fleet rollout is tracked in
  content-server (provisioning, snapshot bake, `GenieVersion`).
