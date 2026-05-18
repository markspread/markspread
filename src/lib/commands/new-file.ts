/**
 * S-FT-005 / FT-006: ⌘N / ⌘⇧N broadcast a request that the active FileTree
 * picks up. The tree owns selection state, so it decides the parent directory
 * rather than threading it through the command registry.
 */
export function newFileCommand(): void {
  window.dispatchEvent(new CustomEvent("markspread:filetree:new-file"));
}

export function newFolderCommand(): void {
  window.dispatchEvent(new CustomEvent("markspread:filetree:new-folder"));
}
