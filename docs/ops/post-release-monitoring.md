# 24-hour post-release monitoring

> S-REL-013 — what to watch and when to pull the rollback handle.
> Owner is the on-call engineer for the 24 h after a release lands on
> the `latest` channel. Hand-off at the team-wide standup the next
> business day.

## Dashboards (open these in tabs at T+0)

1. **GitHub Release downloads** —
   `https://github.com/markspread/markspread/releases/tag/<tag>`
   refreshed every ~5 min by the GitHub UI.
2. **Sentry "Recent releases"** —
   `https://markspread.sentry.io/issues/?project=markspread&query=release%3A<tag>`
3. **Updater feed hit-rate (Cloudflare)** —
   `https://dash.cloudflare.com/.../analytics` filtered to host
   `releases.markspread.app`. Useful as a leading indicator: a sharp
   drop in `latest.json` requests means clients can't reach the feed.
4. **GitHub issue search** —
   `is:issue is:open created:>=<release-date> label:release-feedback`

## What "healthy" looks like

| Metric                           | Healthy           | Watch                | Page on-call         |
|----------------------------------|-------------------|----------------------|----------------------|
| Crash-free sessions              | > 99.5%           | 99.0–99.5%           | < 99.0%              |
| Crash-free users                 | > 99.0%           | 98.5–99.0%           | < 98.5%              |
| New `release-feedback` issues    | < 5/day           | 5–10/day             | > 10/day             |
| Updater error rate (5xx + 4xx)   | < 0.1%            | 0.1–0.5%             | > 0.5%               |
| Hard regressions reported        | 0                 | 1–2 (with workaround)| ≥ 1 with no workaround |
| Download counts ramp             | Smooth growth     | Plateau early        | Drop after launch    |

"Hard regression" = a feature that worked in the previous stable
release and is broken in the new one (not an entirely new bug).

## Cadence

- **T+0 → T+1h:** stay at the desk. Watch the first crash reports as
  early adopters install. Most catastrophic failures (signing broke,
  binary won't launch on platform X) surface in the first hour.
- **T+1h → T+6h:** check every 30 min. Reply to GitHub issues within
  this window even with just "we see this, looking".
- **T+6h → T+24h:** check every 2 h. Sleep is fine — Sentry will page
  the on-call rota directly if the crash rate breaches the page-on
  threshold.

## Decision matrix

```
            Severity → │ cosmetic / edge │ regression w/  │ data-loss or
            ───────────┼─────────────────┼ workaround     ┼ won't-launch
   Affected    < 5%    │   monitor       │  patch within  │  patch within
   user pop.   < 25%   │   patch in 1wk  │  24 h          │  rollback now
              ≥ 25%    │   patch in 24h  │  rollback now  │  rollback now
```

"Rollback now" = run `rollback.yml` (S-CI-022). The patch path is a
hotfix via `hotfix.yml` (S-CI-021).

## Communication

- **#releases-internal** in Slack: post status updates at T+1h, T+6h,
  T+24h regardless of whether things are quiet. Silence on a release
  thread means "I forgot to check", not "everything is fine".
- **GitHub issue thread on the release tag:** any user-visible action
  (rollback, hotfix announcement) gets a comment here so users following
  the tag are notified.
- **Status page** (status.markspread.app): only updated for
  rollback-or-worse events. Cosmetic regressions don't warrant a public
  status entry.

## Hand-off checklist (T+24h)

- [ ] Crash rate within healthy range for the last 6 h
- [ ] No open `regression` issues without an owner
- [ ] Updater feed hit-rate stable
- [ ] Final post in #releases-internal: "<release> 24 h handover —
      crash-free X.X%, downloads N, issues M (M-resolved); promoting
      to monitoring-rotation"
- [ ] If a patch is queued, it has a tracking issue and a target ETA
