# Screen-reader smoke checklist

Manual passes that complement the automated axe + landmark checks. Run on
each platform's release-candidate build before promoting to stable.

## VoiceOver (macOS) — S-A11-004

1. **First-run** — `Cmd+F5` to enable VO; launch Markspread fresh. The
   welcome screen should be announced as `main, Markspread welcome`. Tab into
   the action list; each button announces its label and shortcut hint.
2. **Open workspace** — `VO+Space` on the open-workspace button. The native
   open-dialog inherits OS chrome (out-of-scope). After dismissal the file
   tree announces as `complementary, file tree`.
3. **Sidebar filter** — focus the filter input and verify VO announces
   `search, file filter`. Type `readme`; the result count is read via the
   live region (S-A11-010).
4. **AI Review** — open command palette (`Cmd+/`), select Review. The
   streaming output container announces incremental tokens as `polite` live
   region updates so VO doesn't interrupt the user mid-keystroke.

## NVDA (Windows) — S-A11-005

Same scenarios with `Insert+Down` (read-all) and `H` (jump heading).
Headings must follow the document outline (h1 → h2) without skipping levels.

## Orca (Linux) — S-A11-006

Best-effort coverage. Wayland + Tauri's webview presents a single ATK tree;
verify the same landmark structure with `orca --list-apps` open.

## Pass criteria

- Every interactive control has an audible label.
- No element is announced as `group` or `region` without context.
- Live regions announce updates without stealing focus.
- Esc consistently closes the topmost modal and returns to the launcher.
