# ACP v1 Rust Client (S-AI-ACP-001)

Status: Draft — design, not yet implemented.
Owners: `ai::acp`, `ai::auth`.

이 문서는 Markspread 의 Tauri 백엔드(`src-tauri`)에 추가될 **Agent Client
Protocol v1** 클라이언트의 설계를 정의한다. 구현 가이드(파일 분할, 동시성
모델, IPC 표면) 이며, 어떤 Rust 코드도 포함하지 않는다. 코드는 후속
S-AI-ACP-002 이후에서 본 문서를 근거로 작성한다.

## 1. 목적과 범위

ACP(Agent Client Protocol, Apache 2.0) 는 에디터(클라이언트) 와 코딩
에이전트(자식 프로세스) 가 **JSON-RPC 2.0 over stdio** 로 대화하기 위한
오픈 표준이다. Markspread 가 Claude Code, Codex CLI, Gemini CLI, OpenCode,
GitHub Copilot CLI 를 각자의 SDK 로 N 번 통합하면 N 개의 어댑터·N 개의
인증 흐름·N 개의 스트리밍 파서가 필요하다. ACP 는 이 N 을 **1** 로
줄인다. 본 문서가 정의하는 단일 `AcpClient` 가 위 다섯 에이전트(그리고
앞으로 ACP 를 지원하는 모든 에이전트) 를 동일한 메시지 모델로 다룬다.

범위는 (a) 자식 프로세스 spawn 및 stdio 프레이밍, (b) ACP v1 핸드쉐이크와
세션 라이프사이클, (c) Claude 구독(`ai_auth`) 과 BYO key(`ai_keys`) 양쪽
인증 경로 통합, (d) Tauri command/event 표면 정의 까지다. UI 패널·턴
이력의 저장 모델·MCP 서버 브리지(ACP 가 정의하는 `mcpServers` 옵션) 는
별도 단위(S-AI-ACP-003+) 에서 다룬다.

출처:
- 사양 저장소: <https://github.com/zed-industries/agent-client-protocol>
- 표준 사이트: <https://agentclientprotocol.com/overview/introduction>
- 호스트 측 가이드(Zed): <https://zed.dev/docs/ai/external-agents>

## 2. ACP v1 사양 요약

### 2.1 트랜스포트와 프레이밍

- 로컬 에이전트는 **JSON-RPC 2.0 over stdio** 를 사용한다
  (<https://agentclientprotocol.com/protocol/overview>).
- 사양 페이지가 프레이밍을 명시적으로 정의하지 않지만, 참조 SDK
  (`agent-client-protocol` TypeScript/Rust) 와 Zed 의 호스트 구현은 **개행
  분리(newline-delimited JSON, NDJSON)** 를 사용한다. LSP 스타일의
  `Content-Length:` 헤더 프레이밍은 쓰지 않는다.
  → 본 클라이언트도 **개행 분리 한 줄에 JSON-RPC 메시지 하나** 로 통일한다.
- 키 표기는 모두 `camelCase`, 파일 경로는 절대 경로, 라인 번호는 1-based
  (<https://agentclientprotocol.com/protocol/overview>).
- 커스텀 메서드·필드는 `_` 접두사 또는 `_meta` 필드를 통해서만 확장한다.

### 2.2 핸드쉐이크

`initialize` 요청(Client → Agent) 에 다음을 보낸다:

- `protocolVersion`: 정수 — 클라이언트가 지원하는 최신 메이저 버전
  (현재 `1`).
- `clientCapabilities`: 파일시스템(`fs.readTextFile`, `fs.writeTextFile`),
  터미널 등 호스트가 제공할 메서드.
- `clientInfo`: `{ name, title, version }`.

에이전트 응답:

- `protocolVersion`: 합의된 버전 (에이전트가 더 낮은 버전만 안다면 그것을
  돌려준다 — 클라이언트가 다운그레이드).
- `agentCapabilities`: `loadSession`, `promptCapabilities`(허용되는 콘텐츠
  종류), `mcpCapabilities` 등.
- `agentInfo`: 동일 형태.
- `authMethods`: `[{ id, name, description }]` — 에이전트가 지원하는 인증
  수단 카탈로그.

출처: <https://agentclientprotocol.com/protocol/initialization>.

### 2.3 핵심 메시지 카탈로그

| 메서드/알림 | 방향 | 한 줄 설명 |
|---|---|---|
| `initialize` | C → A (요청) | 프로토콜 버전 합의 + capability 교환 |
| `authenticate` | C → A (요청) | `authMethods` 중 하나를 `methodId` 로 선택해 로그인 |
| `session/new` | C → A (요청) | `cwd` 와 `mcpServers` 로 새 세션 ID 생성 |
| `session/load` | C → A (요청) | 기존 세션 재개 + 히스토리를 `session/update` 로 replay |
| `session/resume` | C → A (요청) | replay 없이 컨텍스트만 복원 |
| `session/prompt` | C → A (요청) | 사용자 메시지를 보내고 한 턴 시작; 응답에 `stopReason` |
| `session/cancel` | C → A (알림) | 진행 중인 턴 즉시 중단; 종료 시 `stopReason: cancelled` |
| `session/close` | C → A (요청) | 세션 종료 + 자원 해제 (내부적으로 cancel 포함) |
| `session/update` | A → C (알림) | 턴 진행 중 스트리밍 이벤트 (아래 표 참고) |
| `session/request_permission` | A → C (요청) | 민감한 도구 호출 전 사용자 승인 요청 |
| `fs/read_text_file` | A → C (요청) | 클라이언트 파일 읽기 위임 |
| `fs/write_text_file` | A → C (요청) | 클라이언트 파일 쓰기 위임 |
| `terminal/*` | A → C (요청) | 터미널 capability 가 있을 때만 |

`session/update` 의 `update.kind` 종류:

- `plan` — 에이전트가 세운 계획 항목 배열
- `agent_message_chunk` — LLM 텍스트 스트림 조각
- `tool_call` — 새 도구 호출 시작 (`toolCallId`, `title`, `kind`, status=`pending`)
- `tool_call_update` — 같은 `toolCallId` 의 상태 전이 (`in_progress` → `completed`/`cancelled`)

출처: <https://agentclientprotocol.com/protocol/prompt-turn>,
<https://agentclientprotocol.com/protocol/session-setup>.

### 2.4 인증 (사양 수준)

사양은 `authenticate` 메서드만 정의하며 `methodId` 한 필드만 받는다. **자격
증명(API key/OAuth token) 을 어떻게 전달할지는 사양이 규정하지 않는다** —
이는 각 에이전트 바이너리의 관례이다. Zed 의 호스트 구현은 모두 **spawn
시 환경 변수** 로 주입한다 (`agent_servers.<agent>.env` 설정을 자식으로
forward). Markspread 도 동일한 결정을 따른다 (§6 참고).

## 3. 모듈 레이아웃

`src-tauri/src/acp/` 아래 다음 파일로 분할한다.

```
src-tauri/src/acp/
├── mod.rs              # Tauri command 표면 + AppState 등록
├── protocol.rs         # JSON-RPC 메시지/프레이밍, serde 타입
├── client.rs           # AcpClient (per-session) — id 발급, pending map
├── transport.rs        # tokio Child + stdin/stdout NDJSON 프레임
├── agent_registry.rs   # 알려진 에이전트 카탈로그 + spawn 명세
└── auth.rs             # 자격 증명 라우터 (ai_auth ↔ ai_keys)
```

### 3.1 `mod.rs` — Tauri 표면

- 등록 함수 `register(builder) -> Builder` (lib.rs §145 부근의
  `ai_auth::*` / `ai_keys::*` 등록과 동일 패턴).
- 노출 명령: `acp_start_session`, `acp_send_message`, `acp_approve_tool`,
  `acp_cancel`, `acp_list_agents`, `acp_end_session`.
- `AppState` 에 `Mutex<HashMap<SessionHandle, Arc<AcpClient>>>` 보유.

### 3.2 `protocol.rs` — 와이어 타입

- `JsonRpcRequest`/`Response`/`Notification` 의 `serde` 타입.
- ACP 메시지 enum (요청/응답/알림 각각 untagged) — `method` 와 `params` 쌍.
- `update.kind` 디스패치 enum: `Plan`, `AgentMessageChunk`, `ToolCall`,
  `ToolCallUpdate`.
- 프레이밍은 `tokio_util::codec::LinesCodec` (또는 직접 `BufReader::lines`)
  로 처리 — Content-Length 가 아니므로 길이 디코더는 불필요.

### 3.3 `client.rs` — `AcpClient`

- 한 세션 = 한 `AcpClient`. 자식 프로세스 1개를 소유.
- 필드:
  - `tx_request`: `mpsc::Sender<OutgoingMessage>` — writer task 로의 채널
  - `pending`: `Mutex<HashMap<RequestId, oneshot::Sender<Result<Value>>>>`
  - `next_id`: `AtomicU64`
  - `caps`: 핸드쉐이크 결과 (`AgentCapabilities`, `AuthMethods`)
  - `session_id`: `String` (initialize 이후 `session/new` 응답에서 채워짐)
  - `event_tx`: `mpsc::Sender<AcpEvent>` — Tauri emit 으로 fan-out
- API: `initialize()`, `authenticate(method_id)`, `new_session(cwd)`,
  `prompt(blocks)`, `cancel()`, `respond_permission(id, decision)`, `close()`.

### 3.4 `transport.rs` — Child + NDJSON

- `tokio::process::Command` 로 spawn (stdin/stdout/stderr = piped).
- writer task: `mpsc::Receiver<String>` → `child.stdin.write_all(line)` +
  개행.
- reader task: `BufReader::new(child.stdout).lines()` → `serde_json` →
  correlator 채널.
- stderr task: 로깅 전용. 자식 줄을 `tracing::warn!` 로 흘려보낸다.
- exit watcher: `child.wait()` 이 반환되면 `AcpEvent::Error(Crash)` 발행
  후 `pending` 맵의 모든 oneshot 을 `Err(channel_closed)` 로 닫는다.

### 3.5 `agent_registry.rs` — 카탈로그

내장 에이전트 목록(빌드 시 정적, JSON 파일이 아니라 Rust `const`):

| id | 표시명 | 실행 |
|---|---|---|
| `claude` | Claude Code | `npx @zed-industries/claude-agent-acp` (Zed 가 publishes 하는 ACP 어댑터) — 또는 `CLAUDE_CODE_EXECUTABLE` override |
| `codex` | Codex CLI | `npx codex-acp` |
| `gemini` | Gemini CLI | `npx @google/gemini-cli --acp` |
| `opencode` | OpenCode | `opencode serve --acp` (네이티브 ACP) |
| `copilot` | GitHub Copilot CLI | `gh copilot --acp` (사양 노출 시) |

각 항목의 명세 구조:

- `id`, `display_name`
- `spawn`: `{ program, args, working_dir_override }`
- `env_map`: `{ "credential" => "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | … }`
- `credential_source`: `enum { ClaudeSubscription, AiKey { provider } }`

사용자 정의 에이전트는 v1 범위 외 (open question §10).

### 3.6 `auth.rs` — 자격 증명 라우터

```
spawn 직전:
  match registry.credential_source {
    ClaudeSubscription =>
      let token = ai_auth::resolve_access_token().await?;        // 만료 시 refresh 후 반환
      env.insert("ANTHROPIC_API_KEY", token);
    AiKey { provider } =>
      let plain = ai_keys::ai_key_resolve(provider).await?;      // 키체인에서 평문
      env.insert(registry.env_map["credential"], plain);
  }
```

`ai_auth` 와 `ai_keys` 의 평문은 **spawn 후 즉시 zeroize** 한다 (메모리에
남기지 않음). `OsStr` 에서는 zeroize 가 어려우므로 `Command::env` 호출
직후 임시 `String` 을 drop 한다.

## 4. Tauri command 표면

모든 명령은 `Result<…, AppError>` 반환. 입력/출력 시그니처:

```rust
// 사용 가능한 에이전트 목록 (UI 셀렉터용)
#[tauri::command]
async fn acp_list_agents() -> AppResult<Vec<AgentDescriptor>>;
// AgentDescriptor: { id, display_name, available: bool, why_unavailable: Option<String> }

// 세션 시작 — 자식 spawn + initialize + (필요시) authenticate + session/new
#[tauri::command]
async fn acp_start_session(
    agent_id: String,
    cwd: String,
    mcp_servers: Option<Vec<McpServerSpec>>,
) -> AppResult<SessionHandle>;
// SessionHandle: { session_token: String, session_id_from_agent: String, caps: AgentCaps }

// 한 턴 시작 — session/prompt
#[tauri::command]
async fn acp_send_message(
    session_token: String,
    blocks: Vec<ContentBlock>,
) -> AppResult<()>;
// 응답은 stream 으로 events 로 흘려보냄. 호출 자체는 “turn 시작 ack”.

// session/request_permission 의 사용자 응답
#[tauri::command]
async fn acp_approve_tool(
    session_token: String,
    tool_call_id: String,
    decision: PermissionDecision,   // Allow | AllowOnce | Deny
) -> AppResult<()>;

// 진행 중 턴 중단 (session/cancel 알림)
#[tauri::command]
async fn acp_cancel(session_token: String) -> AppResult<()>;

// 세션 종료 (session/close + 자식 kill)
#[tauri::command]
async fn acp_end_session(session_token: String) -> AppResult<()>;
```

### 4.1 이벤트 페이로드

프론트에 `app.emit_to(window, name, payload)` 로 보내는 이벤트:

| 이벤트 이름 | payload 모양 | 의미 |
|---|---|---|
| `acp:session:plan` | `{ session_token, entries: [{content, priority, status}] }` | 계획 항목 갱신 |
| `acp:session:chunk` | `{ session_token, text: String }` | LLM 텍스트 스트림 한 조각 |
| `acp:session:tool_call` | `{ session_token, tool_call_id, title, kind, status }` | 도구 호출 시작 |
| `acp:session:tool_update` | `{ session_token, tool_call_id, status, content? }` | 도구 호출 상태 전이 |
| `acp:session:permission_request` | `{ session_token, tool_call_id, summary }` | 사용자 승인 요청 |
| `acp:session:done` | `{ session_token, stop_reason: "end_turn"\|"cancelled"\|"max_tokens"\|"max_turns" }` | 턴 종료 |
| `acp:session:error` | `{ session_token, code, message }` | 자식 크래시·프로토콜 오류·인증 실패 |

이벤트 이름은 namespacing 을 위해 `acp:session:*` 형식. 콜론 분리는
`ai:auth:*` 등 기존 이벤트와 일관성 유지.

## 5. 동시성 모델

세션 당 task 토폴로지:

```
                 ┌──────────────┐
   acp_send_msg ─▶│ AcpClient API│─▶ mpsc::Sender<String>(tx_request)
                 └──────┬───────┘
                        │
                  ┌─────▼──────┐                ┌──────────┐
                  │ writer task│──▶ stdin ────▶ │  child   │
                  └────────────┘                │ process  │
                                                │          │
                  ┌────────────┐                │          │
                  │ reader task│◀── stdout ◀────│          │
                  └──┬─────────┘                └──────────┘
                     │ raw JsonRpcMessage
                     ▼
                  ┌──────────────────┐
                  │ correlator task  │
                  └──┬────────────┬──┘
                     │            │
            response │            │ notification
                     ▼            ▼
              pending oneshot     event_tx (mpsc → emit)
```

- 세션 당 **3 task**: writer, reader, correlator. 사양은 단순화를 위해
  reader 와 correlator 를 하나로 합쳐도 무방 — reader 가 응답이면 pending
  맵에서 oneshot 을 꺼내 send, 알림이면 `event_tx` 로 forward.
- `tx_request` 채널 capacity: 64 (LLM 텍스트 chunk 가 폭주하지 않으므로
  과도한 버퍼는 불필요; in-flight 요청 수의 합리적 상한).
- `event_tx` 채널 capacity: 256 (스트리밍 chunk 가 빠르게 들어옴; 백프레셔
  발생 시 `try_send` 가 fail 하면 reader 가 잠시 `await` 로 양보).
- 백프레셔 동작: writer 가 stdin 에 쓰지 못하면(자식이 stdin 을
  소비하지 않으면) writer task 가 block → `tx_request.send().await` 가
  block → Tauri command 가 timeout(기본 5초) 으로 실패하고 사용자에게
  보고. event_tx 의 lag 는 chunk drop 보다 더 늦은 emit 을 택한다.
- 종료: `acp_end_session` 또는 자식 exit → writer/reader/correlator 모두
  채널 닫힘으로 자연 종료, pending oneshot 은 모두 `Err` 로 close.

## 6. 인증 통합

### 6.1 Claude Code (2026-06-15+ 구독 크레딧 모델)

- spawn 전 `ai_auth::ai_keys_get_subscription` 으로 키체인에서 access
  token 메타 확인. 만료 ≤ 60s 면 `ai_auth_refresh_subscription` 먼저 호출.
- 환경 변수: `ANTHROPIC_API_KEY` 로 access token 주입. Anthropic 의 ACP
  어댑터(`@zed-industries/claude-agent-acp`) 는 이 변수를 우선 본다.
- 토큰 만료가 세션 도중 발생하면: 어댑터가 401 / `auth_required` 를 turn
  도중 돌려준다 → 우리는 `acp:session:error` 발행 + 사용자에게 "다시
  로그인" 토스트. 자동 재시작은 v1 에서는 **하지 않는다**(중단된 턴의
  상태를 안전하게 이어붙일 방법이 없음). 사용자가 재시도하면 spawn 전
  refresh 가 새 토큰을 보장.
- ACP 의 `authenticate(methodId)` RPC: Claude 어댑터가 이 메서드를
  요구하지 않는다 — env 변수로 충분. 어댑터가 `authMethods` 를 비어 있게
  돌려주면 skip.

### 6.2 그 외 에이전트 (BYO key)

- spawn 직전 `ai_keys::ai_key_resolve(alias)` 호출 → 평문 키 1회 획득.
- 에이전트별 env 명 (`agent_registry::env_map`):
  - Codex CLI → `OPENAI_API_KEY`
  - Gemini CLI → `GEMINI_API_KEY`
  - OpenCode → `OPENROUTER_API_KEY` 또는 alias 별 매핑
  - Copilot CLI → GitHub auth 는 자체 `gh auth login` 흐름; 이 경우 env
    주입 없이 spawn (registry 에서 `credential_source: None` 으로 표시)
- 키 회전: 사용자가 `ai_key_save` 로 새 키를 저장해도 **이미 활성화된
  세션은 영향 없음**. 다음 `acp_start_session` 부터 적용.

### 6.3 `ai_auth` 와의 인터페이스

`ai_auth.rs` 에는 access token 의 **평문을 반환하는 내부 함수**가 아직
없다 (현재 IPC 표면은 메타만 반환). spawn 직전에만 호출되는
`pub(crate) async fn resolve_access_token() -> AppResult<String>` 을
새로 추가해야 한다. 키체인 read → `meta.expires_at` 검사 → 필요시 refresh
→ 평문 반환. **IPC 로는 절대 노출하지 않는다** (crate-private).

## 7. 에러 모델

`AppError` (현재 `src-tauri/src/error.rs`) 에 ACP 전용 variant 를 추가하지
않고 기존 `AppError::Invalid(String)` 으로 매핑한다 — JSON-RPC 에러는
프로토콜 레벨의 사용자 입력/구성 오류로 분류한다.

매핑:

| 상황 | AppError | code |
|---|---|---|
| 자식 spawn 실패 (ENOENT 등) | `NotFound`/`Io` | 기존 |
| `initialize` 응답이 비호환 버전 | `Invalid("acp version unsupported")` | `EINVAL` |
| `authenticate` 거부 | `Invalid("acp auth: <msg>")` | `EINVAL` |
| JSON-RPC error response | `Invalid("acp rpc: <code> <msg>")` | `EINVAL` |
| 자식 stdout EOF (예기치 못한 종료) | `Invalid("acp child exited: <status>")` + `acp:session:error` 이벤트 | `EINVAL` |
| 응답 timeout (>30s, configurable) | `Invalid("acp timeout: <method>")` | `EINVAL` |

자식 크래시 처리: exit watcher 가 `acp:session:error` 를 발행하고 세션
맵에서 해당 핸들을 제거한다. 프론트는 토스트로 "에이전트가 종료되었습니다"
를 보여주고, 사용자가 다시 `acp_start_session` 을 호출하면 새 자식이
spawn 된다. 자동 재시작 정책은 도입하지 않는다 — 크래시 루프 방지가
재시도 가치보다 중요.

## 8. 테스트 전략

`wiremock` 은 HTTP 전용이라 ACP(자식 프로세스) 에는 쓸 수 없다. 세 층으로
대체한다.

1. **단위 — protocol.rs**
   - serde round-trip: 각 메시지/`session/update.kind` 의 JSON 고정값을
     `insta` 스냅샷으로 고정 (기존 코드베이스가 `insta` 사용중).
   - 프레이밍: `tokio::io::duplex()` 로 in-memory pipe 를 만들고 writer 가
     쓴 바이트를 reader 가 line-by-line 으로 정확히 복원하는지 확인.
     멀티바이트(한국어 텍스트 chunk) 와 1MB 단일 메시지 양극단 테스트.

2. **통합 — client.rs 전 구간**
   - `scripts/test/fake-acp-agent.mjs` 작성: Node 스크립트가 stdin
     NDJSON 을 읽고 미리 짠 시나리오(initialize 응답, prompt → 3 개의
     chunk → done) 를 stdout 으로 흘려보낸다.
   - `serial_test` 로 직렬화(`Cargo.toml` 에 이미 존재).
   - 커버: 정상 턴, cancel 도중, permission_request 응답, 자식이 RPC
     error 응답, stdout 중간 종료.

3. **End-to-end (gated)**
   - `#[ignore]` 로 표시. `MARKSPREAD_E2E_ACP=1` 환경 변수가 있을 때만
     실행. 실제 `claude` 바이너리를 spawn → `2 + 2 = ?` prompt → 응답에
     "4" 포함 확인. CI 가 아닌 로컬에서만 실행 (구독 토큰 필요).

테스트가 `tokio::process` 를 쓰므로 §9 의 feature 추가가 선결조건이다.

## 9. 선결 의존성 변경

`src-tauri/Cargo.toml`:

- `tokio` features 에 **`"process"` 추가**. 현재 `["fs", "io-util",
  "macros", "net", "rt-multi-thread", "sync", "time"]` 만 활성화돼 있어
  `tokio::process::Command` 를 쓸 수 없다. 변경 후:

  ```toml
  tokio = { version = "1.40", features = [
    "fs", "io-util", "macros", "net", "process",
    "rt-multi-thread", "sync", "time"
  ] }
  ```

- `tokio-util` 신규 추가 (NDJSON 라인 디코더용, 직접 `BufReader::lines`
  로 대체 가능하면 생략 가능):

  ```toml
  tokio-util = { version = "0.7", features = ["codec"] }
  ```

- `zeroize` 신규 추가 (평문 토큰을 임시로 들고 있는 `String` drop 전에
  덮어쓰기용):

  ```toml
  zeroize = { version = "1", features = ["zeroize_derive"] }
  ```

- 새로운 런타임 의존성은 없음. 기존 `serde`, `serde_json`, `tracing`,
  `thiserror`, `rand` 모두 그대로 활용.

## 10. 공개 질문

1. **동시 세션 상한** — 사용자가 5 개 워크스페이스 × 2 에이전트 = 10
   자식 프로세스를 동시에 띄울 수 있다. 합리적 hard cap 은? (제안:
   기본 4, 설정에서 조정. 초과 시 LRU 로 idle 세션을 종료.)
2. **턴/도구 호출 이력 영속화** — `acp:session:chunk` 와 도구 호출 시퀀스를
   SQLite(`ai.db`) 에 저장해 재시작 후 `session/load` 와 함께 복원할지,
   아니면 휘발성으로 둘지. 후자가 단순하나 사용자가 "어제 그 대화" 를
   잃는다.
3. **같은 워크스페이스에 N 개 에이전트 동시 활성화 허용 여부** — 두
   에이전트가 같은 파일을 동시에 수정 요청하면 충돌. v1 은 워크스페이스
   당 ACP 세션 1개로 제한할지?
4. **MCP 서버 브리지** — ACP `session/new` 의 `mcpServers` 옵션을 우리
   기존 MCP 통합(있다면) 과 어떻게 연결할지. 별도 단위로 미룰 가능성.
5. **자식 stderr 처리 정책** — 단순 `tracing::warn!` 로 충분한가, 아니면
   `acp:session:error` 의 진단 페이로드에 마지막 N 라인을 포함해야 하나.
6. **Windows 에서 `npx` 의 `.cmd` shim** — `agent_registry` 의 spawn
   명령이 Windows 에서는 `npx.cmd` 가 되어야 한다. `cfg!(windows)` 분기
   처리만으로 충분한지, 아니면 `which` crate 로 동적 해결할지.

## 참고

- ACP overview: <https://agentclientprotocol.com/overview/introduction>
- Initialization: <https://agentclientprotocol.com/protocol/initialization>
- Session setup: <https://agentclientprotocol.com/protocol/session-setup>
- Prompt turn: <https://agentclientprotocol.com/protocol/prompt-turn>
- Zed external agents: <https://zed.dev/docs/ai/external-agents>
- ADR-0004: Claude 구독 OAuth 인증 (`docs/adr/0004-anthropic-subscription-oauth.md`).
- `src-tauri/src/ai_auth.rs` — 본 클라이언트의 Claude 토큰 소스.
- `src-tauri/src/ai_keys.rs` — 본 클라이언트의 BYO key 소스.
