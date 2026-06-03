// ADR-0019 T4: ▦ ↔ ▣ 모드 전환 시 각 표면의 컨텍스트(활성 파일/탭, 채팅 세션)가
// 보존된다는 *외부 관찰 가능* 한 계약. 모드 전환은 `useActivityMode` 의 mode 만
// 바꾸며, 활성 파일을 들고 있는 `useTabs` 와 표면별 채팅을 들고 있는
// `useChatSessions` 는 어떤 모드 전환 액션에서도 건드리지 않는다.

import { beforeEach, describe, expect, it } from "vitest";
import { useActivityMode } from "../activity-mode";
import { _cancelChatFlush, useChatSessions } from "../chat-sessions";
import { useTabs } from "../tabs";

describe("ADR-0019 T4 — mode switch preserves active file + chat session", () => {
  beforeEach(() => {
    _cancelChatFlush();
    useChatSessions.getState()._reset();
    useTabs.getState().replaceAll([], null);
    useActivityMode.setState({
      mode: "workspace",
      parserPrefillSource: "",
      enteredParserFrom: null,
      parserRenderNonce: 0,
      parserRegistryRev: 0,
    });
  });

  it("keeps useTabs.activePath across ▦ → ▣ → ▦ (setMode)", () => {
    useTabs.getState().open("/ws/doc.md");
    expect(useTabs.getState().activePath).toBe("/ws/doc.md");

    useActivityMode.getState().setMode("parser");
    expect(useTabs.getState().activePath).toBe("/ws/doc.md");

    useActivityMode.getState().setMode("workspace");
    expect(useTabs.getState().activePath).toBe("/ws/doc.md");
    expect(useTabs.getState().tabs.map((t) => t.path)).toEqual(["/ws/doc.md"]);
  });

  it("keeps the active file across the enterParser / exitParser breadcrumb flow", () => {
    useTabs.getState().open("/ws/a.md");
    useTabs.getState().open("/ws/b.md");
    expect(useTabs.getState().activePath).toBe("/ws/b.md");

    useActivityMode.getState().enterParser({ prefillSource: "SRC" });
    expect(useActivityMode.getState().mode).toBe("parser");
    // entering parser carries only a source prefill — it must not disturb tabs.
    expect(useTabs.getState().activePath).toBe("/ws/b.md");

    useActivityMode.getState().exitParser();
    expect(useActivityMode.getState().mode).toBe("workspace");
    expect(useTabs.getState().activePath).toBe("/ws/b.md");
    expect(useTabs.getState().tabs).toHaveLength(2);
  });

  it("preserves workspace- and parser-surface chat sessions separately across mode switches", () => {
    // Workspace chat session (review surface).
    const review = useChatSessions.getState().createSession("ws-1", "리뷰");
    useChatSessions.getState().appendMessage(review.id, { role: "user", content: "review q" });
    // Parser Studio chat session (parser surface) — distinct session, same workspace.
    const parser = useChatSessions.getState().createSession("ws-1", "파서 개발");
    useChatSessions.getState().appendMessage(parser.id, { role: "user", content: "parser q" });

    useActivityMode.getState().setMode("parser");
    useActivityMode.getState().setMode("workspace");
    useActivityMode.getState().enterParser();
    useActivityMode.getState().exitParser();

    const sessions = useChatSessions.getState().sessions;
    expect(sessions[review.id]?.messages.map((m) => m.content)).toEqual(["review q"]);
    expect(sessions[parser.id]?.messages.map((m) => m.content)).toEqual(["parser q"]);
    // Both surface sessions survive under the same workspace, unmerged.
    expect(useChatSessions.getState().byWorkspace["ws-1"]).toEqual([parser.id, review.id]);

    _cancelChatFlush();
  });
});
