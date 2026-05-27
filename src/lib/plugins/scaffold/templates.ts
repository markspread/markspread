// S-PL-SEC-001 (MAR-1019): LLM-assisted plugin scaffolding templates.
//
// 이 모듈은 *순수 문자열 빌더* 만 노출한다 — 파일 시스템 / Tauri 의존성
// 없음. scaffold.ts 가 결과 `Record<path,string>` 을 받아 PluginHost 로
// 흘려보낸다. 분리 이유:
//   (a) 테스트가 디스크 없이 정확한 템플릿 산출을 검증할 수 있다.
//   (b) ChatShell 에이전트가 "draft 만 보여주고 install 은 따로" 같은
//       흐름을 만들 수 있다 (draft 상태에서 사용자가 review).

import type { Permission, RenderMode } from "../runtime/types";

/** scaffoldPlugin 의 입력. ADR-0012 D2 의 필수 키만 받는다. */
export interface ScaffoldSpec {
  /** lowercase + dash, 1-32자. manifest 의 `name` 과 동일. */
  name: string;
  /** codeblock (```lang) 또는 fence (:::name). 가장 흔한 두 케이스. */
  kind: "codeblock" | "fence";
  /** lang 또는 fence name (e.g. "mermaid", "note"). */
  key: string;
  /** 디스플레이용 한 줄 설명. README 와 manifest 의 description 에 들어간다. */
  hint?: string;
  /** 권한 — 빈 배열이 디폴트. network 가 있으면 allowedHosts 가 강제된다. */
  permissions?: Permission[];
  /** network 권한과 짝. */
  allowedHosts?: string[];
  /** 출력 모드. 디폴트는 html (가장 안전). */
  render?: RenderMode;
  /** SemVer. 디폴트 0.1.0. */
  version?: string;
}

/** scaffoldPlugin 의 결과. key = 상대경로, value = 파일 내용. */
export interface ScaffoldFiles {
  "markspread-plugin.json": string;
  "index.js": string;
  "README.md": string;
}

/**
 * Manifest JSON 을 생성. ADR-0012 D2 의 모든 필수 키를 포함하고,
 * passthrough 키는 추가하지 않는다 (forward-compat).
 */
export function buildManifest(spec: ScaffoldSpec): string {
  const permissions = spec.permissions ?? [];
  const allowedHosts = spec.allowedHosts ?? [];
  const render: RenderMode = spec.render ?? "html";
  const version = spec.version ?? "0.1.0";
  const contributes =
    spec.kind === "codeblock"
      ? { codeblocks: { [spec.key]: { render } } }
      : { fences: [{ name: spec.key, render }] };
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    name: spec.name,
    version,
    entry: "./index.js",
    description: spec.hint ?? `Scaffolded ${spec.kind} plugin for "${spec.key}".`,
    permissions,
    allowedHosts,
    contributes,
    render,
    engines: { markspread: ">=1.3.0" },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Worker entry skeleton. host:init → plugin:ready handshake + hook:invoke
 * dispatch. 본문 본체에는 TODO 주석을 남겨 LLM 이나 사용자가 채워 넣을
 * 곳을 명시한다.
 */
export function buildIndexJs(spec: ScaffoldSpec): string {
  const registered =
    spec.kind === "codeblock"
      ? `{ kind: "codeblock", key: ${JSON.stringify(spec.key)} }`
      : `{ kind: "fence", key: ${JSON.stringify(spec.key)} }`;
  const dispatch =
    spec.kind === "codeblock"
      ? `m.kind === "codeblock" && m.key === ${JSON.stringify(spec.key)}`
      : `m.kind === "fence" && m.key === ${JSON.stringify(spec.key)}`;
  return `// ${spec.name} — scaffolded plugin.
// ADR-0012 worker hook: host posts \`host:init\`, we reply \`plugin:ready\`,
// then handle \`hook:invoke\` calls and reply with \`hook:result\`.

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function render(source) {
  // TODO: replace this stub with your real renderer. The return must be
  // { kind: "html", html: "<...>" } or { kind: "error", message: "..." }.
  return {
    kind: "html",
    html: \`<pre class="ms-${spec.name}">\${escapeHtml(source)}</pre>\`,
  };
}

self.addEventListener("message", (ev) => {
  const m = ev.data;
  if (!m || typeof m !== "object") return;
  if (m.type === "host:init") {
    self.postMessage({
      type: "plugin:ready",
      registered: [${registered}],
    });
    return;
  }
  if (m.type === "hook:invoke" && ${dispatch}) {
    const result = render(m.payload.source);
    self.postMessage({ type: "hook:result", requestId: m.requestId, result });
  }
});
`;
}

/** README.md skeleton — 사용자 검토용. */
export function buildReadme(spec: ScaffoldSpec): string {
  const trigger =
    spec.kind === "codeblock"
      ? `\`\`\`${spec.key}\n…content…\n\`\`\``
      : `:::${spec.key}\n…content…\n:::`;
  const permissions = spec.permissions ?? [];
  const permsLine =
    permissions.length === 0
      ? "None (pure transform — no network, no fs)."
      : permissions.join(", ");
  return `# ${spec.name}

${spec.hint ?? `Scaffolded ${spec.kind} plugin for \`${spec.key}\`.`}

## Trigger

${trigger}

## Permissions

${permsLine}

## Install

Copy this folder to \`~/.markspread/plugins/${spec.name}/\` and reload
Markspread (or use the Plugin Author Panel's **Install** button).

## TODO

- Replace the stub renderer in \`index.js\` with your logic.
- Add a screenshot or ASCII demo to this README.
- Bump \`version\` in \`markspread-plugin.json\` when you ship changes.
`;
}
