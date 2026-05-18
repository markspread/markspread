# Show HN packet

This is the submission for Hacker News. HN punishes everything that
reads like marketing copy, so the rules are simple: be specific, be
short, link to the thing itself, answer questions in the thread.

## Title

```
Show HN: Markspread – a markdown editor with a synced spread pane
```

Length: 64 chars. HN truncates at ~80, so we have headroom. We use
"Show HN:" because we want feedback; the prefix changes the kind of
thread we get (more product talk, less drive-by snark).

We submit the URL — `https://markspread.dev/` — not a blog post.
HN regulars prefer landing-on-product. The launch blog post lives
at `/blog/hello-markspread/` and is referenced by the first comment
for context.

## Posting time

Tuesday, 09:00 US Eastern. Rationale: catches both US-East morning
and European afternoon. The Korean evening overlaps so the maker
can be in the thread for the first 6 hours.

We do not re-submit if the first attempt does not gain traction; HN
allows it but the community judges harshly. If the timing was bad
we accept that and post the same URL again only after a meaningful
update (a 1.1 release with a fixable issue, for instance).

## First comment (the maker posts within 60 seconds)

```
Hi HN — I'm one of the maintainers.

The pitch in three sentences: Markspread is a Tauri-based markdown
editor whose preview pane renders the *exact CSS the published
site will use*, so what you see is what your blog/docs/MDN page
will publish — not "lorem ipsum styled". The AI features run
against your provider key, kept in the OS keychain, never proxied
through us. The whole thing is MIT, ~85 MB idle RAM, ~220 ms cold
start on a 2024 MacBook Air.

Architecturally interesting bits, in case you were going to ask:

- Editor: CodeMirror 6 with a custom decoration pipeline that
  re-uses the parser output for both the source view and the
  spread pane, so there is no double-parse.
- Preview: a sandboxed iframe per workspace; CSS the user supplies
  is namespaced and CSP-locked. Plugins run in their own
  sandboxed renderer, talked to over a MessagePort.
- AI: a thin gateway that does prompt redaction (paths, emails,
  API keys are scrubbed before sending) and a rolling cost meter.
  Local providers (Ollama, llama.cpp) skip the gateway entirely.
- Updater: Ed25519 signatures, the publisher key fingerprint
  baked into the binary at build time. No JS auto-update.

Source: https://github.com/markspread/markspread
Download: https://markspread.dev/download (macOS / Win / Linux)
Architecture writeup: https://markspread.dev/docs/architecture/

Honest list of things I'd push back on if I were reading this:

1. "Another markdown editor". Yes, but the spread pane is the
   actual hook — try it for 30 seconds and tell me if I'm wrong
   that the preview-CSS gap is annoying everywhere else.
2. "Tauri RAM claims sound aspirational." 85 MB idle is real on
   the bundle we ship today; once you open a 30k-line doc it's
   ~120 MB. Numbers in /docs/perf-budget if you want to call BS.
3. "The Obsidian crowd will hate this." Probably. We are not
   competing with vault-shaped products; the editor is the whole
   product.

I'll be in the thread for the next 6 hours. Genuine criticism is
more useful than upvotes — please tell me what's wrong.
```

The comment is intentionally long because HN's culture is "show me
the substance". Long comments perform better here than they would
on Twitter.

## What the maker does in the thread

- Reply to every top-level comment, even the dismissive ones, with
  one paragraph that engages the actual point.
- Concede when the critic is right. Specific concessions read as
  honesty; vague "good point, we'll think about it" reads as
  marketing.
- Link to source files when an architecture question comes up. HN
  rewards "here is the line that does this".
- Avoid: emoji, exclamation marks, "love it!", "great question!".
  HN punishes positivity inflation.

## Anticipated questions

The maker prepares one-paragraph answers in advance. Themes we
expect:

- "Tauri's webview surface is a security nightmare" — discuss the
  CSP, the sandboxed plugin renderer, and the fact that we don't
  enable the dangerous Tauri APIs.
- "Why not Electron / Qt / GTK / native?" — explain the trade-off:
  binary size, deployment story, and that we share the editor
  backend with `markspread-cli`.
- "I'd rather use vim + pandoc" — say that's perfectly reasonable
  and explain who Markspread *is* for.
- "Open core?" — no. The marketplace is open; we don't sell paid
  features.
- "VC-backed?" — no, self-funded; sponsorships welcome through GH.
- "Dark patterns / telemetry / 'AI is data harvesting'" — point at
  the privacy policy, the telemetry-off-by-default code path, and
  the keychain demo.

## Where this packet lives

- This file (`docs/launch/show-hn.md`) is the script.
- Maker keeps a side-by-side terminal open during the launch with
  the answers to anticipated questions ready to paste.
- After the thread cools, the highlights are folded into
  `/docs/faq/` so the next person asking gets the same answer.

## Followups

We do **not** spam the thread with marketing tweets. The launch
retrospective (S-LCH-011) reports HN's actual numbers (rank, time
on front page, comment count) along with the three most useful
threads of feedback.
