# Release checklist

> S-REL-011 — every step that has to happen between "we want to ship" and
> "users can install the new version". Run top-to-bottom; CI does most of
> the heavy lifting but the human gates are listed explicitly so nothing
> ships unverified.

## T-3 days — pre-flight

- [ ] **Open the milestone.** Confirm every issue tagged for this version
      is closed or moved to the next milestone — no half-merged work.
- [ ] **Run `pnpm changeset status`.** All merged feature/fix PRs since
      the last release should appear. If anything is missing, add a
      changeset retroactively before tagging.
- [ ] **CHANGELOG drift check.** `node scripts/release/check-changelog.mjs --tag <next>`
      ensures the upcoming `## <version>` section exists in CHANGELOG.md.
- [ ] **Localisation parity.** `node scripts/check-i18n-keys.mjs --strict`
      passes (no missing keys in any locale, no orphan keys).
- [ ] **SBOM diff review.** `pnpm run sbom:diff` posts the dependency
      delta to #releases-internal — ops engineer initials it.
- [ ] **Security advisories.** Check SECURITY-INDEX.md for any tag-
      bound advisory that needs to land in this release's notes.

## T-1 day — staging

- [ ] **Beta channel sanity.** Confirm the latest nightly built from
      `main` ran 24+ h on the dogfood machines without a crash report.
- [ ] **Visual regression baseline.** If any UI changed, the visual e2e
      job is green on `main` (no `tolerated` flags in the diff report).
- [ ] **Updater smoke.** With `MARKSPREAD_UPDATER_FEED=staging`, the
      previous stable build successfully detects + applies a fake
      "new version" pointing at the next release's pre-built artifacts.

## T-0 — tag + release

- [ ] **Branch is clean.** `git fetch && git status` reports
      "up to date with origin/main", working tree clean.
- [ ] **Bump + tag.** `pnpm changeset version && git push --follow-tags`
      — Changesets writes the version bumps + CHANGELOG entries, the
      tag push triggers `release.yml`.
- [ ] **release.yml.** Watch every shard pass:
      - macos (universal .dmg, signed + notarized + stapled)
      - windows (x64 .msi EV-signed via KeyLocker)
      - windows-arm64 (best-effort, may legitimately fail)
      - linux (.AppImage + .deb + .rpm, GPG-signed)
      - linux-arm64 (.AppImage + .deb)
      - finalise-github-release (SHA256SUMS + GPG signature)
- [ ] **Manual review of release notes.** GitHub Release page renders
      the composed notes correctly, no broken links, security callout
      present if applicable.
- [ ] **Updater feed publish.** `publish-update-feed.yml` ran after
      release.yml — `https://releases.markspread.app/latest.json`
      returns the new version, signature validates against the
      embedded public key.

## T+0 — distribution

- [ ] **Homebrew Cask PR.** `publish-homebrew.yml` opened a PR against
      homebrew/cask — verify SHA matches our SHA256SUMS file.
- [ ] **winget PR.** `publish-winget.yml` opened a PR against
      microsoft/winget-pkgs — manifests for x64 (+ arm64 if built).
- [ ] **Snap Store push.** `publish-snap.yml` reports "release: stable"
      success for amd64 + arm64.
- [ ] **AUR push.** `publish-aur.yml` updated `markspread-bin`. Verify
      `https://aur.archlinux.org/packages/markspread-bin` shows the
      new pkgver.
- [ ] **Flathub PR.** Auto-bumper bot opens a PR against
      flathub/app.markspread.Markspread (or hand-cranked if the bot is
      stuck). Reviewer merges after CI build passes.

## T+0 — visibility

- [ ] **Site update.** Update `marketing/landing/data/version.ts`
      (download links pull dynamically from the GitHub Release, but the
      version string in the hero hero copy is hard-coded). Vercel auto-
      deploys on merge.
- [ ] **Documentation.** `docs/` site rebuild — the version selector
      pulls from `docs/data/versions.json`; add an entry.
- [ ] **Tweet.** Compose from the template in `docs/ops/release-tweet-template.md`,
      include the Release page URL, post from the @markspread account.
- [ ] **Discord/Slack.** `#releases` announcement with TL;DR + 3 user-
      facing highlights + link to full notes.
- [ ] **Email.** Newsletter draft (only for minor+ versions, not
      patches) sent to ops for review before send.

## T+0 — smoke (S-REL-012)

Tracked in detail in `docs/ops/post-release-smoke.md`. Required for
every minor + major; optional for patches.

## T+0 to T+24h — monitoring (S-REL-013)

- [ ] **Crash dashboard.** Sentry "this release" filter shows < 0.5%
      crash rate after the first 1000 launches. If a regression spike
      is visible, page the on-call.
- [ ] **Download counts.** GitHub Release download counts grow steadily;
      no "stuck at zero" platforms (indicates a CDN miss).
- [ ] **GitHub issues.** Watch the `release-feedback` label. Triage
      anything tagged `regression` immediately.

## When something goes wrong

- **Bad release detected before site update.** Don't update the site;
  delete the GitHub Release tag, fix, re-tag with a `+1` suffix on the
  metadata if needed (or skip the broken version entirely).
- **Bad release shipped to users.** Run `rollback.yml` (S-CI-022)
  immediately. The auto-updater stops offering the bad version within
  5 minutes (CDN cache TTL on `latest.json`).
- **Compromised signing key suspected.** Follow the compromise drill
  in `docs/ops/ci-secrets.md`: rotate, advisory entry, mandatory
  update push.

## Owners

| Step                       | Primary owner | Backup     |
|----------------------------|---------------|------------|
| Tag + monitor release.yml  | Release captain (rotates weekly) | ops |
| Distribution PRs           | release captain | ops |
| Site + tweet               | marketing on-call | release captain |
| Smoke test                 | release captain | QA |
| 24 h monitoring            | on-call eng | ops |
| Rollback                   | on-call eng | release captain |
