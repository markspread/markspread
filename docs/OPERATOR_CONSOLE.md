# Operator console (deferred — post-v1)

> Status: **deferred**. We do not ship this in v1. This file documents
> the design so it can be picked up after launch without rediscovering
> the constraints we set ourselves at the start.

## What it is

A small read-only dashboard for the maintainers showing:

- **Download counts** — per-OS and per-channel, derived from the
  release artifact CDN logs (Cloudflare R2 → BigQuery, Vercel
  Analytics for the landing site).
- **Install activations** — count of unique installs that have ever
  pinged `updates.markspread.dev`. The ping carries no user identity:
  it is `(installId, version, os, arch)` where `installId` is a
  random 128-bit token generated on first launch and stored in the
  OS keychain.
- **Crash counts** — number of crash reports submitted via the
  in-app reporter (gated by user consent, off by default).

What it is **not**:

- A user analytics dashboard. We don't track active users, sessions,
  retention, "feature adoption", or anything that requires
  fingerprinting.
- A telemetry pipeline. Telemetry is opt-in and goes to a separate
  retention store with a 30-day TTL.

## Privacy guarantees we want to keep

1. **No PII**. The operator console never shows IPs, emails,
   usernames, hostnames, paths, or workspace contents. The data
   pipeline strips these at ingest, not at query time.
2. **Aggregation only**. Bucket sizes < 10 are rolled up to "<10".
   This stops the dashboard from incidentally identifying small
   user groups (e.g. all installs in a tiny country).
3. **Public-mirror by default**. The aggregated counters are also
   published at `markspread.dev/stats` so users can verify what
   maintainers see is exactly what they see.

## Architecture sketch

```
download CDN ─► R2 access logs ─► daily ETL ─► counters table
                                                    │
update pings ─► /v1/install-ping ─► hash(installId) ┘
                                                    │
                                                    ▼
                                       Postgres (counters table only)
                                                    │
                                       ┌────────────┴───────────┐
                                       ▼                        ▼
                       operator console (Next.js)      public stats page
```

The counters table holds **no per-event rows**. ETL writes only
`(date, os, channel, version, installs, downloads, crashes)`.

## Why we deferred

- Building this requires running an ingest service. v1 ships with
  zero servers we operate (updates and downloads are CDN, telemetry
  is off by default). Adding one for ops convenience trades that
  posture for a little bit of executive dashboarding. Not worth it
  pre-launch.
- We can re-derive most of the headline numbers post-hoc from
  R2 access logs whenever we actually need them.

## Pickup checklist

When this comes off the deferred list:

- [ ] Provision Postgres + R2 ETL job. Minimal schema in this doc.
- [ ] `/v1/install-ping` endpoint with rate limit and HMAC over
      `(installId, today)` so a flood doesn't inflate counters.
- [ ] Bucket roll-up logic (< 10 → "<10") applied at ETL, not query.
- [ ] Operator console SSO via Sign in with Vercel.
- [ ] Public mirror at `markspread.dev/stats`.
- [ ] Update [Telemetry & privacy](../../docs/content/docs/security-privacy/telemetry.mdx)
      to mention the install-ping (currently silent on it).
