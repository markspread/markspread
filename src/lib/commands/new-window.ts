import { invoke } from "@tauri-apps/api/core";
import { useToasts } from "../../store/toasts";

interface NewWindowResult {
  label: string;
}

/**
 * S-WS-015: spawn a fresh top-level window. Each window owns independent
 * workspace/tab state via per-label persistence; settings + recent + theme
 * remain global so changes propagate.
 */
export async function newWindowCommand(): Promise<string | null> {
  try {
    const result = await invoke<NewWindowResult>("window_new");
    return result.label;
  } catch (e) {
    useToasts.getState().push({
      kind: "error",
      message: "window.new.failed",
      details: String(e),
    });
    return null;
  }
}
