# LLM starter prompt — recreate the `github-alerts` sample plugin

Paste this verbatim into the ChatShell.

---

> Scaffold a Markspread plugin called `github-alerts` that registers
> three custom fence hooks: `note`, `warning`, `tip`. Each fence should
> render a `<div class="ms-alert ms-alert-<kind>">` with a coloured
> left border (blue for note, amber for warning, green for tip), a bold
> label, and the body text (newlines as `<br>`). No external
> dependencies, no network, no fs. Standard worker handshake.
> Output goes to `~/.markspread/plugins/github-alerts/`. Reload after.

Variants you can ask for next:

> Add a `caution` fence in red.

> Add an optional `[title]` syntax on the opening fence line.
