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

import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAcpAdapter } from "../lib/agents/acp-adapter";
import { registerParserFromSource, unregisterParser } from "../lib/parsers/register-from-source";
import { render } from "../lib/preview/render";
import { useAgentRegistry } from "../store/agent-registry";
import { useChatSessions } from "../store/chat-sessions";
import { ChatStream } from "./chat/ChatStream";

interface Props {
  workspace: string;
}

// 라이브 프리뷰는 사용자의 목표 확장자와 무관하게 격리된 sentinel 확장자로
// 등록·렌더한다 — builtin markdown 이나 다른 파서를 건드리지 않기 위함.
const STUDIO_ID = "__studio_preview__";
const STUDIO_EXT = ".__studiopreview__";

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

  // 파서-스코프 채팅 세션 (리뷰 채팅과 분리). 워크스페이스당 하나 lazy 생성.
  const sessions = useChatSessions((s) => s.sessions);
  const createSession = useChatSessions((s) => s.createSession);
  const appendMessage = useChatSessions((s) => s.appendMessage);
  const appendAssistantChunk = useChatSessions((s) => s.appendAssistantChunk);
  const resolveAgent = useAgentRegistry((s) => s.resolve);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const acpSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      const created = createSession(workspace, "파서 개발");
      setSessionId(created.id);
    }
  }, [sessionId, workspace, createSession]);

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

  const onApply = () => {
    setApplyMsg(null);
    const exts = extensions
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
      .map((e) => (e.startsWith(".") ? e : `.${e}`));
    if (!parserId.trim()) {
      setApplyMsg("파서 id 를 입력하세요.");
      return;
    }
    if (exts.length === 0) {
      setApplyMsg("확장자를 하나 이상 입력하세요 (예: .md, .wiki).");
      return;
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
  };

  const messages = useMemo(() => session?.messages ?? [], [session]);

  return (
    <main
      className="flex h-full w-full flex-col"
      aria-label={t("activity.parser", "파서 개발")}
      data-shell="parser"
    >
      <header className="flex items-center gap-2 border-[var(--color-border)] border-b px-4 py-2">
        <span className="font-medium text-sm">{t("activity.parser", "파서 개발")}</span>
        <span className="text-[var(--color-muted)] text-xs">
          — 런타임 커스텀 파서 작성 + 라이브 프리뷰
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
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

        {/* 중: 샘플 입력 + 라이브 프리뷰 */}
        <section className="flex min-w-0 flex-1 flex-col border-[var(--color-border)] border-r">
          <div className="border-[var(--color-border)] border-b px-3 py-1.5 text-[var(--color-muted)] text-xs">
            샘플 마크다운
          </div>
          <textarea
            data-testid="parser-sample"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            spellCheck={false}
            className="h-1/3 resize-none border-[var(--color-border)] border-b bg-transparent p-3 font-mono text-xs leading-snug outline-none"
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
