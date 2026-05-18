// S-SE-040: WebView permission gate — uniformly deny camera, mic,
// geolocation, MIDI, USB, etc.
//
// Markspread is a markdown editor. There is no legitimate reason for
// the WebView to access webcam, microphone, location, MIDI devices,
// USB, Bluetooth, or notifications. The Tauri configuration sets the
// platform WebView permissions to deny by default; this module mounts
// a renderer-side belt-and-braces handler that returns "denied" to any
// permission API call, prevents user-script rabbit holes, and logs the
// attempt so we can audit if a plugin tries to escape the sandbox.

import { recordAudit } from "./audit-log";

const BLOCKED_NAMES: readonly PermissionName[] = [
  "camera" as PermissionName,
  "microphone" as PermissionName,
  "geolocation",
  "midi" as PermissionName,
  "notifications",
  "persistent-storage" as PermissionName,
  "background-sync" as PermissionName,
  "background-fetch" as PermissionName,
  "screen-wake-lock" as PermissionName,
  "accelerometer" as PermissionName,
  "gyroscope" as PermissionName,
  "magnetometer" as PermissionName,
  "ambient-light-sensor" as PermissionName,
  "clipboard-write" as PermissionName,
  "clipboard-read" as PermissionName,
];

export function installWebviewPermissionGuard(): () => void {
  const originalQuery = navigator.permissions?.query?.bind(navigator.permissions);

  if (originalQuery) {
    navigator.permissions.query = ((desc: PermissionDescriptor) => {
      if (BLOCKED_NAMES.includes(desc.name)) {
        void recordAudit({
          ts: Date.now(),
          pluginId: "host:webview",
          apiKind: `permission:${desc.name}`,
          apiSummary: JSON.stringify(desc),
          decision: "deny",
          reason: "WebView permission gate (S-SE-040)",
        });
        return Promise.resolve({
          state: "denied",
          name: desc.name,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => true,
        } as unknown as PermissionStatus);
      }
      return originalQuery(desc);
    }) as typeof navigator.permissions.query;
  }

  // Geolocation always errors out before reaching the OS prompt.
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition = ((_ok: unknown, fail?: PositionErrorCallback) => {
      const err = {
        code: 1,
        message: "Geolocation is disabled in Markspread",
        PERMISSION_DENIED: 1,
      } as GeolocationPositionError;
      if (fail) fail(err);
    }) as typeof navigator.geolocation.getCurrentPosition;
    navigator.geolocation.watchPosition = (() => -1) as typeof navigator.geolocation.watchPosition;
  }

  // Disable getUserMedia so plugins can't go around the permissions API.
  const md = navigator.mediaDevices;
  if (md) {
    md.getUserMedia = () =>
      Promise.reject(new DOMException("media access disabled", "NotAllowedError"));
    md.getDisplayMedia = (() =>
      Promise.reject(
        new DOMException("display capture disabled", "NotAllowedError"),
      )) as typeof md.getDisplayMedia;
  }

  return () => {
    if (originalQuery) navigator.permissions.query = originalQuery;
  };
}
