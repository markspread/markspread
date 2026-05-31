# ADR-0007: Bundle size & cold-start budget guard

| Field | Value |
|---|---|
| Status | **Accepted** (S-PF-002, S-PF-019) |
| Date | 2026-05-20 |
| Owners | Performance unit (v1.2 Sprint 2) |
| Supersedes | — |
| Superseded by | — |
| Related | ADR-0004 (SDK 의존 추가가 ceiling 안인지 점검), ADR-0010 (ChatShell 첫 페인트 회귀 가드), ADR-0012 (15MB 상한이 plugin runtime 채택을 배제), `scripts/perf/check-bundle.mjs`, `scripts/perf/check-budgets.mjs`, `scripts/perf/cold-start-probe.mjs`, `.github/workflows/perf.yml` |

## Context

Markspread 의 v1 차별점은 "**가볍다**" 다. 이 단어가 마케팅 카피로 남지 않고 *CI 가 회귀를 막는 숫자* 가 되도록 본 ADR 이 두 숫자를 박는다.

- **번들 사이즈**: `dist/` 의 gzip 합계가 일정 ceiling 을 넘으면 PR 실패.
- **콜드 스타트**: 디버그 바이너리의 `--headless-cold-start` 프로브가 p50/p95 budget 을 넘으면 PR 실패.

ADR-0004 (SDK 의존성 추가), ADR-0010 (ChatShell 추가), ADR-0012 (plugin SDK 추가) 모두 자신의 Consequences 절에서 본 ADR 의 ceiling 을 *참조* 한다. 본 ADR 은 그 ceiling 의 단일 source.

`x-thread.md` 의 마케팅 카피 "Cold start: ~220 ms on a 2024 MacBook Air" 도 본 ADR 의 budget 가 충족될 때만 유효.

## Decision

### D1. 번들 ceiling (gzip)

| Metric | Ceiling | Source |
|---|---:|---|
| dmg 합계 (인스톨러 페이로드) | **15 MB** | ADR-0010/0012 가 참조 |
| renderer JS 합계 (gzip) | 900 KB | `check-bundle.mjs` |
| renderer CSS 합계 (gzip) | 80 KB | `check-bundle.mjs` |
| 최대 단일 chunk (gzip) | 500 KB | `check-bundle.mjs` |

15 MB 는 *dmg 인스톨러* 기준 (Rust 바이너리 + WebView2/wry runtime + bundled assets 포함). renderer 만은 900 KB ceiling 으로 별도 게이팅 — 둘 다 충족해야 통과.

ceiling 변경은 *동일 PR* 안에서만 허용 — 무엇이 무게를 추가했고 어떤 가치와 trade off 했는지 diff 가 기록.

### D2. Cold-start budget

`cold-start-probe.mjs` 가 디버그 바이너리를 `--runs N` 으로 반복 실행, warmup 1회 후 측정. release 바이너리는 디버그의 약 50% 라는 경험치 — 사용자 향 표기는 *release 환산*.

| Platform | Debug p50 | Debug p95 | Release 환산 사용자 표기 |
|---|---:|---:|---|
| darwin | 800 ms | 1200 ms | <600 ms |
| linux | 1000 ms | 1500 ms | <600 ms |
| win32 | 1500 ms | 2200 ms | <800 ms |

**ADR-0012 가 명시한 "<600ms cold start"** 는 macOS release 환산 기준. CI 는 debug 바이너리에서 더 느슨한 budget 으로 게이팅 (`check-budgets.mjs` 의 `DEFAULT_BUDGETS`) — 디버그가 release 보다 ~2× 느린 현실 반영.

`P50_BUDGET_MS` / `P95_BUDGET_MS` env 로 per-run override 가능 (release 채널 시뮬레이션).

### D3. CI 통합

`.github/workflows/perf.yml` 의 두 잡:

```
build-bundle  →  pnpm vite build  →  node scripts/perf/check-bundle.mjs   (D1)
build-probe   →  cargo build      →  node scripts/perf/cold-start-probe.mjs --runs 5 --report perf-stats.jsonl
                                  →  node scripts/perf/check-budgets.mjs perf-stats.jsonl   (D2)
```

PR 에는 두 잡의 결과가 *비교 표* 로 코멘트 (`scripts/perf/bundle-diff.mjs`). 회귀 시 라벨 `perf:regress`.

### D4. 측정 규약 — 무엇을 콜드 스타트로 부르는가

- *측정 구간*: 프로세스 spawn → 첫 IPC 메시지 (`window-ready`).
- *제외*: OS 의 dyld/페이지인 (warmup 1회로 우회), 사용자 자격 증명 로드 (ADR-0004 의 SDK 부트는 *idle 시점* 으로 분리), 첫 워크스페이스 마운트 (별도 메트릭 `workspace.mount.ms`).
- *셸 분기*: ChatShell / EditorShell / SingleFile 세 모드 각각 측정 — ADR-0010 의 R1 ("가볍다" 원칙 깨짐) 회귀 추적.

### D5. 새 의존성 도입 규약

PR 이 5 MB 이상의 새 dependency 를 도입하면:
1. 본 ADR 의 D1 표를 같은 PR 에서 update 하거나,
2. ceiling 안에 들어가도록 lazy-load (`import()`) 로 분할,
3. 둘 다 안 되면 도입 거부.

ADR-0004 의 Claude SDK, ADR-0010 의 ChatShell, ADR-0012 의 plugin SDK 모두 본 규약 통과 후 채택됨.

## Consequences

### 양

- "가볍다" 가 정량 게이팅 — 마케팅 카피와 빌드가 일치.
- 새 ADR 이 본 ADR 을 참조해 *동일 숫자* 를 인용하면 됨 — 분산 정의 회피.
- 회귀 추적이 platform 별로 독립 — Windows 가 macOS 보다 느려도 별도 게이트.

### 음

- Ceiling 이 가깝다 → 정상 PR 도 가끔 fail. *false-positive* 율을 budget headroom 20% 으로 완충.
- 디버그/릴리즈 환산 계수가 경험치 — 새 platform 추가 시 calibration 필요.

### 위험

- **R1**: ceiling 을 늘리는 PR 이 점진적으로 누적되어 "가볍다" 가 약해짐. → 완화: ceiling 변경 PR 은 라벨 `perf:ceiling-change` 강제 + CODEOWNERS 에서 perf unit 리뷰 의무.
- **R2**: 콜드 스타트 측정의 환경 noise. → 완화: 5 runs 후 p50/p95 사용, warmup 1회 제외, CI runner 격리.
- **R3**: 사용자가 본 ADR 의 release 환산 표기 (<600ms) 만 보고 자기 머신에서 측정하면 실측이 다를 수 있음 (콜드 디스크, AV scan). → 완화: 마케팅/문서에서 "warm second-launch, M-class Mac 기준" 명시.

## Validation plan

- S-PF-002: `cold-start-probe.mjs` + `check-budgets.mjs` 가 budget 초과 시 exit 1.
- S-PF-019: `check-bundle.mjs` 가 ceiling 초과 시 exit 1.
- S-PF-020: 인공 회귀 PR (5 MB dummy dep 추가) 로 게이팅이 fail 하는지 확인.
- S-PF-021: 플랫폼별 budget — Linux / Windows runner 에서 각각 통과.

## References

- `scripts/perf/check-bundle.mjs:14~20` — `CEILINGS` 상수.
- `scripts/perf/check-budgets.mjs:21~26` — `DEFAULT_BUDGETS` per platform.
- `scripts/perf/cold-start-probe.mjs` — 측정 절차.
- `.github/workflows/perf.yml` — CI 통합.
- ADR-0004 D-Consequences, ADR-0010 R1, ADR-0012 Context (모두 본 ADR 의 숫자 참조).
