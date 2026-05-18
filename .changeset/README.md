# Changesets

Markspread uses [changesets](https://github.com/changesets/changesets) to decide
the next version on every release. The flow:

1. Open a PR that changes user-visible behaviour.
2. Run `pnpm changeset` and answer the prompts (which packages, what bump).
   That writes a markdown file under `.changeset/<random-name>.md` with a
   summary that lands in the changelog.
3. Commit + push. CI checks (`changesets-required`) verify a `.md` file is
   present unless the PR carries the `no-release-impact` label.
4. When a maintainer merges to `main`, the **Version Packages** workflow
   opens a PR that bumps versions + concatenates the summaries into
   `CHANGELOG.md`. Merging that PR tags the repo and triggers the
   release pipeline (`release.yml`).

## Bump policy

- `patch` — bug fix, doc-only change, dependency bump that doesn't change
  behaviour.
- `minor` — new feature, new API, anything users would notice in release
  notes.
- `major` — backward-incompatible change. The release notes must include a
  migration paragraph, and the PR must add a `breaking` label.

## When you don't need a changeset

PRs that only touch infra (`.github/`, `e2e/`, internal dev scripts), tests,
or documentation can skip the changeset by attaching the `no-release-impact`
label. The CI gate honours that label.
