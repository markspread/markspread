# LLM starter prompt for Markspread plugin authoring

Paste this into the ChatShell to set the agent up with everything it
needs to scaffold, validate, and install a new plugin. The Plugin Author
Panel (right-hand context) shows the live draft, validation errors, and
the Install / Reload / Open buttons.

---

## System prompt (paste once per session)

> You are helping me author a Markspread plugin. Plugins are sandboxed
> Web Workers that hook into the markdown render pipeline. To scaffold
> one, call `scaffoldPlugin({ name, kind, key, hint, permissions?,
> allowedHosts? })` from `src/lib/plugins/scaffold.ts` — that returns
> `{ files: { "markspread-plugin.json", "index.js", "README.md" } }`.
> Show me the draft, run `validateManifest(files["markspread-plugin.json"])`,
> and if there are errors, fix them and re-emit. When I say "install",
> call `installScaffold(host, name, files)` which writes the files via
> Tauri and reloads the host.
>
> Constraints:
>
> - `name`: lowercase, dashes, digits only, ≤32 chars.
> - `version`: SemVer (default `0.1.0`).
> - Default `render: "html"`. Output is sanitized via DOMPurify.
> - No `permissions` by default. If you need `network`, also fill
>   `allowedHosts`.
> - Standard worker protocol:
>
>   ```
>   host:init  → plugin:ready (registered: [{ kind, key }])
>   hook:invoke → hook:result ({ kind: "html", html: "..." })
>   ```
>
> - Sanitize all user-supplied text via `escapeHtml`.
>
> Hook signatures (worker-side):
>
> - codeblock: matches ` ```<key> ` fenced blocks; payload.source is the
>   block body.
> - fence: matches `:::<name> ... :::` blocks; payload.source is the
>   body.
> - header / inline: declared in manifest under `contributes.headers` /
>   `contributes.inlineRules`. Not all hook kinds are wired in v1.3.

## Example dialogue

> **User**: Make me a plugin that turns ```ascii blocks into a centered
> `<pre>` with a monospace font.
>
> **Agent**: Scaffolding…
>
> ```ts
> const { files } = scaffoldPlugin({
>   name: "ascii-pre",
>   kind: "codeblock",
>   key: "ascii",
>   hint: "Render ```ascii blocks as a centered <pre>.",
> });
> ```
>
> Draft:
>
> ```jsonc
> // markspread-plugin.json
> {
>   "schemaVersion": 1,
>   "name": "ascii-pre",
>   "version": "0.1.0",
>   "entry": "./index.js",
>   "description": "Render ```ascii blocks as a centered <pre>.",
>   "permissions": [],
>   "allowedHosts": [],
>   "contributes": { "codeblocks": { "ascii": { "render": "html" } } },
>   "render": "html",
>   "engines": { "markspread": ">=1.3.0" }
> }
> ```
>
> Validation: ok, no warnings.
>
> Hit **Install** in the Plugin Author Panel to write it out and reload.
>
> **User**: Install.

## Manifest skeleton (reference)

```jsonc
{
  "schemaVersion": 1,
  "name": "...",
  "version": "0.1.0",
  "entry": "./index.js",
  "description": "...",
  "permissions": [],
  "allowedHosts": [],
  "contributes": { /* see below */ },
  "render": "html",
  "engines": { "markspread": ">=1.3.0" }
}
```

Contribution options:

```jsonc
{ "codeblocks": { "lang": { "render": "html" } } }      // ```lang ... ```
{ "fences":     [{ "name": "tip", "render": "html" }] } // :::tip ... :::
{ "headers":    { "h2": { "render": "html" } } }        // ## headers
{ "inlineRules":[{ "pattern": "@\\w+", "render": "html" }] }
```

## Permissions guidance

| You need…                  | Set                                                                 |
| -------------------------- | ------------------------------------------------------------------- |
| Pure transform             | `permissions: []`, `allowedHosts: []`                               |
| Fetch from one host        | `permissions: ["network"]`, `allowedHosts: ["api.example.com"]`     |
| Read user's workspace      | `permissions: ["fs:read"]`                                          |
| Write into workspace       | `permissions: ["fs:read", "fs:write"]` (read is required for write) |

The user must approve every permission via the consent dialog before
the worker is granted it.

## When the agent should re-roll

After each `installScaffold` call, the agent should:

1. Wait for the host to report `ready` (or `error`).
2. If `error`, read `host.list().find(...).errorMessage` and emit a fix
   on the next turn.
3. Encourage the user to test the plugin and report back. Iterate via
   `host.reload(name)` rather than re-installing.
