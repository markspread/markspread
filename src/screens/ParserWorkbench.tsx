// ADR-0019: 파서 개발 모드 (parser activity mode).
//
// "파서 개발이 *될 수밖에 없는* UI" — 모달과 채팅이 분리돼 불가능했던 구조를
// 폐기하고, 한 화면에 세 패널을 붙인다:
//
//   [ 파서 코드 (편집) ] [ 라이브 프리뷰 (샘플 md → 렌더) ] [ 채팅 (AI 보조) ]
//
// 흐름: 마크다운 리뷰 중 비표준 블록을 만남 → 파서 모드 전환 → 채팅에
// "::note 블록을 callout 으로 렌더하는 파서 짜줘" → AI 가 JS 반환 → 코드블록
// "에디터로" 버튼이 *그 자리 에디터로 로드* → 라이브 프리뷰 즉시 갱신 → 수정
// 반복 → [적용] 으로 실제 확장자에 등록 → 리뷰 모드에서 그 파서로 렌더.
//
// 채팅은 리뷰 모드와 *공용 컴포넌트*(ChatStream) — 파서 구현에도, 문서 수정
// 에도 쓰인다 (세션만 파서 스코프로 분리).

import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileTree } from "../components/FileTree";
import { getAcpAdapter } from "../lib/agents/acp-adapter";
import { registerParserFromSource, unregisterParser } from "../lib/parsers/register-from-source";
import { render } from "../lib/preview/render";
import { useActivityMode } from "../store/activity-mode";
import { useAgentRegistry } from "../store/agent-registry";
import { useChatSessions } from "../store/chat-sessions";
import { useTabs } from "../store/tabs";
import { ChatStream } from "./chat/ChatStream";

interface Props {
  workspace: string;
}

// 라이브 프리뷰는 사용자의 목표 확장자와 무관하게 격리된 sentinel 확장자로
// 등록·렌더한다 — builtin markdown 이나 다른 파서를 건드리지 않기 위함.
const STUDIO_ID = "__studio_preview__";
const STUDIO_EXT = ".__studiopreview__";

// ADR-0019 T4: 파서 워크벤치 전용 FileTree split. file-tree store 는 persist
// 되므로 이 split 키의 확장 상태는 모드 전환(▦↔▣)으로 컴포넌트가 unmount 돼도
// 보존된다 — 워크스페이스 컨텍스트별로 격리된 상태 워크스페이스.
const PARSER_SPLIT_ID = "parser";

// AC(축2) N3·N8: 중앙 패널 = 샘플(상) + 라이브 프리뷰(하) 세로 분할.
// 기존 `h-1/3` 고정 + 프리뷰 고정높이는 반복 개발에 cramped → 프리뷰 *우선*
// 기본값(샘플 28%, 프리뷰 72%)으로 두고 드래그 핸들로 비율 조정 가능하게 한다.
// 비율은 sample 영역이 차지하는 분율 (0=프리뷰 전체, 1=샘플 전체).
const SAMPLE_RATIO_DEFAULT = 0.28;
const SAMPLE_RATIO_MIN = 0.12; // 프리뷰 우선 — 샘플은 최소 한 줌만
const SAMPLE_RATIO_MAX = 0.8;

export function clampSampleRatio(r: number): number {
  if (Number.isNaN(r)) return SAMPLE_RATIO_DEFAULT;
  return Math.min(SAMPLE_RATIO_MAX, Math.max(SAMPLE_RATIO_MIN, r));
}

// 드래그 분율 산식 분리 (jsdom PointerEvent 가 clientY 를 운반하지 않아 핸들러
// 경유 테스트가 불가 → 순수 함수로 추출해 직접 검증). 컨테이너 높이 대비 픽셀
// 이동을 분율로 환산해 시작 분율에 더하고 clamp. 높이 0(레이아웃 전)은 무변경.
export function nextSampleRatio(startRatio: number, deltaPx: number, containerH: number): number {
  if (containerH <= 0) return startRatio;
  return clampSampleRatio(startRatio + deltaPx / containerH);
}

// N11 / ChatShell.readActiveFileExcerpt 동등 실데이터 경로: 워크스페이스에서
// 선택한 실제 파일을 Tauri fs 로 읽어 라이브 프리뷰 샘플로 사용한다. 파서 소스를
// 본문에 노출하는 워크벤치 특성상 과도하게 큰 파일은 잘라 budget 을 건다.
const MAX_SAMPLE_CHARS = 50_000;

async function readWorkspaceFile(workspace: string, path: string): Promise<string | null> {
  /* v8 ignore next -- callers only invoke this with a truthy activeFilePath (guarded at the effect) and a non-empty workspace prop, so both falsy arms are defensive guards */
  if (!workspace || !path) return null;
  try {
    const result = await invoke<{ content: string; encoding: string }>("fs_read_file", {
      workspace,
      path,
    });
    if (typeof result?.content !== "string") return null;
    if (result.content.length <= MAX_SAMPLE_CHARS) return result.content;
    return `${result.content.slice(0, MAX_SAMPLE_CHARS)}\n…(truncated; total ${result.content.length} chars)`;
  } catch (e) {
    console.warn("[ParserWorkbench] active file read failed", e);
    return null;
  }
}

const DEFAULT_SOURCE = `// 입력 마크다운(input.content)을 받아 AST 를 반환하는 factory.
//   ast.kind: "markdown" → 표준 마크다운 파이프라인으로 렌더
//   ast.kind: "html"     → HTML 직접 렌더 (sanitize 자동 적용)
//   ast.kind: "raw"      → <pre> 로 표시
// 아래는 예시: "::note 텍스트" 한 줄을 callout 박스로 변환.
(input) => {
  const html = input.content.replace(
    /^::note (.+)$/gm,
    '<div style="border-left:3px solid #f59e0b;padding:4px 10px;background:#fffbeb">📌 $1</div>'
  );
  return { ast: { kind: "html", html } };
}`;

const DEFAULT_SAMPLE = `# 샘플 문서

::note 이 줄은 커스텀 파서가 callout 으로 렌더합니다.

일반 문단은 그대로 보입니다.`;

interface AcpChunkPayload {
  sessionId?: string;
  update?: { type?: string; content?: { text?: string } };
}

export function ParserWorkbench({ workspace }: Props): React.ReactElement {
  const { t } = useTranslation();
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [sample, setSample] = useState(DEFAULT_SAMPLE);
  const [parserId, setParserId] = useState("my-parser");
  const [extensions, setExtensions] = useState(".md");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  // AC(축2): 중앙 패널 샘플/프리뷰 세로 분할 비율 + 드래그 컨테이너 ref.
  const [sampleRatio, setSampleRatio] = useState(SAMPLE_RATIO_DEFAULT);
  const centerColRef = useRef<HTMLDivElement | null>(null);
  const dragStartY = useRef(0);
  const dragStartRatio = useRef(SAMPLE_RATIO_DEFAULT);

  // 파서-스코프 채팅 세션 (리뷰 채팅과 분리). 워크스페이스당 하나 lazy 생성.
  const sessions = useChatSessions((s) => s.sessions);
  const createSession = useChatSessions((s) => s.createSession);
  const appendMessage = useChatSessions((s) => s.appendMessage);
  const appendAssistantChunk = useChatSessions((s) => s.appendAssistantChunk);
  const resolveAgent = useAgentRegistry((s) => s.resolve);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const acpSessionRef = useRef<string | null>(null);

  // N11: FileTree 클릭 → useTabs.activePath 갱신. 이 활성 파일을 Tauri fs 로 읽어
  // 라이브 프리뷰 샘플로 바인딩한다. 파일 미선택 시에만 DEFAULT_SAMPLE 폴백.
  const activeFilePath = useTabs((s) => s.activePath);

  // N5 / N10: 리뷰 채팅 코드블록 → 파서 모드 진입 시 운반된 소스 prefill + breadcrumb.
  const parserPrefillSource = useActivityMode((s) => s.parserPrefillSource);
  const clearParserPrefill = useActivityMode((s) => s.clearParserPrefill);
  const enteredParserFrom = useActivityMode((s) => s.enteredParserFrom);
  const exitParser = useActivityMode((s) => s.exitParser);
  const renderWithParser = useActivityMode((s) => s.renderWithParser);
  const notifyParserRegistryChanged = useActivityMode((s) => s.notifyParserRegistryChanged);

  useEffect(() => {
    if (!sessionId) {
      const created = createSession(workspace, "파서 개발");
      setSessionId(created.id);
    }
  }, [sessionId, workspace, createSession]);

  // 리뷰에서 운반된 소스가 있으면 1회 prefill 후 store 에서 소비(비움). 이후
  // 사용자가 워크벤치에서 편집한 소스를 prefill 재진입이 덮어쓰지 않도록 한다.
  useEffect(() => {
    if (parserPrefillSource) {
      setSource(parserPrefillSource);
      clearParserPrefill();
    }
  }, [parserPrefillSource, clearParserPrefill]);

  // 활성 파일이 바뀌면 그 실제 내용을 읽어 sample 로 사용. 선택 해제 시 폴백.
  useEffect(() => {
    let cancelled = false;
    if (!activeFilePath) {
      setSample(DEFAULT_SAMPLE);
      return;
    }
    void (async () => {
      const content = await readWorkspaceFile(workspace, activeFilePath);
      /* v8 ignore next -- cancelled is an unmount/active-file-change race guard; the read resolves within the same active selection under test so the early-return arm is defensive */
      if (cancelled) return;
      // 읽기 실패(null) 시에도 mock 으로 폴백 — 파서 테스트 흐름이 끊기지 않게.
      setSample(content ?? DEFAULT_SAMPLE);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeFilePath, workspace]);

  const session = sessionId ? sessions[sessionId] : undefined;

  // 라이브 프리뷰: source/sample 변경 시 debounce 후 studio 파서 재등록 + 렌더.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setPreviewError(null);
      // unregisterParser never throws (registry delete + guarded trust reset),
      // so no try/catch is needed; first run with no prior studio parser is a
      // no-op delete.
      unregisterParser(STUDIO_ID);
      const res = registerParserFromSource({
        id: STUDIO_ID,
        displayName: "studio-preview",
        extensions: [STUDIO_EXT],
        source,
      });
      if (!res.ok) {
        // register/eval is synchronous (no await above), so `cancelled` cannot
        // have flipped here — no unmount-race guard needed on this path.
        /* v8 ignore next -- registerParserFromSource sets `error` on every failure path, so the "파서 평가 실패" fallback is unreachable */
        setPreviewError(res.error ?? "파서 평가 실패");
        setPreviewHtml("");
        return;
      }
      try {
        const html = await render(sample, { path: `sample${STUDIO_EXT}` });
        if (!cancelled) setPreviewHtml(html);
      } catch (e) {
        /* v8 ignore next -- !cancelled is an unmount-race guard and String(e) only runs for non-Error throws; both are defensive */
        if (!cancelled) setPreviewError(e instanceof Error ? e.message : String(e));
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, sample]);

  // ACP 스트리밍 — 파서 세션으로 청크 누적.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    (async () => {
      try {
        const fn = await listen<AcpChunkPayload>("acp:notification", (evt) => {
          const p = evt.payload;
          if (
            p.sessionId &&
            p.sessionId === acpSessionRef.current &&
            p.update?.type === "agent_message_chunk" &&
            typeof p.update.content?.text === "string" &&
            sessionId
          ) {
            appendAssistantChunk(sessionId, p.update.content.text);
          }
        });
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      } catch (err) {
        console.warn("[ParserWorkbench] acp listen failed", err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [sessionId, appendAssistantChunk]);

  const onSend = async (text: string) => {
    /* v8 ignore next -- sessionId is created in a mount effect before the chat input is interactable, so this guard never fires from the UI */
    if (!sessionId) return;
    appendMessage(sessionId, { role: "user", content: text });
    const agent = resolveAgent(workspace, sessionId);
    if (!agent) {
      appendMessage(sessionId, {
        role: "system",
        content: "에이전트가 없습니다 — 리뷰 모드 상단에서 에이전트를 추가하세요.",
      });
      return;
    }
    if (agent.kind === "api-key") {
      appendMessage(sessionId, {
        role: "assistant",
        content: `(api-key agent ${agent.label}: legacy provider path)`,
      });
      return;
    }
    try {
      if (!acpSessionRef.current) {
        acpSessionRef.current = await getAcpAdapter().startSession(agent, workspace);
      }
      const preamble = [
        "[Markspread 파서 개발 모드]",
        "당신은 마크다운 리뷰 에디터 안에서 *런타임 커스텀 파서* 작성을 돕습니다.",
        "파서는 `(input) => ({ ast })` 형태의 JS factory 한 함수입니다.",
        "ast.kind 는 'html' | 'markdown' | 'raw'. input.content 가 원본 마크다운.",
        "사용자 요청에 맞는 factory 를 ```js 코드블록``` 하나로만 출력하세요.",
        "",
        "[현재 파서 소스]",
        "```js",
        source,
        "```",
        "[샘플 문서]",
        "```md",
        sample,
        "```",
        "[요청]",
        text,
      ].join("\n");
      await getAcpAdapter().sendMessage(acpSessionRef.current, preamble);
    } catch (err) {
      appendMessage(sessionId, {
        role: "system",
        content: `Agent error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // 파서를 실제 확장자에 등록. 성공 여부를 반환 — 역방향 '지금 렌더' 가
  // 등록 성공 시에만 리뷰로 복귀하도록 분기하기 위함.
  const applyParser = (): boolean => {
    setApplyMsg(null);
    const exts = extensions
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
      .map((e) => (e.startsWith(".") ? e : `.${e}`));
    if (!parserId.trim()) {
      setApplyMsg("파서 id 를 입력하세요.");
      return false;
    }
    if (exts.length === 0) {
      setApplyMsg("확장자를 하나 이상 입력하세요 (예: .md, .wiki).");
      return false;
    }
    // 이전 동일 id 가 있으면 교체 (unregisterParser 는 throw 하지 않음).
    unregisterParser(parserId.trim());
    const res = registerParserFromSource({
      id: parserId.trim(),
      displayName: parserId.trim(),
      extensions: exts,
      source,
    });
    setApplyMsg(
      res.ok
        ? `✅ 등록됨: ${parserId.trim()} → ${exts.join(", ")} (리뷰 모드에서 해당 파일이 이 파서로 렌더됩니다)`
        : /* v8 ignore next -- registerParserFromSource sets `error` on every failure path, so the "알 수 없는 오류" fallback is unreachable */
          `❌ 등록 실패: ${res.error ?? "알 수 없는 오류"}`,
    );
    // ADR-0019 T5: 자작 파서가 실제 확장자에 등록되면 rail 게이트 재평가 트리거.
    if (res.ok) notifyParserRegistryChanged();
    return res.ok;
  };

  const onApply = () => {
    applyParser();
  };

  // N10 역방향 동선: 등록 + 리뷰 모드 복귀 + 프리뷰 강제 재렌더(nonce 증가).
  // 등록 실패 시 워크벤치에 머문 채 오류 메시지만 표시한다.
  const onApplyAndRender = () => {
    if (applyParser()) renderWithParser();
  };

  const messages = useMemo(() => session?.messages ?? [], [session]);

  // 샘플↔프리뷰 분할 핸들 드래그. 컨테이너 높이 대비 포인터 이동을 분율로 환산.
  const onSplitPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStartY.current = e.clientY;
      dragStartRatio.current = sampleRatio;
    },
    [sampleRatio],
  );

  const onSplitPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    /* v8 ignore next -- centerColRef is attached to the rendered section before any pointer event can fire, so the `?? 0` null-ref arm is purely defensive */
    const h = centerColRef.current?.getBoundingClientRect().height ?? 0;
    setSampleRatio(nextSampleRatio(dragStartRatio.current, e.clientY - dragStartY.current, h));
  }, []);

  const onSplitPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  // 키보드 접근성: ↑/↓ 로 분율 조정 (Shift = 큰 스텝), Home/End 로 양 끝.
  const onSplitKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.03;
    setSampleRatio((r) => {
      if (e.key === "ArrowUp") return clampSampleRatio(r - step);
      if (e.key === "ArrowDown") return clampSampleRatio(r + step);
      if (e.key === "Home") return SAMPLE_RATIO_MIN;
      if (e.key === "End") return SAMPLE_RATIO_MAX;
      return r;
    });
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) e.preventDefault();
  }, []);

  return (
    <main
      className="flex h-full w-full flex-col"
      aria-label={t("activity.parser", "파서 개발")}
      data-shell="parser"
    >
      <header className="flex items-center gap-2 border-[var(--color-border)] border-b px-4 py-2">
        {/* N5 breadcrumb: 리뷰에서 진입했으면 '돌아가기' 로 원래 모드 복귀. */}
        {enteredParserFrom && (
          <button
            type="button"
            data-testid="parser-back"
            onClick={() => exitParser()}
            className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-muted)] text-xs hover:bg-[var(--color-border)]/40 hover:text-[var(--color-fg)]"
            title={t("parser.back", "리뷰로 돌아가기")}
          >
            <span aria-hidden="true">‹</span>
            <span>{t("parser.back", "리뷰로 돌아가기")}</span>
          </button>
        )}
        <span className="font-medium text-sm">{t("activity.parser", "파서 개발")}</span>
        <span className="text-[var(--color-muted)] text-xs">
          — 런타임 커스텀 파서 작성 + 라이브 프리뷰
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 최좌: 공유 FileTree — 워크스페이스 실제 파일 선택 → 라이브 프리뷰 샘플 */}
        <section
          className="flex w-[240px] min-w-[180px] flex-col border-[var(--color-border)] border-r"
          data-testid="parser-file-tree"
        >
          <div className="border-[var(--color-border)] border-b px-3 py-1.5 text-[var(--color-muted)] text-xs">
            워크스페이스 파일
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <FileTree workspace={workspace} splitId={PARSER_SPLIT_ID} />
          </div>
        </section>

        {/* 좌: 파서 코드 + 메타 + 적용 */}
        <section className="flex min-w-0 flex-1 flex-col border-[var(--color-border)] border-r">
          <div className="flex items-center gap-2 border-[var(--color-border)] border-b px-3 py-1.5 text-xs">
            <input
              data-testid="parser-id"
              value={parserId}
              onChange={(e) => setParserId(e.target.value)}
              placeholder="parser-id"
              className="w-28 rounded border border-[var(--color-border)] bg-transparent px-1.5 py-0.5"
            />
            <input
              data-testid="parser-extensions"
              value={extensions}
              onChange={(e) => setExtensions(e.target.value)}
              placeholder=".md, .wiki"
              className="w-32 rounded border border-[var(--color-border)] bg-transparent px-1.5 py-0.5"
            />
            <button
              type="button"
              data-testid="parser-apply"
              onClick={onApply}
              className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:bg-[var(--color-border)]/40"
            >
              적용
            </button>
            {/* N10 역방향: 등록 후 리뷰로 돌아가 활성 문서를 새 파서로 즉시 렌더. */}
            <button
              type="button"
              data-testid="parser-apply-render"
              onClick={onApplyAndRender}
              className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:bg-[var(--color-border)]/40"
              title={t(
                "parser.applyAndRender.hint",
                "등록 후 리뷰로 돌아가 활성 문서를 이 파서로 렌더",
              )}
            >
              {t("parser.applyAndRender", "이 파서로 지금 렌더")}
            </button>
          </div>
          <textarea
            data-testid="parser-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-snug outline-none"
          />
          {applyMsg && (
            <div
              data-testid="parser-apply-msg"
              className="border-[var(--color-border)] border-t px-3 py-1.5 text-xs"
            >
              {applyMsg}
            </div>
          )}
        </section>

        {/* 중: 샘플 입력 + 라이브 프리뷰 — 프리뷰 우선, 핸들로 비율 조정. */}
        <section
          className="flex min-w-0 flex-1 flex-col border-[var(--color-border)] border-r"
          ref={centerColRef}
          data-testid="parser-center"
        >
          <div
            className="border-[var(--color-border)] border-b px-3 py-1.5 text-[var(--color-muted)] text-xs"
            data-testid="parser-sample-source"
          >
            {activeFilePath
              ? /* v8 ignore next -- split() on a non-empty path always yields ≥1 element, so .pop() is never undefined and the `?? activeFilePath` fallback is unreachable */
                `샘플: ${activeFilePath.split(/[/\\]/).pop() ?? activeFilePath}`
              : "샘플 마크다운 (파일 미선택 — mock)"}
          </div>
          {/* 샘플 영역 — flex-basis = 비율. 프리뷰가 남은 공간을 모두 가져간다. */}
          <textarea
            data-testid="parser-sample"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            spellCheck={false}
            style={{ flexBasis: `${Math.round(sampleRatio * 100)}%` }}
            className="min-h-0 shrink-0 resize-none bg-transparent p-3 font-mono text-xs leading-snug outline-none"
          />
          {/* 드래그 핸들 — 위/아래 비율을 조정 (프리뷰 영역 우선 확보). */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-valuenow={Math.round(sampleRatio * 100)}
            aria-valuemin={Math.round(SAMPLE_RATIO_MIN * 100)}
            aria-valuemax={Math.round(SAMPLE_RATIO_MAX * 100)}
            aria-label={t("parser.workbench.resizeSample", "샘플/프리뷰 비율 조정")}
            tabIndex={0}
            data-testid="parser-sample-resizer"
            className="h-1 shrink-0 cursor-row-resize touch-none border-[var(--color-border)] border-y bg-[var(--color-border)] hover:bg-[var(--color-accent)] focus-visible:bg-[var(--color-accent)] focus-visible:outline-none"
            onPointerDown={onSplitPointerDown}
            onPointerMove={onSplitPointerMove}
            onPointerUp={onSplitPointerUp}
            onPointerCancel={onSplitPointerUp}
            onKeyDown={onSplitKeyDown}
          />
          <div className="border-[var(--color-border)] border-b px-3 py-1.5 text-[var(--color-muted)] text-xs">
            라이브 프리뷰
          </div>
          {previewError ? (
            <div data-testid="parser-preview-error" className="p-3 text-red-600 text-xs">
              파서 오류: {previewError}
            </div>
          ) : (
            <div
              data-testid="parser-preview"
              className="prose min-h-0 flex-1 overflow-auto p-3 text-sm"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: render() 가 sanitizeHtml 로 화이트리스트 정제한 HTML 만 반환
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          )}
        </section>

        {/* 우: 공용 채팅 — 파서 구현 보조. 코드블록 "에디터로" → 소스 로드 */}
        <section className="flex w-[360px] min-w-[300px] flex-col">
          <div className="border-[var(--color-border)] border-b px-3 py-1.5 text-[var(--color-muted)] text-xs">
            AI — 파서 구현 보조
          </div>
          <ChatStream
            messages={messages}
            onSend={onSend}
            onRegisterParser={(src) => setSource(src)}
          />
        </section>
      </div>
    </main>
  );
}
