# ADR-0006: Workspace storage layout

| Field | Value |
|---|---|
| Status | **Accepted** (S-WS-010) |
| Date | 2026-05-18 |
| Owners | Workspace unit (v1.2 Sprint 2) |
| Supersedes | — |
| Superseded by | — |
| Related | ADR-0003 (Editor tab + split-pane model — `layout.json` 도입), ADR-0010 (`preferredShell` 필드 추가), ADR-0011 (multi-workspace), ADR-0012 (plugins 디렉터리), `src-tauri/src/workspace.rs`, `src/lib/migration/run.ts` |

## Context

워크스페이스가 디스크에 남기는 메타데이터가 ADR-0003 (layout), ADR-0010 (shell 선호), ADR-0011 (multi-workspace), ADR-0012 (plugins) 에 걸쳐 산발적으로 생겼다. 각 ADR 이 자기 파일 위치를 자기 ADR 안에서만 정의하면:

- 백업·동기화 도구가 "어디서부터 어디까지 워크스페이스 메타인지" 모름.
- 사용자가 워크스페이스를 zip 으로 옮길 때 누락 위험.
- 새 ADR 이 또 새 파일 위치를 만들 때 일관성 잃음.

본 ADR 은 **모든 워크스페이스 메타의 디렉터리 컨벤션을 한 곳에 못 박는다**. 새 ADR 은 본 ADR 의 규약을 따라야 한다.

## Decision

### D1. 디렉터리 구조

```
<workspace-root>/
├── .markspread/                     # 워크스페이스 메타 루트 (gitignore 권장)
│   ├── layout.json                  # ADR-0003 + ADR-0010 (탭/페인 트리 + shell 선호)
│   ├── chats/                       # ADR-0010 ChatShell 세션
│   │   └── <sessionId>.json
│   ├── plugins/                     # ADR-0012 워크스페이스-로컬 플러그인
│   │   └── <name>/
│   │       ├── markspread-plugin.json
│   │       ├── index.js
│   │       └── .granted.json        # ADR-0012 D3 권한 grant 영속
│   └── .workspace-id                # 안정 식별자 (텔레메트리 hash, recents)
└── <사용자 문서들>
```

전역(워크스페이스 횡단) 메타는 OS 별 app-data 디렉터리.

```
~/Library/Application Support/markspread/   (macOS)
~/.config/markspread/                       (Linux, XDG)
%APPDATA%/markspread/                       (Windows)
├── recents.json                     # ADR-0011 최근 워크스페이스 목록
├── windows.json                     # ADR-0011 윈도우→워크스페이스 매핑
├── plugins/                         # ADR-0012 전역 플러그인 (~/.markspread/plugins 와 동일 의미)
└── telemetry/
    └── consent.json                 # ADR-0005/0008 동의 상태 (zustand persist 동일 위치)
```

> Note: ADR-0012 가 참조하는 `~/.markspread/plugins/` 는 *컨벤션 표기* 다. 실제 위치는 OS-native app-data 의 `plugins/` 서브디렉터리 — 본 ADR 의 D2 가 정규화.

### D2. 경로 해석 규칙

- 워크스페이스 메타 = **항상 워크스페이스 루트 안의 `.markspread/`**. 절대경로/`..` 의 사용자 입력은 거부.
- 전역 메타 = `app-data-dir()` (Tauri API). 코드는 `~/.markspread/...` 같은 표기 대신 `appDataDir()` 만 사용. 문서/사용자 안내에서만 친숙한 표기 (`~/.markspread/`) 허용.
- 두 위치가 같은 이름의 산출물(예: 플러그인) 을 보유하면 **워크스페이스-로컬 우선** (ADR-0012 D3.5 와 일치).

### D3. 파일별 책임 분리

| 파일 | 책임 ADR | 동시 쓰기 |
|---|---|---|
| `.markspread/layout.json` | ADR-0003 (탭/페인) + ADR-0010 (`shell`) | 둘 다 한 파일 — atomic write 보존 |
| `.markspread/chats/<id>.json` | ADR-0010 | 세션 단위 분리 — concurrent write 충돌 회피 |
| `.markspread/plugins/<name>/...` | ADR-0012 | 사용자(혹은 LLM) 가 직접 작성 — 앱은 read-only |
| `.markspread/plugins/<name>/.granted.json` | ADR-0012 D3 | 앱이 작성 (사용자 grant 시) |
| `.markspread/.workspace-id` | 본 ADR | 첫 마운트 시 1회 생성, 이후 불변 |
| `<appdata>/recents.json` | ADR-0011 | 앱 종료/워크스페이스 전환 시 |
| `<appdata>/windows.json` | ADR-0011 | 윈도우 생성/종료 시 |
| `<appdata>/telemetry/consent.json` | ADR-0005/0008 | 사용자 토글 시 즉시 |

각 파일은 schemaVersion 필드 보유. 다운그레이드 경로는 만들지 않는다 — 이전 바이너리는 알 수 없는 필드를 무시.

### D4. Atomic write 규약

- write target = `<path>.tmp` → `fsync` → `rename(.tmp, <path>)`. POSIX 의 rename 원자성 + Windows 의 `ReplaceFile` 사용.
- chats/<id>.json 처럼 다수 파일을 한 번에 쓰는 경우 → 디렉터리 단위 잠금 (`.markspread/.lock`) 으로 외부 동기화 도구의 부분 복사 방지.

### D5. 마이그레이션

본 ADR 이전에 흩어진 파일이 있다면 (`<root>/.markspread-layout.json` 등 가설) `src/lib/migration/run.ts` 에서 본 ADR 의 위치로 이동. 마이그레이션 step 은 idempotent — 이미 정규화된 경우 no-op.

## Consequences

### 양

- 백업 = `.markspread/` 한 디렉터리 + appdata 한 디렉터리. zip/rsync 호환.
- 새 ADR 이 새 파일을 추가할 때 *위치 결정* 이 본 ADR 의 D1 표 한 줄 추가로 끝남.
- 워크스페이스 휴대성 — USB/iCloud Drive 이동 시 `.markspread/` 가 함께 이동.

### 음

- `.markspread/` 가 사용자 디렉터리에 보임 — Hidden(`.` prefix) 으로 완화하지만 Finder "Show hidden" 에서는 노출. README 에 명시.
- chats 가 워크스페이스 안에 저장 → 사용자가 워크스페이스 공유 시 채팅도 동행 (의도된 동작이지만 sensitive). 공유 가이드에 명시.

### 위험

- **R1**: 사용자가 `.markspread/` 를 `.gitignore` 에 안 넣고 커밋 → granted permissions, chat history 가 공개 저장소로 유출. → 완화: 워크스페이스 최초 마운트 시 `.gitignore` 자동 update 제안 (declinable).
- **R2**: appdata 가 OS 마이그레이션 (예: Mac → Mac 이전 도구) 으로 깨질 때 워크스페이스만 살아남고 recents 가 빔. → 완화: `.markspread/.workspace-id` 가 recents 의 단일 source 가 아님 — open dialog 로 재오픈하면 즉시 복구.

## Validation plan

- S-WS-010: `.markspread/` 경로 정규화 — `..`, 절대경로, symlink 거부 Vitest.
- S-WS-011: 마이그레이션 — 가설 legacy 위치에서 신 위치로 이동 후 데이터 무손실.
- S-WS-012: atomic write — crash injection (write 중 SIGKILL) 후 파일이 *이전 버전 또는 새 버전* 둘 중 하나로만 존재.
- S-WS-013: 워크스페이스 zip → 새 머신 unzip → 모든 메타 정상 로드.

## References

- `src-tauri/src/workspace.rs` — 워크스페이스 마운트 / 경로 해석.
- ADR-0003 D3 (`layout.json` 도입), ADR-0010 D5 (`shell` 필드 추가), ADR-0011 (multi-workspace appdata), ADR-0012 D2 (plugins 디렉터리).
- Tauri `appDataDir()`: https://tauri.app/v2/reference/javascript/api/namespacepath/#appdatadir
