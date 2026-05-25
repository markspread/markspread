# ADR-0012: Runtime plugin security model

| Field | Value |
|---|---|
| Status | **Proposed** (S-PL-SEC-001) |
| Date | 2026-05-25 |
| Owners | Architecture Pivot cycle (v1.3 사이클) |
| Supersedes | — |
| Superseded by | — |
| Related | ADR-0010 (chat 가 플러그인 코드를 작성한다), ADR-0011 (parser SDK 격리 기초), `src/lib/parsers/registry.ts`, `src/lib/parsers/renderer-host.ts`, `src/lib/parsers/sandbox-csp.ts`, `src/lib/parsers/transport-registry.ts`, `src-tauri/Cargo.toml` (`pulldown-cmark` 0.12), `src/components/SpreadPane.tsx` |

## Context

Markspread 의 v1 포지셔닝은 **"가벼움 + 사용자 맞춤화가 VSCode 의 무거운 플러그인 모델을 이긴다"** 이다. 가벼움(15MB 번들 상한, 콜드 스타트 <600ms) 은 ADR-0007 에서 가드되고 있으므로, 이 ADR 은 **맞춤화** 쪽을 책임진다.

사용자가 명시적으로 요구한 시나리오는 세 가지다.

1. **런타임 주입**. 플러그인을 사이드로딩해 `설치 → 앱 재시작 → 활성화` 사이클을 거치지 않는다. 사용자가 `~/.markspread/plugins/<name>/index.js` 를 저장하는 순간 다음 렌더 사이클에서 반영되어야 한다.
2. **LLM 협업 저작**. 챗 표면(ADR-0010) 에서 Claude Agent 가 플러그인 코드를 직접 쓰고, 사용자가 확인 후 동일 폴더에 떨어뜨린다. 즉 *사용자의 손으로 작성한 코드는 아니지만 사용자가 검증한 코드* 가 다수다.
3. **선택적 VSCode/Cursor 플러그인 호환**. 이미 검증된 markdown-it / remark 생태계 플러그인을 얕은 shim 으로 받아쓰면 v1.3 에서 즉시 카탈로그가 채워진다. nice-to-have 이며 GA 게이트가 아니다.

대표 use case 는 다음 형태다.

````md
```wireweave
node A -> B [label="hello"]
B -> C
```
````

사용자가 만든 `wireweave` DSL 을 미리보기에서 와이어프레임 SVG 로 렌더하고 싶다. 플러그인은 `registerCodeBlock("wireweave", fn)` 같은 단일 hook 만 등록한다. 동일 호출이 헤더, custom fence, 임의 AST 노드에도 가능해야 한다.

기반 인프라는 일부 이미 존재한다.

- **파서 측 격리**: `src/lib/parsers/renderer-host.ts` 가 Web Worker / sandboxed iframe 두 transport 를 모두 지원하고 (`createWorkerTransport`, `buildIframeSrcdoc`), CSP/sandbox 속성은 `sandbox-csp.ts` 에 못 박혀 있다.
- **transport registry**: `src/lib/parsers/transport-registry.ts` 가 parserId → SandboxTransport 매핑을 보유 — 현재 비어 있고 v1 은 builtin `pulldown-cmark` (Rust) + markdown-it (TS) 만 사용한다.
- **렌더 파이프라인**: `SpreadPane.tsx` 는 `getParserTransport(parserId)` 가 있으면 sandbox 로 라우팅하고, 없으면 builtin 으로 떨어진다.

비어 있는 것은 **(i)** 플러그인 디스커버리/로딩, **(ii)** 코드블록·헤더·임의 노드 hook 의 SDK 표면, **(iii)** React 컴포넌트를 렌더 결과로 받는 경로, **(iv)** 권한 모델, **(v)** 핫리로드, **(vi)** VSCode shim. 본 ADR 은 이 여섯을 한 결정으로 묶는다.

코드 주입은 본질적으로 위험하다. LLM 이 작성한 코드를 사용자가 한 줄 한 줄 읽지 않는다는 현실(ADR-0010 의 "agent autonomy" 절) 을 인정한 위에서, **격리 경계가 #1 설계 질문** 이다.

## Options

### A. 실행 샌드박스

#### (a) 렌더러 컨텍스트에서 직접 `eval`

- 장점: 가장 빠름 (TS → Function() 직접). DOM 접근 자유로움.
- 단점:
  - 동일 origin 에 직결 — `document`, `window`, IndexedDB, `__TAURI__` 글로벌, secret-storage 핸들이 전부 노출된다.
  - `__TAURI__` 가 노출되면 `invoke("fs_write_file", …)` 같은 호스트 명령을 임의 호출할 수 있어 사실상 RCE.
  - 회수 불가능 — 한 번 등록한 hook 이 closure 로 글로벌 상태를 잡고 있으면 해제가 안 됨.
- **거부**.

#### (b) Web Worker + structured-clone postMessage 브리지 ★ parse/transform 채택

- 장점:
  - DOM, `window`, `__TAURI__` 모두 도달 불가.
  - `connect-src 'none'` CSP 로 fetch / WebSocket 봉인. ESM import 도 `script-src 'self' blob:` 안에서만 허용 — 외부 CDN 차단.
  - 메시지 채널이 좁아 감사 가능 (`messages.ts` 의 zod 스키마 한 곳에 모임).
  - `worker.terminate()` 로 깨끗한 회수.
- 단점:
  - 매 메시지 structured-clone 비용 — 큰 AST 는 직렬화 부담.
  - DOM 측정(SVG 텍스트 크기 등) 이 필요한 시각 플러그인은 별도 경로 필요.
- v1.3 에서 *기본* 격리.

#### (c) `<iframe sandbox>` per-plugin + 화이트리스트 CSP ★ render 채택

- 장점:
  - DOM 이 필요한 시각 플러그인(SVG, canvas, 측정 후 위치 계산) 이 정상 동작.
  - `allow-scripts` 만 부여 + `allow-same-origin` 제외 → opaque origin, 호스트 DOM/스토리지 도달 불가.
  - 출력은 `<iframe>` 의 own document 위에 그려져 host CSS 와 격리.
- 단점:
  - 인스턴스 비용 큼 (한 페이지에 와이어프레임 10개면 iframe 10개).
  - host ↔ iframe 통신은 여전히 postMessage — Worker 와 동일 비용 + frame 생성 비용 추가.
  - 호스트 스크롤/리사이즈와 동기화 코드가 매번 필요.
- v1.3 에서 **시각적 결과물이 필요한 플러그인에 한해** 선택적으로 사용.

#### (d) Deno 식 권한 프롬프트 런타임

- 장점: 가장 표현력 있는 권한 모델.
- 단점: 자체 runtime 빌드/유지가 v1 의 15MB 번들 상한과 충돌. 1인 팀의 유지 부담.
- **거부** (스코프 외).

→ **권장: (b) Web Worker 를 parse/transform 의 표준 격리로, (c) sandboxed iframe 을 React/HTML 산출물의 실 렌더 컨테이너로 사용하는 2-tier 구성.** 파서는 가벼운 채로 두고, 비싼 iframe 은 시각 산출물이 있을 때만 띄운다.

### B. SDK 표면

#### (B1) 순수 데이터 API (data-only)

```ts
import { definePlugin } from "@markspread/plugin-sdk";

export default definePlugin({
  name: "wireweave",
  setup(host) {
    host.registerCodeBlock("wireweave", (source, ctx) => ({
      kind: "html",
      html: renderWireweaveToSvg(source),
    }));
    host.registerInlineRule(/@@([a-z]+)/g, (m) => ({
      kind: "html", html: `<span class="mention">${m[1]}</span>`,
    }));
    host.transformNode("heading", (node) => ({ ...node, props: { anchor: true }}));
  },
});
```

- 입력: 마크다운 노드 또는 raw source 문자열, 컨텍스트 (`path`, `theme`, `permissions`).
- 출력: `{ kind: "html"; html }` 또는 `{ kind: "ast"; node }`. 두 경우 모두 host 가 `sanitiseMarkdownHtml` 로 한 번 더 통과시킨다 (`renderer-host.ts` 의 기존 보호).
- 모든 호출은 Worker 안에서 실행되고 결과만 postMessage. ❶ 작고 ❷ 감사 가능하고 ❸ 호환 shim 작성이 쉬움.

#### (B2) React 컴포넌트 API (옵션, flag 뒤)

```ts
export default definePlugin({
  name: "wireweave",
  contributes: {
    codeblocks: { wireweave: () => import("./WireweaveBlock") },
  },
});
```

- 플러그인이 lazy-imported React 컴포넌트를 노출.
- 컴포넌트는 **iframe sandbox 안의 React 18+ 런타임** 에 마운트된다 (host 의 React 19 와 격리 — 버전 충돌 회피).
- iframe 내부 React 런타임은 `esm.sh` 에서 받아온다 (CDN 의존성은 트레이드오프, *F. Consequences* 참고).
- host ↔ iframe 사이는 RPC 브리지 (`{ kind: "props"; data }`, `{ kind: "event"; name; data }`) — props 는 plain JSON 만, 이벤트는 화이트리스트.
- v1.3 에서는 **opt-in flag (`experimental.pluginsReact`)** 뒤. wireweave 같은 시각 플러그인이 충분히 모이는 v1.4 시점에 default-on 검토.

#### (B3) 네트워크/FS

- **기본 거부**. Worker CSP 가 `connect-src 'none'` 이므로 fetch 자체가 throw.
- 필요한 플러그인은 manifest 에 `permissions: ["network", "fs:read", "fs:write"]` 선언.
- 사용자가 첫 사용 시 1회 프롬프트 → 승인 시 host 가 좁은 RPC (`host.fetch(url)`, `host.readFile(relPath)`) 를 proxy.
- proxy 는:
  - `network`: manifest 의 `allowedHosts: ["api.example.com"]` 화이트리스트 강제, body 크기 상한, timeout, CORS-bypass 차단 (서버측 호출은 거부).
  - `fs:read` / `fs:write`: 워크스페이스 루트 안으로 chroot. 절대경로/`..` 정규화 후 prefix 검증.
- 거부된 호출은 plugin 측에 throw 되며 host 는 telemetry 만 기록 (toast 없음 — 의도된 거부).

### C. 신뢰 모델

#### (C1) 로컬 핫로드 = 사용자 신뢰

`~/.markspread/plugins/` 와 워크스페이스 로컬 `.markspread/plugins/` 에서 발견된 플러그인은 **사용자가 직접 보유한 코드** 로 간주한다. 사용자가 LLM 의 출력을 한 번 검토하고 디스크에 떨어뜨린 행위 = 인증 의식.

- 서명 검증 없음.
- 단, *처음 발견 시* 사이드패널에 "이 플러그인이 추가됨 (… 줄, … 권한 요청)" non-blocking 카드. 사용자가 "Disable" 누르면 manifest 만 disable list 에 적힌다.

#### (C2) 미래의 마켓플레이스 = 서명 필요

GA 후 카탈로그(원격 받아쓰기) 가 생기면 서명/체크섬 검증이 필수. **본 ADR 의 스코프 외** — `S-PL-MKT-*` 시리즈에서 별도 ADR.

#### (C3) 권한 그랜트 영속화

`~/.markspread/plugins/<name>/.granted.json` 에 `{ grantedAt, permissions, version }` 저장. 플러그인 `version` 이 manifest 에서 올라가면 권한 재요청 (LLM 이 silently 권한 추가하는 시나리오 차단).

## Decision

### D1. 격리 조합

- **모든 플러그인은 Web Worker 안에서 실행**한다. 격리 transport 는 `src/lib/parsers/transport-registry.ts` 의 기존 메커니즘을 그대로 사용 — pluginId → SandboxTransport.
- 플러그인이 `contributes.codeblocks.<lang>` 에 React 컴포넌트 또는 HTML 을 결과로 내고 그 결과가 *DOM 측정/상호작용* 을 필요로 한다 (`render.mode = "iframe"`) 고 manifest 에 선언한 경우에 한해, host 가 **렌더 시점에** sandboxed iframe 을 한 번 더 만들어 안에 마운트한다.
- 즉 격리는 항상 2-단계: Worker (parse/transform) → 결과 → 필요시 iframe (render). Worker 만으로 끝나는 플러그인(텍스트 HTML 만 반환) 이 다수 케이스.

### D2. 플러그인 manifest (`markspread-plugin.json`)

```jsonc
{
  "schemaVersion": 1,
  "name": "wireweave",                  // 영숫자+`-`, 32자 이하 (FS-safe).
  "version": "0.3.1",                   // SemVer.
  "entry": "./index.js",                // ESM 모듈, default export 가 definePlugin 결과.
  "displayName": "Wireweave diagrams",  // UI 표시용 (옵션).
  "description": "Render wireweave fenced blocks as SVG wireframes.",
  "permissions": [],                    // ["network", "fs:read", "fs:write"] 부분집합.
  "allowedHosts": [],                   // permissions 가 network 포함 시 필수.
  "contributes": {
    "codeblocks": { "wireweave": { "render": "html" } },
    "headers":   { "h1": { "render": "html" } },
    "fences":    [],                    // custom fence (```...``` 안의 첫 토큰 매칭).
    "inlineRules": []                   // 정규식 hook (string 형태로만 — RegExp 직렬화).
  },
  "render": "html",                     // "html" | "react" | "iframe-react".
  "engines": { "markspread": ">=1.3.0 <2.0.0" }
}
```

- `entry` 는 manifest 와 같은 디렉터리 prefix 안에 있어야 한다. 절대경로/`..` 거부.
- `permissions` 비어 있는 manifest 는 권한 프롬프트 없이 자동 활성.
- `render: "react"` 또는 `"iframe-react"` 는 D1 의 iframe 경로를 강제.
- 알 수 없는 키는 무시 (forward-compat). 알 수 없는 `permissions` 값은 manifest 거부.

### D3. 호스트 라이프사이클

```
discover  →  load manifest  →  spawn worker  →  exchange capabilities  →
register hooks  →  watch FS for hot reload  →  (on change) tear down  →  re-spawn
```

각 단계:

1. **Discover** — 부트 시점 + `notify` 워처 (이미 `src-tauri/Cargo.toml` 의 `notify` 활용) 가 `~/.markspread/plugins/*/markspread-plugin.json` 과 `<workspace>/.markspread/plugins/*/markspread-plugin.json` 두 곳을 감시. 워크스페이스 로컬이 우선순위.
2. **Load manifest** — zod 스키마 검증 → 실패 시 toast + sidepanel "broken plugin" 표시.
3. **Spawn worker** — `entry` 를 blob URL 로 만들어 `createWorkerTransport(blobUrl)`. 모듈 로드 실패 시 같은 broken state.
4. **Capability handshake** — host → worker `{ type: "host:init"; capabilities; pluginConfig }`. worker → host `{ type: "plugin:ready"; registered: [{ kind, key }] }`. 8초 timeout (기본 5초보다 길게 — esm.sh 의존 플러그인 cold start 대응).
5. **Hook 등록** — `registered` 리스트를 `getParserRegistry()` 의 코드블록/inline 디스패처에 연결. 같은 키(`codeblocks.wireweave`) 가 둘 이상의 플러그인에서 선언되면 **워크스페이스 로컬 우선**, 동률이면 알파벳 첫 이름 우선 + 충돌 카드 표시.
6. **Hot reload** — `notify-debouncer-mini` 의 250ms debounce 윈도우로 (`entry` 파일이든 manifest 든) 변경 감지 → `unregisterParserTransport(pluginId)` → `worker.terminate()` → 재로딩. 현재 진행 중인 render 는 새 worker 가 뜨면 다음 debounce 사이클에서 재실행 (`SpreadPane.tsx` 의 300ms debounce 와 자연 정합).
7. **Per-plugin worker** — *플러그인마다 워커 하나*. 서로 다른 플러그인이 절대 같은 worker scope 를 공유하지 않는다 (Consequences 의 cross-plugin 공격 회피).

### D4. SDK 패키지 분할

기존 `@markspread/parser-sdk` 와 별개로 `@markspread/plugin-sdk` 를 신설.

| 패키지 | 역할 |
|---|---|
| `@markspread/parser-sdk` | 파일 단위 파서 (현행 ADR-0011) |
| `@markspread/plugin-sdk` | 노드 hook (코드블록, 헤더, inline rule, transform). 본 ADR 의 산출물 |

`plugin-sdk` 는 `definePlugin` / `registerCodeBlock` / `transformNode` / 권한 헬퍼 (`host.fetch`, `host.readFile`) 를 export. parser-sdk 와 같은 transport / message 스키마 위에 얹는다 — `messages.ts` 에 plugin hook 메시지 타입 추가.

### D5. React 산출물 — iframe 마운트 전략

`render: "react"` 플러그인은 iframe srcdoc 에 다음을 부트.

```html
<!doctype html>
<meta http-equiv="Content-Security-Policy" content="<IFRAME_CSP_META + esm.sh 허용>">
<script type="module">
  import React from "https://esm.sh/react@18";
  import { createRoot } from "https://esm.sh/react-dom@18/client";
  // host 가 postMessage 로 보낸 plugin entry 를 import
  // 받은 컴포넌트를 createRoot 로 마운트, props 채널 구독
</script>
```

- `IFRAME_CSP_META` 의 `connect-src` 는 React 산출물 전용으로 `https://esm.sh` 만 허용 (default `'none'` 에서 명시 완화).
- esm.sh 의존이 들어오므로 *offline 환경* 대응이 필요 → manifest 가 `render: "react"` 인 플러그인은 첫 활성 시 esm.sh 응답을 IndexedDB 캐시 (한 번 받으면 오프라인에서도 동작). 캐시 키는 React 버전 핀.
- React 19 (host) 와 React 18 (iframe) 의 분리는 의도적이다 — host 가 19→20 으로 갈 때 플러그인 생태계가 끌려가지 않게 한다.

### D6. VSCode/Cursor 호환 shim — PoC 등급

```
@markspread/plugin-sdk/compat/vscode
@markspread/plugin-sdk/compat/markdownit
```

매핑:

- `contributes.markdown.previewStyles` → host 가 워크스페이스 CSS slot 에 `<link>` 주입.
- `contributes.markdown.markdownItPlugins.provideMarkdownExtensions()` → 반환된 markdown-it 플러그인을 host 의 `MarkdownIt` 인스턴스에 `.use(plugin)`. 실행 컨텍스트는 여전히 Worker 안.
- `vscode.commands.registerCommand` 등 에디터 API 는 stub (호출되면 noop + telemetry).
- remark 플러그인은 별도 `compat/remark` 어댑터 (remark AST → 본 SDK 의 transformNode).

**보장 수준**: "잘 작성된 markdown-it 플러그인 다섯 개 (`emoji`, `footnote`, `task-lists`, `container`, `anchor`) 가 동작" 까지. GA 게이트가 아님 — 호환되면 좋고 안 되면 markspread-native 변형을 LLM 이 빠르게 작성. v1.4 시점에 카탈로그 사이즈 보고 deprecation 결정.

### D7. 메시지 스키마

기존 `src/lib/parsers/messages.ts` 의 zod union 에 다음 variant 를 추가.

- `host:init`, `plugin:ready`, `plugin:err`
- `hook:invoke` (`{ kind: "codeblock"|"header"|"inline"|"transform"; key; payload }`)
- `hook:result` (`{ requestId; html?; ast?; warnings? }`)
- `host:fetch` / `host:fs-read` / `host:fs-write` + 응답 (권한 grant 가 있는 플러그인만 사용)

모든 응답은 `sanitiseMarkdownHtml` 통과. 권한 RPC 응답은 그 자체로 sanitize 대상이 아니지만 호출 사이트 (`registerCodeBlock` 결과) 가 결국 sanitize 된다.

### D8. 권한 프롬프트 UX

- 첫 사용 시점 (hook 이 실제로 invoke 되는 시점이 아닌 worker 활성 시점) 에 사이드패널 toast: "**wireweave** 가 다음 권한을 요청합니다: network (api.example.com). [Allow once] [Allow always] [Deny]".
- "Allow once" = 이번 세션. "Allow always" = `.granted.json` 영속.
- Deny 시 worker 는 활성된 채 유지 (hook 등록은 가능) — 권한 RPC 만 throw. 플러그인 author 가 graceful degradation 을 책임.

## Consequences

### 양

- 진정한 런타임 맞춤화. 사용자가 LLM 과 채팅하며 만든 코드가 즉시 미리보기에 반영.
- 격리 경계가 *명시적이고 작다* — 두 transport (Worker / iframe) 와 한 스키마 (`messages.ts`) 로 모든 confidentiality/integrity 가 추적됨.
- 기존 parser-sdk 인프라 (transport registry, CSP, sanitization) 의 90% 재사용.
- VSCode shim 으로 v1.3 출시 시점에 카탈로그가 비어 있지 않음.

### 음

- Worker spawn / postMessage / structured-clone 의 누적 비용. 큰 문서(10k 줄, 코드블록 100개) 에서 측정 필요. 가드: `S-PL-SEC-005` 에서 1k 줄 markdown · 50 hook 호출 시 추가 지연 < 50ms 를 회귀 기준으로.
- React 산출물 = esm.sh 의존. **오프라인 첫-실행 불가** 케이스가 존재. 캐시 (`D5`) 가 mitigation 이지만 zero-trust 환경의 사용자에게는 거부 사유가 됨 → 문서에 명시.
- 권한 grant 가 늘면 사용자가 dialog-fatigue 로 무지성 승인할 위험. v1.4 에서 "권한 다이제스트" (한 화면에 모든 grant) 화면이 follow-up 으로 필요.

### 위험

- **R1: cross-plugin 공격**. 한 플러그인이 다른 플러그인의 export 를 가로채려 시도. → **mitigation**: D3.7 의 per-plugin worker 격리. 공유 글로벌 없음. 한 워커가 죽어도 다른 워커 무관.
- **R2: esm.sh 공급망**. 외부 CDN 이 손상되면 React 산출물 플러그인 전체 영향. → **mitigation**: IndexedDB 캐시 + SRI 해시를 manifest 옵션으로 (`react.integrity`). 캐시 hit 후에는 외부 호출 없음.
- **R3: sanitize 우회**. 플러그인이 HTML 을 반환하고 host 가 sanitize 하지만 sanitizer 가 모르는 새 벡터 (e.g. CSS expression). → **mitigation**: 기존 `sanitiseMarkdownHtml` 의 회귀 테스트 셋에 plugin-origin 카테고리 추가, `S-PL-SEC-006` 에서 fuzz.
- **R4: 권한 escalation by version bump**. 플러그인 v0.3 에서 권한 없던 것이 v0.4 에서 `fs:write` 추가. → **mitigation**: D2 의 `version` 변경 시 `.granted.json` 무효화 + 재프롬프트.
- **R5: hot-reload race**. 렌더 중 worker 종료 → 결과 도착하지 않음. → **mitigation**: `renderInSandbox` 의 timeout 가드가 이미 존재 (`renderer-host.ts:97`). worker 종료 시 transport 가 dispose → host 가 `kind: "error"; "worker disposed"` 로 settle.
- **R6: 악성 manifest 의 path traversal**. `entry: "../../../etc/passwd"`. → **mitigation**: D2 의 prefix 검증, manifest 디렉터리 밖 entry 거부.
- **R7: LLM-generated 가짜 권한 누락**. LLM 이 fetch 호출은 넣었는데 manifest 에 `network` 권한을 빼먹어 사용자가 모르고 활성. → 실제 호출 시 throw + sidepanel 에 "권한 누락" 카드. 사용자가 LLM 에게 "manifest 에 추가해줘" 요청하는 자연스러운 루프.

### 영향 받는 파일 (구현 단계 참고용)

- `src/lib/parsers/messages.ts` — 메시지 union 확장.
- `src/lib/parsers/transport-registry.ts` — pluginId 도 같은 맵에 수용 (또는 별도 맵 분리).
- 신설 `src/lib/plugins/loader.ts` — discover/load/hot-reload.
- 신설 `src/lib/plugins/manifest.ts` — zod 스키마.
- 신설 `src/lib/plugins/permissions.ts` — grant 저장/검증.
- 신설 `src-tauri/src/plugin_watch.rs` — `~/.markspread/plugins/` notify 워처 + tauri command.
- `src/components/SpreadPane.tsx` — 코드블록 디스패처에 plugin lookup 추가.
- 신설 `src/components/PluginIframeHost.tsx` — D5 의 iframe 마운트.

## Telemetry

성공·실패 모두 hashed pluginId 로 익명 집계. 본문 자체는 절대 송출 안 함.

- `plugin.loaded` { pluginIdHash, hasPermissions, contributesCount }
- `plugin.hook.invoke` { pluginIdHash, hookKind, durationBucket }
- `plugin.sandbox.crash` { pluginIdHash, mode: "worker"|"iframe", reason }
- `plugin.permission.granted` / `.denied` { pluginIdHash, permission, scope: "once"|"always" }
- `plugin.hot_reload` { pluginIdHash, changedFile }
- `plugin.compat.shim_used` { shim: "vscode"|"markdownit"|"remark", pluginIdHash }

ADR-0008 의 telemetry opt-in 동의 안에서만 송출.

## Open questions

다음은 후속 티켓으로 분리한다.

- **OQ1: TypeScript-in-plugin 지원** — `.ts` entry 를 host 가 transpile 해서 worker 에 넣을지, 아니면 빌드 step 을 강요할지. 빌드 강요는 "LLM 이 쓰자마자 동작" UX 와 충돌. 후보: esbuild-wasm 을 host 에 번들. 트레이드오프: 번들 사이즈. → `S-PL-DX-001` 분리.
- **OQ2: 번들링 step** — 다중 파일 플러그인 (entry + utils) 지원 시 import 해석을 host 가 할지 worker 가 할지. Worker 내부 `import` 는 blob: 안에서 같은 origin 으로 풀어야 가능 → preload 단계에서 host 가 의존성 그래프를 평탄화하는 안. → `S-PL-DX-002`.
- **OQ3: 렌더 사이클 중 hot-swap** — 한 페이지 렌더 도중 플러그인 swap 이 발생하면 일부 노드는 구버전, 일부는 신버전 산출물. 사용자에게 시각적 불일치. 후보: 핫스왑 시 다음 idle frame 까지 hold. → `S-PL-DX-003`.
- **OQ4: 플러그인 설정 UI** — 플러그인이 `host.getConfig()` 같은 채널로 사용자 설정을 받을 수 있어야 하는가, 아니면 markdown 본문의 front-matter 만으로 충분한가. → `S-PL-DX-004`.
- **OQ5: 워커 풀** — 50개 플러그인 활성 시 worker 50개. OS thread budget 의 압박. 풀링 시 격리 약화. 측정 후 결정. → `S-PL-SEC-007`.
- **OQ6: Rust 측 hook** — 무거운 파싱은 `pulldown-cmark` (현행 Rust side) 단계에서 후킹하는 것이 빠르지만 격리가 어렵다. 본 ADR 은 *TS 측 hook only*. Rust 측 plugin 경로는 보안 모델이 완전히 달라 v1.5+ 분리 ADR. → `S-PL-NTV-001`.
- **OQ7: 마켓플레이스 서명 ADR** — C2 의 후속. PKI? sigstore? 단순 SHA + 신뢰 anchor? → `S-PL-MKT-001`.

## Validation plan

- `S-PL-SEC-001`: manifest zod 스키마 + path-traversal 거부 Vitest.
- `S-PL-SEC-002`: per-plugin worker 격리 — 두 플러그인이 같은 글로벌을 못 본다는 회귀 테스트.
- `S-PL-SEC-003`: 권한 RPC — `network` grant 없는 플러그인의 `host.fetch` 가 throw 하는지.
- `S-PL-SEC-004`: hot reload — manifest 수정 시 250ms 안에 worker 재생성, 진행 중 render 가 새 결과로 정착.
- `S-PL-SEC-005`: 성능 회귀 — 1k 줄 + 50 hook 호출 시 추가 지연 < 50ms.
- `S-PL-SEC-006`: sanitizer fuzz — plugin 출력에 대한 XSS 페이로드 코퍼스.
- `S-PL-COMPAT-001`: markdown-it `emoji`/`footnote`/`task-lists`/`container`/`anchor` 다섯 플러그인이 shim 위에서 동작.

## References

- ADR-0010: Chat 표면이 플러그인 코드 저작.
- ADR-0011: parser-sdk 의 격리 기초.
- ADR-0007: 번들 사이즈 가드.
- `src/lib/parsers/sandbox-csp.ts` — CSP 사양 (재사용).
- `src/lib/parsers/renderer-host.ts:115` — `createWorkerTransport` (재사용).
- `src/lib/parsers/transport-registry.ts` — pluginId 매핑 확장 지점.
- `src/components/SpreadPane.tsx:53~58` — 디스패처가 transport 를 조회하는 지점.
- 후속 ADR 후보: 마켓플레이스 서명 (`S-PL-MKT-001`), Rust 측 plugin (`S-PL-NTV-001`).
