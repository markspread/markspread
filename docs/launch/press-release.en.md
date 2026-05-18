# Press release — Markspread 1.0

> For journalists who asked for a single document they can quote.
> Embargoed until v1.0.0 launch (00:01 PT on the launch Tuesday).
> Contact: <press@markspread.app>.

## Headline

**Markspread launches version 1.0 — an open-source markdown editor
with a CSS-faithful preview and on-device AI**

## Subhead

A new desktop app for macOS, Windows, and Linux pairs a fast native
editor with a "spread pane" that renders documents using the
publishing site's actual CSS, and integrates AI features that run
against the user's own provider key without going through the
project's servers.

## Body

The Markspread maintainers today released version 1.0 of Markspread,
an open-source markdown editor for desktop platforms. The release
ships native binaries for macOS, Windows, and Linux, all built from
the same Rust + Tauri codebase published at
<https://github.com/markspread/markspread>.

The project's distinguishing feature is the *spread pane* — a live
preview that loads the user's publishing CSS into a sandboxed
iframe. The team's argument: most markdown editors style the
preview with a generic stylesheet, leaving authors to discover
formatting bugs after publishing. Markspread reuses the actual CSS,
so what the user sees while writing is what their site, blog, or
documentation page will publish.

A second focus is AI privacy. Where competing tools route AI
requests through a vendor's servers, Markspread sends prompts and
responses directly from the user's machine to the provider the user
chose (OpenAI, Anthropic, or local models via Ollama and llama.cpp).
API keys are stored in the operating-system keychain. The project
does not operate any AI relay or proxy.

Markspread is licensed under the MIT License. Releases are
reproducible from a public commit SHA and signed: Apple Notarisation
on macOS, EV codesigning on Windows, and Ed25519 signatures on the
update channel. The plugin marketplace ships with four first-party
plugins and an open submission process for community plugins; all
plugins run sandboxed in a separate renderer with explicit
filesystem and network scopes.

The team behind Markspread is small and self-funded. The project
has no venture capital and does not operate a cloud product. A
plugin marketplace, a CLI, and an SDK are released alongside the
desktop app.

## Selected facts

- **Cold-start time:** ~220 ms on a 2024 MacBook Air.
- **Idle memory:** ~85 MB.
- **Installer size:** 18 MB (macOS), 22 MB (Windows), 24 MB (Linux
  AppImage).
- **Telemetry:** off by default; opt-in uses a rotating weekly
  client identifier.
- **Licence:** MIT.
- **Source:** <https://github.com/markspread/markspread>.

## Quotes

A maintainer:

> Most markdown editors solved the editing problem 15 years ago.
> The thing they keep missing is that the writer's preview is
> different from the publishing result, and we wanted to close that
> loop without inventing a new format or asking anyone to switch
> note-taking app.

A second quote, on the AI design:

> We did the work to make AI features useful while keeping the
> contract with users honest: your key, your machine, your prompts.
> If you trust your provider, that's the only trust relationship
> the app needs.

## About the project

Markspread is an open-source markdown editor and tooling project.
The desktop app is the primary product; companion releases include
`markspread-cli` for scripting and CI, `@markspread/sdk` for plugin
authors, and an open marketplace for plugins. The project is
maintained by a small team and developed in the open at
<https://github.com/markspread>.

## Press contact

- Email: <press@markspread.app>
- Press kit: <https://markspread.dev/press/>
- Embargoed builds: available on request before launch.
- After launch: full builds at <https://markspread.dev/download>.

— *ends*
