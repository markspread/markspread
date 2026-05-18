import { invoke } from "@tauri-apps/api/core";

let reported = false;

export function markFirstPaint(): void {
  if (reported) return;
  reported = true;
  const send = () => {
    invoke<{ first_paint_ms: number }>("startup_mark_first_paint")
      .then((m) => {
        console.info(`[startup] first paint @ ${m.first_paint_ms}ms`);
      })
      .catch(() => {});
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(send));
  } else {
    queueMicrotask(send);
  }
}
