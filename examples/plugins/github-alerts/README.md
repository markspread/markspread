# github-alerts (sample plugin)

Render `:::note`, `:::warning`, `:::tip` custom fences as GitHub-style
callouts.

## What it does

```md
:::note
Heads up — this is a note.
:::

:::warning
Don't do that.
:::

:::tip
Here's a hint.
:::
```

Each fence becomes a styled `<div>` with a coloured left border matching
GitHub's UI conventions.

## Install

1. Copy `examples/plugins/github-alerts/` to
   `~/.markspread/plugins/github-alerts/`.
2. Reload Markspread.
3. Open any `.md` with a `:::note` fence.

## Permissions

None. Pure-Worker plugin — no network, no fs. Plain string transforms
only.

## Why this is the simplest sample

It is the canonical "first plugin": no parsing, three fence names mapped
to colour + label, output is one `<div>`. If you are learning the plugin
API, read this one first.
