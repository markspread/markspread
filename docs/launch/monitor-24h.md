# Launch day — 24-hour monitoring

The first 24 hours after the v1.0.0 tag is the riskiest window in
the project's life. We staff a continuous on-call shift and we
rehearse the hotfix path before launch so we don't learn the rollback
flow under pressure.

## Coverage

We split the 24 hours into three 8-hour shifts so no one person is
on for the whole window. Two people overlap shift boundaries by 30
minutes for handoff.

| Shift                  | Owner   | Backup  | Hours covered                |
|------------------------|---------|---------|------------------------------|
| KST 16:00 – 00:00      | Maker A | Maker C | Korean evening + EU afternoon|
| KST 00:00 – 08:00      | Maker B | Maker A | US business hours            |
| KST 08:00 – 16:00      | Maker C | Maker B | EU morning + KR working day  |

Each owner is reachable on the maintainers' Slack and (separately)
by a phone number listed in `scripts/notify-oncall.sh`. Backup is
woken only if the owner does not acknowledge an alert within 5
minutes.

## What we watch

The pre-built dashboards are already linked from the bookmarks bar
(`scripts/bookmarks-launch.json`). The numbers we actually look at:

| Signal                      | Source                                            | Sane range          | Action threshold            |
|-----------------------------|---------------------------------------------------|---------------------|-----------------------------|
| Downloads (per OS)          | Cloudflare R2 access logs (real-time)             | rising              | sudden flatline = CDN issue |
| Updater pings               | `updates.markspread.dev` access logs              | climb steadily      | sharp drop = signing problem|
| Crash rate                  | Sentry, gated by user opt-in                      | < 0.1% of sessions  | > 0.5% triggers triage      |
| GitHub issues               | repo issue tracker, label `launch`                | trickle             | > 5/hr = look for a pattern |
| HN thread position          | hnrss + manual                                    | front page          | falling off = sustain or move on |
| PH ranking                  | producthunt API (rate-limited)                    | rising into top 5   | n/a                         |
| Status page                 | <https://status.markspread.dev>                   | green               | yellow → page on-call       |

We are not watching:

- Twitter likes / retweets — meaningless under load.
- HN comment-count alone — context-free.
- Any "active users" metric — telemetry is opt-in, the number is
  unreliable as a signal.

## Communication channels we answer

The maker on shift answers, in priority order:

1. GitHub issues labeled `launch` and any with `crash` in the title.
2. The Show HN thread (S-LCH-005) — every top-level comment.
3. PH and the X / Mastodon thread.
4. Reddit threads from S-LCH-006.
5. Korean community comments (S-LCH-008).
6. Direct support inbox `support@markspread.app`.
7. The press email queue.

Anything answered with "we'll look into it" gets a Clawket ticket
opened in the same minute. Verbal commitments without a ticket
disappear by hour 12.

## Hotfix decision tree

The release pipeline ships a "hotfix" lane (S-CI-021) that takes
~15 minutes from tag-push to signed installer in the update channel.
The decision of whether to use it during the launch window:

```
Is the bug we're seeing P0?
  - Crash on first launch (a > 1% slice)
  - Data loss on save
  - Update channel returning bad signatures
  - Public-facing privacy regression (e.g. telemetry on by default)

  YES → hotfix. The launch retrospective writes itself.
  NO  → log it, batch into v1.0.1 (max 7 days out).

Is the bug a P1 that hits a specific platform?
  YES + the platform is < 30% of installs → ship platform-specific
        update channel (S-UP-014).
  YES + the platform is the majority → treat as P0.

Is the bug a regression a single user reports without reproduction?
  → Ask for repro. Track in Clawket. Do not hotfix.
```

If a hotfix ships, the maker also:

- Writes a single-paragraph update at `notices.json` so the in-app
  updater shows a "We shipped 1.0.1 because…" message.
- Posts a thread reply (X, Mastodon) acknowledging the issue and
  the fix. No spin.
- Adds the bug to the launch retrospective (S-LCH-011) regardless
  of severity.

## Rollback

Rollback (yanking 1.0.0 from the update server) is more disruptive
than a hotfix but is the right move when:

- The release contains a malicious update vector.
- The signing key was compromised.
- A security advisory is being published right now.

The procedure is in `docs/INCIDENT_PLAYBOOK.md` (Step 3 → Editor
RCE / signing key leak). On launch day specifically:

- Mark v1.0.0 as `yanked` on the GitHub release.
- Update `updates.markspread.dev` to skip 1.0.0 and serve 1.0.1
  (the hotfix) as the current.
- Post a SEV-1 advisory using `docs/incident-templates/advisory.md`.
- Notify the press contacts who covered the launch.

We do **not** rollback for ordinary bugs. Rollback is a security
move, not a quality move.

## Handoff template

At every shift boundary the off-going maker pastes this into the
`#launch-monitor` Slack channel:

```
Handoff at <KST timestamp>.

Numbers:
  downloads/hr: <macos / win / linux>
  crash rate:   <%>
  open issues:  <count> (<count> labelled launch)
  HN position:  <rank>
  PH rank:      <rank>

Issues opened this shift:
  - #<n>: <one-line summary>  → <action>
  - …

Pending:
  - <thing>

Anything weird:
  - <observation>

Going off, picking up: <name>.
```

## End of 24-hour window

The shift owner at KST T+24 closes the window with a single message
to `#launch-monitor`:

> Launch monitoring window closed. <name> wrote up the 24h numbers
> in `docs/launch/monitor-24h-report-<date>.md`. Punchlist for
> v1.0.1 is in Clawket under unit LCH.

The on-call rota collapses back to the standard maintainer rotation
in `docs/INCIDENT_PLAYBOOK.md` after that message.

## Pre-launch dry-run

48 hours before launch, the on-call team does a dry run:

- Push a signed `v1.0.0-rc1` tag to the release pipeline.
- Watch the dashboards as the rc1 propagates.
- Trigger a fake P0 (override a noop crash to fire a Sentry alert)
  and walk the hotfix tree end-to-end.
- Tear it all down before launch.

If the dry run finds a missing dashboard, a stale on-call number,
or a broken alert, that itself blocks the launch.
