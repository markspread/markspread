# Press outreach plan

The press packet itself is published at
<https://markspread.dev/press/> (S-LND-016) and includes the
boilerplate, logos, screenshots, founder photos, and the elevator
pitch. This document is the outreach plan: who we email, when, with
what hook.

## Distribution rules

- We send **personal** emails. No press release blast. A blast that
  hits 200 inboxes wins zero coverage; ten well-targeted emails win
  two or three pieces.
- Each email mentions a specific piece by the journalist that made
  us pick them. If we cannot name a piece, we do not have a reason
  to email them.
- We honour **embargoes** when we offer them, and we offer them only
  to people who have a track record of honouring embargoes.
- We do not pay for coverage. We do not gift hardware to reviewers
  who are not on a publication's editorial team.

## Press list

The actual list lives in `docs/launch/press-list.csv` (private,
git-crypt'd). The columns are: `outlet, journalist, beat, hook,
last_piece_we_liked, contact_form_or_email, embargo_status`.

The shape of the list:

| Tier | Outlets we contact (typical)                                         | Embargo? |
|------|----------------------------------------------------------------------|----------|
| 1    | TechCrunch, The Verge, Ars Technica (developer-tooling beat)         | Yes      |
| 2    | Hacker News (we don't email; just submit per S-LCH-005)              | n/a      |
| 3    | Specialised: ZDNet, IT조선, ITWorld 한국, Linux Magazine, opensource.com | Yes if asked |
| 4    | Newsletters: tldr.tech, Pointer, Console.dev, JS Weekly, Rust Weekly | No (newsletters publish on their cadence) |
| 5    | YouTubers / streamers in the developer-tools niche                   | Hardware or screencast review copies on request |

Tier-1 entries get personalised emails 7 days before launch.
Tier-3 the day before. Tier-4 newsletters get a single submission
through their public form on launch day.

## Email template (Tier-1 / Tier-3)

We adapt every email; the template below is a checklist of pieces
that should be in the final version.

```
Subject: Markspread — open-source markdown editor with on-device AI (launching <date>)

Hi <name>,

I read your <date> piece on <topic> — the bit about <specific
detail> stuck with me, and it's part of why I'm reaching out.

We're shipping Markspread on <launch date>. In one paragraph: it's
an MIT-licensed Tauri 2 markdown editor whose preview pane uses your
site's actual CSS (not a generic stylesheet), and whose AI features
run against your provider key, kept in the OS keychain. The whole
project is reproducible from a public commit SHA, signed at release
time.

I think there's a story here for you because <one sentence about
why this fits their beat — local-first, AI privacy posture,
cross-platform Tauri shipping, etc.>.

Can I send you a build a few days early under embargo? The press
kit is at https://markspread.dev/press/ in the meantime.

Happy to answer any questions.

— <name>, maintainer
```

The template avoids:

- Adjectives like "revolutionary", "next-generation", "game-changer".
  Journalists strip these immediately and remember which sources
  use them.
- Word-count-padding social niceties beyond the opener.
- Attached PDFs. The press kit is web-hosted; nobody opens
  attachments from cold-emails.

## Embargo terms

If a journalist accepts an embargo, the deal is:

- We send them a build, the press kit URL, and a maker contact 5–7
  days before launch.
- They publish no earlier than the launch hour (00:01 PT).
- If the embargo leaks (one piece goes early), the embargo is
  globally void and we tell every other journalist in the embargo
  group immediately.
- If they end up not running the piece, no hard feelings. We do not
  pull future builds from them as retaliation.

## Korean press

한국 매체는 별도 트랙으로 관리한다:

- IT조선, ZDNet Korea, 디지털타임스 — Tier 3 와 동등 처리.
  연락은 한국어 메일.
- ITWorld 한국 / 마이크로소프트웨어 — 기술 리뷰 가능. 영문 빌드
  + 한국어 보도자료 동봉.
- 개인 블로거 (커널 / 깃 / 오픈소스 분야) — 외주 검토 빌드 무상
  제공 가능, 단 리뷰가 호의적이어야 한다는 조건 절대 걸지 않음.

한국어 보도자료는 `docs/launch/press-release.ko.md` 에 별도 작성
(영문판은 `press-release.en.md`).

## Tracking

The maker fills in `press-list.csv` with the response status
(`sent`, `replied`, `published`, `declined`, `silent`) per row.
After launch, the retrospective (S-LCH-011) records:

- Coverage that ran (with link).
- Inbound that surprised us.
- Sources that ghosted, with hypotheses about why.

The list is reused for the next major release; we do not re-pitch
the people who declined unless something materially new is shipping.

## What we don't do

- **No PR firm.** Coverage from a PR firm reads like a PR firm.
- **No exclusive first.** Offering one outlet a 24-hour exclusive
  burns every other outlet that finds out.
- **No retaliation.** If a piece is critical, we engage with the
  criticism in writing (and link the piece from our own blog if
  it's a fair critique). Future builds still go to the same
  reviewer.
