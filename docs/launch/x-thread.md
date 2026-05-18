# X / Mastodon launch thread

The thread is identical on X and Mastodon, with two differences:
on Mastodon each post can be 500 chars, so the chunking is gentler;
on X we hold to ~270 chars per post so screenshots aren't truncated
on the timeline. We post both simultaneously from the same maker
account.

## When

- X: Tuesday 09:30 ET (30 minutes after the HN post — gives early
  HN visitors a thread to share without making the HN thread look
  brigaded).
- Mastodon: same time on `mastodon.social/@markspread`. We do not
  cross-post to Threads or Bluesky on launch day; one of those gets
  a hand-written follow-up the day after.

## Thread structure

Eight tweets. The first tweet carries the demo video as a native
upload (not a link to a YouTube embed — autoplay is the point).

### 1/8 — opener
```
Markspread 1.0 is out.

A markdown editor where the preview pane is the *exact CSS* your
site publishes — no more "looks fine in editor, broken on the blog".

Open source, MIT, on macOS / Win / Linux:
markspread.dev

[60s demo video, captions on]
```

### 2/8 — spread pane
```
The spread pane isn't a generic preview.

It loads your site's CSS into a sandboxed iframe and renders the
document with the styles you'll actually publish. Resize, switch
themes, swap CSS — both panes track in real time.

[gif: spread pane reflowing on resize]
```

### 3/8 — AI on user keys
```
AI is opt-in and runs against your provider key.

The key sits in your OS keychain. Requests go from your machine
straight to the provider. We never see your prompts and we are not
a relay.

Local models (Ollama, llama.cpp) work offline.

[screenshot: keychain access showing the entry]
```

### 4/8 — privacy posture
```
Telemetry is off by default.

If you opt in, the rotating-client ID changes weekly and is salted —
we cannot tie two weeks' data to the same person.

There are no user accounts because there is nothing to log into.

[link: privacy policy]
```

### 5/8 — performance
```
Native, not Chromium.

Cold start: ~220 ms on a 2024 MacBook Air.
Idle RAM: ~85 MB.
Installer: 18 MB.

It feels like an editor, not a browser pretending to be one.

[screenshot: Activity Monitor side-by-side vs Electron-based peers]
```

### 6/8 — plugins
```
The marketplace is open.

Plugins run sandboxed in a separate renderer with explicit
filesystem and network scopes. The "Verified" badge is awarded by
the maintainers; you can also publish unverified plugins from the
CLI.

Authors: hello at markspread.app
```

### 7/8 — open source
```
MIT, releases are reproducible from a public commit SHA, signed by
a Yubikey we keep in a safe.

Ed25519 update signatures, EV codesigning on Windows, Apple
Notarisation on macOS, GPG-signed tarballs on Linux.

Everything is on GitHub:
github.com/markspread/markspread
```

### 8/8 — close
```
Built by a small team that ships software for a living.

If you give it a real try, please tell us what breaks. Issues,
Discussions, or replies here all reach the same group.

Download → markspread.dev
Source → github.com/markspread/markspread
```

## Mastodon variant

On Mastodon, posts 1–8 expand by ~50% length each because the
character budget is bigger and the audience prefers fewer, fuller
toots. The Mastodon version of post 3 explicitly cites the relevant
sections of the privacy policy with anchors. Otherwise identical.

## During the day

The maker pins post 1 to the profile, replies to **every** quote
tweet that has more than two likes, and bookmarks anything specific
that should fold into the FAQ. We avoid:

- Vague-tweeting at competitors.
- Begging for retweets.
- Quote-tweeting our own thread to "boost" it.

## Repurpose

The thread copy is not reused inside the blog post; HN/PH/Reddit
versions are written separately so each platform gets the tone its
audience expects.

## Followups

The launch retrospective (S-LCH-011) reports impression counts,
follower delta, and the three quote-tweets that taught us something.
That data feeds the next launch's thread structure.
