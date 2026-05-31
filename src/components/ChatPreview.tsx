// FIX: ChatShell 에서 md 파일 선택 시 *렌더된 미리보기* 보이기.
//
// EditorPane 만 wire 했을 땐 raw source 만 보였음. 사용자 기대: 마크다운 미리보기.
// 본 컴포넌트는 SpreadPane 을 wrap — stub PaneNode 와 fs_read_file 호출로
// content 를 가져와서 렌더된 HTML 표시.

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PaneNode } from "../lib/editor/layout-model";
import { SpreadPane } from "./SpreadPane";

interface Props {
  workspace: string;
  documentPath: string;
}

interface FsReadResult {
  content: string;
  encoding: string;
}

const STUB_PANE: PaneNode = {
  type: "pane",
  id: "chat-preview-pane",
  tabs: [],
  activeTabId: null,
};

export function ChatPreview({ workspace, documentPath }: Props): React.ReactElement {
  const { t } = useTranslation();
  const [content, setContent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setContent(null);
    setErr(null);
    invoke<FsReadResult>("fs_read_file", { workspace, path: documentPath })
      .then((r) => {
        if (active) setContent(r.content);
      })
      .catch((e) => {
        if (active) setErr(String(e));
      });
    return () => {
      active = false;
    };
  }, [workspace, documentPath]);

  if (err) {
    return (
      <div className="p-4 text-red-600 text-xs" data-testid="chat-preview-error">
        {t("chat_preview.error", "미리보기 로드 실패")}: {err}
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="p-4 text-[var(--color-muted)] text-xs" data-testid="chat-preview-loading">
        {t("chat_preview.loading", "로딩중…")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="chat-preview-root">
      <SpreadPane
        workspace={workspace}
        pane={STUB_PANE}
        documentPath={documentPath}
        content={content}
      />
    </div>
  );
}
