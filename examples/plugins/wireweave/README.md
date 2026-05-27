# wireweave (sample plugin)

Render ```wireweave fenced code blocks as inline SVG wireframes. A
purposefully tiny DSL — boxes + arrows, nothing else.

## What it does

````md
```wireweave
[Login]
[Home]
[Profile]
Login -> Home
Home -> Profile
```
````

Renders a row of rectangles connected by arrows.

## Grammar

| Line              | Meaning                                            |
| ----------------- | -------------------------------------------------- |
| `[label]`         | Declare a box. Duplicates are folded.              |
| `A -> B`          | Draw an arrow from box `A` to box `B`. Both boxes are auto-declared if missing. |
| anything else     | Silently ignored — keeps drafts forgiving.         |

### Limits

- Up to 32 chars per label.
- Boxes lay out in a single horizontal row; no automatic routing.
- No nested groups, no styles, no labels on arrows. (Submit a follow-up
  plugin if you need them — wireweave is intentionally small.)

## Install

1. Copy `examples/plugins/wireweave/` to `~/.markspread/plugins/wireweave/`.
2. Reload Markspread.
3. Paste the example above into a `.md` file.

## Permissions

None. Pure-Worker plugin — no network, no fs.
