// S-KB-011: thin command wrappers around the io module so the
// command palette can call them by id. The user-visible toast
// messages live here; the actual file work lives in lib/keybindings/io.ts.

import { exportKeybindings, importKeybindings } from "@/lib/keybindings/io";
import type { ImportMode } from "@/lib/keybindings/io";
import { useToasts } from "@/store/toasts";

export async function exportKeybindingsCommand(): Promise<void> {
  const push = useToasts.getState().push;
  try {
    const path = await exportKeybindings();
    if (!path) return;
    push({ kind: "success", message: "Keybindings exported", details: path });
  } catch (e) {
    push({
      kind: "error",
      message: "Export failed",
      details: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function importKeybindingsCommand(
  modeArg?: string,
): Promise<void> {
  const mode: ImportMode = modeArg === "replace" ? "replace" : "merge";
  const push = useToasts.getState().push;
  try {
    const report = await importKeybindings(mode);
    if (!report) return;
    const conflicts = report.conflicts.length;
    push({
      kind: conflicts > 0 ? "warning" : "success",
      message: "Keybindings imported",
      details:
        `${report.applied} applied` +
        (conflicts > 0 ? ` · ${conflicts} replaced existing override` : "") +
        ` (${mode})`,
    });
  } catch (e) {
    push({
      kind: "error",
      message: "Import failed",
      details: e instanceof Error ? e.message : String(e),
    });
  }
}
