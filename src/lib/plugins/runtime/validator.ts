// ADR-0016 (T5.B): Validator — parser/plugin source 정적 분석.
//
// 본 모듈은 *순수 text/regex* 분석. AST 파싱은 비용 대비 가치가 적어 v1 에서는
// regex 기반으로 두고, 알려진 false-positive (string 내부 패턴) 는 코드 주석
// 으로 명시한다. AST 도입은 별도 ADR.
//
// 검사 대상:
//   - 코드 실행 우회: eval, new Function, dynamic import(), require
//   - 네트워크 / IPC: fetch, XMLHttpRequest, WebSocket, EventSource, postMessage
//   - DOM injection: document.write, innerHTML 대입
//   - DoS heuristic: while(true), for(;;)
//
// caller (CreateParserDialog, register-from-source, orchestrator) 는 결과의
// violations 를 사용자에게 보여주고, llm-generated trust level 의 경우
// 동의 dialog 에서 violations 를 함께 표시한다.

export type ViolationCode =
  | "eval"
  | "new_function"
  | "dynamic_import"
  | "require"
  | "network_fetch"
  | "network_xhr"
  | "network_websocket"
  | "network_event_source"
  | "ipc_post_message"
  | "document_write"
  | "innerhtml_assign"
  | "infinite_loop";

export interface Violation {
  code: ViolationCode;
  /** 매치된 줄의 원본 텍스트 (트리밍됨). */
  snippet: string;
  span: {
    /** 1-based line. */
    line: number;
    /** 1-based column. */
    column: number;
    /** match length (chars). */
    length: number;
  };
  /** 사람-친화 메시지 — UI 표시용. */
  message: string;
}

export interface AnalyseOptions {
  /** 이 set 에 포함된 code 는 violation 으로 보고하지 않음. */
  allow?: Set<ViolationCode>;
}

interface Rule {
  code: ViolationCode;
  pattern: RegExp;
  message: string;
}

// `\b` word boundary 로 `eval2` 같은 변수명 false-positive 차단.
// 각 호출마다 `new RegExp` 로 재생성해 lastIndex 누수 방지.
const RULES: Rule[] = [
  {
    code: "eval",
    pattern: /\beval\s*\(/g,
    message: "eval() — 동적 코드 실행 금지",
  },
  {
    code: "new_function",
    pattern: /\bnew\s+Function\s*\(/g,
    message: "new Function() — 동적 코드 실행 금지",
  },
  {
    code: "dynamic_import",
    // `.import(` 같은 메소드 호출 / `someimport(` 변수 호출 false-positive 방지
    pattern: /(?<![.\w])import\s*\(/g,
    message: "import() — 런타임 모듈 로드 금지",
  },
  {
    code: "require",
    pattern: /(?<![.\w])require\s*\(/g,
    message: "require() — CommonJS 모듈 로드 금지",
  },
  {
    code: "network_fetch",
    pattern: /(?<![.\w])fetch\s*\(/g,
    message: "fetch() — 외부 네트워크 호출 금지",
  },
  {
    code: "network_xhr",
    pattern: /\bnew\s+XMLHttpRequest\b/g,
    message: "XMLHttpRequest — 외부 네트워크 호출 금지",
  },
  {
    code: "network_websocket",
    pattern: /\bnew\s+WebSocket\s*\(/g,
    message: "WebSocket — 외부 채널 개설 금지",
  },
  {
    code: "network_event_source",
    pattern: /\bnew\s+EventSource\s*\(/g,
    message: "EventSource — 외부 stream 구독 금지",
  },
  {
    code: "ipc_post_message",
    pattern: /\bpostMessage\s*\(/g,
    message: "postMessage — 부모 frame / worker 와의 IPC 금지",
  },
  {
    code: "document_write",
    pattern: /\bdocument\.write(?:ln)?\s*\(/g,
    message: "document.write — DOM 직접 수정 금지",
  },
  {
    code: "innerhtml_assign",
    // `.innerHTML =` 만 매치 (.innerText 등 제외)
    pattern: /\.innerHTML\s*=(?!=)/g,
    message: "innerHTML 대입 — XSS 가능 (sanitizer 우회)",
  },
  {
    code: "infinite_loop",
    pattern: /\b(?:while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\))/g,
    message: "무한 루프 추정 — DoS 가능 (BudgetGuard 가 차단하지만 사전 경고)",
  },
];

/**
 * `source` 를 RULES 전체에 대해 검사. allow 옵션으로 일부 규칙을 무시 가능.
 */
export function analyse(source: string, opts: AnalyseOptions = {}): Violation[] {
  const allow = opts.allow ?? new Set<ViolationCode>();
  const violations: Violation[] = [];
  for (const rule of RULES) {
    if (allow.has(rule.code)) continue;
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m: RegExpExecArray | null = re.exec(source);
    while (m !== null) {
      const { line, column } = offsetToLineColumn(source, m.index);
      const lineEnd = source.indexOf("\n", m.index);
      const lineStart = source.lastIndexOf("\n", m.index - 1) + 1;
      const snippet = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim();
      violations.push({
        code: rule.code,
        snippet,
        span: { line, column, length: m[0].length },
        message: rule.message,
      });
      m = re.exec(source);
    }
  }
  violations.sort((a, b) => a.span.line - b.span.line || a.span.column - b.span.column);
  return violations;
}

/**
 * violation 이 하나도 없으면 true. allow set 적용 후 기준.
 */
export function isClean(source: string, opts: AnalyseOptions = {}): boolean {
  return analyse(source, opts).length === 0;
}

function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset; i++) {
    if (source.charCodeAt(i) === 0x0a) {
      line += 1;
      lastNewline = i;
    }
  }
  // lastNewline 이 -1 이면 column = offset + 1 (1-based)
  return { line, column: offset - lastNewline };
}
