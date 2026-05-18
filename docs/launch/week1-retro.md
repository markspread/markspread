# Week-1 retrospective and v1.0.x plan

The first week of v1.0.0 in the wild teaches us more than the entire
beta did. This document is the template for the retro we run on
**day 7** and the plan for the v1.0.x patch we ship by **day 10**.

The dates are commitments, not aspirations. Slipping the retro is
acceptable; slipping the patch isn't, because users hit bugs
expect a fix in a week, not a quarter.

## Day-7 retrospective — agenda

A 60-minute meeting on day 7. Maintainers only; we publish a
sanitised version externally a day later.

### Agenda

1. **Numbers** (10 min). The shift logs from S-LCH-010 are already
   filed. We read them out — downloads per OS, crash rate, top 10
   GitHub issues by reaction count, retention of `installId` (i.e.
   how many of day-1 installs are still pinging by day 7).
2. **What we got wrong** (15 min). Each maintainer names one
   specific thing — a bug, a doc gap, a comment we mishandled. No
   round-robin politeness; specific incidents only.
3. **What we got right** (10 min). Same format. We need this for
   morale and to know which patterns to keep.
4. **Patch shortlist** (15 min). Convert the issue tracker into a
   priority-ordered list using the rubric below. Output is a
   Clawket cycle scoped at v1.0.1.
5. **External communication** (10 min). What we say in the
   "after one week" blog post and the patch release notes.

### Outputs

- `docs/launch/retro-<launch-date>.md` (this file's evolution).
- A Clawket cycle `v1.0.1` with each item sized.
- A Slack/Mastodon thread linking to the retrospective.

## Issue triage rubric

For every GitHub issue opened in the first week, assign exactly one
column:

| Column            | Definition                                                              | Patch slot |
|-------------------|-------------------------------------------------------------------------|------------|
| **must-fix**      | Crashes, data loss, broken updates, security regressions                | v1.0.1     |
| **annoying**      | Workflow-breaking on a common path. Frequent and named.                 | v1.0.1 if cheap, else v1.1 |
| **niche**         | Edge case affecting a small slice. Real bug.                            | v1.1       |
| **future**        | Reasonable feature request. Not a bug.                                  | roadmap     |
| **declined**      | Out of scope, will not implement                                        | closed with rationale |

The rubric is applied by a single maintainer in one sitting.
Disagreements get re-triaged in the retro; the queue does not stall
on consensus.

## v1.0.1 ship rules

- **Patch only**: bug fixes that meet the must-fix column. No
  features. No refactors.
- **Date**: tagged on day 8, landed in the update channel by day 10.
- **Process**: every PR rebased on the v1.0.0 tag, not on `main`.
  This avoids accidentally bringing post-launch refactors into a
  patch.
- **Tests**: every fix has a regression test. Period. We did not
  catch the issue the first time; the test ensures we catch it
  next time.
- **Notes**: the release notes call each fix by GitHub issue
  number and credit the reporter (with permission).
- **Signing + 3-OS smoke**: same gates as v1.0.0. The launch checklist
  applies even to a patch.

## v1.0.2 placeholder

If issues that were "annoying" but cheap to fix accumulate during
v1.0.1's window, we ship v1.0.2 a week later (day ~17). We do not
let "annoying" linger past v1.1.

## Public retrospective

A day after the internal retro, the maintainers publish the public
version at `markspread-landing/src/content/blog/week-one.md`.

It includes:

- **Honest numbers**. Downloads per OS, crash rate, the top three
  things people asked about. We do not selectively cite. If we
  underperformed expectations, we say so.
- **Three things we got wrong**. The specific incidents from the
  retro, with what we did about them. The blog is *how* we held
  ourselves accountable; vague "we hear you" entries don't count.
- **Three things we're shipping**. The v1.0.1 changelog in plain
  language, plus a date.
- **Thanks**. Reporters by name (or handle, with permission).
- **What's next**. A pointer to the public roadmap.

The blog post does not ask for upvotes, retweets, or any other
engagement. It exists to keep the contract honest.

## Anti-patterns

These are how a launch turns sour, in our experience:

- **Hotfix-fatigue**: shipping v1.0.1, .2, .3, .4 in week one. The
  must-fix column is small *because* we want one stable patch, not
  five panicked ones. If the column is huge, we revisit whether
  v1.0.0 should have shipped.
- **Roadmap-pivot**: rewriting the public roadmap because of one
  loud thread. Loud is not the same as representative. The retro
  reads the comment counts before the roadmap moves.
- **Ghost the critic**: we reply to every substantive critique even
  if we disagree, and we link the disagreement from the retro.

## Signoff

Releases manager signs:

```
v1.0.1 retro:    YYYY-MM-DD
v1.0.1 tagged:   YYYY-MM-DD
v1.0.1 in update channel: YYYY-MM-DD
Public blog:     <url>
Retro doc:       docs/launch/retro-YYYY-MM-DD.md
```

If any of those slip, the slip itself goes into the next retro.
