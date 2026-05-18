# Post-release smoke test (manual)

> S-REL-012 — 30-minute manual run on three OSes after every minor or
> major release. Patches are exempt unless they touch updater, AI flow,
> or workspace storage.

## Why manual

Automated e2e (`e2e-main.yml`) runs against pre-release artifacts in CI,
which proves the binary functions. The manual smoke proves the
*delivery channel* works: the .dmg downloaded from a real GitHub
Release URL, dragged into Applications by a human, opens without
Gatekeeper warnings. CI can't see those layers.

## What you need

- A clean macOS, Windows, and Linux VM (or fresh user accounts on
  shared machines). "Clean" = no prior Markspread install, no leftover
  config under `~/Library/Application Support/Markspread`,
  `%APPDATA%\Markspread`, or `~/.config/markspread`.
- A throwaway AI provider key (the team has a budget-capped OpenAI key
  in 1Password for this purpose — entry "smoke-test-openai").
- ~30 min uninterrupted.

## The script (run on each OS)

### 1. Download

- [ ] Open https://github.com/markspread/markspread/releases/latest in
      a browser
- [ ] Click the platform-appropriate asset:
      - macOS: `Markspread_<ver>_universal.dmg`
      - Windows: `Markspread_<ver>_x64_en-US.msi`
      - Linux: `Markspread_<ver>_amd64.deb` (Debian-likes) or `.AppImage`
- [ ] Verify the download size is non-zero and roughly matches the
      previous release (a 0-byte or 100x-bloat artefact = abort)

### 2. Verify integrity

- [ ] Pull `SHA256SUMS` and `SHA256SUMS.asc` from the same Release
- [ ] `gpg --verify SHA256SUMS.asc` — expect "Good signature from
      Markspread <ops@markspread.app>" and the fingerprint listed in
      `docs/security/signing-keys.md`
- [ ] `sha256sum -c SHA256SUMS --ignore-missing` (or platform
      equivalent) — the line for your downloaded file passes

### 3. First launch (no warnings)

- [ ] **macOS:** drag .app to /Applications, double-click. Gatekeeper
      should accept the notarization without "unidentified developer".
- [ ] **Windows:** run the .msi installer; SmartScreen should not warn
      (the EV signature is verified).
- [ ] **Linux:** `sudo apt install ./Markspread_<ver>_amd64.deb` (or
      `chmod +x ... && ./Markspread_<ver>.AppImage`). No "untrusted"
      banner.

### 4. First-launch wizard

- [ ] EULA shows; accepting moves forward
- [ ] Telemetry consent defaults to opt-out
- [ ] Locale auto-detects (test on a system with KR locale at least once)
- [ ] AI key prompt — paste the throwaway key, "Test connection" passes
- [ ] Workspace picker — create one named `smoke-<date>` in a tmp dir
- [ ] Wizard completes; main editor opens

### 5. Workspace authoring

- [ ] Create a new file `note.md`, type 2-3 paragraphs of content
- [ ] Spread pane updates live as you type
- [ ] Bold (Ctrl/Cmd+B), italic, link, heading — toolbar + shortcut both work
- [ ] Save (Ctrl/Cmd+S) — the file persists; close + reopen Markspread
      and the content is still there

### 6. AI action (the cheap one)

- [ ] Select a paragraph, run "Improve writing" (Ctrl/Cmd+Shift+I)
- [ ] Inline diff panel appears; rejecting closes without modification
- [ ] Run again, accept this time; text is replaced
- [ ] Sidebar shows token usage incremented by a sane number (10s, not 10000s)

### 7. Updater dry-run (only for major)

- [ ] **Settings → About → Check for updates** returns "you're on the
      latest version" — verifies the manifest endpoint works
- [ ] (Optional, only when testing the rollback workflow) point the
      app at the staging endpoint and confirm an offered update
      installs cleanly

### 8. Quit + relaunch

- [ ] Quit the app
- [ ] Relaunch — wizard does *not* re-appear; opens to the smoke
      workspace; AI key still configured

### 9. Uninstall

- [ ] **macOS:** drag .app to Trash. Optional: delete
      `~/Library/Application Support/Markspread`.
- [ ] **Windows:** Apps & Features → Markspread → Uninstall.
      Optional: delete `%APPDATA%\Markspread`.
- [ ] **Linux:** `sudo apt remove markspread` or delete the .AppImage.
      Optional: `~/.config/markspread`.
- [ ] No leftover background processes (Activity Monitor / Task Manager /
      `pgrep markspread`)

## Pass/fail criteria

- All required steps green on all three OSes → ship is good.
- Any "no warnings" step fails (Gatekeeper, SmartScreen, untrusted
  banner) → block site/tweet announcement, file an immediate ticket.
- A non-blocking issue (cosmetic, edge-case) → file as `release-feedback`
  and decide async whether it warrants a patch.

## Sign-off

- [ ] macOS run by ____________________ at __________
- [ ] Windows run by __________________ at __________
- [ ] Linux run by ____________________ at __________

Paste the sign-off into the Release issue thread before promoting to
"latest" channel.
