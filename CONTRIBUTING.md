# Contributing to Markspread

Thanks for considering a contribution. This document covers the
mechanical bits — how to sign a commit, where to file an issue, what
the CI expects. The architectural rationale lives elsewhere
(`docs/ARCHITECTURE.md`); this file is the checklist a first-time
contributor needs to land their first PR without surprises.

## Before you start

- For anything more than a typo or one-line bug fix, **open an issue
  first**. We'd rather negotiate the design before you write code.
- Search existing issues and the [roadmap](https://markspread.dev/roadmap/) —
  a lot of obvious next steps are already on someone's plate.
- For security issues, do **not** file a public issue. Follow
  [`SECURITY.md`](./SECURITY.md).

## Developer Certificate of Origin (DCO)

We do not ask contributors to sign a Contributor License Agreement.
We use the [Developer Certificate of Origin](https://developercertificate.org/)
instead — a one-line attestation that you wrote the patch (or have
the right to submit it) and are happy to ship it under the project
licence (MIT).

Sign every commit by adding a trailing line:

```
Signed-off-by: Real Name <you@example.com>
```

The easiest way is `git commit -s` — git fills the line in for you,
using the name and email from your local git config. The name must be
a real name (not a handle), and the email must be one you can receive
mail at.

The CI rejects pull requests with unsigned commits. To fix an
existing branch, either amend (`git commit --amend -s`) for a single
commit or rebase (`git rebase --signoff main`) for several. We
deliberately do not auto-add the line on merge — the sign-off has to
come from you, otherwise it isn't an attestation.

The full DCO text is reproduced below for convenience; the canonical
version is at <https://developercertificate.org/>.

> By making a contribution to this project, I certify that:
>
> (a) The contribution was created in whole or in part by me and I have
>     the right to submit it under the open source license indicated in
>     the file; or
>
> (b) The contribution is based upon previous work that, to the best of
>     my knowledge, is covered under an appropriate open source license
>     and I have the right under that license to submit that work with
>     modifications, whether created in whole or in part by me, under the
>     same open source license (unless I am permitted to submit under a
>     different license), as indicated in the file; or
>
> (c) The contribution was provided directly to me by some other person
>     who certified (a), (b) or (c) and I have not modified it.
>
> (d) I understand and agree that this project and the contribution are
>     public and that a record of the contribution (including all
>     personal information I submit with it, including my sign-off) is
>     maintained indefinitely and may be redistributed consistent with
>     this project and the open source license(s) involved.

## Development setup

```bash
pnpm install
pnpm dev              # Tauri dev shell (hot-reloads frontend + Rust)
pnpm test             # vitest run
pnpm typecheck        # tsc --noEmit
pnpm lint             # biome check
```

Rust-side tests: `cargo test --manifest-path src-tauri/Cargo.toml`.
End-to-end: `pnpm e2e` (Playwright; needs a built dev binary).

## Pull request checklist

Before requesting review:

- [ ] The change is described in the PR body, with a "why" not just
      a "what".
- [ ] Every commit has `Signed-off-by`.
- [ ] Tests added for new behaviour; existing tests still pass
      locally.
- [ ] No new lint warnings (`pnpm lint`).
- [ ] User-visible strings go through `i18next` (`pnpm i18n:check-hardcoded`
      passes).
- [ ] If you added an IPC command, it has a TS wrapper in `src/lib/`
      and the command name follows `<area>.<verb>` — see
      `docs/ARCHITECTURE.md`.
- [ ] Public-facing documentation updated, if applicable.

## Commit messages

Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
`test:`). The body explains *why* the change is needed; the diff
shows *what* changed. Keep the subject under 72 characters.

The `Signed-off-by` line goes after the body, separated by a blank
line:

```
fix(editor): debounce paragraph reflow on slow input

Without this debounce, holding a key on a 30k-line document caused
the spread pane to recompute on every keystroke, dropping frames.

Closes #1234.

Signed-off-by: Real Name <you@example.com>
```

## Code review

We aim for a first-pass response within two business days. Reviews
default to "block on questions, ship on convergence" — if a reviewer
leaves a comment without explicitly blocking, treat it as a
recommendation you can decline with reasoning.

The release manager merges; contributors do not self-merge except for
their own typo fixes when CI is green.

## Code of Conduct

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).
Report issues to <conduct@markspread.app>.
