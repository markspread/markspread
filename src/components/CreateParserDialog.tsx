// H4 / ADR-0013: 사용자가 chat 으로 LLM 과 만든 파서 JS source 를 *런타임 등록*.
//
// 흐름:
//   1. 사용자가 ChatStream 의 assistant 응답에서 ```js 코드 복사
//   2. CreateParserDialog 열기 (toolbar 또는 chat의 + 버튼)
//   3. id + displayName + 확장자 (콤마구분) + code 입력
//   4. "Validate" → Validator violations 표시
//   5. "Create & Register" → ParserRegistry 에 등록 + TrustRegistry llm-generated
//   6. 해당 확장자 파일 열면 SpreadPane 가 자동으로 새 파서 사용

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { registerParserFromSource, unregisterParser } from "../lib/parsers/register-from-source";
import { getParserRegistry } from "../lib/parsers/registry";
import { Icon } from "./Icon";

interface Props {
  open: boolean;
  onClose: () => void;
  /** chat 측에서 ```js block 우클릭 시 자동 채우는 source. optional. */
  prefilledSource?: string;
  /** chat 측 한 줄 요약 — 동의 dialog 에 표시. */
  prefilledSummary?: string;
}

export function CreateParserDialog({
  open,
  onClose,
  prefilledSource = "",
  prefilledSummary = "",
}: Props): React.ReactElement | null {
  const { t } = useTranslation();
  const [id, setId] = useState("my-parser");
  const [displayName, setDisplayName] = useState("My Parser");
  const [extensions, setExtensions] = useState(".wireweave, .ww");
  const [source, setSource] = useState(prefilledSource);
  const [summary, setSummary] = useState(prefilledSummary);
  const [result, setResult] = useState<{
    kind: "idle" | "success" | "error";
    message?: string;
    violations?: { code: string; message: string }[];
  }>({ kind: "idle" });
  /** force re-render to refresh registry list after register/unregister */
  const [registryTick, setRegistryTick] = useState(0);

  // ParserRegistry 의 모든 등록 파서. registryTick 으로 register/unregister 후 refresh.
  const registeredParsers = useMemo(() => {
    void registryTick;
    const reg = getParserRegistry();
    return reg.list().map((p) => ({
      id: p.manifest.id,
      displayName: p.manifest.displayName ?? p.manifest.id,
      extensions: p.manifest.fileMatch?.extensions ?? [],
      entry: p.manifest.entry ?? "(inline)",
      isSystem: reg.isSystem(p.manifest.id),
    }));
  }, [registryTick]);

  if (!open) return null;

  const handleCreate = () => {
    const exts = extensions
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("."));
    if (!id.trim() || exts.length === 0) {
      setResult({
        kind: "error",
        message: t("parser.dialog.error.required", "id 와 최소 1개 확장자 필수"),
      });
      return;
    }
    const r = registerParserFromSource({
      id: id.trim(),
      displayName: displayName.trim() || id,
      extensions: exts,
      source,
      ...(summary ? { oneLinerSummary: summary } : {}),
    });
    if (r.ok) {
      setResult({
        kind: "success",
        message: t(
          "parser.dialog.success",
          `등록 완료 — ${exts.join("/")} 파일 열면 새 파서가 사용됨`,
        ),
        violations: r.violations.map((v) => ({ code: v.code, message: v.message })),
      });
      setRegistryTick((n) => n + 1);
    } else {
      setResult({
        kind: "error",
        message: r.error ?? t("parser.dialog.error.unknown", "unknown"),
        violations: r.violations.map((v) => ({ code: v.code, message: v.message })),
      });
    }
  };

  const handleRemove = () => {
    if (!id.trim()) return;
    unregisterParser(id.trim());
    setResult({
      kind: "success",
      message: t("parser.dialog.removed", `${id} 등록 해제됨`),
    });
    setRegistryTick((n) => n + 1);
  };

  const handleRemoveById = (rid: string) => {
    // 시스템 파서는 registry 단에서 false 리턴 → 사용자 경고 표시.
    if (getParserRegistry().isSystem(rid)) {
      setResult({
        kind: "error",
        message: t("parser.dialog.system_protected", `${rid} 는 시스템 파서 — 삭제 불가`),
      });
      return;
    }
    unregisterParser(rid);
    setRegistryTick((n) => n + 1);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="presentation"
      data-testid="create-parser-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: portal-less overlay; matches app convention */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-parser-title"
        className="flex max-h-[88vh] w-[min(720px,94vw)] flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)] shadow-2xl"
      >
        <header className="flex items-center justify-between border-[var(--color-border)] border-b px-4 py-3">
          <h2 id="create-parser-title" className="flex items-center gap-2 font-semibold text-base">
            <Icon name="sparkle" size={16} />
            <span>{t("parser.dialog.title", "런타임 파서 만들기")}</span>
          </h2>
          <button
            type="button"
            data-testid="create-parser-close"
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 text-sm">
          <div className="mb-3 flex gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[var(--color-muted)] text-xs">ID</span>
              <input
                data-testid="parser-id"
                type="text"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="wireweave"
                className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[var(--color-muted)] text-xs">Display Name</span>
              <input
                data-testid="parser-display"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
              />
            </label>
          </div>
          <label className="mb-3 flex flex-col gap-1">
            <span className="text-[var(--color-muted)] text-xs">Extensions (comma)</span>
            <input
              data-testid="parser-extensions"
              type="text"
              value={extensions}
              onChange={(e) => setExtensions(e.target.value)}
              placeholder=".wireweave, .ww"
              className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <label className="mb-3 flex flex-col gap-1">
            <span className="text-[var(--color-muted)] text-xs">한 줄 요약 (consent 표시용)</span>
            <input
              data-testid="parser-summary"
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="WireWeave DSL → SVG 다이어그램"
              className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--color-muted)] text-xs">
              Factory JS (default export 또는 function 식)
            </span>
            <textarea
              data-testid="parser-source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              rows={12}
              spellCheck={false}
              placeholder={`(input) => ({ ast: { kind: "html", html: "<pre>" + input.content + "</pre>" } })`}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-2 font-mono text-xs"
            />
          </label>
          {result.kind === "success" && (
            <div
              data-testid="parser-result-success"
              className="mt-3 flex items-start gap-2 rounded border border-emerald-400 bg-emerald-50 p-2 text-emerald-900 text-xs dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
            >
              <Icon name="check" size={14} className="mt-0.5 shrink-0" />
              <span>{result.message}</span>
            </div>
          )}
          {result.kind === "error" && (
            <div
              data-testid="parser-result-error"
              className="mt-3 flex items-start gap-2 rounded border border-red-400 bg-red-50 p-2 text-red-900 text-xs dark:border-red-700 dark:bg-red-950 dark:text-red-200"
            >
              <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
              <span>{result.message}</span>
            </div>
          )}
          {result.violations && result.violations.length > 0 && (
            <ul
              data-testid="parser-violations"
              className="mt-2 list-disc rounded border border-amber-300 bg-amber-50 p-2 pl-6 text-amber-900 text-xs dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
            >
              {result.violations.map((v, i) => (
                <li key={`${v.code}-${i}`}>
                  <strong>{v.code}</strong>: {v.message}
                </li>
              ))}
            </ul>
          )}

          {/* 현재 등록된 파서 목록 — fallback markdown 포함 모두 표시.
              사용자가 어떤 파서가 활성인지 한눈에 보고 즉시 unregister 가능. */}
          <section
            className="mt-4 border-[var(--color-border)] border-t pt-3"
            data-testid="parser-registry-list"
          >
            <h3 className="mb-2 text-[var(--color-muted)] text-xs uppercase tracking-wide">
              {t("parser.dialog.registry_title", "현재 등록된 파서")} ({registeredParsers.length})
            </h3>
            {registeredParsers.length === 0 ? (
              <p className="text-[var(--color-muted)] text-xs italic">
                {t("parser.dialog.registry_empty", "등록된 파서가 없습니다")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {registeredParsers.map((p) => (
                  <li
                    key={p.id}
                    data-testid={`parser-registry-row-${p.id}`}
                    className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)]/40 px-2 py-1 text-xs"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{p.displayName}</span>
                      <span className="truncate text-[var(--color-muted)]">
                        {p.id} · {p.extensions.length > 0 ? p.extensions.join(", ") : "(no ext)"}
                        {p.isSystem && (
                          <>
                            {" · "}
                            <em>{t("parser.dialog.system", "시스템 (삭제 불가)")}</em>
                          </>
                        )}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-muted)] hover:bg-[var(--color-border)]/40 hover:text-[var(--color-fg)]"
                        onClick={() => {
                          setId(p.id);
                          setDisplayName(p.displayName);
                          setExtensions(p.extensions.join(", "));
                        }}
                        title={t("parser.dialog.load_into_form", "이 파서 ID 로 폼 채우기")}
                      >
                        {t("parser.dialog.edit_in_form", "Edit")}
                      </button>
                      {!p.isSystem && (
                        <button
                          type="button"
                          data-testid={`parser-registry-remove-${p.id}`}
                          className="rounded border border-red-300 px-1.5 py-0.5 text-red-600 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-950"
                          onClick={() => handleRemoveById(p.id)}
                          title={t("parser.dialog.remove_this", "이 파서 등록 해제")}
                        >
                          <Icon name="trash" size={12} />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="flex items-center justify-between border-[var(--color-border)] border-t px-4 py-3">
          <button
            type="button"
            data-testid="parser-remove"
            onClick={handleRemove}
            className="text-red-600 text-xs hover:underline"
          >
            {t("parser.dialog.remove", "이 ID 등록 해제")}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-border)]/40"
            >
              {t("parser.dialog.cancel", "취소")}
            </button>
            <button
              type="button"
              data-testid="parser-create"
              onClick={handleCreate}
              className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white hover:opacity-90"
            >
              {t("parser.dialog.create", "Create & Register")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
