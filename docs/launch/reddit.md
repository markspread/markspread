# Reddit launch packet

Reddit's a tougher launch surface than HN or PH because each
subreddit has its own moderation culture and "looks like marketing"
gets removed without notice. We post in the subreddits where the
audience genuinely cares about the product, follow each one's rules
verbatim, and **never cross-post the same wording**.

## Universal rules

- **One subreddit at a time, spaced.** We do not blast five subs in
  ten minutes. The mod tools detect that pattern and the second post
  often gets removed by the time the third lands.
- **Read the rules before posting.** Most of these subs require a
  flair, prohibit "show off" titles, or only allow self-promotion on
  specific weekdays. We honour all of that.
- **Original screenshot per sub.** Reusing the PH gallery image is
  the fastest way to get flagged for marketing.
- **Maker is the OP.** No employee accounts upvoting. Real reddit
  accounts with comment history.
- **Reply to every comment in the first 12 hours.** This is what
  makes a launch thread cohere; ghosting kills momentum.

## Subreddit plan

### r/programming
- **When**: Tuesday 12:00 ET (after the HN front page wave subsides).
- **Format**: Link post to `https://markspread.dev/blog/hello-markspread/`.
- **Title**: `Markspread 1.0 – open-source markdown editor with a CSS-faithful spread pane (MIT, Tauri, Rust)`
- **Tone**: Engineering-leaning. Lead with the architecture writeup
  in the first comment.
- **Mod rules**: No "Show HN" prefixes; no Imgur albums; no clickbait.

### r/opensource
- **When**: Tuesday 14:00 ET.
- **Format**: Self-post.
- **Title**: `Markspread – MIT-licensed markdown editor for the AI era`
- **Body**: 4-paragraph version of the launch post emphasising the
  licence, reproducible builds, and the publishing-key flow.
- **Mod rules**: Self-promotion allowed; flair `Promotional` is
  required; one post per project per 30 days.

### r/markdown
- **When**: Tuesday 16:00 ET.
- **Format**: Link to `/`.
- **Title**: `Markspread: a markdown editor whose preview is the actual CSS your site publishes`
- **Tone**: Heavier on the spread-pane demo, lighter on architecture.
- **Mod rules**: Small sub; mods prefer comments to bare links.
  First comment from OP must add value.

### r/tauri
- **When**: Wednesday 10:00 ET.
- **Format**: Self-post.
- **Title**: `Show off: Markspread – a markdown editor we shipped with Tauri 2`
- **Tone**: Tauri-specific lessons learned. Crashes we hit, IPC
  patterns, plugin sandbox via custom protocol. Audience here is
  fellow Tauri builders, not end users.
- **Mod rules**: Showcase posts welcome on weekdays; flair `Showcase`.

### r/rust
- **When**: Wednesday 13:00 ET.
- **Format**: Self-post.
- **Title**: `Markspread, a markdown editor in Rust + Tauri – architecture writeup`
- **Tone**: Technical. Talk about the indexer, the parser, where we
  used unsafe (we didn't, in the host), the tradeoffs we made.
- **Mod rules**: Self-promo limited to one post per quarter per
  user; mods prefer architecture-focused content over marketing.

### r/coolgithubprojects (optional)
- Only if the launch goes well. A ".0" launch on day one looks too
  promotional here; pick a moment a week later when there is real
  user feedback to share.

## Subreddits we don't post in

- **r/SideProject / r/madewithlove / r/IMadeThis** — high churn,
  drive-by audience that doesn't convert and doesn't give useful
  feedback.
- **r/MachineLearning** — wrong audience; this isn't an ML
  contribution.
- **r/productivity / r/notes** — adjacent but the audience there
  expects vault-shaped products and we are not that.
- **r/writing** — wrong scope; people there discuss craft, not tools.

## Drafted bodies

The actual self-post bodies live in
`docs/launch/reddit-drafts/<sub>.md`, one file per sub. Each is
hand-edited; they are not generated from a template, because that
shows.

The drafts are reviewed by another maintainer before posting — same
rule as the rest of the launch packet.

## Failure modes

- **Removed by mods**: read the removal reason, fix it, ask the mod
  team via mail before resubmitting. We do not just repost.
- **Downvoted to oblivion**: that's the Reddit answer. We don't
  delete posts that didn't land. The downvotes are data; we record
  them in the retrospective.
- **Brigade accusation**: respond in the thread that we are not
  brigading and offer to share the launch packet (this file) so
  mods can see we played by the rules.

## Followups

The launch retrospective (S-LCH-011) lists the per-sub results
(upvotes, comments, top three pieces of feedback). Anything that
moderation pushed back on is fed into the next launch's rules
section.
