# Month-1 community plan

The first month after launch is when a project's community shape
gets baked in. We want a small number of well-run channels, not a
sprawl of half-staffed servers. The plan is:

- **GitHub Discussions**: the primary, async, indexed channel.
- **Discord**: real-time chat, but with intentional limits.
- **Plugin builders**: a private channel + a 30-day recruitment loop.
- **Contribution guide**: surfaced at every entry point; reviewed
  monthly.

We avoid: starting a Slack, a Telegram group, a Matrix room, a
subreddit, and a forum simultaneously. Pick two channels you can
staff well, ignore the rest.

## GitHub Discussions

Enabled on day one. Categories:

| Category          | Used for                                     | Pinned post |
|-------------------|----------------------------------------------|-------------|
| Announcements     | Maintainers post; community reads            | "How this category is used" |
| Q&A               | Help requests, answered with accepted answers| "Before you ask, the FAQ"   |
| Show and tell     | What people built                            | "Plugin showcase weekly"    |
| Ideas             | Feature ideas, with reactions for signal     | "Roadmap link"              |
| Plugin authors    | For people building or planning plugins      | "Author kickstart guide"    |

Maintainers respond to every Q&A post within 24 hours during the
first month. After day 30, that drops to 48 hours; community members
who answer well get a `Helper` flair.

## Discord

Server URL: `discord.gg/markspread`. We open it on launch day and
post the invite in the launch announcement.

### Channel layout (kept small)

```
# announcements         (maintainers only)
# general               (chat)
# help                  (mirrors GitHub Q&A)
# show-and-tell         (mirrors GitHub showcase)
# plugin-authors        (gated by role)
# ko-한국어              (Korean speakers)
# off-topic             (no rules; muted by default)
```

Two language channels (English + Korean). We do not pre-emptively
add Japanese, German, etc. — those open when the community size
asks for them.

### Rules

The same Code of Conduct that applies on GitHub applies on Discord.
Moderation is: warn, then 24-hour mute, then ban. Bans are public
in `#announcements` so the standard is visible.

### Bridges

We do **not** bridge Discord to a Matrix room, an IRC channel, or a
forum. Bridges look great on launch and break six months later when
nobody has cycles to maintain them.

## Plugin builder recruitment

The plugin marketplace ships with four first-party plugins. We need
five to ten community plugins by day 30 to make the marketplace feel
alive.

### How we find authors

- **Reach out to people we already know**: contributors to similar
  ecosystems (Obsidian, VS Code, neovim plugins). One DM, one
  paragraph, one link to the SDK readme.
- **Pin the "Plugin authors" Discussions category** at the top of
  the marketplace landing page.
- **Office hours**: a one-hour Discord voice channel every Friday
  16:00 KST for the first 4 weeks. We post the recordings (audio
  only, with consent) afterward.
- **Weekly showcase post**: every Friday, a maintainer writes a
  short post in `#show-and-tell` highlighting one plugin work-in-progress.

### What we offer plugin authors

- Early access to SDK changes via a `plugin-authors` GitHub team.
- A "First plugin" label that ships with the marketplace catalogue
  for the first month — not a quality endorsement, just visibility.
- Direct support: maintainer pairs with author on a plumbing issue
  if requested. We're not running a help desk; we're trying to
  unstick people who are 80% there.

### What we do **not** offer

- Money for plugins. The marketplace has no monetisation surface in
  v1; pretending otherwise is a setup for resentment.
- Exclusive features. The SDK API is the same one our first-party
  plugins use, no private hooks.

## Contribution guide rotation

`CONTRIBUTING.md` is the entry point for every code contributor. In
month one we:

- Link to it from the GitHub repo "About" sidebar, the Discussions
  pinned post, and the Discord `#help` topic.
- Run a "good first issue" pass on the issue tracker on day 14:
  every issue with `good-first-issue` label gets a 2-paragraph
  on-ramp comment ("the file you want is X; the test you should
  add is Y").
- Reserve 4 hours / week of one maintainer's time for first-time
  contributor PRs. The first review is high-touch; we mentor, we
  don't filter.
- DCO is enforced (S-LGL-006); the workflow tells the contributor
  exactly how to fix sign-off so the gate doesn't feel hostile.

## Cadence

Monthly community update post on `markspread-landing/blog`:

- Marketplace size delta.
- Top 3 community-merged PRs by impact.
- One spotlight on a plugin author or contributor.
- The next month's "what we're building".

The post replaces the noise of "weekly what we shipped" updates. We
write fewer, denser updates.

## What success looks like at day 30

- ≥ 5 community plugins in the marketplace.
- ≥ 20 GitHub contributors (commits or merged PRs).
- A weekend-pace Discord — busy enough to be alive, slow enough that
  one maintainer can read every channel before bed without burning
  out.
- The "good first issue" queue is replenishing — items added at
  least as fast as items closed.

If we hit those, we open up plans for month 2 (community-run
plugin showcase events, conference talk submissions, in-person
meetups). If we miss, we cut the ambition before adding more
channels.
