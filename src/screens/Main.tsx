// ADR-0010 D1/D3: `Main` is the legacy name for what is now `EditorShell`.
// The file is kept as a thin alias so existing tests / external imports
// continue to compile during the cut-over wave. New code should import
// `EditorShell` directly.

export { EditorShell as Main } from "./EditorShell";
