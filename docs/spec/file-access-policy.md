# File Access Policy

| Field | Value |
|---|---|
| Status | **shipped** — 사양 확정, 정책 엔진(FAP-007)·거부 카드(FAP-008)·텔레메트리(FAP-009) 모두 통합 완료 |
| Plan | `PLAN-01KRE5GWRSTHCAJ1H8FF6EDC4X` — Markspread v1.1 — Editor Ergonomics & Spec Clarification |
| Unit | F3 — File Access Policy Specification (`UNIT-01KRE5N28JWTHT6744J70QAV42`) |
| Related tasks | S-FAP-001 ~ S-FAP-009 (MAR-848 ~ MAR-856) |
| Owners | core/fs, ux/error-surface |
| Progress | ✅ FAP-001 (§2) · ✅ FAP-002 (§3) · ✅ FAP-003 (§4) · ✅ FAP-004 (§5) · ✅ FAP-005 (머지) · ✅ FAP-006 (§6) · ✅ FAP-007 (§7) · ✅ FAP-008 (§8) · ✅ FAP-009 (§9) |

## 0. 목적

워크스페이스 안에서 파일을 열거나 읽을 때 "이 파일을 읽을 수 없습니다" 류의 거부가 어떤 조건에서 발생하는지, 어떤 카테고리에 속하는지, 어떤 메시지/UX로 사용자에게 전달되는지를 단일 문서로 정리한다. 향후 (a) 단일 정책 엔진 리팩토링(FAP-007), (b) 사용자 오버라이드(FAP-006), (c) 카테고리 라벨드 UI(FAP-008)의 근거가 된다.

## 1. 목차

- [0. 목적](#0-목적)
- [1. 목차](#1-목차)
- [2. 현황 — 차단/거부 분기 인벤토리 (FAP-001 산출물)](#2-현황--차단거부-분기-인벤토리-fap-001-산출물) ✅
- [3. 카테고리 정의 — `FAP-002`](#3-카테고리-정의--fap-002) ✅
- [4. 카테고리별 트리거 룰 — `FAP-003`](#4-카테고리별-트리거-룰--fap-003) ✅
- [5. 사용자 메시지 & 해결 가이드 — `FAP-004`](#5-사용자-메시지--해결-가이드--fap-004) ✅
- [6. 사용자 오버라이드 사양 — `FAP-006`](#6-사용자-오버라이드-사양--fap-006) ✅
- [7. 정책 엔진 통합 — `FAP-007`](#7-정책-엔진-통합--fap-007) ✅
- [8. UI 라벨링 — `FAP-008`](#8-ui-라벨링--fap-008) ✅
- [9. 텔레메트리 — `FAP-009`](#9-텔레메트리--fap-009) ✅
- [10. 향후 변경 절차](#10-향후-변경-절차) ✅
- [부록 A. 용어 정리](#부록-a-용어-정리) ✅
- [부록 B. 관련 문서](#부록-b-관련-문서) ✅

---

## 2. 현황 — 차단/거부 분기 인벤토리 (FAP-001 산출물)

### 2.1 요약

현재 거부 결정은 **단일 정책 엔진 없이 Rust 백엔드 + TS 프론트엔드 양쪽에 산재**되어 있다. 사용자가 마주치는 메시지는 대부분 i18n 카탈로그(`src/locales/{ko,en,ja,zh,es}.json`)의 `errors.posix.*` 키를 통해 표시되며, 동일한 `errors.posix.eio` 키가 \"이 파일을 읽을 수 없습니다.\"라는 포괄적 카피로 다양한 원인을 흡수하고 있다 — **이것이 사용자 혼란의 핵심 원인**.

### 2.2 거부 분기 위치 (Rust 백엔드)

| # | 위치 | 트리거 조건 (요약) | 결과 (AppError) | 카테고리 추정 |
|---|---|---|---|---|
| R1 | `src-tauri/src/fs_cmd.rs:90-103` `validate_input_path()` | 빈 경로 / NUL 바이트 / URL-encoded `..` | `Invalid` | 보안차단 |
| R2 | `src-tauri/src/fs_cmd.rs:112-146` `ensure_within()` | `canonicalize` 후 워크스페이스 루트 밖 / 심볼릭 링크 DENY 정책 위반 | `PathEscape("EOUTSIDE_WORKSPACE")` | 워크스페이스경계 |
| R3 | `src-tauri/src/fs_cmd.rs:270-274` `fs_read_file` | `size >= HUGE_FILE_THRESHOLD` (100MB) | `Invalid("file too large…")` | 성능차단 |
| R4 | `src-tauri/src/error.rs:77-78` | `raw_os_error() == 21` (EISDIR — 디렉토리 오픈 시도) | `IsDirectory` | 기타 |
| R5 | `src-tauri/src/error.rs:81-89` | OS `ErrorKind::PermissionDenied` | `PermissionDenied` | 권한차단 |
| R6 | `src-tauri/src/error.rs:59-61` | 디스크 풀 감지 | `DiskFull` | 성능차단 (저장 측) |
| R7 | (read path 내 UTF-8 디코드 실패) | 텍스트 인코딩이 UTF-8 아님 | `NotUtf8` → `ENOTUTF8` | 보안/형식차단 |

> **메모**: R1~R3는 명시적 정책 분기, R4~R7은 OS 에러를 흡수해 정책 결정처럼 동작하는 분기. 정책 엔진 통합(FAP-007) 시 두 종류의 결합도를 분리해야 함.

### 2.3 매핑 위치 (TS 프론트엔드)

| # | 위치 | 역할 |
|---|---|---|
| T1 | `src/lib/errors/codes.ts:120-164` `describePosixIpcError()` | Rust IPC 에러 → POSIX 코드 → i18n 키 매핑 (단일 진입점) |
| T2 | `src/locales/{ko,en,ja,zh,es}.json` `errors.posix.*` | 사용자 메시지 카탈로그 |
| T3 | `src/components/EditorPane.tsx:87-91, 161-169` | `fs_read_file` 실패 시 i18n 메시지를 **에디터 본문 placeholder**로 표시 (빨간 텍스트) |
| T4 | `src/components/FileTree.tsx:181-182, 405-406` | 자식 로드/리프레시 실패는 **조용히 무시** (watcher 보정 기대) |
| T5 | `src/components/FileTree.tsx:516-524` `trashSelected()` | 휴지통 이동 실패 시 **토스트** (`filetree.trash.item_failed`) |
| T6 | `src/components/NonTextViewer.tsx` | 바이너리/이미지 — 거부가 아닌 대체 뷰 (정책 아님) |
| T7 | `src/.../save-tab.ts:58-71` | `fs_write` 실패 시 **토스트** (`save.failed` + 원본 에러) |

### 2.4 POSIX 코드 → i18n 키 → 카테고리 매핑 (현재)

| POSIX | i18n key | 현재 카피 (ko) | 카테고리 추정 |
|---|---|---|---|
| `EACCES` | `errors.posix.eacces` | "권한이 없습니다. 파일의 읽기 권한을 확인하세요." | 권한차단 |
| `EISDIR` | `errors.posix.isdir` | (디렉토리 안내 카피) | 기타 |
| `ENOENT` | `errors.posix.enoent` | (파일 없음 안내) | 권한차단 ⚠ 재분류 필요 |
| `EOUTSIDE_WORKSPACE` | `errors.posix.outside_workspace` | (워크스페이스 밖 안내) | 워크스페이스경계 |
| `ENOTUTF8` | `errors.posix.enotutf8` | "이 파일의 인코딩을 텍스트로 해석할 수 없습니다." | 형식차단 (신규 카테고리 후보) |
| (fallback) | `errors.posix.eio` | **"이 파일을 읽을 수 없습니다."** | **모호 — 흡수 카피** |

> **핵심 문제**: 사용자가 `node_modules` 추정 패키지에서 보는 메시지는 \"이 파일을 읽을 수 없습니다\"(=`errors.posix.eio`)인데, 현재 코드에는 **`node_modules` 같은 정책 차단 분기 자체가 없다**. 즉 그 메시지는 (a) 100MB 초과(R3), (b) UTF-8 아님(R7), (c) 일반 IO 실패(EIO) 중 하나로부터 흡수되어 출력되는 것으로 추정된다. **정책 차단(`node_modules`/`.git` 등)은 현재 부재**라는 점을 후속 단계에서 새로 도입해야 한다.

### 2.5 거부 결정의 결과 표면 (UX surface)

| Surface | 사용 위치 | 특징 |
|---|---|---|
| 에디터 본문 placeholder (빨간 텍스트) | EditorPane | 가장 가시적. 카테고리 라벨 없음 — FAP-008에서 추가 |
| 토스트 | FileTree 휴지통, save-tab 실패 | 일시적. 원본 에러 details 노출 가능 |
| 조용한 실패 (무시) | FileTree 로드/리프레시 | 사용자 인지 불가. 진단 텔레메트리(FAP-009)에서 보강 |
| 대체 뷰 | NonTextViewer | 거부가 아님 — 정책 외 |

### 2.6 결손 영역 (현 코드에 분기 없음 → 후속 단계에 신규 도입 대상)

다음 항목들은 사용자가 \"읽을 수 없음\"이라 체감하지만 현재 명시적 정책 분기가 없다:

1. **`node_modules`, `.git`, `dist`, `build`, `.next`, `.turbo`, `target`, `.venv` 등 기본 보호 디렉토리** — 현재 UI/IPC가 차단하지 않음. 사용자가 트리 탐색은 가능하나 실제 열면 EIO/사이즈 임계로 흡수되어 모호한 메시지 출력.
2. **바이너리 sniff 차단** — 현재는 디코드 시점의 `ENOTUTF8`로 사후 흡수. 사전 sniff 룰 없음.
3. **MIME/확장자 정책** — 현재 정책 없음. NonTextViewer가 사후 라우팅.
4. **워크스페이스 외부 경로** — `EOUTSIDE_WORKSPACE`는 있으나 사용자가 의도해서 그 경로를 열려고 한 경우의 UX(허용 옵션)는 없음.

### 2.7 조사 완전성 평가

**커버됨**: Rust `fs_cmd`/`error` 전체, TS `errors/codes.ts`, EditorPane/FileTree/save-tab의 사용자 가시 분기, i18n 카탈로그.

**보강 필요(후속 task에서 다룰 영역)**:
- `NonTextViewer` 내부 세부 실패(이미지/PDF 로드 오류)
- 플러그인 SDK의 파일 접근 권한(샌드박스 측) — `markspread-sdk`/`plugin::permissions` 라인 추가 조사 필요
- watcher / 폴링 기반 변화 감지 실패 시나리오
- 네트워크 드라이브 / 마운트 해제 동안의 에러 흡수

---

## 3. 카테고리 정의 — `FAP-002`

거부 결정을 **사용자가 원인과 해결책을 즉시 파악 가능한 7개 카테고리**로 표준화한다. 분류 기준은 다음 3축이다:

- **책임 주체**: OS / Markspread 정책 / 사용자 설정 / 파일 자체
- **해결 가능성**: 오버라이드 가능 / OS 액션 필요 / 형식 변환 필요 / 불가
- **위험성**: 보안 영향 / 단순 UX 영향

### 3.1 카테고리 일람

| ID | 이름 (한글) | 영문 | 책임 주체 | 오버라이드 | UX 톤 | 감사 로그 |
|---|---|---|---|---|---|---|
| `SEC` | 보안차단 | Security Block | Markspread (정책) | **불가** | 단호 / 위험 알림 | **필수** |
| `BND` | 워크스페이스 경계 | Workspace Boundary | Markspread (정책) | 워크스페이스 추가로 해소 | 안내 / 경계 설명 | 필요 |
| `PRM` | 권한차단 | Permission Block | OS | OS 권한 변경 시 자동 해소 | 안내 / OS 액션 권유 | 선택 |
| `POL` | 정책차단 | Policy Block | Markspread (기본 보호) | **가능** (FAP-006) | 안내 / "허용" CTA | 권장 |
| `PRF` | 성능차단 | Performance Block | 파일 (사이즈/노드수) | **가능** ("그래도 열기") | 경고 / 성능 영향 안내 | 선택 |
| `FMT` | 형식차단 | Format Mismatch | 파일 (인코딩/타입) | 대체 뷰어로 라우팅 | 중립 / 다른 뷰어 제안 | 불필요 |
| `IO` | 기타 (미분류) | Unclassified IO | 시스템 | 재시도 권유 | 중립 / 진단 정보 | 권장 |

> **결정 우선순위**: 한 경로가 여러 룰에 매칭될 때 `SEC > BND > PRM > POL > PRF > FMT > IO` 순으로 가장 우선하는 카테고리만 출력한다 (FAP-003에서 룰별로 재확인).

### 3.2 카테고리별 상세

#### `SEC` — 보안차단 (Security Block)

- **정의**: 경로/입력 자체가 보안 위험을 내포하거나, 정책상 노출되면 안 되는 영역. **사용자 오버라이드는 절대 허용하지 않는다.**
- **트리거 예시**: 경로에 NUL 바이트 / URL-encoded `..` traversal / `.env` 같은 secret 의심 파일(향후) / 워크스페이스 밖 심볼릭 링크 대상.
- **UX 톤**: \"이 작업은 보안 정책상 차단되었습니다.\" + 룰 ID + 문서 링크. \"허용\" 버튼 없음.
- **오버라이드**: 불가. (코드 변경/사양 변경으로만 해소)
- **감사 로그**: **필수** — 시도된 경로, 룰 ID, 타임스탬프, 호출처(IPC/UI).

#### `BND` — 워크스페이스 경계 (Workspace Boundary)

- **정의**: `canonicalize` 후 경로가 활성 워크스페이스 루트 밖. Markspread는 워크스페이스 샌드박스가 1급 원칙이므로 기본 거부.
- **트리거 예시**: 절대경로 직접 IPC, symlink 추적 후 외부, 외부 드래그앤드롭.
- **UX 톤**: \"이 경로는 현재 워크스페이스 밖입니다. 워크스페이스를 추가하거나 파일을 워크스페이스 안으로 이동하세요.\" + [워크스페이스 추가] CTA.
- **오버라이드**: 워크스페이스 추가/변경으로 해소. 단일 파일 임시 허용은 보안 검토 후 v1.2 이상에서 고려.
- **감사 로그**: 필요 — 외부 접근 시도는 패턴 모니터링 가치 있음.

#### `PRM` — 권한차단 (Permission Block)

- **정의**: OS 수준 권한 부재 (`EACCES`, `EPERM`). Markspread의 정책이 아닌 외부 사실.
- **트리거 예시**: 다른 사용자 소유 파일, 읽기 권한 미부여.
- **UX 톤**: \"이 파일을 읽을 권한이 OS에 의해 거부되었습니다.\" + OS별 해결 가이드 링크.
- **오버라이드**: Markspread 측 오버라이드 없음. OS에서 권한 변경 시 자동 해소.
- **감사 로그**: 선택 — 빈도가 높으면 텔레메트리로 확인.

#### `POL` — 정책차단 (Policy Block)

- **정의**: Markspread의 기본 보호 정책에 의해 차단. **사용자 컨텍스트(비개발 업무 문서 워크)에 부합하지 않는 영역**을 기본 차단하여 노이즈를 줄인다.
- **트리거 예시**: `node_modules`, `.git`, `dist`, `build`, `.next`, `.turbo`, `target`, `.venv`, `__pycache__` 등 보호 디렉토리 하위.
- **UX 톤**: \"이 위치는 기본 보호 영역입니다. 설정에서 허용 가능합니다.\" + [허용 목록 편집] CTA.
- **오버라이드**: **가능** — FAP-006의 `.markspread/access-allow.json` 글로브 패턴으로 사용자가 해제.
- **감사 로그**: 권장 — 오버라이드 변경 이력은 필수.

#### `PRF` — 성능차단 (Performance Block)

- **정의**: 파일 사이즈 / 디렉토리 노드 수 / 메모리 임계를 초과해 열면 앱 안정성을 해칠 수 있는 경우.
- **트리거 예시**: 단일 파일 > 100MB (현 `HUGE_FILE_THRESHOLD`), 디렉토리 노드 > 5000 (FAP-003에서 확정).
- **UX 톤**: \"이 파일은 앱 안정성을 위해 기본 차단됩니다 (사이즈 105MB).\" + [그래도 열기] CTA (위험 안내).
- **오버라이드**: 가능 — 1회성 강제 오픈 / 영구 허용 옵션.
- **감사 로그**: 선택.

#### `FMT` — 형식차단 (Format Mismatch)

- **정의**: 텍스트 뷰어가 다루기에 부적합한 형식. **정책 거부라기보다 "다른 뷰어로 라우팅"의 신호**.
- **트리거 예시**: UTF-8 디코드 실패 (바이너리), 디렉토리 오픈 시도 (`EISDIR`), 향후 등록되지 않은 MIME.
- **UX 톤**: 중립. \"이 형식은 텍스트가 아닙니다 — 이미지 뷰어로 열까요?\" 같은 라우팅 제안. v1.2 Custom Parser Platform과 직접 연계 — \"이 형식은 파서 플러그인을 설치하면 예쁘게 볼 수 있어요\".
- **오버라이드**: 라우팅이므로 \"오버라이드\"라기보다 \"강제 텍스트로 보기\" 옵션.
- **감사 로그**: 불필요.

#### `IO` — 기타 / 미분류 (Unclassified IO Error)

- **정의**: 위 카테고리 어디에도 속하지 않는 시스템 오류. EIO, 디스크 에러, 알 수 없는 OS 에러.
- **UX 톤**: \"파일 시스템에서 알 수 없는 오류가 발생했습니다 (코드: EIO).\" + [재시도] / [진단 정보 복사] CTA.
- **오버라이드**: 무관.
- **감사 로그**: 권장 — 빈도 높으면 시스템 진단 입력.

### 3.3 현재 상태 → 카테고리 매핑 갱신

§2.4 의 매핑을 본 사양에 맞춰 재정렬:

| 현재 키 | 현 카피 (ko) | **신규 카테고리** | 변경 사항 |
|---|---|---|---|
| `errors.posix.eacces` | "권한이 없습니다…" | `PRM` | 유지 |
| `errors.posix.isdir` | (디렉토리 안내) | `FMT` | 정책에서 라우팅 신호로 재분류 |
| `errors.posix.enoent` | (파일 없음) | `IO` | **재분류** (권한차단 아님 — 단순 존재 부재) |
| `errors.posix.outside_workspace` | (워크스페이스 밖) | `BND` | 유지 |
| `errors.posix.enotutf8` | "텍스트로 해석할 수 없습니다" | `FMT` | 유지 (라우팅으로 톤 변경) |
| `errors.posix.eio` (fallback) | "이 파일을 읽을 수 없습니다." | `IO` | **흡수 카피 해체** — 100MB 초과는 `PRF`로, 정책 차단(node_modules 등)은 `POL` 신규로 분리 |
| (신규) — | — | `POL` | 보호 디렉토리 정책 신설 |
| (신규) — | — | `SEC` | 정책 위반 보안 차단(NUL/traversal) 명시 분리 |
| (신규) — | — | `PRF` | 사이즈/노드수 임계 명시 분리 |



## 4. 카테고리별 트리거 룰 — `FAP-003`

각 카테고리에 속하는 **구체 룰**과 **rule_id**를 정의한다. `AccessPolicyEngine::check_access(path) -> AccessDecision` (FAP-007)이 이 표를 그대로 사용한다.

### 4.1 룰 ID 표기 규칙

`<카테고리>-<도메인>-<세부>` — 예: `POL-VCS-INTERNAL`. 모든 rule_id는 안정적이며 i18n 메시지 키 / 감사 로그 / 텔레메트리에서 동일하게 사용된다.

### 4.2 룰 표

| Rule ID | 카테고리 | 트리거 조건 | 매칭 위치 | Override | 비고 |
|---|---|---|---|---|---|
| `SEC-NULL-BYTE` | SEC | path에 NUL(`\0`) 포함 | pre-IPC validate | ❌ | 기존 R1 |
| `SEC-PATH-TRAVERSAL` | SEC | URL-encoded `..` (%2e%2e), 정규화 전 `..` segment overflow | pre-IPC validate | ❌ | 기존 R1 |
| `SEC-SYMLINK-ESCAPE` | SEC | symlink 대상이 워크스페이스 루트 밖, DENY_OUTSIDE 정책 | canonicalize + ensure_within | ❌ | 기존 R2의 symlink 분기 |
| `SEC-SECRET-FILE` *(v1.2 예약)* | SEC | `.env`, `.env.*`, `*.pem`, `id_rsa`, `*.key` 등 secret 패턴 (열람은 허용 / 클립보드/플러그인 전달 차단) | 별도 secret-detector | ❌ | v1.1 비스코프 — 룰 ID만 예약 |
| `BND-OUTSIDE-WORKSPACE` | BND | `canonicalize` 후 활성 워크스페이스 루트 밖 (symlink 추적은 정책에 따름) | ensure_within | 워크스페이스 추가로 해소 | 기존 R2 |
| `PRM-OS-EACCES` | PRM | OS `EACCES`/`EPERM` | fs IO 결과 | OS 변경 | 기존 R5 |
| `POL-VCS-INTERNAL` | POL | 경로에 `/.git/`, `/.hg/`, `/.svn/` segment | path-glob matcher | ✅ (FAP-006) | 신규 |
| `POL-NODE-MODULES` | POL | 경로에 `/node_modules/` segment | path-glob matcher | ✅ | 신규 |
| `POL-BUILD-OUTPUT` | POL | `/dist/`, `/build/`, `/out/`, `/.next/`, `/.nuxt/`, `/.turbo/`, `/.svelte-kit/`, `/.astro/`, `/target/` (Rust), `/bin/`, `/obj/` (.NET) | path-glob matcher | ✅ | 신규 |
| `POL-LANG-CACHE` | POL | `/__pycache__/`, `/.venv/`, `/venv/`, `/.tox/`, `/.gradle/`, `/.mvn/`, `/.cargo/`, `/.rustup/` | path-glob matcher | ✅ | 신규 |
| `POL-IDE-INTERNAL` | POL | `/.idea/`, `/.vscode/` *(단 `.vscode/settings.json` 같은 사용자 편집 대상은 화이트리스트로 노출)*, `/.cursor/` | path-glob matcher | ✅ | 신규 — 화이트리스트 예외 룰은 §4.4 |
| `POL-PLATFORM-CRUFT` | POL | 파일명 `.DS_Store`, `Thumbs.db`, `desktop.ini`, `*.swp`, `*.swo` | filename matcher | ✅ | 신규 |
| `PRF-FILE-SIZE-LIMIT` | PRF | 단일 파일 사이즈 ≥ 100MB (`HUGE_FILE_THRESHOLD`) | stat 결과 | ✅ ("그래도 열기") | 기존 R3 |
| `PRF-FILE-SIZE-WARN` | (경고) | 사이즈 10MB ~ 100MB | stat 결과 | — | 차단 아님, 경고 토스트만. 카테고리는 PRF지만 `decision=warn` |
| `PRF-DIR-NODE-COUNT` | PRF | 디렉토리 한 단계 안 노드 수 > 5000 | readdir 결과 | ✅ | 신규 — 노출 시점에서 페이지네이션 강제 |
| `PRF-LINE-LENGTH` *(예약)* | PRF | 단일 라인 길이 > 10MB (CodeMirror 안정성) | 파일 로드 후 | — | v1.2 이상 예약 |
| `FMT-NOT-UTF8` | FMT | UTF-8 디코드 실패 | read 결과 | "강제 텍스트로 보기" 옵션 | 기존 R7 |
| `FMT-IS-DIRECTORY` | FMT | `EISDIR` | OS 에러 | — | 기존 R4. 라우팅: 파일 트리에 포커스 |
| `FMT-BINARY-SNIFF` *(신규)* | FMT | 파일 첫 8KB에 NUL 바이트 / non-printable 비율 > 임계 | read 도중 sniff | "강제 텍스트로 보기" | NonTextViewer로 라우팅 |
| `FMT-MIME-UNSUPPORTED` *(v1.2 예약)* | FMT | MIME이 등록된 parser 플러그인과 매칭 안 됨 | 파서 라우팅 | "원본 텍스트로 보기" | v1.2 Custom Parser Platform 연계 |
| `IO-DISK-FULL` | IO | DiskFull 감지 | write 결과 | 재시도 | 기존 R6 (write 측이지만 표시 정책은 동일) |
| `IO-ENOENT` | IO | 파일 없음 (`ENOENT`) | OS 에러 | 재시도 / 파일 트리 새로고침 | §3.3에서 PRM→IO로 재분류 |
| `IO-UNCLASSIFIED` | IO | 위 어떤 룰에도 매칭되지 않는 OS 에러 | fallback | 재시도 + 진단 로그 | 기존 R7 외 잔여 |

### 4.3 매칭 알고리즘

```
fn check_access(path: &Path, intent: AccessIntent) -> AccessDecision {
    // 1. 입력 검증 (SEC 1-2)
    if has_null_byte(path) { return Deny(SEC_NULL_BYTE); }
    if has_traversal(path) { return Deny(SEC_PATH_TRAVERSAL); }

    // 2. canonicalize + 경계 검증 (SEC-3, BND)
    let canonical = canonicalize(path)?;
    match ensure_within(canonical, workspace_root) {
        Outside if via_symlink => return Deny(SEC_SYMLINK_ESCAPE),
        Outside              => return Deny(BND_OUTSIDE_WORKSPACE),
        Inside               => {},
    }

    // 3. 사용자 오버라이드 화이트리스트 우선 적용 (FAP-006)
    if allow_list_matches(canonical) { return Allow; }

    // 4. POL 글로브 매칭
    if let Some(rule) = match_pol_rule(canonical) {
        return Deny(rule);
    }

    // 5. OS stat (PRM, PRF size, FMT isdir)
    let meta = stat(canonical)?;  // EACCES → Deny(PRM_OS_EACCES)
    if meta.is_dir() && intent == OpenAsFile {
        return Deny(FMT_IS_DIRECTORY);
    }
    if meta.size >= 100MB { return Deny(PRF_FILE_SIZE_LIMIT); }
    if meta.size >= 10MB  { return Warn(PRF_FILE_SIZE_WARN); }

    // 6. 실제 read는 호출자에서 수행. read 도중 FMT-NOT-UTF8 / FMT-BINARY-SNIFF / IO-* 발생.
    Allow
}
```

> **불변식**: `Deny`는 카테고리 1개 + rule_id 1개 + (선택)힌트만 포함. 여러 룰에 동시 매칭되면 §3.1 우선순위에 따라 첫 번째만 반환.

### 4.4 화이트리스트 예외 (POL 보조 룰)

POL 카테고리는 사용성 흠집을 줄이기 위해 **기본 정책 안의 명시적 예외**를 가진다. 사용자 오버라이드(FAP-006)와는 별개로 빌트인 항목:

| Exception ID | 패턴 | 이유 |
|---|---|---|
| `POL-VCS-INTERNAL.EXC.GITHUB` | `.github/**/*.{md,yml,yaml}` | GitHub Actions / community health 문서는 비개발 업무에서도 빈번히 편집 |
| `POL-IDE-INTERNAL.EXC.VSCODE-SETTINGS` | `.vscode/{settings,launch,tasks}.json`, `.vscode/*.md` | 사용자가 명시적으로 편집하는 메타 파일 |
| `POL-IDE-INTERNAL.EXC.CURSOR-RULES` | `.cursor/rules/*.md`, `.cursor/*.md` | Cursor 사용자 룰 파일은 \"문서\" 성격 |
| `POL-LANG-CACHE.EXC.PYPROJECT` | `pyproject.toml`, `requirements*.txt` 등은 애초에 caches 외부이므로 트리거되지 않음. 명시적 캡처용. | (no-op 보장) |

> 화이트리스트 예외는 POL 룰 매칭 **직후** 다시 검사하여 매칭되면 `Allow`로 승격.

### 4.5 임계값 일람

| 상수 | 값 | 적용 룰 | 비고 |
|---|---|---|---|
| `HUGE_FILE_THRESHOLD` | 100 MB | `PRF-FILE-SIZE-LIMIT` | 기존 코드 상수 — 변경 시 ADR 필요 |
| `LARGE_FILE_WARN_THRESHOLD` | 10 MB | `PRF-FILE-SIZE-WARN` | 신규 |
| `DIR_NODE_LIMIT` | 5000 | `PRF-DIR-NODE-COUNT` | 신규. 페이지네이션 트리거 |
| `BINARY_SNIFF_BYTES` | 8 KB | `FMT-BINARY-SNIFF` | 신규 |
| `BINARY_SNIFF_NUL_THRESHOLD` | 1 NUL byte (즉 1개라도 등장) | `FMT-BINARY-SNIFF` | 보수적 — 텍스트 파일에 NUL이 정상적으로 나오는 경우는 거의 없음 |

### 4.6 충돌/엣지 케이스 결정

- **워크스페이스 루트가 `node_modules` 내부**일 때: POL은 \"활성 워크스페이스 루트 기준 상대 경로\"에 매칭. 워크스페이스 루트 자체는 정책 차단되지 않는다 — 즉 사용자가 의도해 `node_modules/some-pkg`를 워크스페이스로 열었다면 그 안의 모든 파일은 `Allow` (단 보안/성능 룰은 여전히 적용).
- **심볼릭 링크가 보호 디렉토리를 가리킴**: canonicalize 결과 경로로 POL 매칭. 즉 우회 불가.
- **POL과 화이트리스트 예외가 동시 매칭**: 화이트리스트 우선 (Allow 승격).
- **사용자 오버라이드와 SEC 동시 매칭**: SEC 우선 (override 불가 원칙).


## 5. 사용자 메시지 & 해결 가이드 — `FAP-004`

### 5.1 카탈로그 구조

5개 로케일(`ko`/`en`/`ja`/`zh`/`es`)의 `src/locales/<locale>.json` 안 `errors.access` 네임스페이스에 다음 3개 하위 트리를 두어 통합한다.

| Subtree | 키 형식 | 용도 |
|---|---|---|
| `errors.access.category.<cat>` | `sec`/`bnd`/`prm`/`pol`/`prf`/`fmt`/`io` | 에러 카드 상단 카테고리 배지 라벨 |
| `errors.access.action.<id>` | `open_settings`, `edit_allowlist`, `add_workspace`, `open_anyway`, `force_text`, `retry`, `copy_diagnostics`, `learn_more`, `show_in_tree`, `open_image_viewer` | 카드 버튼/CTA 텍스트 (공용 라벨, FAP-008 UI가 룰별 매핑 결정) |
| `errors.access.rule.<rule_id_snake>.{title,body,learn_more}` | `sec_null_byte` … `io_unclassified` | 룰별 원인+해결 카피 (snake_case로 안정화) |

> **카피 톤 규약** (§3.2 표 준수):
> - `title` — 원인을 단정형 1문장 헤드라인. SEC는 단호, BND/POL은 안내, PRF는 경고, FMT는 중립, IO는 진단 톤.
> - `body` — 원인 1문장 + 해결 1문장. 사용자가 즉시 할 행동이 있어야 한다.
> - `learn_more` — 학습 링크 라벨. 별도 가이드 문서가 없는 룰은 빈 문자열(`""`)로 둔다.
> - 보간 변수: `{{size}}` `{{limit}}` `{{count}}` `{{code}}` — i18next 표준 보간을 사용.

### 5.2 액션 카드 props 사양 (FAP-008 입력)

`<FileAccessErrorCard>` 가 받는 props (구현은 FAP-008):

```ts
type FileAccessErrorCardProps = {
  category: 'SEC' | 'BND' | 'PRM' | 'POL' | 'PRF' | 'FMT' | 'IO';
  ruleId: RuleId;             // 예: 'POL-NODE-MODULES'
  title: string;               // t('errors.access.rule.pol_node_modules.title')
  body: string;                // t('errors.access.rule.pol_node_modules.body', { size, ... })
  learnMore?: { label: string; href: string };
  primaryAction?:   { id: ActionId; label: string; onClick(): void };
  secondaryAction?: { id: ActionId; label: string; onClick(): void };
};
```

룰 → 권장 액션 매핑 (FAP-008 컴포넌트가 이 표를 룩업 테이블로 사용):

| Rule | Primary | Secondary |
|---|---|---|
| `SEC-*` | `copy_diagnostics` | `learn_more` |
| `BND-OUTSIDE-WORKSPACE` | `add_workspace` | `learn_more` |
| `PRM-OS-EACCES` | `retry` | `learn_more` |
| `POL-*` | `edit_allowlist` | `learn_more` |
| `PRF-FILE-SIZE-LIMIT` | `open_anyway` | `learn_more` |
| `PRF-FILE-SIZE-WARN` | — | — *(warn-only, 토스트만)* |
| `PRF-DIR-NODE-COUNT` | `edit_allowlist` | `learn_more` |
| `FMT-NOT-UTF8` | `force_text` | `learn_more` |
| `FMT-IS-DIRECTORY` | `show_in_tree` | — |
| `FMT-BINARY-SNIFF` | `open_image_viewer` | `force_text` |
| `IO-DISK-FULL` | `retry` | — |
| `IO-ENOENT` | `retry` | `show_in_tree` |
| `IO-UNCLASSIFIED` | `retry` | `copy_diagnostics` |

### 5.3 i18n 키 ↔ rule_id 매핑

스펙 §4.2 룰 표의 `rule_id` 를 snake_case 로 정규화해 i18n 키로 사용한다. v1.1 비스코프(예약) 룰 3개(`SEC-SECRET-FILE`, `PRF-LINE-LENGTH`, `FMT-MIME-UNSUPPORTED`)는 이번 카탈로그에 포함하지 않으며, 도입 시 §10 절차에 따라 추가한다.

| Rule ID | i18n 키 prefix |
|---|---|
| `SEC-NULL-BYTE` | `errors.access.rule.sec_null_byte` |
| `SEC-PATH-TRAVERSAL` | `errors.access.rule.sec_path_traversal` |
| `SEC-SYMLINK-ESCAPE` | `errors.access.rule.sec_symlink_escape` |
| `BND-OUTSIDE-WORKSPACE` | `errors.access.rule.bnd_outside_workspace` |
| `PRM-OS-EACCES` | `errors.access.rule.prm_os_eacces` |
| `POL-VCS-INTERNAL` | `errors.access.rule.pol_vcs_internal` |
| `POL-NODE-MODULES` | `errors.access.rule.pol_node_modules` |
| `POL-BUILD-OUTPUT` | `errors.access.rule.pol_build_output` |
| `POL-LANG-CACHE` | `errors.access.rule.pol_lang_cache` |
| `POL-IDE-INTERNAL` | `errors.access.rule.pol_ide_internal` |
| `POL-PLATFORM-CRUFT` | `errors.access.rule.pol_platform_cruft` |
| `PRF-FILE-SIZE-LIMIT` | `errors.access.rule.prf_file_size_limit` |
| `PRF-FILE-SIZE-WARN` | `errors.access.rule.prf_file_size_warn` |
| `PRF-DIR-NODE-COUNT` | `errors.access.rule.prf_dir_node_count` |
| `FMT-NOT-UTF8` | `errors.access.rule.fmt_not_utf8` |
| `FMT-IS-DIRECTORY` | `errors.access.rule.fmt_is_directory` |
| `FMT-BINARY-SNIFF` | `errors.access.rule.fmt_binary_sniff` |
| `IO-DISK-FULL` | `errors.access.rule.io_disk_full` |
| `IO-ENOENT` | `errors.access.rule.io_enoent` |
| `IO-UNCLASSIFIED` | `errors.access.rule.io_unclassified` |

### 5.4 산출물 / DoD

- ✅ `src/locales/{ko,en,ja,zh,es}.json` 의 `errors.access` 트리 (카테고리 7 / 액션 10 / 룰 20)
- ✅ 5개 로케일의 룰 키셋이 정확히 일치하며, 각 룰은 `title`/`body`/`learn_more` 필드를 모두 보유
- ⏳ `<FileAccessErrorCard>` 실제 구현은 FAP-008
- ⏳ 룰 → 액션 매핑 상수화(`RULE_ACTIONS[rule_id]`)도 FAP-008 시 함께 도입

## 6. 사용자 오버라이드 사양 — `FAP-006`

### 6.1 목표 / 비목표

**목표**
- POL 카테고리의 기본 차단을 워크스페이스 단위로 풀 수 있는 영구 화이트리스트 제공.
- 글로브 1개당 정확히 1개 `rule_id` 만 해제(보안 우회 방지).
- 변경 이력을 감사 로그로 보존해 사후 추적 가능.
- 형식이 단순하고 사람이 직접 편집할 수 있는 JSON 파일.

**비목표** (v1.1 비스코프)
- SEC/BND/PRM/IO 카테고리 오버라이드 — 구조적으로 금지(§6.5).
- PRF·FMT 의 "그래도 열기"·"강제 텍스트로 보기" — 영구 화이트리스트가 아닌 **세션 1회성** 우회. UI에서 처리 (FAP-008).
- 사용자 임의 패턴을 추가 보호하는 `deny` 항목 — 스키마에는 자리만 잡고 매칭은 v1.2에서.
- 글로벌(워크스페이스 외) 화이트리스트 — 워크스페이스 샌드박스 원칙 유지.

### 6.2 파일 위치 / 라이프사이클

- 경로: `<workspace_root>/.markspread/access-allow.json`
- 인코딩: UTF-8, LF 줄바꿈 권장.
- 생성: 사용자가 첫 오버라이드를 추가할 때 자동 생성. 비어 있는 워크스페이스에는 파일 없음 = 모든 기본 POL 정책 적용.
- VCS 정책 권장: **체크인 권장** (팀 단위 공통 오버라이드). 단 민감 글로브를 포함할 수 있으므로 `.gitignore` 에 추가하고 개인용으로 쓰는 사용 형태도 허용 — 정책 엔진은 어느 쪽도 강제하지 않음.
- 워치: 정책 엔진(FAP-007)은 파일 변경을 watch 하여 즉시 반영. 파싱 실패 시 직전 유효 상태를 유지하고 사용자에게 토스트로 알림(`access_allow.parse_error`).

### 6.3 스키마 — `access-allow.v1.json`

```json
{
  "$schema": "https://markspread.dev/schema/access-allow.v1.json",
  "version": 1,
  "allow": [
    {
      "glob": "node_modules/@my-org/**",
      "rule": "POL-NODE-MODULES",
      "note": "내부 모노레포 패키지 디버깅"
    }
  ],
  "deny": []
}
```

**Top-level 필드**

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `$schema` | string (URI) | optional | 에디터 자동 완성용. 정책 엔진은 무시. |
| `version` | integer | **required** | 현재 `1`. 미일치 시 §6.8 마이그레이션 정책. |
| `allow` | `AllowEntry[]` | **required** | 비어 있으면 `[]`. |
| `deny` | `DenyEntry[]` | optional | v1.1에서는 파싱하되 매칭 보류. 알 수 없는 형식은 경고. |

**`AllowEntry` 스키마**

| 필드 | 타입 | 필수 | 제약 |
|---|---|---|---|
| `glob` | string | **required** | §6.4 글로브 문법. 워크스페이스 루트 기준 POSIX 상대 경로. 최대 1024자. |
| `rule` | string | **required** | §6.5 허용 목록 안의 `rule_id`. 그 외 값은 거부. |
| `note` | string | optional | 사람용 메모. 정책 엔진은 사용하지 않음. 최대 200자. |
| `created_at` | string (ISO-8601) | optional | UI가 자동 채움. 사람이 비워도 무방. |

**`DenyEntry` 스키마** *(v1.1 비활성, 자리만 보존)*

| 필드 | 타입 | 필수 | 제약 |
|---|---|---|---|
| `glob` | string | **required** | 동일 문법. v1.1에서는 매칭하지 않음. |
| `category` | string | optional | v1.2에서 정의. 현재는 무시. |
| `note` | string | optional | — |

> JSON Schema 정식 파일은 `docs/spec/schema/access-allow.v1.json` 으로 별도 배포(추후 FAP-007 구현 시 생성). 본 절은 그 SoT.

### 6.4 매칭 시맨틱스

#### 6.4.1 경로 정규화 입력

엔진은 항상 다음 정규화된 표현을 사용해 매칭한다:

1. `canonicalize()` 결과(절대 경로, symlink 해석 완료) 를 가져온다.
2. 활성 워크스페이스 루트를 prefix 로 제거해 **상대 경로**를 얻는다. 결과가 `..` 로 시작하면 매칭 대상이 아님(BND 단계에서 이미 차단된 경로이므로 도달 불가).
3. 윈도우 백슬래시는 forward slash 로 변환.
4. 매칭 입력은 항상 **leading slash 없음** (`node_modules/foo/bar.js`).

#### 6.4.2 글로브 문법 (정의된 부분집합)

`gitignore` 의 일부 + `**` 명시적 재귀를 채택한다. 부정형은 지원하지 않는다(`deny` 배열로 표현).

| 메타 | 의미 |
|---|---|
| `?` | 한 글자(슬래시 제외) |
| `*` | 0+ 글자(슬래시 제외) |
| `**` | 0+ 경로 세그먼트. 단독 세그먼트로만 사용 — `a/**/b` 가능, `a**b` 금지. |
| `[abc]`·`[a-z]` | 문자 클래스(슬래시 제외) |
| `/` 로 시작 | 워크스페이스 루트 앵커. 본 사양은 항상 루트 기준이므로 `/` 로 시작하지 않아도 동일. 가독성을 위해 둘 다 허용. |
| `/` 로 끝남 | 디렉토리만 매칭. 파일은 제외. |
| escape `\` | 다음 한 글자를 메타가 아닌 리터럴로. (윈도우 경로 충돌 우려로 비권장) |

**불변식**
- 모든 매칭은 대소문자 **민감**(macOS HFS+ 의 case-insensitive 거동과 무관 — 엔진 수준에서는 민감).
- 매칭은 **경로 전체** 기준(`fullmatch`). 부분 매칭은 `**` 명시 필요.
- 룰 ID 비교는 대소문자 무시(저장 시점에는 dash 포함 원형 보존, 비교는 uppercase 정규화).

#### 6.4.3 결정 우선순위

§4.3 의사코드 단계 3 (오버라이드 화이트리스트) 와 §4.4 빌트인 화이트리스트 예외의 결합 우선순위:

```
SEC/BND  (override 불가)             ──> 최우선 Deny
  ↓ (통과 시)
사용자 allow-list      매칭?  Yes ──> Allow (단 매칭 rule_id 일치 필수)
  ↓ No
빌트인 화이트리스트(§4.4) 매칭? Yes ──> Allow
  ↓ No
POL 룰                매칭?  Yes ──> Deny(POL-*)
  ↓ No
PRM/PRF/FMT/IO 평가 (이하 §4.3)
```

즉 SEC/BND 가 통과한 뒤에 한해 사용자 allow-list 가 빌트인 화이트리스트보다 **먼저** 평가된다. 사용자 의도를 우선하지만 보안 룰은 절대 우회 못 함.

#### 6.4.4 매칭 동시성 / 엣지

- 동일 경로가 여러 `AllowEntry` 에 매칭되더라도 결과는 동일(Allow). 가장 먼저 매칭된 엔트리 식별자만 감사 로그에 기록.
- `glob` 이 빌트인 보호 영역 밖을 지목 — 무효가 아니라 no-op (그 경로는 어차피 차단되지 않음). 경고 표시 없음.
- `glob` 이 SEC/BND 가 적용되는 경로에 매칭 — Deny 가 우선이므로 효과 없음. 사용자에게는 "이 패턴은 보안 룰로 우선 차단됩니다" 토스트(`access_allow.shadowed`)로 안내.

### 6.5 오버라이드 가능 룰 목록

`AllowEntry.rule` 에 들어올 수 있는 값은 다음으로 한정한다. 그 외 값을 가진 엔트리는 거부(파일 파싱 실패 아님; 해당 엔트리만 무시 + 토스트).

| 허용된 rule_id | 카테고리 | 비고 |
|---|---|---|
| `POL-VCS-INTERNAL` | POL | |
| `POL-NODE-MODULES` | POL | |
| `POL-BUILD-OUTPUT` | POL | |
| `POL-LANG-CACHE` | POL | |
| `POL-IDE-INTERNAL` | POL | 빌트인 화이트리스트와 별개로 추가 해제 가능 |
| `POL-PLATFORM-CRUFT` | POL | |

**명시적 금지** (저장 시점에 거부):
- `SEC-*` — 보안 우회. 절대 불가.
- `BND-OUTSIDE-WORKSPACE` — 워크스페이스 추가로 해소. allow-list 대상 아님.
- `PRM-*` — OS 책임. allow-list 로 우회 불가.
- `PRF-*`·`FMT-*` — 영구 화이트리스트가 아니라 1회 우회(FAP-008 UI).
- `IO-*` — 거부 자체가 정책이 아님. 우회 의미 없음.

확장 절차: 새 POL 룰 추가 시 §10 변경 절차를 따라 본 표를 갱신한다.

### 6.6 감사 로그

#### 6.6.1 저장소

- 위치: 로컬 SQLite, 테이블 `policy_audit` (FAP-009 의 `access_decision_counter` 와 별개).
- 외부 송신 없음. 사용자 동의/옵트인 없이 항상 기록(정책 변경 추적은 보안 요구사항).

#### 6.6.2 스키마

```sql
CREATE TABLE policy_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,           -- ISO-8601 UTC
  workspace   TEXT NOT NULL,           -- workspace_id (hash of root path)
  event       TEXT NOT NULL,           -- 'allow_added' | 'allow_removed' | 'allow_modified' | 'allow_used' | 'parse_error' | 'shadowed'
  rule_id     TEXT,                    -- 영향 받은 rule_id (해당 없으면 NULL)
  glob        TEXT,                    -- 영향 받은 glob (해당 없으면 NULL)
  path        TEXT,                    -- allow_used 시 실제 매칭된 상대 경로
  note        TEXT,                    -- AllowEntry.note 스냅샷
  actor       TEXT NOT NULL            -- 'user' | 'sync' | 'migration'
);
CREATE INDEX policy_audit_ts ON policy_audit(ts);
CREATE INDEX policy_audit_ws ON policy_audit(workspace, ts);
```

#### 6.6.3 이벤트 목록

| event | 트리거 |
|---|---|
| `allow_added` | 새 `AllowEntry` 추가 (UI 또는 직접 편집 후 watcher 반영) |
| `allow_removed` | 엔트리 삭제 |
| `allow_modified` | `glob`/`rule`/`note` 중 1개 이상 변경 |
| `allow_used` | 런타임 매칭으로 Allow 가 결정된 순간 (디바운스: 동일 (workspace, glob, rule_id, path) 의 연속 기록은 60초 1회) |
| `parse_error` | 파일 파싱 실패. 실패 사유 요약을 `note` 에 저장 |
| `shadowed` | SEC/BND 가 사용자 allow 보다 우선해 효과를 무효화한 경우 |

#### 6.6.4 회전 / 유출 방지

- 보존 기간: 기본 90일 (설정 가능). 초과 행은 일 단위 배치로 삭제.
- 사용자가 `policy_audit` 을 내보내고 싶을 때는 설정 UI 의 "감사 로그 내보내기" 로 CSV 추출.
- `path`/`glob` 에 잠재적으로 사용자 디스크 구조가 포함될 수 있으므로 외부 송신은 절대 없음(텔레메트리 FAP-009 와도 별도 DB 격리 권장).

### 6.7 UX 진입점

| 진입점 | 동작 |
|---|---|
| 거부 카드의 `[허용 목록 편집]` 액션 (FAP-008) | 설정 → 보안 → 파일 접근 → 허용 목록 패널 열기 + 현재 차단된 경로/rule_id 가 prefilled |
| 명령 팔레트 `File: Open Access Allow List` | 위와 동일 |
| 직접 편집 | 사용자가 IDE 로 `access-allow.json` 을 열어 편집 — watcher 가 변경을 잡고 즉시 반영 |
| 설정 → 진단 → 감사 로그 | 카테고리별/일자별 이벤트 표시, CSV 내보내기 |

UI 컴포넌트 구현은 FAP-008(거부 카드) 및 별도 설정 패널 작업으로 분기.

### 6.8 마이그레이션 / 버전 호환

- `version` 누락 → 1로 가정하되 토스트 경고.
- `version` > 현재 지원 버전 → 파일 전체를 안전상 무시하고 토스트(`access_allow.unsupported_version`). 정책은 빌트인 기본값만 적용.
- 향후 버전 업 시: 새 키 추가는 후방 호환(기존 구현 무시), 키 의미 변경은 메이저 버전 bump 필수.
- 마이그레이션 도구: 별도 명령 (`markspread access migrate`) 으로 v1 → v2 자동 변환 제공.

### 6.9 엔진 통합 계약 (FAP-007 입력)

FAP-007 이 즉시 사용 가능한 Rust 인터페이스 초안:

```rust
pub struct AllowList {
    version: u32,
    entries: Vec<AllowEntry>,
}

pub struct AllowEntry {
    pub glob: CompiledGlob,        // 파싱 + 컴파일 완료된 매처
    pub rule: RuleId,               // 검증 통과한 화이트리스트 룰 ID
    pub note: Option<String>,
}

impl AllowList {
    /// 새로고침. 파싱 실패 시 직전 상태 유지.
    pub fn load(workspace_root: &Path) -> Result<Self, AccessAllowError>;

    /// (canonical_rel, rule_id) 매칭 여부. 매칭 시 매칭된 엔트리 인덱스 반환.
    pub fn matches(&self, rel: &Path, rule: RuleId) -> Option<usize>;
}
```

- `CompiledGlob` 는 §6.4.2 부분집합만 지원 — `globset` crate 의 `Glob::new` 결과를 wrapping 하되 메타 검증을 layer로 추가.
- 파일 watcher 는 `tauri::api::notification` 이 아닌 `notify` crate 로 구현(이미 의존). 디바운스 200ms.

### 6.10 산출물 / DoD

- ✅ §6 사양 (포맷·매칭·우선순위·감사 로그·UX·엔진 계약) 완료 — 본 절.
- ⏳ `docs/spec/schema/access-allow.v1.json` JSON Schema 정식 파일 — FAP-007 구현 시 생성.
- ⏳ Rust `AllowList` 구현 — FAP-007.
- ⏳ 설정 UI 의 허용 목록 패널 — FAP-008 에 후속 작업으로 추가.
- ⏳ 감사 로그 SQLite 스키마 마이그레이션 — FAP-007.

## 7. 정책 엔진 통합 — `FAP-007`

**입력**: §4.3 매칭 알고리즘 + §4.2 룰 표 + §4.4 화이트리스트 + §4.5 임계값.

### 7.1 모듈 구성

```
src-tauri/src/access_policy/
├── mod.rs       (re-exports: AccessCategory, RuleId, AccessDecision, AccessIntent, VarValue,
│                              check_access, check_path_input, check_stat, ensure_within_engine)
├── decision.rs  (타입 + Serialize — 프론트 `src/lib/access-policy/types.ts` 와 1:1)
├── engine.rs    (`check_access`, `check_path_input`, `ensure_within_engine`, `check_stat`)
├── rules.rs     (`has_null_byte`, `has_encoded_traversal`, `match_pol_rule`,
│                 `is_pol_exception`, `looks_binary`, 임계값 상수)
└── tests.rs     (per-category ≥ 2 케이스 + end-to-end priority 테스트)
```

### 7.2 공용 타입

```rust
pub enum AccessCategory { SEC, BND, PRM, POL, PRF, FMT, IO }
pub enum RuleId { /* 20 종 — 프론트 RuleId 와 동일 */ }
pub enum AccessIntent { OpenAsFile, ListDir, Write, Stat }
pub struct AccessDecision {
    pub rule_id: RuleId,
    pub category: AccessCategory,
    pub vars: Option<BTreeMap<String, VarValue>>,
}
```

`AccessDecision` 의 `Serialize` 구현은 프론트 `AccessDecision` interface (`ruleId`/`category`/`vars`) 와 정확히 일치 — IPC 라운드트립에 추가 변환 불필요.

### 7.3 진입점

```rust
pub fn ensure_within_engine(workspace: &Path, target: &Path) -> Result<PathBuf, AccessDecision>;
pub fn check_path_input(raw: &str) -> Option<AccessDecision>;
pub fn check_access(workspace: &Path, relative: &Path, raw: &str,
                    intent: AccessIntent) -> Result<PathBuf, AccessDecision>;
pub fn check_stat(meta: &Metadata, intent: AccessIntent) -> Option<AccessDecision>;
```

`fs_cmd.rs` 의 기존 두 헬퍼는 엔진 위임 wrapper 로 축소:

```rust
pub(crate) fn validate_input_path(raw: &str) -> AppResult<()> {
    if let Some(d) = check_path_input(raw) { return Err(AppError::Access(d)); }
    Ok(())
}
pub(crate) fn ensure_within(ws: &Path, target: &Path) -> AppResult<PathBuf> {
    ensure_within_engine(ws, target).map_err(AppError::Access)
}
```

이 한 줄 위임만으로 `fs_read_file`, `fs_write`, `fs_stat`, `fs_list_dir`, `fs_read_chunk`, `fs_remove_*`, `fs_copy`, `fs_move`, `fs_rename`, `fs_create_dir` 등 **14개 fs 커맨드 호출처 전부**가 자동 마이그레이션. 호출처별 개별 수정 없음.

### 7.4 IPC 직렬화

`AppError` 에 `Access(AccessDecision)` variant 추가. `Serialize` 는 레거시 페이로드(`code`, `message`)를 유지하면서 새 `access` 필드를 함께 노출:

```jsonc
{
  "code": "EOUTSIDE_WORKSPACE",         // 레거시: 기존 콜러 호환
  "message": "...",
  "access": {                            // FAP-008 카드가 직접 디코드
    "ruleId": "SEC-SYMLINK-ESCAPE",
    "category": "SEC",
    "vars": { "path": "/outside/secret.md" }
  }
}
```

레거시 `code` 매핑은 `error::access_decision_legacy_code()` 가 룰별 POSIX 코드(BND→EOUTSIDE_WORKSPACE, PRM→EACCES, PRF→EFBIG 등)를 부여하므로 기존 frontend `fromPosixError` 도 그대로 작동. 새 `access` 필드가 있으면 frontend 가 그것을 우선 채택해서 SEC-SYMLINK-ESCAPE 처럼 같은 POSIX 코드를 공유하는 룰을 분리 렌더한다.

### 7.5 우선순위 처리

§3.1 SEC > BND > PRM > POL > PRF > FMT > IO 를 그대로 따른다:

1. SEC pre-IPC (null byte, encoded traversal) — `check_path_input`
2. SEC-SYMLINK-ESCAPE / BND-OUTSIDE-WORKSPACE — `ensure_within_engine` 가 canonicalize 후 워크스페이스 경계 검사. 경계를 넘은 경로가 symlink 컴포넌트를 거치면 SEC, 아니면 BND.
3. POL — `match_pol_rule` + `is_pol_exception` (§4.4 빌트인 화이트리스트). 현재 **엔진엔 구현 + 단위 테스트로 회귀 방어**, fs_cmd 단계 게이팅은 `pol_enabled = false` 로 OFF. FAP-006 사용자 allow-list UI 가 착륙해야 실제 차단으로 전환 — 그때까지는 사용자가 `node_modules/` 을 열 수 있는 v1.0 동작 유지.
4. PRM/PRF/FMT/IO — fs 호출 결과의 `io::Error` 가 `AppError::From<io::Error>` → `access_decision()` 으로 변환되며, FMT/PRF 의 상위 케이스(`FMT-IS-DIRECTORY`, `PRF-FILE-SIZE-LIMIT`)는 `check_stat` 으로 라우팅 가능.

### 7.6 ancestor walk (신규 파일 저장 케이스)

`ensure_within_engine` 는 canonicalize 가 실패하면 가장 가까운 존재하는 ancestor 까지 올라가 캐노니컬라이즈한 뒤 suffix 를 재결합한다. 그래야 `fs_write("new/file.md")` 또는 `fs_create_dir("a/b/c")` 같이 leaf 가 아직 없는 경로도 경계 검사가 통과한다. 결과 경로는 여전히 `starts_with(ws_canonical)` 로 워크스페이스 prefix 가 강제된다 (escape 불가).

### 7.7 단위 테스트 (`access_policy/tests.rs`)

| 카테고리 | 케이스 |
|----------|--------|
| SEC | NUL 바이트 입력, encoded traversal, symlink 탈출 (3) |
| BND | absolute path 탈출, `..` 조인 탈출, 정상 in-workspace allow (3) |
| PRM | 룰 분류·POSIX 매핑 동등성 (2) |
| POL | node_modules / .git / .DS_Store 매칭, vscode·github 화이트리스트 예외 (4) |
| PRF | 10MB ≤ size < 100MB 경고, < 10MB 정상 통과 (2) |
| FMT | 디렉토리에 OpenAsFile, NUL sniff (2) |
| IO | 빈 입력, IO 룰 카테고리 분류 (2) |
| E2E | 정상 경로 통과, SEC > BND 우선순위 (2) |

총 20 케이스. `cargo test --lib` 시 access_policy + fs_cmd 단위 테스트가 모두 통과.

### 7.8 DoD

- [x] `src-tauri/src/access_policy/` 모듈 + 4 파일 (decision/engine/rules/tests)
- [x] `check_access`, `check_path_input`, `ensure_within_engine`, `check_stat` 공용 export
- [x] `AccessDecision`/`RuleId`/`AccessCategory` 가 프론트 타입과 동일 wire shape
- [x] `AppError::Access(AccessDecision)` variant + legacy `code` 보존 + `access` 필드 직렬화
- [x] `fs_cmd` 의 `validate_input_path` / `ensure_within` 한 줄 위임화 → 14개 호출처 마이그레이션
- [x] 각 카테고리 ≥ 2 단위 테스트 (총 20)
- [x] 프론트 `fromPosixError` 가 `access` 필드 우선 채택 + 회귀 테스트 2 케이스 추가
- [ ] POL 룰 라이브 게이팅 — FAP-006 allow-list UI 착륙 후 `pol_enabled = true` 플립.

## 8. UI 라벨링 — `FAP-008`

**입력**: §3.1 카테고리 색상 토큰, §3.2 UX 톤, §4.2 룰 ID, §5.1 i18n 카탈로그, §5.2 액션 매핑 표.

### 8.1 산출물

| 파일 | 역할 |
| ---- | ---- |
| `src/lib/access-policy/types.ts` | `AccessCategory`/`RuleId`/`ActionId`/`AccessDecision` 공용 타입 |
| `src/lib/access-policy/mapping.ts` | `RULE_TO_CATEGORY`, `RULE_ACTIONS`, `ruleI18nPrefix`, `fromPosixError`, `specAnchorFor` |
| `src/lib/access-policy/mapping.test.ts` | 9 케이스 — 카테고리·i18n·액션·POSIX shim·스펙 앵커 회귀 |
| `src/components/FileAccessErrorCard.tsx` | 거부 카드 — 카테고리 배지 + 룰 ID + 카피 + 액션 버튼 + "왜?" 링크 |
| `src/components/EditorPane.tsx` | 빨간 placeholder 제거, `FileAccessErrorCard` + retry/copy_diagnostics 핸들러 |
| `src/styles.css` | `--color-access-{danger,warning,info,muted}-{bg,fg,border}` 4개 톤 × 라이트/다크 |
| `src/locales/{en,ko,ja,zh,es}.json` | §5 카탈로그(`errors.access.*`)는 FAP-004에서 머지 — FAP-008 은 소비 측 |

### 8.2 카테고리 → 톤 매핑

`FileAccessErrorCard.CATEGORY_TONE` 에 표를 단일 출처로 둔다.

| 카테고리 | 톤 | CSS 토큰 prefix |
| -------- | -- | --------------- |
| `SEC` | `danger` | `--color-access-danger-*` |
| `BND` | `info` | `--color-access-info-*` |
| `PRM` | `warning` | `--color-access-warning-*` |
| `POL` | `info` | `--color-access-info-*` |
| `PRF` | `warning` | `--color-access-warning-*` |
| `FMT` | `muted` | `--color-access-muted-*` |
| `IO` | `muted` | `--color-access-muted-*` |

`color-mix(in oklab, currentColor X%, transparent)` 로 배지·버튼 배경을 합성해 다크 모드에서 별도 토큰 추가 없이 톤이 유지된다.

### 8.3 카드 구성

- `role="alert"`, `aria-label` 은 `errors.access.category.<lower>` (스크린리더가 카테고리부터 읽음).
- `data-rule-id`, `data-access-category`, `data-access-tone` 속성 — 텔레메트리(FAP-009)·E2E 셀렉터·테마 디버그용.
- 카드 본문: 카테고리 배지(uppercase) → 룰 ID 코드 칩(`text-xs opacity-70`) → 제목(h2) → 본문(p) → 액션 footer.
- 액션 버튼은 핸들러가 주입된 ActionId 만 렌더 — 미구현 액션(예: `edit_allowlist`)은 자동 숨김.
- "왜?" 링크는 `specAnchorFor(ruleId)` 가 만든 `https://docs.markspread.dev/spec/file-access-policy#<rule-id-kebab>` 으로 새 탭.

### 8.4 EditorPane 통합

- `fs_read_file` 실패 시 `fromPosixError(err)` 로 `AccessDecision` 으로 승급해 `errors[path]` 에 저장(향후 FAP-007 이 IPC 단에서 직접 `AccessDecision` 을 반환하면 shim 만 교체).
- 빨간 텍스트 placeholder → `<FileAccessErrorCard>` (max-w-lg).
- 핸들러:
  - `retry` — `errors[path]` 삭제 + `reloadKey` 증가로 effect 재실행.
  - `copy_diagnostics` — `{ruleId, category, path, vars}` JSON 을 클립보드로 복사.
- `edit_allowlist`/`add_workspace`/`open_settings` 핸들러는 FAP-006 UI·설정 패널 착륙 후 주입(현재는 카드에 버튼 미렌더).

### 8.5 i18n 키 형식

`ruleI18nPrefix(rule_id)` 가 `errors.access.rule.<snake_case>` 로 변환하고, 카드가 `.title`/`.body`/`.learn_more` 를 t() 한다. `vars` 가 있으면 그대로 interpolation 으로 전달(예: `{{size}}`/`{{limit}}`/`{{code}}`). 회귀 테스트가 `en`·`ko` 번들에 20개 룰 전부 키가 존재함을 검증.

### 8.6 POSIX → RuleId 승급 (shim)

```text
EOUTSIDE_WORKSPACE → BND-OUTSIDE-WORKSPACE
EACCES             → PRM-OS-EACCES
EISDIR             → FMT-IS-DIRECTORY
ENOTUTF8           → FMT-NOT-UTF8
ENOSPC             → IO-DISK-FULL
ENOENT             → IO-ENOENT
*                  → IO-UNCLASSIFIED (vars.code 에 원본 코드)
```

오브젝트가 아니거나 `code` 가 누락된 입력은 throw 없이 `IO-UNCLASSIFIED` 로 폴백. FAP-007 이 통합 엔진을 도입하면 이 함수는 IPC 응답 디코더로만 남는다.

### 8.7 DoD

- [x] CSS 톤 토큰 4 × {bg,fg,border} 라이트/다크 양쪽 정의
- [x] `RuleId`·`AccessCategory`·`ActionId` 공용 타입 export
- [x] `RULE_ACTIONS` 표가 §5.2 매핑과 1:1
- [x] `FileAccessErrorCard` 가 카테고리 라벨·룰 ID·카피·1차/2차 액션·"왜?" 링크 렌더
- [x] EditorPane 빨간 placeholder 제거, 카드 + retry + copy_diagnostics 결선
- [x] 회귀 테스트 9개 통과 (RULE_TO_CATEGORY, 액션 정책, POSIX shim, i18n 키, 스펙 앵커)
- [ ] 토스트(§2.3 T5, T7)·파일 트리 prefetch 실패도 카드/배지 로 라벨링 — FAP-007 통합 시 후속

## 9. 텔레메트리 — `FAP-009`

### 9.1 원칙

- **로컬 전용 (local-only)**. 외부 송신·집계 서버 없음. 모든 카운터는 사용자의 디스크에만 머문다.
- **옵트인 (기본 OFF)**. 사용자가 명시적으로 켜기 전까지 `record()`는 즉시 반환하며 DB도 열지 않는다.
- **best-effort**. 텔레메트리 실패가 원래 fs 동작을 막거나 에러 전파를 바꾸지 않는다. 모든 실패는 silent (warn 로그만).
- **카운터 only**. 경로·내용·glob 등 사용자 디스크 구조를 추론할 수 있는 정보는 절대 저장하지 않는다.

### 9.2 저장소 스키마

- 위치: `data_dir()/access_telemetry.db` (`ops_erase_all`이 wipe 하는 디렉토리 안에 위치 → 사용자가 "모두 삭제"를 누르면 함께 삭제됨)
- 모드: SQLite + WAL.
- 테이블:

  ```sql
  CREATE TABLE IF NOT EXISTS access_decision_counter (
      date     TEXT NOT NULL,  -- UTC, YYYY-MM-DD
      category TEXT NOT NULL,  -- SEC|BND|PRM|POL|PRF|FMT|IO
      rule_id  TEXT NOT NULL,  -- §4.2 와이어 문자열
      count    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, category, rule_id)
  );
  ```

- 기록 패턴: `INSERT ... ON CONFLICT(date, category, rule_id) DO UPDATE SET count = count + 1`.
- 별도 DB로 격리한 이유: §6.6 `policy_audit`(오버라이드 감사)와 lifecycle·민감도가 다르다 — 감사 로그는 사용자 결정의 흔적이고 텔레메트리는 카운터다.

### 9.3 옵트인 플래그

- 위치: `data_dir()/settings.json` 의 최상위 키 `telemetryAccessEnabled` (bool).
- 기본값: `false`. 키가 없거나 파일이 없으면 `false`로 간주.
- 토글 시 `telemetry_access_set(enabled)` IPC 가 settings.json 을 갱신한다. 끌 때는 in-process 커넥션을 drop 만 하고 기존 데이터는 보존(사용자가 카운트를 보고 끄는 시나리오).

### 9.4 기록 진입점

- `crate::telemetry::record(decision: &AccessDecision)` — synchronous, best-effort.
- 호출 지점:
  - `fs_cmd::validate_input_path` (SEC pre-check 차단 시)
  - `fs_cmd::ensure_within` (엔진의 BND/SEC-SYMLINK-ESCAPE 차단 시)
- 두 지점 모두 `AppError::Access(d)` 로 분기하기 직전에 `telemetry::record(&d)` 를 호출. 엔진 결정(§4.3)이 이미 결정된 후이므로 카운터는 카테고리 우선순위가 반영된 최종 rule_id로 집계된다.

### 9.5 IPC 명령 / 프론트엔드 표면

`tauri::generate_handler!` 에 4개 명령 등록:

| 명령 | 입력 | 출력 | 용도 |
|---|---|---|---|
| `telemetry_access_get` | — | `{ enabled }` | 설정 화면 초기 로드 |
| `telemetry_access_set` | `{ enabled }` | — | 토글 |
| `telemetry_access_query` | `{ days?: 1..365 (default 30) }` | `[{ date, category, ruleId, count }]` | 통계 표 |
| `telemetry_access_clear` | — | — | DB TRUNCATE (DELETE FROM …) |

- 직렬화는 `serde(rename_all = "camelCase")` — `ruleId` 가 프론트엔드 `AccessDecision` 타입과 1:1 일치.
- 컴포넌트: `src/components/SettingsDiagnostics.tsx` — 설정 시트 안에 "진단" 섹션으로 표시. 옵트인 체크박스 + 최근 30일 표 + 새로고침/비우기 버튼.
- i18n: `settings.diagnostics.*` 키를 5개 로케일(en/ko/ja/zh/es) 동시 추가.

### 9.6 동시성

- 내부 락: `static RECORDER: Mutex<Option<Connection>>`. 첫 deny 발생 시 lazy-open, 이후 재사용. 다수의 deny가 동시에 발생해도 WAL 작가가 하나만 떠 있다.
- `telemetry_access_clear` 와 `telemetry_access_set(false)` 는 in-process 커넥션을 drop 하여 다음 deny가 reopen 하도록 강제 → 다른 프로세스/세션이 DB를 동시에 잡고 있어도 안전하게 회복.

### 9.7 보안 / 프라이버시

- 저장하지 않는 정보: 경로 문자열, 파일명, 워크스페이스 경로, glob, 사용자 입력, 사용자 ID. → 카운터에서 사용자 디스크 구조를 복원할 수 없음.
- 저장하는 정보: rule_id, category, 날짜(UTC), 횟수. 모두 이미 §4.2 에 정의된 상수 집합 안의 값.
- 송신 없음. `reqwest`/`tauri-plugin-http` 등 어떤 네트워크 모듈도 import 하지 않는다.

### 9.8 단위 테스트

`src-tauri/src/telemetry/mod.rs#tests`:

- `record_when_disabled_is_noop` — `telemetryAccessEnabled` 미설정 상태에서 `record()` 가 panic 없이 즉시 반환하며 DB를 열지 않음.
- `stat_row_serializes_to_camel_case` — `AccessStatRow` 가 `ruleId`/`count` 키로 JSON 출력됨 (프론트엔드 계약 회귀 방지).

### 9.9 DoD

- [x] SQLite 테이블 + WAL + 옵트인 플래그
- [x] `record()` 가 `fs_cmd` 의 두 차단 지점에서 호출됨
- [x] 4개 IPC 명령 등록, camelCase 직렬화
- [x] 설정 시트 진단 섹션, 5개 로케일 i18n
- [x] 외부 송신 없음 — `reqwest` 등 import 부재 검증
- [x] FAP 유닛(F3) 전체 닫힘

## 10. 향후 변경 절차

정책 추가/완화는 다음 절차를 따른다:

1. **사용자 영향 평가** — 어떤 워크플로가 막히거나 풀리는지 시나리오 명시.
2. **rule_id 신규 발급** — §4.1 네이밍 규칙 준수. 기존 `rule_id`는 절대 의미 변경 금지(텔레메트리/감사 로그 연속성).
3. **카테고리 우선순위 변경 금지** — §3.1 우선순위는 안정성을 위해 ADR 없이는 변경하지 않는다.
4. **카피 변경** — `errors.access.<rule_id>` 키 추가/수정. 5개 로케일 동시 갱신 원칙.
5. **테스트** — 신규 룰은 단위 테스트 + E2E 시나리오 1개 이상.
6. **변경 로그** — 이 문서 §11(추가 예정 — 변경 이력)에 누적.

---

## 부록 A. 용어 정리

- **rule_id**: 거부 결정의 안정적 식별자. 형식 `<카테고리>-<도메인>-<세부>`.
- **canonicalize**: symlink 해석 + 정규화된 절대 경로. POL/BND 매칭의 표준 입력.
- **활성 워크스페이스 루트**: 사용자가 현재 열어둔 워크스페이스의 최상위 디렉토리. canonicalize 후 비교.
- **오버라이드(override)**: 사용자가 정책 차단을 명시적으로 해제하는 행위. POL만 허용.
- **AccessDecision**: 엔진 출력 (Allow / Warn / Deny). 카테고리·rule_id·힌트를 포함.

## 부록 B. 관련 문서

- `docs/spec/` — 사양 문서 디렉토리 (이 문서가 첫 사양)
- 코드 위치 (FAP-007 후 갱신):
  - `src-tauri/src/access_policy/` *(신규, FAP-007에서 생성)*
  - `src-tauri/src/fs_cmd.rs` *(기존 분기 마이그레이션 대상)*
  - `src-tauri/src/error.rs` *(기존 분기 마이그레이션 대상)*
  - `src/lib/errors/codes.ts` *(POSIX → rule_id 매핑 갱신)*
  - `src/locales/*/file-access.json` *(FAP-004 카피 카탈로그)*
- 연계 플랜: `PLAN-01KRE5JF06ES5SCMRMTE5SZHQN` (v1.2 Document-First Refocus) — FMT-MIME-UNSUPPORTED 룰이 Custom Parser Platform 직접 연결.
