# LLM starter prompt — recreate the `mermaid` sample plugin

Paste this verbatim into the ChatShell to ask the agent to scaffold the
mermaid plugin from scratch.

---

> Scaffold a Markspread plugin called `mermaid` that registers a codeblock
> hook for the language `mermaid`. Until I bring in `mermaid.js` myself,
> stub the renderer with a `<div class="ms-mermaid-stub">[mermaid:
> <escaped-source>]</div>` placeholder so I can see the block is being
> intercepted. No network, no fs permissions. Use the standard
> `host:init` → `plugin:ready` → `hook:invoke` → `hook:result` protocol.
> Drop the result in `~/.markspread/plugins/mermaid/`, then reload the
> host.

The agent should call `scaffoldPlugin({ name: "mermaid", kind:
"codeblock", key: "mermaid", hint: "Render mermaid diagrams" })`,
show the draft in the Plugin Author Panel, then call `installScaffold`.
