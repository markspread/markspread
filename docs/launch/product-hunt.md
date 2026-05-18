# Product Hunt launch packet

This document is what the maker submits to Product Hunt the night
before launch. Everything here lives in the doc so it is reviewable
and reusable; nothing should be improvised on the form.

## When

PH listings reset at 00:01 PT. We submit the night before with a
**scheduled** launch on Tuesday. Rationale: weekend launches see
fewer hunters online; Mondays compete with weekend backlog; Tuesday
gives us 24 honest hours of attention.

We do **not** double-submit on a different day if the first one
flops. PH's algorithm penalises that and we would rather take the
result.

## Who

| Role            | Person                  | What they do                          |
|-----------------|-------------------------|---------------------------------------|
| **Hunter**      | Reach out to a top-50 hunter who has a track record with developer tools. Confirmed: TBD. | Submits the listing, posts the first comment. |
| **Maker**       | Lead maintainer (`@swlee`) | Tagged on the listing. Replies to top comments. |
| **Co-makers**   | Three maintainers most active in the past quarter | Tagged so PH credits the team rather than one person. |

If we cannot land a top-50 hunter by T-7, the maker self-submits.
The "no hunter" path costs about 30% of opening-hour upvotes by our
estimate, but is recoverable.

## Listing copy

### Tagline (60 char limit)

> Markdown editor with a synced spread pane and on-device AI.

Backup taglines (in case the first reads too dry to the hunter):

- Markdown that previews as your published site, not as Lorem.
- Local-first markdown editor. Your AI keys, your machine.
- The markdown editor that respects your provider key.

### Description (260 char limit)

> Markspread is an open-source markdown editor with a synced spread
> pane that shows exactly what publishes — not a generic preview.
> AI runs against your provider key, stored in the OS keychain.
> Plugins are sandboxed. macOS, Windows, Linux. MIT.

### Topics

`Developer Tools`, `Productivity`, `Writing`, `AI`, `Open Source`.
Avoid `Note Taking` — that bucket is crowded and not who we are.

## Gallery (6 images + 1 video)

| Slot | Asset                                                    | Notes                              |
|------|----------------------------------------------------------|------------------------------------|
| 1    | `gallery/1-spread-pane.avif` (1280×800)                  | Hero shot. The spread pane open.   |
| 2    | `gallery/2-ai-improve.avif`                              | Inline AI diff overlay.            |
| 3    | `gallery/3-keychain.avif`                                | Keychain Access showing the key.   |
| 4    | `gallery/4-plugin-install.avif`                          | Plugin marketplace dialog.         |
| 5    | `gallery/5-cli.avif`                                     | Terminal: `markspread render` pipeline. |
| 6    | `gallery/6-three-os.avif`                                | macOS, Win, Linux side by side.    |
| Video| `launch/demo.mp4`                                        | The 60s asset from S-LCH-003.      |

All images shipped at AVIF + PNG fallback. PH compresses uploads;
upload at 2× the listing display dimensions to survive that pass.

## First comment script

The hunter posts this within five minutes of the listing going live.
The maker replies under it.

```
Hi PH! 👋

This started as a half-day prototype because every markdown editor
either showed a generic preview or owned my notes in a custom vault.
Markspread is the answer to that frustration: the right pane is
*your* CSS, no surprises at publish time, and your AI key never
leaves the OS keychain.

Three things people seem to like:

- It boots in ~220 ms (it's a real native app, not Chromium).
- Plugins are sandboxed; the marketplace verifies the manifest.
- It's MIT, releases are reproducible, and signed.

Available for macOS, Windows, and Linux. Free. No account needed.

Maker is @swlee — happy to answer anything.
```

The maker reply is shorter:

```
Hi all — happy to answer questions about the architecture, the
threat model, where AI fits, or "but what about Obsidian / iA / Bear".
Genuine feedback is more useful than upvotes; please tell us what
breaks.
```

## Anticipated questions and stock answers

The maker prepares one-paragraph answers to these before launch and
keeps them in a private snippet. Publishing the questions here so
the answers can be reviewed and updated.

1. "How is this different from <Obsidian/iA/Bear/Typora>?"
2. "Why MIT and not AGPL? Won't a cloud company fork you?"
3. "Where is mobile?"
4. "Will you ever add sync?"
5. "Does the AI work offline?"
6. "Why Tauri instead of Electron?"
7. "Is the marketplace audited? What stops a malicious plugin?"
8. "Roadmap?"

The answers live in `docs/launch/ph-faq.md` (private to maintainers
until we open-source the launch playbook itself).

## What we don't do

- **No upvote rings.** We do not ask employees, friends, or family
  who have never used the product to upvote. PH spots clusters and
  punishes them. Honest votes only.
- **No incentivising upvotes.** No "comment for a free thing" deals.
- **No deleting bad comments.** If a critique is wrong we reply; if
  it's right we agree. Disagreement is fine; deletion is not.

## Day-of timeline (PT)

| 00:01 | Listing goes live (scheduled). Hunter posts first comment by 00:05. |
| 00:30 | Maker tweet linking the listing. Mastodon mirror.            |
| 06:00 | Korean morning slot — GeekNews and Twitter-KR posts (S-LCH-008). |
| 09:00 | Western working hours. Maker active in comments through the day. |
| 18:00 | Maker writes a "thanks" comment whether we win or lose the day. |

## Post-launch

Within 48 hours, write the launch retrospective (S-LCH-011) with
the actual numbers (upvotes, comments, sign-ups, downloads) and the
top three themes from comment threads. The PH packet is updated for
the next major release based on what worked and what didn't.
