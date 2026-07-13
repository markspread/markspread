---
"markspread": patch
---

Wire finished modules into the live app and harden the parser runtime — full-behavior regression (47 SDI scenarios) now passes end-to-end.

- Preview: mermaid diagrams, KaTeX math (inline `$…$`, fenced and standalone `$$…$$`), YAML frontmatter stripping, and shiki syntax highlighting now actually render — the modules existed but were never bootstrapped. Shiki runs on a curated grammar set to keep the install lean.
- Editor: non-markdown files get real syntax highlighting (nine CodeMirror languages) while staying read-only, in all three mount paths.
- Parser workbench: `.markspread/parsers/` hot-reload works end-to-end (watcher → re-register → preview).
- Parser security: untrusted runtime parsers execute only inside the sandboxed worker (fail-closed), validator violations reject registration, the 100 ms render budget suspends offenders with a visible notice, and the consent dialog gates first activation.
- Chat: agent file-edit approvals reach the approval card and write to disk on accept; drag-selection edits render an inline diff with Enter/Esc/Cmd+R; the BYOK lane streams through the real provider runner with clear auth-failure messages; custom ACP agents persist across restarts; all eight BYOK providers are registrable with per-provider base-URL handling and a key test button.
- ACP: closing a session against an unresponsive agent now times out instead of hanging.
