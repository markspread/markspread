# ADR-0014 — Document/Code Asymmetry + Drag-Chat Edit + File Category Mapping

- **Status**: Accepted (2026-05-30)
- **Cycle**: CYC-01KSWHTW2ZTXRS3HSYGDBNSNX2 (T2 closure 실행)
- **Discovery**: T2 + H13 + H14 + 모든 T2 sub-tensions 통합

## Context

Markspread 가 마크다운 *전용* 인가 / 코드 뷰도 지원하나 의 결정. 본인 핵심 발언: "README 에 코드 참조 있거나 리뷰가 코드 리뷰일 수도. 다만 문서는 편집, 코드는 수정 안 함." 다중 프로젝트 운영자 (P-self) 의 트리 가벼움 욕구와 코드 리뷰 가능성을 양립.

## Decision

### 1. File Category Mapping (자동 분류)

| 카테고리 | 확장자 | 동작 |
|---|---|---|
| **Document** (편집 가능) | `.md`, `.mdx`, `.markdown` + *활성 파서 플러그인 대상 확장자* (예: 사용자가 `.rst` 파서 설치 시 자동 승격) | 직접 편집 + 드래그-채팅 부분 편집 |
| **Code/Config** (read-only) | `.ts/.tsx`, `.js/.jsx`, `.rs`, `.py`, `.go`, `.json`, `.yaml`, `.toml`, `.lock`, `.sh`, `.css`, `.html`, `.sql`, 기타 | syntax highlight only, 편집 X, LSP X |
| **Media** (인라인 뷰어) | `.png`, `.jpg`, `.svg`, `.pdf` | 뷰만 |

### 2. 파일트리 토글

- **md-only 모드** (default): 폴더는 모드 무관 항상 표시 (`.gitignore` 존중). 비-문서 파일만 숨김.
- **전체 보기 모드**: 모든 파일 표시 (`.gitignore` 존중).
- 토글 상태 = 워크스페이스별 persist.
- 트리 헤더에 모드 아이콘 (📄 md-only / 📁 전체).

### 3. 다층 ignore

| 층 | 상태 |
|---|---|
| `.gitignore` | default on, 토글로 끌 수 있음 |
| `.markspreadignore` | 본 도구 전용 추가 ignore, optional 파일. syntax = `.gitignore` 동일 |
| 글로벌 설정 ignore | **v1 scope 밖** (요청 없음) |

### 4. 새 파일 생성 UX

- dialog default 확장자 = `.md`.
- 다른 확장자 입력 가능. 비-md 생성 시 = *그 파일만* 일시 highlight + 토스트 "전체 보기에서 항상 표시" + 토글 버튼. 사용자가 토글 안 누르면 다음 새로고침 시 숨김 복귀.

### 5. 드래그-채팅 편집 (H13)

- md 에디터에서 드래그 선택 → 채팅 입력창에 컨텍스트 자동 주입 (파일·범위·텍스트).
- AI 응답이 *그 위치에 인라인 diff* (녹/적).
- Enter = accept, Esc = reject, Cmd+R = 다시 (새 제안 1회 재요청).
- 다중 제안 v1 scope 밖.

### 6. 외부 위임 버튼 = 미제공

- "VSCode/Cursor 로 이 파일 열기" 버튼 ❌.
- 코드 수정 필요 시 = *그 자리에서 AI(Claude Code SDK) 위임*.
- 본 도구 정체성 = "리뷰 + AI 협업". 외부 위임 = 자기부정.

### 7. 코드 하이라이터 (T2.c)

- **CodeMirror 6 lazy language modules** (이미 에디터 코어 = CM6).
- 첫 코드 파일 열림 시점에 해당 lang module download, 이후 캐시.
- read-only = `EditorState.readOnly.of(true)` 한 줄.
- shiki/Prism/highlight.js 미도입 (의존성 + 번들 무게).

### 8. CLI 진입점 + OS file association (H14)

- `markspread <path>` CLI = 본 도구 띄우고 path 자동 열기 (단일 인스턴스).
- macOS `Info.plist` `CFBundleDocumentTypes` (.md/.mdx/.markdown).
- Windows + Linux 동등 association.

## Rationale

- 본인 직접 제안 안 (B + D 조합) 그대로 채택 — 토론 후 다른 옵션 모두 부족 확인.
- 비대칭 (문서=편집 / 코드=read-only) 이 *"리뷰 도구"* 정체성과 자연 매칭.
- 드래그-채팅 편집 = 채팅 셸 (ADR-0010) 의 *킬러 유즈케이스* 확보.
- 외부 위임 버튼 거부 = 본 도구 가치 자기부정 회피.

## Consequences

- 새 컴포넌트: `CodeViewer` (read-only + lazy lang), `InlineDiffOverlay`, `TreeFilterToggle`.
- 신규 모듈: 파일 카테고리 디스패처, 다층 ignore matcher, drag→chat selection bridge.
- ADR-0013 의 "활성 파서 대상 확장자 자동 승격" 와 결합 (이 ADR §1).
- P-hybrid (코드+문서 병행 개발자) 부분 만족 (수용).

## Related

- ADR-0010 — Agent-Chat-First Shell
- ADR-0013 — Plugin Scope = Parser Only + Export Compat
- ADR-0016 — Parser Safety Model (T5)
- CONTEXT.md §5.4, §5.5, §5.6
- U7 task 들 (TASK-01KSVS5J4PJNTDCZSPRRH4TW54 외 5개)
