// ADR-0019 §Decision.1: `Main` is the legacy name for the workspace
// screen, now unified into `WorkspaceShell` (single shell + Chat toggle).
// The alias is kept so existing tests / external imports continue to
// compile during the cut-over wave. New code should import
// `WorkspaceShell` directly.

export { WorkspaceShell as Main } from "./WorkspaceShell";
