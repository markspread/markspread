# Security Policy

This document is the contract between the Markspread maintainers and
people who find security issues in the project. The internal runbook
that we follow once a report comes in lives at
[`docs/INCIDENT_PLAYBOOK.md`](./docs/INCIDENT_PLAYBOOK.md); this file
is the public-facing version.

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue;
that's how reports get scooped before a fix ships.

You have two channels:

1. **GitHub Security Advisories** — preferred. Open a private
   advisory on the affected repository:
   <https://github.com/markspread/markspread/security/advisories/new>.
   Reports route to the same maintainer group that reads the email
   address below.
2. **Encrypted email** — <security@markspread.app>. Please encrypt
   sensitive details with the PGP key listed below. The address is
   monitored by a small group of maintainers and is not the public
   support inbox.

If you can't use either, send a clear-text email to the same address
saying only "I'd like to send a security report"; we will reply with
a one-shot upload link.

## PGP key

Fingerprint:

```
5F3A 1A6E 9B0D 4A77 2C0E  6D11 8B22 4F9C E1D5 7A40
```

Pull the key from any of:

- `https://markspread.dev/.well-known/pgp-key.asc`
- `keys.openpgp.org` (search by fingerprint)
- DNS TXT on `_pgp.markspread.dev` (fingerprint hash)

If the three sources disagree, the well-known location wins; treat
disagreement itself as a reportable signal and email us about it.

## Response SLA

Once a report reaches us:

| Step                              | Within             |
|-----------------------------------|--------------------|
| Acknowledge receipt + tracking ID | 30 minutes         |
| Initial triage and severity score | 4 hours            |
| First public notice (SEV-1)       | 4 hours            |
| First public notice (SEV-2)       | 24 hours           |
| First public notice (SEV-3)       | 5 business days    |
| Fix shipped + advisory published  | per coordinated disclosure window |

If we cannot meet a window, we tell you before it expires; we do not
silently let it slip.

## Severity ladder

| Severity | Examples                                                                  |
|----------|---------------------------------------------------------------------------|
| **SEV-1** | RCE in editor, signing key leak, malicious update shipped to users       |
| **SEV-2** | Local privilege escalation, IDOR exposing other users' data, marketplace signature bypass |
| **SEV-3** | Self-XSS that requires user action; integrity issue with no PoC for impact |
| **SEV-4** | Hardening / defense-in-depth                                              |

## Coordinated disclosure

We aim to ship a fix and a public advisory at the same time. We
coordinate the embargo window with the reporter:

- Default embargo: **90 days** from acknowledgement, or until the fix
  ships — whichever is sooner.
- Detailed exploit information stays private until the patched
  version has been generally available for at least **72 hours**, so
  end users have time to update.
- If the issue is being actively exploited in the wild, we shorten
  the embargo and tell the reporter immediately.

## Scope

In scope:

- The Markspread desktop app (Tauri host + webview).
- The Markspread CLI (`markspread-cli`).
- The Markspread SDK (`@markspread/sdk`).
- The plugin marketplace catalogue and signature scheme.
- The update server and signing infrastructure.
- The first-party landing site and docs site, including
  authentication-style flows (we don't have any user accounts, but
  the marketplace publisher console does).

Out of scope:

- Third-party plugins distributed through the marketplace. Report
  those to the plugin author; if the plugin's behaviour breaks the
  sandbox, that's a host bug and is in scope.
- AI provider responses. The model said something offensive or
  hallucinated is between you and the provider.
- Issues that require physical access to an unlocked device.
- Vulnerabilities in dependencies that we have already patched in
  the latest release.
- Best-practice findings without an exploitable consequence
  (e.g. "TLS 1.0 is disabled in the binary you can verify with
  `nmap`"). These are useful, but they go in a normal issue.

## Safe-harbour statement

If you make a good-faith effort to comply with this policy, we:

- Will not pursue or support any legal action against you.
- Will work with you to understand and address the issue quickly.
- Will recognise your contribution publicly with your permission.

Good faith excludes:

- Accessing data that does not belong to you beyond what's required
  to demonstrate the issue.
- Degrading service for other users (denial-of-service testing on
  shared infrastructure).
- Sharing the issue with third parties before the embargo lifts.

## Hall of fame

We don't run a paid bug bounty in v1. We do publicly credit reporters
in the relevant advisory and on
<https://markspread.dev/security/hall-of-fame>, with the reporter's
preferred handle and (if they want) a link.

## Reference documents

- Internal incident runbook: [`docs/INCIDENT_PLAYBOOK.md`](./docs/INCIDENT_PLAYBOOK.md)
- Advisory template: [`docs/incident-templates/advisory.md`](./docs/incident-templates/advisory.md)
- Public security policy page: <https://markspread.dev/security/>
