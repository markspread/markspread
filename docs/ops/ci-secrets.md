# CI secrets policy

> S-CI-024 — signing keys live in HSMs / KMS, never as long-lived plaintext.

This document is the authoritative reference for how Markspread's CI handles
sensitive material. Every signing key in the release pipeline (S-CI-011..016)
is held in a hardware-backed store; every workflow that needs to use one
authenticates via short-lived OIDC, then accesses the store with a token that
expires when the workflow ends.

## What's allowed in `secrets:`

| Use                              | Storage                       | Renewal     |
|----------------------------------|-------------------------------|-------------|
| Apple Developer ID cert          | Azure Key Vault HSM           | n/a (cert)  |
| Apple App-specific password      | GitHub Secrets                | quarterly   |
| Apple Team ID, Apple ID          | GitHub Vars (non-sensitive)   | n/a         |
| Windows EV cert                  | DigiCert KeyLocker (HSM)      | n/a (cert)  |
| Windows EV key access            | OIDC → Azure → KeyLocker      | per-run     |
| Linux GPG key                    | Yubikey (held offline)        | n/a (key)   |
| Linux GPG passphrase             | GitHub Secrets                | quarterly   |
| Updater Ed25519 key              | Yubikey (held offline)        | n/a (key)   |
| S3 release bucket access         | OIDC → IAM role (no static)   | per-run     |
| CloudFront invalidation          | same                          | per-run     |
| npm publish (SDK)                | OIDC → npm provenance         | per-run     |
| GitHub releases (`GITHUB_TOKEN`) | minted by GitHub per workflow | per-run     |

## What's never allowed

- `secrets.<NAME>` referenced in a workflow that runs on `pull_request:` from a
  fork. Forked PRs run with limited secrets by default; we enforce this with
  `permissions:` at the job level.
- Long-lived `aws_access_key_id` / `aws_secret_access_key` strings. We use
  `aws-actions/configure-aws-credentials@v4` with `role-to-assume` + OIDC,
  never static creds.
- Plaintext signing keys committed to the repo or left on a runner's disk
  past the workflow's lifetime. Every signing step writes to `$RUNNER_TEMP`
  and the runner is destroyed when the job ends.

## Adding a new secret

1. **Decide the trust class.** If the secret signs binaries that users
   install, it goes in an HSM — full stop. If it's a credential for an API
   we call but doesn't appear in the released artefact, GitHub Secrets is
   acceptable.
2. **Document scope.** Add the secret + its scope (org / repo / environment)
   to this file's table.
3. **Set the `environment:` on the job.** Production secrets live in the
   `release` environment which requires manual approval before a workflow
   run can read them.
4. **Don't echo the secret.** The job log redacts known secrets, but a
   `set -x` or a tool that prints command lines can still leak them.

## Environments

| Environment | Approval required | Used by                                       |
|-------------|-------------------|-----------------------------------------------|
| `release`   | yes (1 reviewer)  | `release.yml`, `publish-update-feed`, `rollback` |
| `beta`      | no                | `nightly.yml`                                 |
| `dev`       | no                | everything else                               |

## Rotation

- Quarterly review (calendar event, owner: ops). For each entry in the
  table above:
  - confirm the secret still has a documented owner;
  - rotate any GitHub Secret that's been touched in plaintext form (passphrases,
    app-specific passwords);
  - verify HSM access by signing a known-good test artefact and validating
    the signature against the embedded public key (no false positives).
- Yubikeys live in the safe; their access requires two engineers on-site.
  Annual key ceremony rotates the Ed25519 updater key — when it rotates,
  the new public key ships in the next release and the updater is taught
  to accept both during a 30-day overlap.

## OIDC trust setup (one-time)

```sh
# Federate GitHub → AWS so workflows in this repo can assume `markspread-ci`.
aws iam create-openid-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list <github-actions-thumbprint>

# Trust policy on the role pins the repo + a list of allowed branches/tags.
# (See infra/aws/markspread-ci-role.json for the source of truth.)
```

Compromise drill: if a signing key is suspected compromised, run the
**rollback** workflow (`S-CI-022`) within the hour, rotate the affected
key, and publish an advisory entry in `SECURITY-INDEX.md`.
