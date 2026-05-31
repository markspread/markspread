# ADR-0015 — Revenue Model: Free OSS (AGPL-3.0) + Obsidian-Pattern Subscription

- **Status**: Accepted (2026-05-30)
- **Cycle**: CYC-01KSWHTW2ZTXRS3HSYGDBNSNX2 (T4 closure 실행)
- **Discovery**: T4 + H10 + 시장 조사 ([Obsidian](https://obsidian.md/pricing), [Zed](https://zed.dev/pricing), [Cursor](https://cursor.com/pricing), [Logseq](https://github.com/logseq/logseq), [Typora](https://typora.io/), [Inkdrop](https://www.inkdrop.app/))

## Context

OSS 정신 vs 수익 모델의 조화. 본인 자가 운영 + 1인 sustainable + 제품 정체성 (가벼움·로컬 우선·BYOK) 과 정합. 초기 권장 안 (LLM 게이트) 은 본인 직관과 시장 사례 재검토 후 거부 (LLM 게이트 = 본 도구 정체성 ❌, 운영 리스크 큼).

## Decision

### 1. License

**AGPL-3.0** (Logseq 검증 패턴).

근거:
- Free OSS + 자체 운영 Sync/Publish SaaS 모델에서 *fork 방어 필수*.
- MIT 면 fork 가 우리 코드 그대로 자체 SaaS 차려 사업 잠식 가능.
- AGPL = SaaS 운영 시 *수정사항 공개 의무* → 사실상 enterprise fork 차단.
- 의존성 (React/Tauri/CodeMirror/Vercel AI SDK) AGPL 호환 확인 ✓.

### 2. Free tier (모든 사용자)

- 코드 = AGPL-3.0 OSS.
- 전 기능 + 모든 페르소나 만족.
- **AI 동선 3가지**:
  1. BYOK (모든 provider via Vercel AI SDK — Anthropic, OpenAI, Gemini, Grok, DeepSeek, Ollama 등)
  2. Claude Code SDK in-process (본인 Claude.ai 구독 활용)
  3. ACP (Agent Client Protocol) — 외부 ACP 에이전트 연결
- 데이터 = 로컬 only.

### 3. Paid layer (Obsidian 패턴 mirror)

| Tier | 가격 | 포함 |
|---|---|---|
| **Sync** | $5/mo annual ($6/mo monthly) | 워크스페이스 설정 + 플러그인 구성 + AI 리뷰 세션 이력 *e2e 암호화* 동기화. **문서 파일 제외** (로컬 우선 절대 유지). 디바이스 N개. version history. |
| **Publish** | $10/mo per site | 사용자 선택 문서 → 정적 HTML site publish. AI 코멘트·diff 이력 함께 표시 (옵션). 커스텀 도메인 또는 `markspread.app` 서브도메인. |
| **Commercial License** | $50/y per user | 조직 사용. honor system (Obsidian 식). 법적 강제 ❌. |

### 4. 명시 거부 모델

- **LLM 게이트** ❌ — 1인 운영 리스크 (abuse·refund·cost variability) + 정체성 (LLM 재판매 사업화) 불일치.
- **자체 마켓플레이스 수수료** ❌ — VSCode/Cursor 마켓플레이스도 유료 모델 없음. 호환 카테고리에서 수수료 = 억지.
- **Dual License (MongoDB 류)** ❌ — 영업·법무 부담. honor-system Commercial License 로 대체.

### 5. 인프라 (1인 운영 가능 검증)

- Sync 서버: **Cloudflare R2** (스토리지) + **Hono on Cloudflare Workers** (API) + **Clerk/Auth.js** (auth).
- Publish 호스팅: Vercel/Cloudflare Pages.
- 결제: **Stripe Checkout**.
- 셀프 호스팅 옵션: 사용자가 본인 인프라에서 운영 가능 (AGPL 공개 의무 준수).

## Rationale

- [Obsidian](https://obsidian.md/pricing) ($25M ARR 추정, 7-person team, bootstrap) = 로컬 우선 + 옵션 SaaS 패턴이 1인-소팀 운영에 검증됨.
- 본 도구의 *문서 워크벤치* 정체성과 Sync/Publish 가 자연 결합.
- LLM 게이트 거부 = 본인 1인 운영 + AGPL 보호로 fork 위험 충분히 방어.

## Consequences

- 모든 markspread 관련 레포 → PRIVATE 전환 완료 (개발 중).
- CONTEXT.md §3, §9 = 새 모델로 전면 개정 (v1.0).
- 라이선스 파일 교체 필요 (`LICENSE` → AGPL-3.0).
- Sync/Publish/Commercial 인프라 구현 task 분리됨 (U8).
- GitHub Sponsors 링크는 보조로 추가 (수익 다각화).

## Alternatives Considered

- **A. BYOK only (수익 0)**: 지속 불가.
- **B. Hosted Sync (Obsidian 패턴)**: ✅ 채택.
- **C. LLM Gate (Cursor/Zed)**: ❌ 거부 (1인 리스크 + 정체성).
- **D. Claude OAuth 만**: 수익 0, BYOK 와 동일 효과.
- **E. Dual License**: 1인 무리.
- **F. 기부**: 단독 불충분, 보조로만.
- **G. 마켓플레이스 수수료**: 정체성 불일치, 본인 거부.

## Related

- ADR-0004 — Claude Agent SDK Subscription Auth
- CONTEXT.md §3, §9
- TASK-01KSW5E3* (Sync/Publish/Commercial 구현)
- TASK-01KSW5E3B2PYHWV3RTMWC2MQ6K (License 결정 — done)
