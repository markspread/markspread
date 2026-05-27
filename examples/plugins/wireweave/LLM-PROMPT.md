# LLM starter prompt — recreate the `wireweave` sample plugin

Paste this verbatim into the ChatShell.

---

> Scaffold a Markspread plugin called `wireweave` that registers a
> codeblock hook for the language `wireweave`. The grammar is:
>
> - `[label]` declares a rectangle.
> - `A -> B` draws an arrow from box `A` to box `B` (auto-declaring
>   missing boxes).
> - Other lines are ignored.
>
> Render the result as a single inline `<svg>` with rectangles, labels,
> and arrows (using a `<defs><marker>` for the arrowhead). No external
> dependencies. No network or fs permissions. Standard worker handshake.
> Add a README with the grammar table and an ASCII demo, then drop the
> folder into `~/.markspread/plugins/wireweave/` and reload.

Optional follow-up prompts:

> Make boxes lay out on two rows when there are more than 5 of them.

> Add an arrow label syntax `A -> B : "label"`.
