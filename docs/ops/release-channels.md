# Release channels

> S-REL-014 — three channels with explicit promotion paths.

```
              alpha (internal)
                ↓ promote on green smoke
              beta (opt-in users)
                ↓ promote after 24h healthy beta
              stable (default for everyone)
```

## What each channel is for

| Channel  | Audience                | Tag pattern              | Manifest URL                                    |
|----------|-------------------------|--------------------------|-------------------------------------------------|
| `alpha`  | Markspread engineers    | `vX.Y.Z-alpha.N`         | `https://releases.markspread.app/alpha/latest.json` |
| `beta`   | Opted-in users          | `vX.Y.Z-beta.N` / `-rc.N`| `https://releases.markspread.app/beta/latest.json`  |
| `stable` | Everyone (default)      | `vX.Y.Z`                 | `https://releases.markspread.app/latest.json` *and* `/stable/latest.json` |

`stable` lives at both the legacy unprefixed path and the prefixed path
because v0.x clients hard-coded the unprefixed URL. Newer clients
parameterise on the user's channel selection.

## Tag → channel routing

Done in `publish-update-feed.yml` from the tag suffix:

- `*-alpha*`     → alpha
- `*-beta*` / `*-rc*` → beta
- everything else → stable

So you don't need a workflow input — just push a tag with the right
suffix and the right channel publishes.

## Promotion

There is **no rebuild** between channels. Promoting from beta to stable
means tagging a stripped-suffix version pointing at the same artefacts:

```
git tag v1.2.3-beta.3   <- beta release
# ... 24h on beta channel, no critical issues ...
git tag v1.2.3          <- promote to stable; same code
git push --tags
```

The release.yml workflow rebuilds for the stable tag (because the
binaries embed the version string), but the testing-stage code is
identical.

## Client-side selection

`UpdaterSettings.channel` (default `stable`). The settings UI exposes
two toggles for end-users:

- "Use beta channel" (off by default) → switches to `beta`
- "Use alpha channel" — hidden unless `licence.internal === true`

When the user changes channels, the next check fetches the new
manifest URL. If they switch from `beta` back to `stable` while
running a beta build that's *newer* than the current stable, the
updater offers a "downgrade-to-stable" entry rather than silently
rolling back (S-UP-016 inverts here on user request).

## Internal alpha gating

`alpha` builds carry an embedded `requires-internal-licence: true`
flag in the manifest. The Tauri side refuses to install the .dmg/.msi
if the licence claims don't match. Rationale: even if the alpha URL
leaks, an external user who pastes it into their endpoint setting
can't run the binary.

## Beta opt-in flow

The opt-in toggle in Settings sends one telemetry event
(`updater.channel_changed`) with the new channel value. We use this
to estimate the beta cohort size for ramp planning. No personally
identifiable info is included.

## When to publish a beta-only release

- Any version that touches the updater itself (so we can roll back
  via channel-flip if the new updater is broken)
- Any major UI change we want feedback on before stable lands
- Any time a refactor touched > 25 % of the codebase

When in doubt: ship to beta first.
