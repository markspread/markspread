# Markspread plugins

Markspread plugins are sandboxed JavaScript modules that hook into the
markdown render pipeline. They run in a Web Worker with no DOM, no
network (by default), and no fs access. The full security model is in
[ADR-0012](../adr/0012-runtime-plugin-security-model.md).

This doc covers everything a plugin author needs:

1. [Install location](#install-location)
2. [Manifest schema](#manifest-schema)
3. [Hook protocol](#hook-protocol)
4. [Permissions](#permissions)
5. [Sandbox guarantees](#sandbox-guarantees)
6. [Debugging](#debugging)
7. [Sample tour](#sample-tour)

## Install location

| Scope     | Path                                           | Wins on conflict |
| --------- | ---------------------------------------------- | ---------------- |
| User      | `~/.markspread/plugins/<name>/`                | —                |
| Workspace | `<workspace>/.markspread/plugins/<name>/`      | yes (ADR-0012 D3.5) |

Each plugin folder must contain `markspread-plugin.json` and the entry
script the manifest points at (conventionally `index.js`).

## Manifest schema

The full TypeScript surface is in
`src/lib/plugins/runtime/types.ts` (re-exported via the `runtime` barrel)
and validated by the zod schema in
[`src/lib/plugins/runtime/loader.ts`](../../src/lib/plugins/runtime/loader.ts).

```jsonc
{
  "schemaVersion": 1,                       // currently always 1
  "name": "demo",                           // [a-z0-9-]{1,32}
  "version": "0.1.0",                       // SemVer
  "entry": "./index.js",                    // relative path inside the plugin dir
  "displayName": "Demo plugin",             // optional, ≤80 chars
  "description": "What this does.",         // optional, ≤280 chars
  "permissions": [],                        // see Permissions section
  "allowedHosts": [],                       // network whitelist
  "contributes": {                          // hook points
    "codeblocks": { "lang": { "render": "html" } },
    "fences":     [{ "name": "note", "render": "html" }],
    "headers":    { "h2": { "render": "html" } },
    "inlineRules":[{ "pattern": "@\\w+", "render": "html" }]
  },
  "render": "html",                         // default render mode
  "engines": { "markspread": ">=1.3.0" }    // SemVer range
}
```

The schema is **forward-compatible**: unknown top-level keys are passed
through unchanged so we can extend the manifest without breaking old
plugins.

## Hook protocol

Plugins are loaded as Web Workers. Messages flow over `postMessage` with
the following lifecycle (full grammar in
[`sandbox-rpc.ts`](../../src/lib/plugins/runtime/sandbox-rpc.ts)):

1. Host → Worker: `{ type: "host:init", pluginName, capabilities }`
2. Worker → Host: `{ type: "plugin:ready", registered: [...] }`
3. Host → Worker: `{ type: "hook:invoke", requestId, kind, key, payload }`
4. Worker → Host: `{ type: "hook:result", requestId, result }`

`result` is either `{ kind: "html", html: string }` or `{ kind: "error",
message: string }`. HTML output is run through `DOMPurify` before being
inserted, so dangerous tags / attributes are stripped — design your
output to use the standard DOMPurify whitelist.

A minimal worker skeleton:

```js
self.addEventListener("message", (ev) => {
  const m = ev.data;
  if (m?.type === "host:init") {
    self.postMessage({
      type: "plugin:ready",
      registered: [{ kind: "codeblock", key: "demo" }],
    });
  } else if (m?.type === "hook:invoke") {
    self.postMessage({
      type: "hook:result",
      requestId: m.requestId,
      result: { kind: "html", html: `<pre>${m.payload.source}</pre>` },
    });
  }
});
```

## Permissions

| Label       | What it grants                                                     |
| ----------- | ------------------------------------------------------------------ |
| `network`   | `fetch` to hosts listed in `allowedHosts`. Empty list → manifest rejected. |
| `fs:read`   | Read access to the current workspace (mediated by Tauri IPC).       |
| `fs:write`  | Write access to the current workspace.                              |

Permissions are **opt-in and explicit**. The user must approve them via
the consent dialog the first time the plugin loads. Granted permissions
are persisted in the plugin folder; users can revoke them at any time.

## Sandbox guarantees

- No DOM, no `window`, no `__TAURI__`.
- `fetch` is hard-blocked unless `network` permission + matching
  `allowedHosts` entry.
- Message channel is strictly typed (see `sandbox-rpc.ts`) — any payload
  failing the zod schema is silently dropped.
- `worker.terminate()` reclaims all resources; hot-reload uses this
  cleanly (ADR-0012 D3.6).
- HTML output passes through DOMPurify on the host side.

Full threat model: ADR-0012, sections "Threat model" and "R-numbers".

## Debugging

- **Hot reload**: edit any file under the plugin folder and the host
  re-spawns the worker on the next render cycle (250ms debounce).
- **DevTools**: workers show up under the Sources panel as
  `blob:tauri://...`; breakpoints survive reloads.
- **Logs**: `console.log` in the worker prints to the renderer's
  DevTools console (prefixed with the worker URL).
- **Validation errors**: the Plugin Author Panel and the LLM agent both
  surface `validateManifest()` results — fix the listed paths and the
  errors should clear without a manual reload.

## Sample tour

The repo ships three runnable samples under
[`examples/plugins/`](../../examples/plugins/):

| Sample        | Hook        | Complexity                                |
| ------------- | ----------- | ----------------------------------------- |
| `github-alerts` | fence    | Smallest sample. 3 fences → coloured `<div>`. Read this first. |
| `mermaid`     | codeblock   | Stub renderer to show how to intercept a fenced code block.    |
| `wireweave`   | codeblock   | Mini DSL → inline SVG. Demonstrates parsing + structured output.|

Each sample has a `README.md` and a `LLM-PROMPT.md` you can paste into
the ChatShell to ask the agent to recreate the plugin from scratch.

For the chat-driven authoring flow (scaffold → review → install →
iterate), see [`llm-starter-prompt.md`](./llm-starter-prompt.md).
