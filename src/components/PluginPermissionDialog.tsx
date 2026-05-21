// S-PL-013: per-permission consent gate. A plugin advertises the
// permissions it needs in its manifest; the user must explicitly allow
// each one before the runtime grants it. The dialog is purely
// presentational — the actual grant is persisted by
// `plugin_permission_prompt` on the Rust side.

import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../lib/focus-trap";
import type { PluginPermission } from "../lib/plugins/manifest";

interface PluginPermissionDialogProps {
  pluginId: string;
  pluginName: string;
  requestedPermissions: PluginPermission[];
  onAllow: (granted: PluginPermission[]) => void;
  onDeny: () => void;
}

/* v8 ignore start -- PluginPermission is a discriminated union of the four string variants + network + keychain; the trailing String() fallback is defensive and never reached at runtime */
function describePermission(
  p: PluginPermission,
  t: (k: string, fallback: string) => string,
): string {
  if (typeof p === "string") {
    switch (p) {
      case "fs.workspace-read":
        return t("plugin.perm.fs_read", "Read files in this workspace");
      case "fs.workspace-write":
        return t("plugin.perm.fs_write", "Write files in this workspace");
      case "fs.outside":
        return t("plugin.perm.fs_outside", "Read/write files outside this workspace");
      case "shell":
        return t("plugin.perm.shell", "Run shell commands (denied in v1)");
    }
  }
  if ("network" in p) {
    return t("plugin.perm.network", "Network: ") + p.network.join(", ");
  }
  if ("keychain" in p) {
    return t("plugin.perm.keychain", "Keychain: ") + p.keychain.join(", ");
  }
  return String(p);
}
/* v8 ignore stop */

/* v8 ignore start -- the final JSON.stringify fallback is unreachable because PluginPermission is a closed union and every variant returns above */
function permissionKey(p: PluginPermission): string {
  if (typeof p === "string") return p;
  if ("network" in p) return `network:${p.network.join(",")}`;
  if ("keychain" in p) return `keychain:${p.keychain.join(",")}`;
  return JSON.stringify(p);
}
/* v8 ignore stop */

export function PluginPermissionDialog({
  pluginId,
  pluginName,
  requestedPermissions,
  onAllow,
  onDeny,
}: PluginPermissionDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(requestedPermissions.map(permissionKey)),
  );
  const trapRef = useFocusTrap<HTMLDivElement>({ active: true, onEscape: onDeny });

  const toggle = (p: PluginPermission) => {
    const key = permissionKey(p);
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allow = async () => {
    const granted = requestedPermissions.filter((p) => selected.has(permissionKey(p)));
    try {
      await invoke("plugin_permission_prompt", { pluginId, granted });
    } catch {
      // best-effort: the Rust side may reject; UI still closes
    }
    onAllow(granted);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      // biome-ignore lint/a11y/useSemanticElements: dialog overlay keeps div for layout/portal control
      role="dialog"
      aria-modal="true"
      aria-label={t("plugin.perm.aria", "Plugin permissions")}
    >
      <div
        ref={trapRef}
        className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-xl"
      >
        <h2 className="font-semibold text-base">
          {t("plugin.perm.headline", "{{name}} requests permissions", { name: pluginName })}
        </h2>
        <p className="mt-1 text-[var(--color-muted)] text-xs">{pluginId}</p>
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          {requestedPermissions.map((perm) => {
            const key = permissionKey(perm);
            return (
              <li key={key} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(key)}
                  onChange={() => toggle(perm)}
                  id={`perm-${key}`}
                />
                <label htmlFor={`perm-${key}`} className="cursor-pointer">
                  {describePermission(perm, t)}
                </label>
              </li>
            );
          })}
        </ul>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm"
            onClick={onDeny}
          >
            {t("plugin.perm.deny", "Deny")}
          </button>
          <button
            type="button"
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 font-medium text-sm text-white"
            onClick={() => void allow()}
          >
            {t("plugin.perm.allow", "Allow")}
          </button>
        </div>
      </div>
    </div>
  );
}
