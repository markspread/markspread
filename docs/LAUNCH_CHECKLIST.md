# Pre-launch checklist (v1.0.0)

This is the gate every line of which must be ticked off before we
flip the website "Download" button from staging to production. The
release manager owns the gate; nobody overrides without writing
down what's being deferred and why.

The checklist is deliberately conservative. Things that can be
fixed in v1.0.1 do not block v1.0.0; things that put users at risk
or embarrass the project after launch do.

## T-7 days — readiness review

### Product gate (P0 scenarios)

- [ ] Every scenario flagged P0 in the cycle is `done` in Clawket.
- [ ] No P0 scenario has unresolved review comments older than 24h.
- [ ] `docs/MIGRATION_NOTES.md` is empty (we have nothing to migrate
      from on a fresh install).
- [ ] The "first-run" smoke walkthrough — install → open workspace →
      edit → spread → quit — runs in under 90s on a 2-year-old
      MacBook Air baseline.

### Cross-OS smoke (S-REL-012)

- [ ] macOS 14 + 15, Apple Silicon and Intel-via-Rosetta builds
      pass the smoke matrix in `.github/workflows/smoke-macos.yml`.
- [ ] Windows 10 22H2 + Windows 11 23H2, x64 build passes
      `.github/workflows/smoke-windows.yml`.
- [ ] Ubuntu 22.04 + 24.04, Fedora 40, x64 builds pass
      `.github/workflows/smoke-linux.yml` (X11 and Wayland sessions
      both).
- [ ] Smoke artifacts uploaded to the run; manual reviewer signs the
      run with a comment.

### Signing and notarisation

- [ ] macOS bundle signed with the Developer ID certificate currently
      on file at <https://markspread.dev/.well-known/codesign-id>.
- [ ] macOS bundle stapled with a fresh notarisation ticket. Staple
      verified with `xcrun stapler validate`.
- [ ] Windows installer signed with the EV certificate. Authenticode
      timestamp present and verified with `signtool verify /pa /v`.
- [ ] Linux AppImage and tarball ship with detached
      `.asc` signatures from the publisher key. `gpg --verify`
      passes against the key on `keys.openpgp.org`.
- [ ] Signature fingerprints match the values published at
      <https://markspread.dev/security/keys>.

### Legal and content

- [ ] [Terms of Use](https://markspread.dev/terms/) live, last-updated
      date matches release date.
- [ ] [Privacy Policy](https://markspread.dev/privacy/) live, ditto.
- [ ] [Trademark Guidelines](https://markspread.dev/trademark/) live.
- [ ] [SECURITY.md](../SECURITY.md) merged with PGP fingerprint
      matching `.well-known/pgp-key.asc`.
- [ ] [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) merged with
      `conduct@markspread.app` mailbox active.
- [ ] [CONTRIBUTING.md](../CONTRIBUTING.md) DCO requirement enforced
      by `.github/workflows/dco.yml`.
- [ ] `NOTICE` regenerated from current `Cargo.lock` + `pnpm-lock.yaml`
      via `pnpm gen:licenses && pnpm gen:notice`.

### Domain, DNS, HSTS

- [ ] `markspread.dev` apex resolves to Vercel; CAA record pins
      `letsencrypt.org` and `sectigo.com`.
- [ ] `www.markspread.dev` 301s to apex.
- [ ] `updates.markspread.dev` resolves and serves a valid signed
      release manifest.
- [ ] HSTS header present with `max-age=31536000; includeSubDomains;
      preload` and the apex is on the
      [HSTS preload list](https://hstspreload.org/).
- [ ] CSP on the docs and landing site contains no `unsafe-inline`
      scripts. (Inline styles are fine; the lint check passes.)
- [ ] Cloudflare-style request-coalescing is **off** on
      `updates.markspread.dev` so a poisoned cache cannot pin a bad
      release.

## T-2 days — final dry run

- [ ] Dry-run the release pipeline against a `v1.0.0-rc1` tag,
      pulling the artefact through `winget`, `brew`, and AUR. (We
      throw the rc1 away after.)
- [ ] Update `notices.json` with a launch-day banner; it stays
      **empty** in production until launch flips it.
- [ ] Customer-support inbox `support@markspread.app` answered by an
      autoresponder that points at the docs and the bug tracker.
- [ ] Status page <https://status.markspread.dev> green; the
      synthetic check from `monitoring/synthetics.ts` passes from
      icn1 / iad1 / fra1.

## T-0 — launch day

- [ ] Tag `v1.0.0`, push, watch CI build the bundle.
- [ ] Verify the published artefact in <30 minutes:
      download from a clean machine, install, run, quit. If verify
      fails, **rollback** before announcing.
- [ ] Flip the website Download CTA to v1.0.0.
- [ ] Publish the launch announcement (S-LCH-002).
- [ ] Post Show HN, Product Hunt, Mastodon, X (S-LCH-004 → 008).
- [ ] On-call enters "launch monitoring" mode (S-LCH-010).

## What is *not* on this list

- "Hit X downloads on day one." Vanity targets are not a release gate.
- "Telemetry shows opt-in adoption." Telemetry is off by default and
  we won't see most users at all. The pre-launch privacy posture
  forbids treating opt-out installs as a measurement gap.
- "Every translation is at 100%." `pnpm i18n:progress` reports the
  current state; English plus one other above 80% ships.

## Sign-off

The release manager records the sign-off here:

```
Released:     v1.0.0
Tag pushed:   YYYY-MM-DD HH:MM UTC
Verified by:  <name>
Notes:        <link to release issue>
```

Anything ticked off late, or skipped with explicit acceptance,
goes in the launch retrospective (S-LCH-011).
