// ADR-0014 + H13: 드래그-채팅 편집 — 선택 → 채팅 컨텍스트 주입 + 응답 → 인라인 diff.
//
// 순수 logic. UI 컴포넌트 (DragChatOverlay 등) 는 본 모듈만 import.
//
// 흐름:
//   1. 사용자가 md 에디터에서 텍스트 선택
//   2. captureSelection(view) → SelectionContext
//   3. 채팅 입력창에 SelectionContext + 사용자 prompt 주입
//   4. AI 응답 → diff 생성 (computeInlineDiff)
//   5. 인라인 diff overlay 렌더 (UI 책임)
//   6. 사용자 결정 → applyDecision

export interface SelectionContext {
  /** absolute file path */
  filePath: string;
  /** 1-based line + column 의 시작점 */
  from: { line: number; col: number };
  /** 1-based line + column 의 끝점 */
  to: { line: number; col: number };
  /** 선택된 raw 텍스트 */
  selectedText: string;
  /** 선택 앞뒤 N 줄 컨텍스트 (AI 가 의미 이해할 수 있도록) — default 5줄. */
  surroundingContext?: {
    before: string;
    after: string;
  };
}

export interface ChatPromptPayload {
  /** 사용자 입력 (자연어 — "이 단락 더 부드럽게") */
  userPrompt: string;
  /** 자동 주입된 컨텍스트 */
  selection: SelectionContext;
  /** 추가 메타 (timestamp, sessionId 등) — caller 정의 */
  meta?: Record<string, unknown>;
}

/**
 * AI 응답 → 인라인 diff 형태로 분해.
 * 단순 line-level diff (LCS) — 의존성 0. 정교한 diff 는 후속 (jsdiff 등) 대체 가능.
 */
export interface InlineDiff {
  /** 원본 (selectedText) */
  original: string;
  /** AI 가 제안한 새 텍스트 */
  proposed: string;
  /** line-level chunks — UI 가 녹/적/유지 렌더 */
  chunks: DiffChunk[];
}

export type DiffChunkKind = "equal" | "remove" | "add";

export interface DiffChunk {
  kind: DiffChunkKind;
  text: string;
}

export type Decision = "accept" | "reject" | "retry";

export interface DecisionResult {
  /** 에디터에 반영할 새 텍스트 (accept) 또는 null (reject/retry — caller 가 다음 단계) */
  newText: string | null;
  /** 채팅 이력에 추가할 audit 라인 */
  auditLine: string;
}

/**
 * CM6 EditorView 에서 현재 선택 → SelectionContext.
 * 본 모듈은 EditorView 의존성을 직접 가지지 않음 — caller 가 view → payload 변환 후 호출.
 * 본 함수는 *데이터* 만 받음. headless 테스트 가능.
 */
export function buildSelectionContext(input: {
  filePath: string;
  fullText: string;
  fromOffset: number;
  toOffset: number;
  surroundingLines?: number;
}): SelectionContext {
  const surroundN = input.surroundingLines ?? 5;
  const selectedText = input.fullText.slice(input.fromOffset, input.toOffset);
  const from = offsetToLineCol(input.fullText, input.fromOffset);
  const to = offsetToLineCol(input.fullText, input.toOffset);

  // 선택 앞뒤 컨텍스트
  const lines = input.fullText.split("\n");
  const beforeStart = Math.max(0, from.line - 1 - surroundN);
  const afterEnd = Math.min(lines.length, to.line + surroundN);
  const before = lines.slice(beforeStart, from.line - 1).join("\n");
  const after = lines.slice(to.line, afterEnd).join("\n");

  return {
    filePath: input.filePath,
    from,
    to,
    selectedText,
    surroundingContext: { before, after },
  };
}

function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return { line, col };
}

/**
 * 사용자 prompt + selection → 채팅 페이로드.
 */
export function makeChatPrompt(userPrompt: string, selection: SelectionContext): ChatPromptPayload {
  return { userPrompt, selection };
}

/**
 * AI 응답 텍스트 → 인라인 diff.
 */
export function computeInlineDiff(original: string, proposed: string): InlineDiff {
  if (original === proposed) {
    return { original, proposed, chunks: [{ kind: "equal", text: original }] };
  }
  const o = original.split("\n");
  const p = proposed.split("\n");
  const chunks: DiffChunk[] = [];

  // 단순 LCS — n*m, 작은 selection 에선 충분.
  const lcs = lcsLines(o, p);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < o.length && j < p.length) {
    if (k < lcs.length && o[i] === lcs[k] && p[j] === lcs[k]) {
      pushChunk(chunks, "equal", `${o[i]}\n`);
      i += 1;
      j += 1;
      k += 1;
    } else if (k >= lcs.length || (i < o.length && o[i] !== lcs[k])) {
      pushChunk(chunks, "remove", `${o[i]}\n`);
      i += 1;
    } else {
      pushChunk(chunks, "add", `${p[j]}\n`);
      j += 1;
    }
  }
  while (i < o.length) {
    pushChunk(chunks, "remove", `${o[i]}\n`);
    i += 1;
  }
  while (j < p.length) {
    pushChunk(chunks, "add", `${p[j]}\n`);
    j += 1;
  }

  // 마지막 newline 처리: 원본/제안 둘 다 끝에 newline 없으면 마지막 chunk 에서 strip
  if (chunks.length > 0 && !proposed.endsWith("\n") && !original.endsWith("\n")) {
    const last = chunks[chunks.length - 1];
    if (last?.text.endsWith("\n")) {
      last.text = last.text.slice(0, -1);
    }
  }
  return { original, proposed, chunks };
}

function pushChunk(chunks: DiffChunk[], kind: DiffChunkKind, text: string): void {
  const last = chunks[chunks.length - 1];
  if (last && last.kind === kind) {
    last.text += text;
  } else {
    chunks.push({ kind, text });
  }
}

function lcsLines(a: readonly string[], b: readonly string[]): string[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const row = dp[i];
      const prev = dp[i - 1];
      if (!row || !prev) continue;
      if (a[i - 1] === b[j - 1]) {
        row[j] = (prev[j - 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(prev[j] ?? 0, row[j - 1] ?? 0);
      }
    }
  }
  const lcs: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1] ?? "");
      i -= 1;
      j -= 1;
    } else {
      const prev = dp[i - 1];
      const row = dp[i];
      if ((prev?.[j] ?? 0) >= (row?.[j - 1] ?? 0)) i -= 1;
      else j -= 1;
    }
  }
  return lcs;
}

/**
 * 사용자 결정 (accept/reject/retry) → 에디터 반영 결정.
 */
export function applyDecision(diff: InlineDiff, decision: Decision): DecisionResult {
  if (decision === "accept") {
    return {
      newText: diff.proposed,
      auditLine: `accepted: ${truncate(diff.original, 40)} → ${truncate(diff.proposed, 40)}`,
    };
  }
  if (decision === "reject") {
    return {
      newText: null,
      auditLine: `rejected: ${truncate(diff.original, 40)}`,
    };
  }
  // retry
  return {
    newText: null,
    auditLine: `retry requested for: ${truncate(diff.original, 40)}`,
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s.replace(/\n/g, "↵");
  return `${s.slice(0, n).replace(/\n/g, "↵")}...`;
}
