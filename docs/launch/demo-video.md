# 60-second launch demo — script and shot list

This is the script for the launch video. The video itself ships at
`markspread-landing/public/launch/demo.mp4` (1080p) and
`demo.webm` (vp9) with `demo.poster.avif`. Captions ship as
`captions/demo.en.vtt` and `captions/demo.ko.vtt`; the
`<video>` tag on `/download` and `/blog/hello-markspread` references
both tracks.

## Goals

- Land the elevator pitch in under 15 seconds.
- Show the spread pane scrolling in sync — the *one* feature people
  remember.
- Demo an AI action that runs against a key the viewer can see is
  in the keychain, not on a server.
- Get to a download URL before the viewer scrolls past.

The video is short on purpose. We don't need to show every feature;
the docs do that.

## Length

| Section                 | Time     | Cumulative |
|-------------------------|----------|------------|
| Cold open + logo        | 0:00–0:03 | 0:03      |
| Spread pane sync demo   | 0:03–0:18 | 0:18      |
| AI "improve" inline     | 0:18–0:32 | 0:32      |
| Plugin install (1-shot) | 0:32–0:42 | 0:42      |
| Open source / privacy   | 0:42–0:52 | 0:52      |
| CTA + URL               | 0:52–1:00 | 1:00      |

## Shot list

### 0:00–0:03 — cold open
Black to logo wipe. Wordmark appears, no tagline. Subtle rise SFX.

### 0:03–0:18 — spread pane
- Open document `welcome.md` in a clean workspace.
- Type a heading; right pane scrolls in sync.
- Resize the window from 1280×800 down to 900×600 — both panes
  reflow without flicker.

**Voiceover (en)**: "Markspread is a markdown editor with a synced
spread pane — write on the left, see exactly what publishes on the
right."

**Voiceover (ko)**: "마크스프레드는 동기화된 스프레드 패널이 있는
마크다운 에디터입니다. 왼쪽에 쓰면 오른쪽에 그대로 게시됩니다."

### 0:18–0:32 — AI improve
- Highlight a paragraph.
- Cmd-K → "Improve writing".
- Diff overlay slides in; accept with Enter.
- Cut to the keychain entry being shown in macOS Keychain Access —
  the API key lives there, not on a server.

**Voiceover (en)**: "AI runs against your own provider key. It lives
in your OS keychain. We never see your prompts."

**Voiceover (ko)**: "AI는 사용자의 프로바이더 키로 동작합니다. 키는
OS 키체인에 저장되며, 우리는 프롬프트를 볼 수 없습니다."

### 0:32–0:42 — plugin install
- Cmd-Shift-P → "Install plugin".
- Pick "Mermaid Diagrams" from the list.
- Insert ` ```mermaid ` block; right pane renders the diagram live.

**Voiceover (en)**: "Plugins extend the editor. Sandboxed, signed,
removable in one click."

**Voiceover (ko)**: "플러그인으로 에디터를 확장하세요. 샌드박스에서
서명되어 동작하며 한 번에 제거할 수 있습니다."

### 0:42–0:52 — open source / privacy
- Show GitHub stars counter.
- Cut to terminal: `pnpm install && pnpm build` produces a binary
  whose hash matches the published release.

**Voiceover (en)**: "Open source under MIT. Reproducible builds.
Telemetry off by default."

**Voiceover (ko)**: "MIT 오픈소스. 재현 가능한 빌드. 텔레메트리는
기본적으로 꺼져 있습니다."

### 0:52–1:00 — CTA
- "markspread.dev" appears centered.
- Short tag: "Free for everyone. macOS, Windows, Linux."

**Voiceover (en)**: "Markspread one-oh — at markspread.dev."

**Voiceover (ko)**: "마크스프레드 1.0 — markspread.dev."

## Production notes

- 1080p / 60fps, captured from a 14" MacBook Pro running the release
  build at the v1.0.0 tag.
- Cursor highlighting on; click effects off (they distract on
  trackpads).
- No music for the first 60 seconds. We can add a music-bed cut
  later for social autoplay environments.
- Captions are required, not optional. The video must convey the
  pitch with audio off.

## Captions

The two `.vtt` files live next to the video and get loaded as
`<track kind="subtitles">` elements. Translation parity is enforced
by `pnpm i18n:check-vtt-parity` (timecodes must match line-for-line).

## Where it embeds

- `/` (landing) — autoplay muted, replay on click.
- `/download` — paused with poster, plays on click.
- Blog post `hello-markspread.md` — embedded after the lede.
- README on GitHub — preview.gif (≤2 MB) generated from the first
  18 s, since GitHub does not embed video.
