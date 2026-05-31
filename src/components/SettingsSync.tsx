// ADR-0015 §3 Sync: 구독 동기화 UI 패널.
//
// 본 컴포넌트는 사용자가 Sync 구독·디바이스·암호화 상태를 보고 관리.
// 실제 SyncClient (src/lib/sync/client.ts) 는 별도 백엔드와 통신 — 본 UI 는 상태만.

import { useTranslation } from "react-i18next";

export interface SyncStatusSnapshot {
  /** 활성 구독 여부 */
  active: boolean;
  /** 등록된 디바이스 수 */
  deviceCount: number;
  /** 마지막 sync 시각 (ISO) */
  lastSyncAt?: string;
  /** e2e 암호화 활성 여부 (passphrase 등록 완료) */
  encryptionReady: boolean;
}

interface Props {
  status?: SyncStatusSnapshot;
  manageBaseUrl?: string;
  onSetupEncryption?: () => void;
  onSyncNow?: () => void;
}

const DEFAULT_STATUS: SyncStatusSnapshot = {
  active: false,
  deviceCount: 0,
  encryptionReady: false,
};

export function SettingsSync({
  status = DEFAULT_STATUS,
  manageBaseUrl = "https://markspread.app/sync",
  onSetupEncryption,
  onSyncNow,
}: Props): React.ReactElement {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t("settings.sync.title", "Sync")}
      className="flex flex-col gap-3 border-[var(--color-border)] border-b p-4 text-sm"
    >
      <header className="flex items-center justify-between">
        <h2 className="font-semibold text-base">{t("settings.sync.title", "Sync")}</h2>
        <span
          data-testid="sync-tier-badge"
          className={`rounded px-2 py-0.5 text-xs ${
            status.active
              ? "bg-[var(--color-accent)]/20 text-[var(--color-accent)]"
              : "bg-[var(--color-border)]/40 text-[var(--color-muted)]"
          }`}
        >
          {status.active ? "$5/mo" : "Inactive"}
        </span>
      </header>
      <p className="text-[var(--color-muted)] text-xs">
        {t(
          "settings.sync.description",
          "워크스페이스 설정 + 플러그인 구성 + 리뷰 세션 이력 동기화. 문서 파일은 동기화 안 함 (로컬 우선 유지).",
        )}
      </p>
      <div className="flex flex-col gap-1 text-xs">
        <div>
          <span className="text-[var(--color-muted)]">
            {t("settings.sync.devices", "Devices")}:
          </span>{" "}
          <span data-testid="sync-device-count">{status.deviceCount}</span>
        </div>
        {status.lastSyncAt && (
          <div>
            <span className="text-[var(--color-muted)]">
              {t("settings.sync.last", "Last sync")}:
            </span>{" "}
            <time data-testid="sync-last-at" dateTime={status.lastSyncAt}>
              {status.lastSyncAt.slice(0, 19).replace("T", " ")}
            </time>
          </div>
        )}
        <div>
          <span className="text-[var(--color-muted)]">
            {t("settings.sync.encryption", "End-to-end encryption")}:
          </span>{" "}
          <span
            data-testid="sync-encryption-status"
            className={status.encryptionReady ? "text-emerald-600" : "text-amber-600"}
          >
            {status.encryptionReady
              ? t("settings.sync.encryption_ready", "Ready")
              : t("settings.sync.encryption_pending", "Pending — passphrase needed")}
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        {status.active && status.encryptionReady && (
          <button
            type="button"
            data-testid="sync-now-button"
            onClick={onSyncNow}
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-border)]/40"
          >
            {t("settings.sync.sync_now", "Sync now")}
          </button>
        )}
        {status.active && !status.encryptionReady && (
          <button
            type="button"
            data-testid="sync-setup-encryption"
            onClick={onSetupEncryption}
            className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          >
            {t("settings.sync.setup_encryption", "passphrase 설정")}
          </button>
        )}
        <a
          href={manageBaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="sync-manage-link"
          className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-border)]/40"
        >
          {status.active
            ? t("settings.sync.manage", "구독 관리")
            : t("settings.sync.subscribe", "Sync 구독 시작")}
        </a>
      </div>
    </section>
  );
}
