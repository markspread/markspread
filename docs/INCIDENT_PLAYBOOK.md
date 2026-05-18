# Incident response playbook

This document is the runbook the maintainers follow when something
has gone wrong publicly: a security report we have to act on, a key
or signing-credential compromise, or a release that's hurting users.

Audience: anyone with merge access. Use this as a checklist, not a
suggestion. The deadlines below are commitments to users; missing
them happens, but missing them silently does not.

## Severity ladder

| Severity | Examples                                                      | Time to first public notice |
|----------|---------------------------------------------------------------|-----------------------------|
| **SEV-1** | RCE in editor, signing key leak, shipped malicious update     | ≤ 4 hours                   |
| **SEV-2** | Local privilege escalation, IDOR exposing other users' data, marketplace sig-bypass | ≤ 24 hours |
| **SEV-3** | Self-XSS that escalates with user action; integrity issue with no PoC for impact | ≤ 5 business days |
| **SEV-4** | Hardening / defense-in-depth                                  | next release                |

The [Security policy](../../docs/content/docs/security-policy.mdx)
binds us to those windows. If we can't meet one, we tell the
reporter before it expires; we do not silently let it slip.

## On-call

We do not have a 24/7 rotation. The on-call is whoever first reads
the report; their job is to do the **first three steps** below and
hand off if needed. The handoff target is documented in
`scripts/notify-oncall.sh`.

## Step 1 — Acknowledge

Within 30 minutes of seeing a security report:

- Reply from `security@markspread.app` confirming receipt and
  attaching a tracking ID (`MS-SEC-YYYY-NNN`).
- Open a private GitHub Security Advisory on the affected repo.
  Don't open a public issue — that's how reports get scooped.
- Post a one-line status to the maintainers' Slack channel
  (`#sec-incidents`). Don't post details, just "MS-SEC-2026-007 —
  SEV-1 triage starting".

## Step 2 — Triage

Within 4 hours:

- Reproduce the report on a clean install. If you cannot reproduce,
  ask the reporter for a recording or a sandbox repro before
  closing as "not-a-bug".
- Score severity using CVSS 3.1 calculator (link in
  `~/.config/markspread-sec/cvss-bookmark.txt`).
- Decide containment:
  - SEV-1: pull the affected release from `updates.markspread.dev`
    and the marketplace catalog. Push a static "do not install"
    advisory to the updater's notice channel.
  - SEV-2: same release pull; advisory posted within 24h.
  - SEV-3/4: no immediate pull; patch lands in next release.

## Step 3 — Contain

The actions we take depend on the kind of incident.

### Editor RCE / signing key leak

1. Rotate the signing keys.
   - Generate a new Ed25519 key locally (`markspread keygen`).
   - Update the well-known PGP location, the DNS TXT record, and
     `keys.openpgp.org` in that order.
   - Revoke the old key on `keys.openpgp.org` so anyone who
     re-fetches refuses old signatures.
2. Re-sign the latest known-good release with the new key.
3. Push a forced check-in to the updater that prefers the new
   signature; bake the old fingerprint into the updater's
   blocklist.
4. Open a public advisory naming the old fingerprint.

Do **not** keep the old key around "just in case". The whole point
of the rotation is that the old key is dead.

### Marketplace plugin compromise

1. `markspread plugin yank <plugin-id>@<version>` — removes from the
   catalog and adds to the blocklist.
2. The yank propagates to clients on next catalog poll (≤ 1 hour);
   tell the affected userbase via the in-app notice channel
   immediately because we don't want to wait on the poll.
3. If the plugin author was compromised, lock their publisher
   account in the marketplace control plane and contact them via
   the email on file.

### Bad release (no security impact)

1. Mark the release "yanked" on GitHub.
2. Update `updates.markspread.dev` to skip that version (the updater
   prefers the highest non-skipped semver).
3. Ship the next patch — the updater will pull users forward.

## Step 4 — Communicate externally

Use the templates in [`docs/incident-templates/`](./incident-templates/).
Copy verbatim, fill in the angle-bracketed fields, and review with
one other maintainer before publishing.

Channels we publish to:

- `markspread.dev/security/advisories` — RSS-mirrored from GitHub
  Security Advisories.
- `@markspread` on Mastodon and X for short notice; link to the
  advisory.
- The in-app notice channel (`updates.markspread.dev/notices.json`),
  which the updater pings every 6 hours.

Do **not** publish details that help someone exploit the issue
before the patched version has been out for at least 72 hours.
Coordinate with the reporter on the embargo window.

## Step 5 — Patch and ship

1. Branch off `main` to `sec/<tracking-id>` (private fork if needed).
2. Land the patch with the test that reproduces the issue.
3. Sign with the (rotated) key, push to `updates.markspread.dev`.
4. Run the post-deploy smoke checks in
   `.github/workflows/deploy.yml`.
5. Update the advisory: it now becomes public, with the
   patched-version field populated.

## Step 6 — Postmortem

Within 7 days of the patched release, write a postmortem to
`docs/postmortems/MS-SEC-YYYY-NNN.md`. Required fields:

- Timeline (UTC).
- Root cause.
- Why our existing tests didn't catch it.
- What we're changing so a similar bug fails to land next time.
- Reporter credit, if they want it.

The postmortem is **not** a who-blamed-whom document. It's the test
we add and the process change we make.

## Tools the playbook references

| Tool                         | Where it lives                                  |
|------------------------------|-------------------------------------------------|
| `markspread keygen`          | `markspread-cli`                                |
| `markspread plugin yank`     | `markspread-cli`                                |
| Advisory templates           | [`./incident-templates/`](./incident-templates/) |
| On-call notifier             | `scripts/notify-oncall.sh`                      |
| CVSS bookmark                | `~/.config/markspread-sec/cvss-bookmark.txt`    |

If any of these are missing, that itself is a SEV-3.
