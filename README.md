<p align="center">
  <img src="./assets/logo.svg" alt="Markspread" width="420" />
</p>

<p align="center">
  Lightweight markdown reviewer for the AI era.
</p>

<p align="center">
  <em>Tauri 2 &middot; Vite &middot; React 19 &middot; Tailwind v4 &middot; TypeScript strict</em>
</p>

---

## Quick start

```bash
pnpm install
pnpm dev          # Tauri dev (Rust + Vite)
pnpm vite:dev     # Frontend only
pnpm test         # Vitest
pnpm typecheck
pnpm lint
```

## Features

- **Markdown review workspace** — open folders, browse `.md` files, and read with a clean, distraction-free renderer.
- **AI key management** — bring-your-own provider keys and Anthropic subscription auth, stored in the OS keychain (`com.markspread.app`); plaintext tokens never round-trip needlessly over IPC.
- **Plugins** — install, enable, and sandbox plugins with a per-API permission gate and marketplace signature verification.
- **Backup & export** — snapshot workspace state and export documents.
- **Migration** — import existing notes from Obsidian, Typora, iA Writer, Notion, and Logseq.

## Architecture

- `src/` — React 19 frontend (Vite + Tailwind v4)
- `src-tauri/` — Rust core (Tauri 2 + tokio + tracing)
- `src-tauri/src/fs_cmd.rs` — sandboxed FS IPC commands
- `src-tauri/src/ai_keys.rs` / `ai_auth.rs` — keychain-backed credential handling
- `src-tauri/src/plugins.rs` — plugin lifecycle, storage, and permission backend
- `src-tauri/capabilities/` — per-window capability allowlist
- `assets/` — brand assets (`logo.svg`, `icon.svg`)

See [`/docs-design`](https://github.com/markspread) and [`/scenarios`](https://github.com/markspread) at the org root for design docs and atomic scenarios.

## License

MIT — see [LICENSE](./LICENSE).
