import { listen } from "@tauri-apps/api/event";
import { routeCliPathArg } from "./cli-route";

interface ForwardedArgs {
  path_arg: string | null;
}

export function registerCliForwardedListener(): () => void {
  let unlisten: (() => void) | null = null;
  listen<ForwardedArgs>("cli://forwarded", (evt) => {
    const path = evt.payload.path_arg;
    if (typeof path === "string" && path.length > 0) {
      void routeCliPathArg(path);
    }
  })
    .then((u) => {
      unlisten = u;
    })
    .catch(() => {});
  return () => {
    unlisten?.();
  };
}
